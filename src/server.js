require('dotenv').config();
const express      = require('express');
const session      = require('express-session');
const rateLimit    = require('express-rate-limit');
const path         = require('path');
const fs           = require('fs');
const crypto       = require('crypto');

const db = require('./db');
const { getAuthUrl, exchangeCode, getAuthStatus } = require('./linkedin');
const scheduler = require('./scheduler');
const { regenerateDraft, reloadSkills, evaluate, draft, buildEvalContext, analyzeArticleUrl } = require('./pipeline');
const { checkSourceHealth } = require('./crawler');
const { streamCalibration, appendPointOfView } = require('./calibrate');

// ─── Config helpers ───────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
if (!require('fs').existsSync(CONFIG_PATH)) {
  console.error('config.json not found. Copy config.example.json to config.json and fill in your details.');
  process.exit(1);
}const loadConfig  = () => JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const saveConfig  = (c) => fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express();
const PORT        = process.env.PORT || 3000;
const UI_PASSWORD = process.env.UI_PASSWORD || 'changeme';

if (!process.env.UI_PASSWORD)    console.warn('[security] UI_PASSWORD not set — using default. Set it in .env before exposing to the network.');
if (!process.env.SESSION_SECRET) console.warn('[security] SESSION_SECRET not set — using default. Set it in .env before exposing to the network.');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret:            process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave:            false,
  saveUninitialized: false,
  cookie:            { secure: process.env.HTTPS === 'true', maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

const loginLimiter = rateLimit({
  windowMs:         15 * 60 * 1000, // 15 minutes
  max:              10,              // 10 attempts per window
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many login attempts, please try again later.' },
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Auth middleware ──────────────────────────────────────────────────────────

function requireLogin(req, res, next) {
  if (req.session?.authenticated) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not authenticated' });
  res.redirect('/login');
}

// ─── Login / logout ───────────────────────────────────────────────────────────

app.get('/login', (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'))
);

app.post('/api/login', loginLimiter, (req, res) => {
  if (req.body.password === UI_PASSWORD) {
    req.session.authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// ─── LinkedIn OAuth ───────────────────────────────────────────────────────────

app.get('/auth/linkedin', requireLogin, (req, res) => {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  res.redirect(getAuthUrl(state));
});

app.get('/auth/linkedin/callback', requireLogin, async (req, res) => {
  const { code, state, error } = req.query;
  if (error)                         return res.redirect(`/?error=${encodeURIComponent(error)}`);
  if (state !== req.session.oauthState) return res.status(400).send('OAuth state mismatch.');

  try {
    await exchangeCode(code);
    res.redirect('/?linked=1');
  } catch (err) {
    res.redirect(`/?error=${encodeURIComponent(err.message)}`);
  }
});

// ─── LinkedIn status ──────────────────────────────────────────────────────────

app.get('/api/linkedin/status', requireLogin, (req, res) => {
  res.json(getAuthStatus());
});

// ─── Dashboard ────────────────────────────────────────────────────────────────

app.get('/api/dashboard', requireLogin, (req, res) => {
  const healthRaw = db.getSetting('source_health');
  res.json({
    stats:          db.getStats(),
    linkedInStatus: getAuthStatus(),
    config:         loadConfig(),
    sourceHealth:   healthRaw
      ? { ...JSON.parse(healthRaw), checkedAt: db.getSetting('source_health_checked_at') }
      : null,
  });
});

// ─── Drafts ───────────────────────────────────────────────────────────────────

app.get('/api/drafts/pending', requireLogin, (req, res) =>
  res.json(db.getDraftsByStatus('pending_review'))
);

app.get('/api/drafts/queue', requireLogin, (req, res) =>
  res.json(db.getApprovedQueue())
);

app.get('/api/drafts/:id', requireLogin, (req, res) => {
  const d = db.getDraftById(Number(req.params.id));
  d ? res.json(d) : res.status(404).json({ error: 'Not found' });
});

app.post('/api/drafts/:id/approve', requireLogin, (req, res) => {
  db.approveDraft(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/drafts/:id/reject', requireLogin, (req, res) => {
  db.rejectDraft(Number(req.params.id), req.body.note);
  res.json({ ok: true });
});

app.post('/api/drafts/:id/regenerate', requireLogin, async (req, res) => {
  try {
    const result = await regenerateDraft(Number(req.params.id), req.body.guidance || '', loadConfig());
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/drafts/:id', requireLogin, (req, res) => {
  if (!req.body.post_text) return res.status(400).json({ error: 'post_text required' });
  db.updateDraftText(Number(req.params.id), req.body.post_text);
  res.json({ ok: true });
});

app.post('/api/drafts/queue/reorder', requireLogin, (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds array required' });
  db.reorderQueue(orderedIds);
  res.json({ ok: true });
});

// ─── Posts ────────────────────────────────────────────────────────────────────

app.get('/api/posts/recent', requireLogin, (req, res) =>
  res.json(db.getRecentPosts(20))
);

// ─── Manual triggers ──────────────────────────────────────────────────────────

app.get('/api/sources/health', requireLogin, async (req, res) => {
  try {
    const results = await checkSourceHealth(loadConfig());
    db.setSetting('source_health', JSON.stringify(results));
    db.setSetting('source_health_checked_at', new Date().toISOString());
    res.json({ ...results, checkedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/run/crawl', requireLogin, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const result = await scheduler.runCrawlAndPipeline(send);
    send({ done: true, ...result });
  } catch (err) {
    send({ error: err.message });
  } finally {
    res.end();
  }
});

app.post('/api/run/post', requireLogin, async (req, res) => {
  try {
    res.json(await scheduler.runWeeklyPost());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/run/analyze', requireLogin, async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url required' });
  try {
    const result = await analyzeArticleUrl(url);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/run/analytics', requireLogin, (req, res) => {
  res.json({ ok: true, message: 'Analytics sync started in background' });
  scheduler.runAnalyticsSync().catch((err) =>
    console.error('[server] Manual analytics sync error:', err.message)
  );
});

// ─── Analytics ────────────────────────────────────────────────────────────────

app.get('/api/analytics', requireLogin, (req, res) => {
  res.json({
    sources: db.getSourceStats(),
    trends:  db.getEngagementTrends(),
  });
});

// ─── Feed ─────────────────────────────────────────────────────────────────────

app.get('/api/articles', requireLogin, (req, res) => {
  const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
  const TWO_WEEKS  = 14 * 24 * 60 * 60 * 1000;
  const articles = db.getAllArticles().map(a => {
    const evalData = a.eval_data ? JSON.parse(a.eval_data) : null;
    const expires_at =
      (a.status === 'skipped' && !a.starred)
        ? new Date(new Date(a.fetched_at).getTime() + THREE_DAYS).toISOString()
      : (a.status === 'drafted' && !a.starred && a.draft_status !== 'approved' && a.draft_status !== 'posted')
        ? new Date(new Date(a.fetched_at).getTime() + TWO_WEEKS).toISOString()
      : null;
    const queued_for_deletion = !a.starred
      && a.status === 'drafted'
      && a.draft_status === 'rejected';
    return {
      id:                  a.id,
      title:               a.title,
      url:                 a.url,
      source:              a.source,
      status:              a.status,
      draft_status:        a.draft_status || null,
      fetched_at:          a.fetched_at,
      eval_score:          a.eval_score,
      key_insight:         evalData?.keyInsight        || null,
      primary_connection:  evalData?.primaryConnection || null,
      eval_breakdown: evalData ? {
        overallScore:      evalData.overallScore        ?? null,
        primaryConnection: evalData.primaryConnection   || null,
        relevance:         evalData.relevanceScore      ?? null,
        timeliness:        evalData.timelinessScore     ?? null,
        specificity:       evalData.specificityScore    ?? null,
        feedValue:         evalData.feedValueScore      ?? evalData.postPotentialScore ?? null,
        skipReason:        evalData.skipReason          || null,
        similarityNote:    evalData.similarityNote      || null,
      } : null,
      starred:             !!a.starred,
      expires_at,
      queued_for_deletion,
    };
  });
  res.json(articles);
});

app.post('/api/articles/:id/ai-assist', requireLogin, async (req, res) => {
  try {
    const article = db.getArticleById(Number(req.params.id));
    if (!article) return res.status(404).json({ error: 'Article not found' });

    let evalData = article.eval_data ? JSON.parse(article.eval_data) : null;
    if (!evalData) {
      const { rejectionContext, recencyContext } = buildEvalContext();
      evalData = await evaluate(article, rejectionContext, recencyContext);
      if (!evalData) return res.status(500).json({ error: 'Evaluation failed' });
      db.updateArticleEval(article.id, evalData.overallScore, evalData, 'evaluated');
    }

    const postText = await draft(article, evalData, loadConfig(), req.body.guidance || null);
    if (!postText) return res.status(500).json({ error: 'Draft generation failed' });

    res.json({ post_text: postText, score: evalData.overallScore || article.eval_score });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/drafts', requireLogin, (req, res) => {
  const { article_id, post_text } = req.body;
  if (!post_text?.trim()) return res.status(400).json({ error: 'post_text required' });
  const result = db.insertDraft({
    article_id:         article_id || null,
    post_text:          post_text.trim(),
    primary_connection: null,
    key_insight:        null,
    eval_score:         null,
  });
  if (article_id) db.markArticleDrafted(article_id);
  res.json({ ok: true, draftId: result.lastInsertRowid });
});

app.post('/api/articles/:id/star', requireLogin, (req, res) => {
  const result = db.toggleArticleStar(Number(req.params.id));
  res.json({ starred: !!result.starred });
});

app.delete('/api/articles/:id', requireLogin, (req, res) => {
  db.deleteArticle(Number(req.params.id));
  res.json({ ok: true });
});

// ─── Skills / Calibrate ───────────────────────────────────────────────────────

const SKILLS_DIR     = path.join(__dirname, '..', 'skills');
const ALLOWED_SKILLS = ['writing-style', 'content-eval', 'job-context', 'points-of-view'];

app.get('/api/skills/:name', requireLogin, (req, res) => {
  if (!ALLOWED_SKILLS.includes(req.params.name))
    return res.status(400).json({ error: 'Unknown skill' });
  try {
    const content = fs.readFileSync(path.join(SKILLS_DIR, `${req.params.name}.md`), 'utf-8');
    res.json({ name: req.params.name, content });
  } catch {
    res.json({ name: req.params.name, content: '' });
  }
});

app.put('/api/skills/:name', requireLogin, (req, res) => {
  if (!ALLOWED_SKILLS.includes(req.params.name))
    return res.status(400).json({ error: 'Unknown skill' });
  if (!req.body.content || typeof req.body.content !== 'string')
    return res.status(400).json({ error: 'content required' });
  fs.writeFileSync(path.join(SKILLS_DIR, `${req.params.name}.md`), req.body.content, 'utf-8');
  reloadSkills();
  res.json({ ok: true });
});

app.post('/api/calibrate/interview', requireLogin, async (req, res) => {
  const { skillName, currentContent, messages } = req.body;
  if (!ALLOWED_SKILLS.includes(skillName))
    return res.status(400).json({ error: 'Unknown skill' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    await streamCalibration({ skillName, currentContent, messages, res });
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

app.post('/api/calibrate/pov', requireLogin, async (req, res) => {
  const { rejectionNote, postText } = req.body;
  if (!rejectionNote) return res.status(400).json({ error: 'rejectionNote required' });
  try {
    const updated = await appendPointOfView(rejectionNote, postText || '');
    fs.writeFileSync(path.join(SKILLS_DIR, 'writing-style.md'), updated, 'utf-8');
    reloadSkills();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Config ───────────────────────────────────────────────────────────────────

app.get('/api/config', requireLogin, (req, res) => res.json(loadConfig()));

app.put('/api/config', requireLogin, (req, res) => {
  const updated = { ...loadConfig(), ...req.body };
  saveConfig(updated);
  scheduler.updateConfig(updated);
  res.json({ ok: true });
});

// ─── Global error handler ─────────────────────────────────────────────────────

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server] Unhandled error:', err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
});

// ─── Start ────────────────────────────────────────────────────────────────────

scheduler.start(loadConfig());

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════╗
║  Vantage — http://localhost:${PORT}         ║
╚═══════════════════════════════════════╝
  `);
});

module.exports = app;
