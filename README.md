# Vantage

A personal tech news feed that learns who you are, what you believe, and what you care about — then surfaces only the articles worth your attention.

<!-- Replace with updated screenshot -->
<img width="775" alt="Vantage dashboard" src="https://github.com/user-attachments/assets/848551a3-88b3-4d01-bff0-e0f5e057eb82" />

---

## The idea

Most aggregators show you what's popular. This one shows you what's relevant — to your specific domain, your specific opinions, and the specific problems you've worked on.

You teach it who you are through a set of **Skills**: markdown files that encode your professional background, your points of view on where the industry is heading, and your content standards. The pipeline reads those files on every run and uses them to score incoming articles.

An article that gives you something to push back on — something that intersects with a conviction you hold — scores just as high as one that confirms it. Disagreement is signal. The evaluator looks for genuine connection to what you think, not alignment with it. The more specific and opinionated your Skills are, the sharper the feed gets.

When you find an article worth writing about, you draft the post yourself. There's an AI assist option that generates a first pass in your voice, using your writing style and the evaluation insights already captured for that article. You edit, save, and queue it for publishing on your schedule.

---

## Skills

Skills are the intelligence layer. Four markdown files that you own and control:

**`skills/job-context.md`** — your professional background. Current role, relevant past experience, the products and teams you've worked on. Used to assess whether an article connects to work you've actually done.

**`skills/points-of-view.md`** — your actual opinions. Named topic areas with specific, debatable convictions about where things are heading. Articles that support, challenge, or complicate these views are all treated as relevant. Vague beliefs produce weak signal — the more precise, the better.

**`skills/content-eval.md`** — your relevance criteria. High-signal topic areas, low-signal content types to filter out, opinion-match examples, and optional notes to fine-tune how the app-level scoring dimensions apply to your context. The scoring formula and universal evaluation principles are managed by the app — this file controls what matters to *you*.

**`skills/writing-style.md`** — your writing voice. Tone, format preferences, banned phrases, and example sentences. Used when generating AI-assisted drafts. Concrete examples outperform abstract rules.

Your real skill files are gitignored. Only `.example.md` templates are committed, so personal details stay out of version control.

### Setting up

```bash
cp skills/writing-style.example.md skills/writing-style.md
cp skills/points-of-view.example.md skills/points-of-view.md
cp skills/job-context.example.md skills/job-context.md
cp skills/content-eval.example.md skills/content-eval.md
```

Then open the **Calibrate** tab. Each skill has a guided AI interview that asks focused questions to surface the context and opinions that make the feed work. When you've answered enough, ask it to propose a revision — it generates a complete updated file you can review, edit, and save. Or skip the interview and edit the files directly.

Skills are loaded fresh on every pipeline run. Changes take effect immediately.

### Tuning

| Problem | Fix |
|---|---|
| Too few articles in the feed | Lower `minRelevanceScore` in Settings, or add more sources |
| Wrong articles passing | Add those topics to the low-relevance signals in `content-eval.md` |
| Relevant articles being filtered | Add those topics to the high-relevance signals in `content-eval.md` |
| Scoring feels off for your domain | Add notes to the `## Scoring notes` section in `content-eval.md` |
| AI drafts don't sound like you | Add concrete example sentences to `writing-style.md` |
| AI drafts miss the point | Add or sharpen opinions in `points-of-view.md` |

---

## Sources

Articles are pulled from Hacker News, Reddit, RSS feeds, and TLDR newsletters on a configurable schedule. You can also paste any URL directly on the dashboard to score it and add it to your feed immediately, bypassing the crawl.

Each source has its own settings — enabled/disabled, age filter, minimum score threshold, subreddits or feed URLs. All configurable from the **Settings** page or directly in `config.json`.

Article TTLs by status:
- **Pending / low score** — pruned after 3 days
- **Scored** — pruned after 30 days
- **Draft saved** — pruned after 14 days (if no approved or posted draft exists)
- **Starred** — kept indefinitely

---

## How it works

### Feed

Each crawl run:

1. **Fetch** — pulls new articles from enabled sources, deduplicates by URL
2. **Evaluate** — Claude scores each article against your Skills across four dimensions: relevance (50%), timeliness (20%), specificity (15%), and feed value (15%). Articles below your relevance threshold are filtered out.
3. **Browse** — scored articles appear in the feed with scores, key insights, and relevance notes. Filter by source, status, score range, date, or starred.

### Drafting

Drafting is intentional, not automatic. When an article is worth writing about:

1. Click **Draft** on any article in the feed
2. Write your post in the editor — the article's key insight, relevance note, and source are shown alongside
3. Optionally click **✦ AI Assist** to generate a first pass. On the first click, you can add guidance (e.g. "focus on the leadership angle"). The AI uses your writing style, job context, and points of view — not a summary of the article.
4. Edit, save the draft, and it appears in the **Sharing** tab

### Publishing

From the **Sharing** tab:

- **Saved** — drafts awaiting review. Edit inline, use AI Assist to rewrite, or add to the queue.
- **Queue** — approved drafts in publish order. Drag to reorder. The first item posts automatically on your configured schedule.

LinkedIn connection and schedule are configured from the **Settings** page.

---

## Configuration

`config.json` controls how the pipeline runs:

```json
{
  "sources": { ... },
  "pipeline": {
    "articlesPerCrawlRun": 60,
    "minRelevanceScore": 7,
    "maxPostChars": 2800
  },
  "schedule": {
    "crawlCron": "0 8 * * 1,3,5",
    "postCron": "0 9 * * 2",
    "timezone": "America/New_York"
  }
}
```

`minRelevanceScore` is applied to the relevance sub-score (not the overall score), so timeliness doesn't penalise articles that are relevant but not brand new.

Most settings can also be changed live from the **Settings** page without touching the file.

---

## Setup

### 1. Install

```bash
npm install
```

`better-sqlite3` requires native compilation — you need Python 3 and a C++ toolchain (`xcode-select --install` on macOS; `sudo apt install build-essential python3` on Ubuntu).

### 2. Environment

```bash
cp .env.example .env
cp config.example.json config.json
```

`.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
LINKEDIN_CLIENT_ID=...
LINKEDIN_CLIENT_SECRET=...
LINKEDIN_REDIRECT_URI=http://localhost:3000/auth/linkedin/callback
SESSION_SECRET=        # openssl rand -hex 32
UI_PASSWORD=           # your chosen login password
```

LinkedIn credentials are only required if you want to use the publishing feature. The feed and drafting work without it.

### 3. LinkedIn Developer App (optional — publishing only)

1. Create an app at https://developer.linkedin.com
2. Add redirect URL: `http://localhost:3000/auth/linkedin/callback`
3. Request scopes: `openid`, `profile`, `w_member_social`, `r_member_social`
4. Copy Client ID and Secret into `.env`

### 4. Run

```bash
npm run dev    # local development
npm start      # production
```

Open http://localhost:3000, sign in, then go to **Calibrate** to set up your Skills before running your first crawl.

---

## Hosting

**DigitalOcean ($6/mo)**:
```bash
sudo apt install -y nodejs npm build-essential python3
git clone <your-repo> /opt/vantage && cd /opt/vantage
npm install && cp .env.example .env && nano .env
npm install -g pm2
pm2 start src/server.js --name vantage && pm2 save && pm2 startup
```

Update `LINKEDIN_REDIRECT_URI` in `.env` and your LinkedIn app settings to use your real domain.

---

## Cost

Anthropic API usage only. Evaluation runs on `claude-sonnet-4-6` at ~$0.01–0.05 per crawl run depending on article volume and skill file size. AI-assisted drafts add a small incremental cost per use. At three crawl runs per week, roughly $1–6/month.
