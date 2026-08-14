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

- `server.js` — the whole backend: auth (accounts are active immediately;
  admins can suspend/reactivate), roles (student/teacher/admin), PDF
  upload & download (including bulk upload and streamed large-file
  handling), book requests + voting, bookmarks, an audit log, and saved
  summaries/quizzes.
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

### One important note on the free tier — READ THIS if accounts keep disappearing

Free tiers on these platforms usually use **ephemeral disk** — files
written after deploy (your SQLite database and uploaded PDFs) get wiped
on every redeploy, and on some platforms even after the app has been idle
for a while and restarts. **This is almost certainly why registered users
or uploaded books seem to vanish "on their own"** — nothing in the app is
deleting them; the server's disk itself got reset.

Fix it one of two ways:

1. **Attach a persistent disk (recommended, and cheap on Render):**
   - Render dashboard → your service → **Disks** → Add Disk → give it a
     mount path, e.g. `/var/data`.
   - In your service's **Environment** tab, add:
     - `DATA_DIR` = `/var/data/data`
     - `UPLOAD_DIR` = `/var/data/uploads`
   - Redeploy. `server.js` already reads these env vars (falls back to
     the local `data/`/`uploads/` folders if unset), so no code changes
     are needed — the database and PDFs now live on disk that survives
     restarts and redeploys.
   - Railway and Fly.io both have an equivalent "volume" feature — same
     idea, just set `DATA_DIR`/`UPLOAD_DIR` to a path inside the volume.

2. **Move to a hosted database later** if you outgrow SQLite entirely —
   the SQL in `server.js` is plain enough to port to Postgres (e.g.
   Supabase) when you need it.

Without one of these, expect the app to reset its user list and library
periodically — fine for testing, not fine for real students relying on
it.

## Security notes before real students use it

- Change the seeded admin password immediately.
- Serve it over HTTPS (Render/Railway/Fly all give you this for free
  automatically on their `*.onrender.com`/etc. domains).
- Session tokens currently don't expire until 30 days — fine for a
  small deployment, but worth shortening if this becomes long-lived.
- New accounts are active immediately (no approval step) so people can
  start using the library right away. If someone misuses their account,
  suspend them from Admin Panel → Manage users — this instantly kills
  their active session and blocks further logins until reactivated.
