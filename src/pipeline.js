const Anthropic = require('@anthropic-ai/sdk');
const axios     = require('axios');
const fs        = require('fs');
const path      = require('path');
const {
  getPendingArticles, updateArticleEval, markArticleDrafted, insertDraft,
  getRecentRejectionNotes, getRecentPostTitles, getDraftById, updateDraftText,
  insertArticle, getArticleByUrl, getArticleById,
} = require('./db');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const SKILLS = path.join(__dirname, '..', 'skills');

const skills = {
  contentEval:  fs.readFileSync(path.join(SKILLS, 'content-eval.md'),    'utf-8'),
  jobContext:   fs.readFileSync(path.join(SKILLS, 'job-context.md'),     'utf-8'),
  writingStyle: fs.readFileSync(path.join(SKILLS, 'writing-style.md'),   'utf-8'),
  pointsOfView: fs.readFileSync(path.join(SKILLS, 'points-of-view.md'), 'utf-8'),
};

// ─── Eval context ─────────────────────────────────────────────────────────────

function buildEvalContext() {
  const rejectionNotes = getRecentRejectionNotes(15);
  const rejectionContext = rejectionNotes.length
    ? rejectionNotes.map(r => `- "${r.title}" (${r.source}): ${r.rejection_note}`).join('\n')
    : null;
  const recentPosts    = getRecentPostTitles(10);
  const recencyContext = buildRecencyContext(recentPosts);
  return { rejectionContext, recencyContext };
}

// ─── Step 1: Evaluate ─────────────────────────────────────────────────────────

function buildRecencyContext(recentPosts) {
  if (!recentPosts.length) return null;
  return recentPosts.map(p => {
    const daysAgo = Math.round((Date.now() - new Date(p.posted_at).getTime()) / 86400000);
    return `- "${p.title}" (${daysAgo} day${daysAgo !== 1 ? 's' : ''} ago)`;
  }).join('\n');
}

async function evaluate(article, rejectionContext, recencyContext) {
  const rejectionBlock = rejectionContext
    ? `---

REJECTION FEEDBACK:
The author has recently rejected drafts with these notes. Use this to calibrate
your scoring — if this article is likely to produce content the author would
reject for similar reasons, score it lower and set pass to false.

${rejectionContext}

---

`
    : '';

  const recencyBlock = recencyContext
    ? `---

RECENTLY ENGAGED ARTICLES (do not repeat these themes):
The author has recently published content on these articles. If the current article
would produce substantially the same theme, angle, or core argument as one of
these, set tooSimilarToRecent to true and explain briefly in similarityNote.
Minor topical overlap is fine — near-identical angles are not.

${recencyContext}

---

`
    : '';

  // Extract optional scoring notes block from the skill file (everything after "## Scoring notes")
  const scoringNotesMatch = skills.contentEval.match(/^## Scoring notes[\s\S]*/m);
  const scoringNotes = scoringNotesMatch
    ? scoringNotesMatch[0].replace(/^## Scoring notes.*\n/, '').trim()
    : null;

  const scoringNotesBlock = scoringNotes
    ? `ADDITIONAL SCORING CONTEXT (from author's preferences):\n${scoringNotes}\n\n`
    : '';

  const system = `You are a content curator evaluating articles for a professional's feed.

## Scoring Dimensions

Score each dimension 1–10.

### Relevance (weight: 50%)

${skills.contentEval.split('## Scoring notes')[0].trim()}

---

For professional background and job context:

${skills.jobContext}

---

For points of view — use these to assess opinion-triggered relevance.
An article that CHALLENGES one of these views scores equally to one that REINFORCES it.
Both prompt genuine engagement. Do not penalise disagreement.

${skills.pointsOfView}

---

### Timeliness (weight: 20%)
- Published within the last week: 9–10
- Within the last month: 6–8
- Within the last quarter: 3–5
- Older: 1–2

### Specificity (weight: 15%)
Does the article contain concrete findings, data, techniques, or specific examples?
Vague think-pieces, listicles, and generic hot-takes score low. Technical depth,
empirical findings, specific frameworks, and hard-won lessons score high.

### Feed Value (weight: 15%)
Would this article be worth the author's time even without writing a post about it?
Is there a genuine insight, a surprising finding, a useful framework, or a perspective
worth engaging with? Purely promotional content, complete paywalls, or content only
meaningful to a niche academic audience score low.

## Scoring Formula
overallScore = (relevance × 0.5) + (timeliness × 0.2) + (specificity × 0.15) + (feedValue × 0.15)
Round to one decimal place.

## Principles
- An article that challenges the author's views ranks the same as one that reinforces them.
- Score what the article actually contains, not what the headline promises.
- Set pass: false only when the article has genuinely no connection to the author's
  work, interests, or points of view — not merely because it disagrees with them.

${scoringNotesBlock}${rejectionBlock}${recencyBlock}## Output Format

Return ONLY a valid JSON object. No markdown fences, no explanation, no preamble.

{
  "relevanceScore": 8,
  "timelinessScore": 9,
  "specificityScore": 7,
  "feedValueScore": 8,
  "overallScore": 8.0,
  "primaryConnection": "Brief description of which work area, topic, or POV this connects to",
  "keyInsight": "One sentence: the core takeaway that makes this article worth reading.",
  "applicationHook": "One sentence: how this connects to the author's specific work or experience.",
  "pass": true,
  "skipReason": null,
  "tooSimilarToRecent": false,
  "similarityNote": null
}

Set pass: false only for clear disqualifiers — entirely paywalled with no substantive preview,
pure press release or promotional content with no analysis, or so vague from the excerpt that
relevance cannot be assessed at all. Do not set pass: false simply because you disagree with
the article or because it scores low. The score threshold handles low-relevance filtering.
pass: false is for articles that should not be in the feed regardless of score.

If pass is false, populate skipReason with a brief explanation.
If tooSimilarToRecent is true, populate similarityNote explaining which recent article it overlaps with and why.`;

  const user = `Evaluate this article for the author's professional feed.

Title: ${article.title}
Source: ${article.source}
URL: ${article.url}
Excerpt: ${article.summary || '(none)'}`;

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 512,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const raw      = msg.content[0].text.trim();
    const stripped = raw.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
    const match    = stripped.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object found in response');
    return JSON.parse(match[0]);
  } catch (err) {
    console.error(`[pipeline] Eval failed "${article.title}":`, err.message);
    return null;
  }
}

// ─── Step 2: Draft ────────────────────────────────────────────────────────────

async function draft(article, evalData, config, guidance = null) {
  const maxChars = config.pipeline?.maxPostChars || config.pipeline?.linkedInPostMaxChars || 2800;

  const system = `You are a writing assistant helping the author draft content in their voice.

WRITING STYLE:
${skills.writingStyle}

JOB CONTEXT:
${skills.jobContext}

POINTS OF VIEW:
${skills.pointsOfView}

CRITICAL INSTRUCTION — READ BEFORE DRAFTING:
The draft must start from a Point of View, not from the article. Before writing
a single word, identify the opinion in the Points of View section that most
closely matches the article's subject. That opinion is the foundation. The article
is a hook — a current, concrete example of something the author already believes.
Write as if the author is reacting to the article through that lens.

Do NOT open by describing what the article says. Do NOT open with what
researchers found, what the study showed, or what the author argued. The
first sentence should state the author's opinion or name the problem they see —
not describe the article.

A reader who has not seen the article should come away with a clear opinion,
not a sense of what the article covered.

Stay under ${maxChars} characters. Return ONLY the draft text — no preamble, no explanation, no surrounding quotes.`;

  const user = `Write a draft for this article.

Title: ${article.title}
Source: ${article.source}
URL: ${article.url}
Excerpt: ${article.summary || '(none)'}

Use these insights from the evaluation:
- Key insight: ${evalData.keyInsight || ''}
- Application hook: ${evalData.applicationHook || ''}
- Primary connection to the author's work: ${evalData.primaryConnection || ''}
${guidance ? `\nAuthor guidance for this draft: ${guidance}` : ''}`;

  try {
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system,
      messages: [{ role: 'user', content: user }],
    });
    return msg.content[0].text.trim();
  } catch (err) {
    console.error(`[pipeline] Draft failed "${article.title}":`, err.message);
    return null;
  }
}

// ─── Regenerate existing draft ────────────────────────────────────────────────

async function regenerateDraft(draftId, guidance, config) {
  const existing = getDraftById(draftId);
  if (!existing) throw new Error('Draft not found');

  const article = {
    title:   existing.article_title   || 'Unknown',
    source:  existing.article_source  || 'Unknown',
    url:     existing.article_url     || '',
    summary: '',
  };

  const evalData = existing.article_eval_data
    ? JSON.parse(existing.article_eval_data)
    : {
        keyInsight:        existing.key_insight        || '',
        applicationHook:   '',
        primaryConnection: existing.primary_connection || '',
      };

  const postText = await draft(article, evalData, config, guidance || null);
  if (!postText) throw new Error('Draft generation failed');

  updateDraftText(draftId, postText);
  return { post_text: postText };
}

// ─── Fetch article content ────────────────────────────────────────────────────

async function fetchArticleContent(url) {
  const { data } = await axios.get(url, {
    timeout: 15000,
    headers: { 'User-Agent': 'Vantage/1.0' },
    maxContentLength: 2 * 1024 * 1024,
    responseType: 'text',
  });

  const titleMatch = data.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const rawTitle   = titleMatch ? titleMatch[1] : '';
  const title = rawTitle
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&\w+;/g, '')
    .replace(/\s+/g, ' ').trim() || new URL(url).hostname;

  const source = new URL(url).hostname.replace(/^www\./, '');

  // Strip scripts and styles first
  const cleaned = data
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  // Try to find a main content area to avoid nav/header/footer noise
  const mainMatch = cleaned.match(/<(?:article|main)(?:\s[^>]*)?>( [\s\S]*?)<\/(?:article|main)>/i);
  const contentArea = mainMatch ? mainMatch[1] : cleaned;

  // Extract paragraph text — filters out short nav/button strings
  const paragraphs = [];
  const pPattern = /<p(?:\s[^>]*)?>( [\s\S]*?)<\/p>/gi;
  let pMatch;
  while ((pMatch = pPattern.exec(contentArea)) !== null) {
    const text = pMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length > 40) paragraphs.push(text);
  }

  const summary = paragraphs.length
    ? paragraphs.join(' ').slice(0, 1500)
    : cleaned.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000);

  return { title, source, summary };
}

// ─── Analyze article by URL (fetch + eval only, no draft) ────────────────────

async function analyzeArticleUrl(url) {
  console.log(`[pipeline] Analyze URL: ${url}`);

  try { new URL(url); } catch { throw new Error('Invalid URL'); }

  let articleContent;
  try {
    articleContent = await fetchArticleContent(url);
  } catch (err) {
    throw new Error(`Could not fetch URL: ${err.message}`);
  }

  insertArticle({
    source:       articleContent.source,
    source_type:  'manual',
    url,
    title:        articleContent.title,
    summary:      articleContent.summary,
    published_at: new Date().toISOString(),
  });

  const article = getArticleByUrl(url);
  if (!article) throw new Error('Failed to store article');

  const { rejectionContext, recencyContext } = buildEvalContext();
  const evalData = await evaluate(article, rejectionContext, recencyContext);
  if (!evalData) throw new Error('Evaluation failed');

  updateArticleEval(article.id, evalData.overallScore, evalData, 'evaluated');
  console.log(`[pipeline] Analyze score: ${evalData.overallScore}/10`);

  return {
    id:                 article.id,
    title:              article.title,
    score:              evalData.overallScore,
    key_insight:        evalData.keyInsight        || null,
    primary_connection: evalData.primaryConnection || null,
    ...(evalData.tooSimilarToRecent && { similarityWarning: evalData.similarityNote }),
  };
}

// ─── Evaluation loop (scores pending articles, no drafting) ──────────────────

async function runEvaluation(config, onProgress) {
  const articleLimit = config.pipeline?.articlesPerCrawlRun || 50;
  console.log('[pipeline] Evaluation starting...');

  const { rejectionContext, recencyContext } = buildEvalContext();
  if (rejectionContext) console.log('[pipeline] Injecting rejection context into eval');
  if (recencyContext)   console.log('[pipeline] Injecting recency context into eval');

  const articles = getPendingArticles(articleLimit);
  console.log(`[pipeline] ${articles.length} pending articles to evaluate`);
  let evaluated = 0;
  let filtered  = 0;

  for (const article of articles) {
    console.log(`[pipeline] Evaluating: "${article.title}"`);
    onProgress?.({ msg: `Scoring: "${article.title}"` });
    const evalData = await evaluate(article, rejectionContext, recencyContext);

    if (!evalData) {
      updateArticleEval(article.id, 0, {}, 'filtered');
      filtered++;
      continue;
    }

    if (evalData.tooSimilarToRecent) {
      console.log(`[pipeline] Filter "${article.title}" — too similar to recent post`);
      updateArticleEval(article.id, evalData.overallScore, evalData, 'filtered');
      filtered++;
      continue;
    }

    if (!evalData.pass) {
      console.log(`[pipeline] Filter "${article.title}": ${evalData.skipReason || 'did not pass'}`);
      updateArticleEval(article.id, evalData.overallScore, evalData, 'filtered');
      filtered++;
      continue;
    }

    updateArticleEval(article.id, evalData.overallScore, evalData, 'scored');
    evaluated++;
    console.log(`[pipeline] Scored "${article.title}": ${evalData.overallScore}/10`);
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[pipeline] Done. evaluated=${evaluated} filtered=${filtered}`);
  return { evaluated, filtered };
}

function reloadSkills() {
  try {
    const contentEval  = fs.readFileSync(path.join(SKILLS, 'content-eval.md'),    'utf-8');
    const jobContext   = fs.readFileSync(path.join(SKILLS, 'job-context.md'),     'utf-8');
    const writingStyle = fs.readFileSync(path.join(SKILLS, 'writing-style.md'),   'utf-8');
    const pointsOfView = fs.readFileSync(path.join(SKILLS, 'points-of-view.md'), 'utf-8');
    skills.contentEval  = contentEval;
    skills.jobContext   = jobContext;
    skills.writingStyle = writingStyle;
    skills.pointsOfView = pointsOfView;
  } catch (err) {
    console.error('[pipeline] Failed to reload skills:', err.message);
    throw err;
  }
}

module.exports = {
  runEvaluation, regenerateDraft, reloadSkills,
  evaluate, draft, buildEvalContext, analyzeArticleUrl,
};
