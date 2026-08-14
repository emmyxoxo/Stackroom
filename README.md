# Stackroom — Student E-Library (real backend edition)

This replaces the old single-file version's `localStorage`/`IndexedDB`
"database" (which only worked on one browser, one device) with a real
backend: a Node.js server, a SQLite database, and PDFs stored as real
files on disk. Once deployed, any student can log in from their phone,
laptop, or a library PC and see the same data and the same files.

No external services or paid dependencies are required to run it —
it uses only Node's built-in `http` and `node:sqlite` modules, so
there's nothing to `npm install`.

## What's included

- `server.js` — the whole backend: auth (with admin approval), roles
  (student/teacher/admin), PDF upload & download, book requests +
  voting, bookmarks, an audit log, and saved summaries/quizzes.
- `public/` — the frontend (plain HTML/CSS/JS, no build step).
- `data/stackroom.db` — created automatically on first run.
- `uploads/` — where uploaded PDFs are stored, one file per book.

## Run it locally first

Requires **Node.js 22 or newer** (for built-in SQLite support).

```bash
node server.js
```

Then open `http://localhost:3000`. On first run it prints a seeded
admin login:

```
username: admin
password: admin123
```

**Log in as admin and change that password immediately** (Log in →
top-right → change password), and approve any students/teachers who
register from the Admin tab.

## Put it on the internet so multiple devices can use it

The simplest free option is **Render**:

1. Push this folder to a new GitHub repository.
2. Go to [render.com](https://render.com) → New → Web Service → connect
   that repo.
3. Build command: leave blank (nothing to build).
   Start command: `node server.js`
4. Render gives you a public URL like `https://stackroom-xyz.onrender.com`
   — that's what you share with students. It works from any phone,
   laptop, or computer with internet access, not just your machine.

Railway and Fly.io work the same way (connect repo → run `node
server.js`) if you'd rather use one of those.

### One important note on the free tier

Free tiers on these platforms usually use **ephemeral disk** — files
written after deploy (your SQLite database and uploaded PDFs) can be
wiped on redeploy or after long idle periods. For a class project or
prototype that's usually fine. For something you want to keep long-term:

- Use Render's **persistent disk** add-on (small monthly cost), or
- Point `UPLOAD_DIR`/`DATA_DIR` at a mounted volume on Railway/Fly, or
- Swap the local SQLite file for a hosted Postgres database later —
  the SQL in `server.js` is simple enough to port if you outgrow this.

## Security notes before real students use it

- Change the seeded admin password immediately.
- Serve it over HTTPS (Render/Railway/Fly all give you this for free
  automatically on their `*.onrender.com`/etc. domains).
- Session tokens currently don't expire until 30 days — fine for a
  small deployment, but worth shortening if this becomes long-lived.
