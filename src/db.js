const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'posts.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ───────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS articles (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source       TEXT NOT NULL,
    source_type  TEXT NOT NULL,
    url          TEXT UNIQUE NOT NULL,
    title        TEXT NOT NULL,
    summary      TEXT,
    published_at TEXT,
    fetched_at   TEXT NOT NULL DEFAULT (datetime('now')),
    eval_score   REAL,
    eval_data    TEXT,
    status       TEXT NOT NULL DEFAULT 'pending'
  );

  CREATE TABLE IF NOT EXISTS drafts (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    article_id         INTEGER REFERENCES articles(id),
    post_text          TEXT NOT NULL,
    primary_connection TEXT,
    key_insight        TEXT,
    eval_score         REAL,
    created_at         TEXT NOT NULL DEFAULT (datetime('now')),
    status             TEXT NOT NULL DEFAULT 'pending_review',
    approved_at        TEXT,
    rejected_at        TEXT,
    rejection_note     TEXT,
    queue_position     INTEGER,
    edited             INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS posts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    draft_id         INTEGER REFERENCES drafts(id),
    post_text        TEXT NOT NULL,
    linkedin_post_id TEXT,
    posted_at        TEXT NOT NULL DEFAULT (datetime('now')),
    status           TEXT NOT NULL DEFAULT 'posted'
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_articles_status ON articles(status);
  CREATE INDEX IF NOT EXISTS idx_drafts_status   ON drafts(status);
  CREATE INDEX IF NOT EXISTS idx_drafts_queue    ON drafts(queue_position);
`);

// ─── Migrations ───────────────────────────────────────────────────────────────

const articleCols = new Set(db.prepare('PRAGMA table_info(articles)').all().map(c => c.name));
if (!articleCols.has('starred')) db.exec('ALTER TABLE articles ADD COLUMN starred INTEGER NOT NULL DEFAULT 0');

const postCols = new Set(db.prepare('PRAGMA table_info(posts)').all().map(c => c.name));
if (!postCols.has('impressions'))          db.exec('ALTER TABLE posts ADD COLUMN impressions INTEGER');
if (!postCols.has('reactions'))            db.exec('ALTER TABLE posts ADD COLUMN reactions INTEGER');
if (!postCols.has('comments'))             db.exec('ALTER TABLE posts ADD COLUMN comments INTEGER');
if (!postCols.has('analytics_fetched_at')) db.exec('ALTER TABLE posts ADD COLUMN analytics_fetched_at TEXT');

// ─── Articles ─────────────────────────────────────────────────────────────────

function insertArticle(a) {
  return db.prepare(`
    INSERT OR IGNORE INTO articles (source, source_type, url, title, summary, published_at)
    VALUES (@source, @source_type, @url, @title, @summary, @published_at)
  `).run(a);
}

function getPendingArticles(limit = 50) {
  return db.prepare(`SELECT * FROM articles WHERE status = 'pending' ORDER BY fetched_at DESC LIMIT ?`).all(limit);
}

function updateArticleEval(id, score, evalData, status) {
  db.prepare(`UPDATE articles SET eval_score=?, eval_data=?, status=? WHERE id=?`)
    .run(score, JSON.stringify(evalData), status, id);
}

function markArticleDrafted(id) {
  db.prepare(`UPDATE articles SET status='drafted' WHERE id=?`).run(id);
}

function getArticleById(id) {
  return db.prepare(`SELECT * FROM articles WHERE id = ?`).get(id);
}

function deleteArticle(id) {
  return db.transaction(() => {
    db.prepare(`DELETE FROM drafts WHERE article_id = ?`).run(id);
    return db.prepare(`DELETE FROM articles WHERE id = ?`).run(id);
  })();
}

function getAllArticles() {
  return db.prepare(`
    SELECT a.*,
      (SELECT d.status FROM drafts d WHERE d.article_id = a.id ORDER BY d.created_at DESC LIMIT 1) as draft_status
    FROM articles a
    ORDER BY a.fetched_at DESC
  `).all();
}

function toggleArticleStar(id) {
  db.prepare(`UPDATE articles SET starred = CASE WHEN starred = 1 THEN 0 ELSE 1 END WHERE id = ?`).run(id);
  return db.prepare(`SELECT starred FROM articles WHERE id = ?`).get(id);
}

function pruneArticles() {
  return db.transaction(() => {
    // Pending articles older than 3 days — stale, will never be evaluated
    const pendingResult = db.prepare(`
      DELETE FROM articles
      WHERE status = 'pending' AND starred = 0 AND fetched_at < datetime('now', '-3 days')
    `).run();

    // Skipped articles older than 3 days (not starred)
    const skippedResult = db.prepare(`
      DELETE FROM articles
      WHERE status = 'skipped' AND starred = 0 AND fetched_at < datetime('now', '-3 days')
    `).run();

    // Evaluated articles older than 30 days that were never drafted (not starred)
    const evaluatedResult = db.prepare(`
      DELETE FROM articles
      WHERE status = 'evaluated' AND starred = 0 AND fetched_at < datetime('now', '-30 days')
    `).run();

    // Articles whose latest draft is rejected, with no active draft, not starred
    const toDelete = db.prepare(`
      SELECT a.id FROM articles a
      WHERE a.starred = 0
        AND a.status = 'drafted'
        AND EXISTS     (SELECT 1 FROM drafts d WHERE d.article_id = a.id AND d.status = 'rejected')
        AND NOT EXISTS (SELECT 1 FROM drafts d WHERE d.article_id = a.id AND d.status IN ('pending_review', 'approved', 'posted'))
    `).all();

    for (const { id } of toDelete) {
      db.prepare(`DELETE FROM drafts  WHERE article_id = ?`).run(id);
      db.prepare(`DELETE FROM articles WHERE id = ?`).run(id);
    }

    // Drafted articles older than 14 days (not starred, no approved/posted drafts)
    const expiredDrafted = db.prepare(`
      SELECT a.id FROM articles a
      WHERE a.starred = 0
        AND a.status = 'drafted'
        AND a.fetched_at < datetime('now', '-14 days')
        AND NOT EXISTS (SELECT 1 FROM drafts d WHERE d.article_id = a.id AND d.status IN ('approved', 'posted'))
    `).all();

    for (const { id } of expiredDrafted) {
      db.prepare(`DELETE FROM drafts  WHERE article_id = ?`).run(id);
      db.prepare(`DELETE FROM articles WHERE id = ?`).run(id);
    }

    // Stale pending_review drafts older than 14 days (not on starred articles)
    const staleDraftsResult = db.prepare(`
      DELETE FROM drafts
      WHERE status = 'pending_review'
        AND created_at < datetime('now', '-14 days')
        AND (article_id IS NULL OR article_id NOT IN (SELECT id FROM articles WHERE starred = 1))
    `).run();

    return {
      pending:        pendingResult.changes,
      skipped:        skippedResult.changes,
      evaluated:      evaluatedResult.changes,
      rejected:       toDelete.length,
      expiredDrafted: expiredDrafted.length,
      staleDrafts:    staleDraftsResult.changes,
    };
  })();
}

// ─── Drafts ───────────────────────────────────────────────────────────────────

function insertDraft(d) {
  return db.prepare(`
    INSERT INTO drafts (article_id, post_text, primary_connection, key_insight, eval_score)
    VALUES (@article_id, @post_text, @primary_connection, @key_insight, @eval_score)
  `).run(d);
}

function getDraftsByStatus(status) {
  return db.prepare(`
    SELECT d.*, a.title as article_title, a.url as article_url,
           a.source as article_source, a.eval_data as article_eval_data
    FROM drafts d LEFT JOIN articles a ON d.article_id = a.id
    WHERE d.status = ? ORDER BY d.created_at DESC
  `).all(status);
}

function getApprovedQueue() {
  return db.prepare(`
    SELECT d.*, a.title as article_title, a.url as article_url
    FROM drafts d LEFT JOIN articles a ON d.article_id = a.id
    WHERE d.status = 'approved'
    ORDER BY COALESCE(d.queue_position, 9999), d.approved_at ASC
  `).all();
}

function getDraftById(id) {
  return db.prepare(`
    SELECT d.*, a.title as article_title, a.url as article_url,
           a.source as article_source, a.eval_data as article_eval_data
    FROM drafts d LEFT JOIN articles a ON d.article_id = a.id
    WHERE d.id = ?
  `).get(id);
}

function approveDraft(id) {
  const { max } = db.prepare(
    `SELECT COALESCE(MAX(queue_position), 0) as max FROM drafts WHERE status = 'approved'`
  ).get();
  db.prepare(`
    UPDATE drafts SET status='approved', approved_at=datetime('now'), queue_position=? WHERE id=?
  `).run(max + 1, id);
}

function rejectDraft(id, note) {
  db.prepare(`
    UPDATE drafts SET status='rejected', rejected_at=datetime('now'), rejection_note=? WHERE id=?
  `).run(note || null, id);
}

function updatePostAnalytics(id, { impressions, reactions, comments }) {
  db.prepare(`
    UPDATE posts
    SET impressions=?, reactions=?, comments=?, analytics_fetched_at=datetime('now')
    WHERE id=?
  `).run(impressions ?? null, reactions ?? null, comments ?? null, id);
}

function getPostsPendingAnalytics() {
  return db.prepare(`
    SELECT * FROM posts
    WHERE status = 'posted'
      AND linkedin_post_id IS NOT NULL
      AND analytics_fetched_at IS NULL
      AND posted_at < datetime('now', '-48 hours')
  `).all();
}

function getRecentPostTitles(limit = 10) {
  return db.prepare(`
    SELECT a.title, p.posted_at
    FROM posts p
    LEFT JOIN drafts d ON p.draft_id = d.id
    LEFT JOIN articles a ON d.article_id = a.id
    WHERE p.status = 'posted' AND a.title IS NOT NULL
    ORDER BY p.posted_at DESC
    LIMIT ?
  `).all(limit);
}

function getRecentRejectionNotes(limit = 15) {
  return db.prepare(`
    SELECT d.rejection_note, a.title, a.source
    FROM drafts d
    LEFT JOIN articles a ON d.article_id = a.id
    WHERE d.status = 'rejected'
      AND d.rejection_note IS NOT NULL
      AND trim(d.rejection_note) != ''
    ORDER BY d.rejected_at DESC
    LIMIT ?
  `).all(limit);
}

function getArticleByUrl(url) {
  return db.prepare(`SELECT * FROM articles WHERE url = ?`).get(url);
}

function updateDraftText(id, text) {
  db.prepare(`UPDATE drafts SET post_text=?, edited=1 WHERE id=?`).run(text, id);
}

function reorderQueue(orderedIds) {
  const stmt = db.prepare(`UPDATE drafts SET queue_position=? WHERE id=?`);
  db.transaction((ids) => ids.forEach((id, i) => stmt.run(i + 1, id)))(orderedIds);
}

function getNextApprovedPost() {
  return db.prepare(`
    SELECT d.*, a.title as article_title
    FROM drafts d LEFT JOIN articles a ON d.article_id = a.id
    WHERE d.status = 'approved'
    ORDER BY COALESCE(d.queue_position, 9999), d.approved_at ASC
    LIMIT 1
  `).get();
}

function markDraftPosted(id) {
  db.prepare(`UPDATE drafts SET status='posted' WHERE id=?`).run(id);
}

// ─── Posts ────────────────────────────────────────────────────────────────────

function insertPost(p) {
  return db.prepare(`
    INSERT INTO posts (draft_id, post_text, linkedin_post_id, status)
    VALUES (@draft_id, @post_text, @linkedin_post_id, @status)
  `).run(p);
}

function getRecentPosts(limit = 20) {
  return db.prepare(`
    SELECT p.*, a.title as article_title
    FROM posts p
    LEFT JOIN drafts d ON p.draft_id = d.id
    LEFT JOIN articles a ON d.article_id = a.id
    ORDER BY p.posted_at DESC LIMIT ?
  `).all(limit);
}

// ─── Analytics ────────────────────────────────────────────────────────────────

function getSourceStats() {
  return db.prepare(`
    SELECT
      a.source,
      COUNT(DISTINCT a.id)                                                   AS articles,
      COUNT(DISTINCT d.id)                                                   AS drafts,
      SUM(CASE WHEN d.status = 'approved'      THEN 1 ELSE 0 END)           AS approved,
      SUM(CASE WHEN d.status = 'rejected'      THEN 1 ELSE 0 END)           AS rejected,
      SUM(CASE WHEN d.status = 'posted'        THEN 1 ELSE 0 END)           AS published
    FROM articles a
    LEFT JOIN drafts d ON d.article_id = a.id
    GROUP BY a.source
    ORDER BY articles DESC
  `).all();
}

function getEngagementTrends() {
  return db.prepare(`
    SELECT
      strftime('%Y-%m-%d', p.posted_at) AS date,
      p.impressions,
      p.reactions,
      p.comments
    FROM posts p
    WHERE p.impressions IS NOT NULL
      AND p.status = 'posted'
    ORDER BY p.posted_at ASC
  `).all();
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function getSetting(key, def = null) {
  const row = db.prepare(`SELECT value FROM settings WHERE key=?`).get(key);
  return row ? row.value : def;
}

function setSetting(key, value) {
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(key, String(value));
}

// ─── Stats ────────────────────────────────────────────────────────────────────

function getStats() {
  return {
    articlesTotal:       db.prepare(`SELECT COUNT(*) as n FROM articles`).get().n,
    draftsPendingReview: db.prepare(`SELECT COUNT(*) as n FROM drafts WHERE status='pending_review'`).get().n,
    draftsApproved:      db.prepare(`SELECT COUNT(*) as n FROM drafts WHERE status='approved'`).get().n,
    postsTotal:          db.prepare(`SELECT COUNT(*) as n FROM posts`).get().n,
    lastPost:            db.prepare(`SELECT posted_at FROM posts ORDER BY posted_at DESC LIMIT 1`).get()?.posted_at || null,
  };
}

module.exports = {
  insertArticle, getPendingArticles, updateArticleEval, markArticleDrafted, getArticleByUrl,
  getArticleById, getAllArticles, toggleArticleStar, deleteArticle, pruneArticles,
  insertDraft, getDraftsByStatus, getApprovedQueue, getDraftById,
  approveDraft, rejectDraft, getRecentRejectionNotes, getRecentPostTitles, updateDraftText, reorderQueue,
  getNextApprovedPost, markDraftPosted,
  insertPost, getRecentPosts,
  updatePostAnalytics, getPostsPendingAnalytics,
  getSetting, setSetting, getStats,
  getSourceStats, getEngagementTrends,
};
