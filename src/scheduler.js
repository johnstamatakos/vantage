const cron = require('node-cron');
const { runCrawl, checkSourceHealth } = require('./crawler');
const { runEvaluation } = require('./pipeline');
const { postToLinkedIn, getAuthStatus, fetchPostAnalytics } = require('./linkedin');
const { getNextApprovedPost, markDraftPosted, insertPost,
        getPostsPendingAnalytics, updatePostAnalytics, setSetting, pruneArticles } = require('./db');

let config       = null;
let crawlJob     = null;
let postJob      = null;
let analyticsJob = null;
let pruneJob     = null;

// ─── Weekly Post ──────────────────────────────────────────────────────────────

async function runWeeklyPost() {
  console.log('[scheduler] Weekly post check...');

  const auth = getAuthStatus();
  if (!auth.connected) {
    console.warn(`[scheduler] LinkedIn not connected: ${auth.reason}`);
    return { skipped: true, reason: auth.reason };
  }

  const next = getNextApprovedPost();
  if (!next) {
    console.log('[scheduler] Backlog empty. Skipping this week.');
    return { skipped: true, reason: 'Empty backlog' };
  }

  console.log(`[scheduler] Posting draft ${next.id}: "${next.article_title}"`);

  try {
    const linkedInPostId = await postToLinkedIn(next.post_text);
    try {
      insertPost({ draft_id: next.id, post_text: next.post_text, linkedin_post_id: linkedInPostId, status: 'posted' });
      markDraftPosted(next.id);
    } catch (dbErr) {
      console.error(`[scheduler] DB write failed after successful post (LinkedIn ID: ${linkedInPostId}):`, dbErr.message);
    }
    console.log(`[scheduler] Posted. LinkedIn ID: ${linkedInPostId}`);
    return { posted: true, draftId: next.id, linkedInPostId };
  } catch (err) {
    console.error('[scheduler] Post failed:', err.message);
    try {
      insertPost({ draft_id: next.id, post_text: next.post_text, linkedin_post_id: null, status: 'failed' });
    } catch (dbErr) {
      console.error('[scheduler] DB write for failed post also failed:', dbErr.message);
    }
    return { posted: false, error: err.message };
  }
}

// ─── Analytics Sync ───────────────────────────────────────────────────────────

async function runAnalyticsSync() {
  console.log('[scheduler] Analytics sync starting...');

  const auth = getAuthStatus();
  if (!auth.connected) {
    console.warn(`[scheduler] Analytics sync skipped — LinkedIn not connected: ${auth.reason}`);
    return { skipped: true, reason: auth.reason };
  }

  const posts = getPostsPendingAnalytics();
  if (!posts.length) {
    console.log('[scheduler] No posts pending analytics.');
    return { synced: 0, skipped: 0 };
  }

  let synced = 0;
  let failed = 0;

  for (const post of posts) {
    try {
      const analytics = await fetchPostAnalytics(post.linkedin_post_id);
      updatePostAnalytics(post.id, analytics);
      synced++;
      console.log(`[scheduler] Analytics saved for post ${post.id}:`, analytics);
    } catch (err) {
      console.error(`[scheduler] Analytics failed for post ${post.id}:`, err.message);
      failed++;
    }
    // Rate-limit courtesy pause between API calls
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(`[scheduler] Analytics sync done. synced=${synced} failed=${failed}`);
  return { synced, failed };
}

// ─── Crawl + Pipeline ─────────────────────────────────────────────────────────

async function runCrawlAndPipeline(onProgress) {
  console.log('[scheduler] Crawl + pipeline starting...');
  try {
    const pruned = pruneArticles();
    if (pruned.pending || pruned.skipped || pruned.rejected) {
      console.log(`[scheduler] Pruned ${pruned.pending} stale pending + ${pruned.skipped} expired + ${pruned.rejected} rejected articles`);
    }

    onProgress?.({ msg: 'Checking source health...' });
    const health = await checkSourceHealth(config);
    setSetting('source_health', JSON.stringify(health));
    setSetting('source_health_checked_at', new Date().toISOString());

    const broken = [
      health.hackernews && !health.hackernews.ok ? `HN: ${health.hackernews.error}` : null,
      health.reddit     && !health.reddit.ok     ? `Reddit: ${health.reddit.error}` : null,
      ...(health.rss || []).filter(f => !f.ok).map(f => `RSS "${f.name}": ${f.error}`),
    ].filter(Boolean);
    if (broken.length) console.warn('[scheduler] Broken sources:', broken.join(' | '));

    onProgress?.({ msg: 'Crawling sources...' });
    const crawlResult = await runCrawl(config);
    onProgress?.({ msg: `Found ${crawlResult.inserted} new articles. Scoring...` });

    const evalResult = await runEvaluation(config, onProgress);
    console.log('[scheduler] Complete:', { crawlResult, evalResult });
    return { crawlResult, evalResult };
  } catch (err) {
    console.error('[scheduler] Error:', err.message);
    throw err;
  }
}

// ─── Start / Stop ─────────────────────────────────────────────────────────────

function start(appConfig) {
  config = appConfig;
  const crawlCron     = config.schedule?.crawlCron     || '0 8 * * 1,3,5';
  const postCron      = config.schedule?.postCron      || '0 9 * * 2';
  const analyticsCron = config.schedule?.analyticsCron  || '0 10 * * *';
  const tz            = config.schedule?.timezone      || 'America/New_York';

  if (cron.validate(crawlCron)) {
    crawlJob = cron.schedule(crawlCron, () => runCrawlAndPipeline(), { scheduled: true, timezone: tz });
    console.log(`[scheduler] Crawl:     "${crawlCron}" (${tz})`);
  } else {
    console.error(`[scheduler] Invalid crawl cron: "${crawlCron}"`);
  }

  if (cron.validate(postCron)) {
    postJob = cron.schedule(postCron, runWeeklyPost, { scheduled: true, timezone: tz });
    console.log(`[scheduler] Post:      "${postCron}" (${tz})`);
  } else {
    console.error(`[scheduler] Invalid post cron: "${postCron}"`);
  }

  if (cron.validate(analyticsCron)) {
    analyticsJob = cron.schedule(analyticsCron, runAnalyticsSync, { scheduled: true, timezone: tz });
    console.log(`[scheduler] Analytics: "${analyticsCron}" (${tz})`);
  } else {
    console.error(`[scheduler] Invalid analytics cron: "${analyticsCron}"`);
  }

  // Nightly prune — runs regardless of crawl schedule
  pruneJob = cron.schedule('0 3 * * *', () => {
    const pruned = pruneArticles();
    if (pruned.pending || pruned.skipped || pruned.rejected) {
      console.log(`[scheduler] Nightly prune: ${pruned.pending} pending + ${pruned.skipped} skipped + ${pruned.rejected} rejected removed`);
    }
  }, { scheduled: true, timezone: tz });

  // Run once at startup to clean up immediately
  const pruned = pruneArticles();
  if (pruned.pending || pruned.skipped || pruned.rejected) {
    console.log(`[scheduler] Startup prune: ${pruned.pending} pending + ${pruned.skipped} skipped + ${pruned.rejected} rejected removed`);
  }
}

function stop() {
  crawlJob?.stop();
  postJob?.stop();
  analyticsJob?.stop();
  pruneJob?.stop();
}

function updateConfig(newConfig) {
  stop();
  start(newConfig);
}

module.exports = { start, stop, updateConfig, runCrawlAndPipeline, runWeeklyPost, runAnalyticsSync };
