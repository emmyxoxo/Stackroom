// Stackroom backend — single dependency-free Node.js server.
// Uses Node's built-in SQLite (Node 22+) and filesystem for PDF storage.
// No npm install required.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const PUBLIC_DIR = path.join(ROOT, 'public');
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'stackroom.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  approved INTEGER NOT NULL DEFAULT 0,
  campus TEXT DEFAULT '',
  college TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS books(
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT DEFAULT '',
  description TEXT DEFAULT '',
  campus TEXT DEFAULT '',
  college TEXT DEFAULT '',
  uploader_id TEXT,
  filename TEXT,
  filesize INTEGER,
  page_count INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS requests(
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT DEFAULT '',
  note TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS votes(
  request_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(request_id, user_id)
);
CREATE TABLE IF NOT EXISTS bookmarks(
  user_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, book_id)
);
CREATE TABLE IF NOT EXISTS recent_views(
  user_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  viewed_at TEXT NOT NULL,
  PRIMARY KEY(user_id, book_id)
);
CREATE TABLE IF NOT EXISTS audit(
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT DEFAULT '',
  details TEXT DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS summaries(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  book_id TEXT,
  file_name TEXT,
  title TEXT,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quiz_records(
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  book_id TEXT,
  file_name TEXT,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

// ---------- helpers ----------
const uid = (p) => `${p}_${crypto.randomBytes(9).toString('hex')}`;
const now = () => new Date().toISOString();

function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const check = crypto.scryptSync(pw, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(check));
}
function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return { ...rest, approved: !!rest.approved };
}
function logAudit(actorId, action, target, details) {
  db.prepare(`INSERT INTO audit(id,actor_id,action,target,details,created_at) VALUES(?,?,?,?,?,?)`)
    .run(uid('aud'), actorId || null, action, target || '', details ? JSON.stringify(details) : '', now());
}

// Seed a default admin on first run.
const userCount = db.prepare(`SELECT COUNT(*) c FROM users`).get().c;
if (userCount === 0) {
  db.prepare(`INSERT INTO users(id,username,password_hash,role,approved,campus,college,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(uid('usr'), 'admin', hashPassword('admin123'), 'admin', 1, '', '', now());
  console.log('Seeded default admin -> username: admin  password: admin123  (change this immediately)');
}

function getSession(token) {
  if (!token) return null;
  const s = db.prepare(`SELECT * FROM sessions WHERE token=?`).get(token);
  if (!s) return null;
  if (new Date(s.expires_at) < new Date()) {
    db.prepare(`DELETE FROM sessions WHERE token=?`).run(token);
    return null;
  }
  return db.prepare(`SELECT * FROM users WHERE id=?`).get(s.user_id);
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

const MIME = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- request handling ----------
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host}`);
    const p = u.pathname;

    if (!p.startsWith('/api/')) return serveStatic(req, res, p);

    // auth — normal calls use the Authorization header; plain <a href> downloads
    // can't set headers, so those links pass the token as ?t= instead.
    const authHeader = req.headers['authorization'] || '';
    const token = (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null) || u.searchParams.get('t');
    const user = getSession(token);

    const requireAuth = () => { if (!user) { send(res, 401, { error: 'Not authenticated' }); return false; } return true; };
    const requireApproved = () => { if (!user || !user.approved) { send(res, 403, { error: 'Account not approved yet' }); return false; } return true; };
    const requireRole = (...roles) => { if (!user || !roles.includes(user.role)) { send(res, 403, { error: 'Not permitted' }); return false; } return true; };

    let body = {};
    if (req.method === 'POST' || req.method === 'PUT') {
      const raw = await readBody(req, 80 * 1024 * 1024); // 80MB cap (covers base64 PDFs)
      if (raw.length) { try { body = JSON.parse(raw.toString('utf8')); } catch { return send(res, 400, { error: 'Invalid JSON' }); } }
    }

    // ---------- AUTH ----------
    if (p === '/api/register' && req.method === 'POST') {
      const { username, password, role, campus, college } = body;
      if (!username || !password) return send(res, 400, { error: 'Username and password required' });
      const exists = db.prepare(`SELECT id FROM users WHERE lower(username)=lower(?)`).get(username);
      if (exists) return send(res, 409, { error: 'Username already taken' });
      const allowedRole = ['student', 'teacher'].includes(role) ? role : 'student';
      const id = uid('usr');
      db.prepare(`INSERT INTO users(id,username,password_hash,role,approved,campus,college,created_at) VALUES(?,?,?,?,?,?,?,?)`)
        .run(id, username, hashPassword(password), allowedRole, 0, campus || '', college || '', now());
      logAudit(id, 'register', id, { username, role: allowedRole });
      return send(res, 201, { message: 'Registered. Awaiting admin approval.' });
    }

    if (p === '/api/login' && req.method === 'POST') {
      const { username, password } = body;
      const row = db.prepare(`SELECT * FROM users WHERE lower(username)=lower(?)`).get(username || '');
      if (!row || !verifyPassword(password || '', row.password_hash)) return send(res, 401, { error: 'Invalid username or password' });
      if (!row.approved) return send(res, 403, { error: 'Your account is pending admin approval' });
      const tok = crypto.randomBytes(24).toString('hex');
      const exp = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
      db.prepare(`INSERT INTO sessions(token,user_id,created_at,expires_at) VALUES(?,?,?,?)`).run(tok, row.id, now(), exp);
      logAudit(row.id, 'login', row.id, {});
      return send(res, 200, { token: tok, user: publicUser(row) });
    }

    if (p === '/api/logout' && req.method === 'POST') {
      if (token) db.prepare(`DELETE FROM sessions WHERE token=?`).run(token);
      return send(res, 200, { ok: true });
    }

    if (p === '/api/me' && req.method === 'GET') {
      if (!requireAuth()) return;
      return send(res, 200, { user: publicUser(user) });
    }

    if (p === '/api/me' && req.method === 'PUT') {
      if (!requireAuth()) return;
      const { username, password, campus, college } = body;
      let newUsername = user.username;
      if (username && username !== user.username) {
        const clash = db.prepare(`SELECT id FROM users WHERE lower(username)=lower(?) AND id<>?`).get(username, user.id);
        if (clash) return send(res, 409, { error: 'Username already taken' });
        newUsername = username;
      }
      const newHash = password ? hashPassword(password) : user.password_hash;
      db.prepare(`UPDATE users SET username=?, password_hash=?, campus=?, college=? WHERE id=?`)
        .run(newUsername, newHash, campus ?? user.campus, college ?? user.college, user.id);
      return send(res, 200, { user: publicUser(db.prepare(`SELECT * FROM users WHERE id=?`).get(user.id)) });
    }

    // ---------- ADMIN: users ----------
    if (p === '/api/users' && req.method === 'GET') {
      if (!requireRole('admin')) return;
      return send(res, 200, { users: db.prepare(`SELECT * FROM users ORDER BY created_at DESC`).all().map(publicUser) });
    }
    let m;
    if ((m = p.match(/^\/api\/users\/([^/]+)\/approve$/)) && req.method === 'POST') {
      if (!requireRole('admin')) return;
      db.prepare(`UPDATE users SET approved=1 WHERE id=?`).run(m[1]);
      logAudit(user.id, 'approve_user', m[1], {});
      return send(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/users\/([^/]+)\/role$/)) && req.method === 'POST') {
      if (!requireRole('admin')) return;
      const { role } = body;
      if (!['student', 'teacher', 'admin'].includes(role)) return send(res, 400, { error: 'Invalid role' });
      if (role !== 'admin') {
        const target = db.prepare(`SELECT * FROM users WHERE id=?`).get(m[1]);
        const adminCount = db.prepare(`SELECT COUNT(*) c FROM users WHERE role='admin' AND approved=1`).get().c;
        if (target && target.role === 'admin' && adminCount <= 1) return send(res, 400, { error: 'Cannot demote the last admin' });
      }
      db.prepare(`UPDATE users SET role=? WHERE id=?`).run(role, m[1]);
      logAudit(user.id, 'change_role', m[1], { role });
      return send(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/users\/([^/]+)$/)) && req.method === 'DELETE') {
      if (!requireRole('admin')) return;
      const target = db.prepare(`SELECT * FROM users WHERE id=?`).get(m[1]);
      if (target && target.role === 'admin') {
        const adminCount = db.prepare(`SELECT COUNT(*) c FROM users WHERE role='admin' AND approved=1`).get().c;
        if (adminCount <= 1) return send(res, 400, { error: 'Cannot delete the last admin' });
      }
      db.prepare(`DELETE FROM users WHERE id=?`).run(m[1]);
      logAudit(user.id, 'delete_user', m[1], {});
      return send(res, 200, { ok: true });
    }

    // ---------- BOOKS ----------
    if (p === '/api/books' && req.method === 'GET') {
      if (!requireApproved()) return;
      const q = (u.searchParams.get('q') || '').toLowerCase();
      let rows = db.prepare(`SELECT id,title,author,description,campus,college,uploader_id,filename,filesize,page_count,created_at FROM books ORDER BY created_at DESC`).all();
      if (q) rows = rows.filter(b => (b.title + ' ' + b.author).toLowerCase().includes(q));
      return send(res, 200, { books: rows });
    }
    if (p === '/api/books' && req.method === 'POST') {
      if (!requireRole('teacher', 'admin')) return;
      const { title, author, description, campus, college, fileName, base64 } = body;
      if (!title || !base64) return send(res, 400, { error: 'Title and PDF file are required' });
      const id = uid('bk');
      const buf = Buffer.from(base64, 'base64');
      fs.writeFileSync(path.join(UPLOAD_DIR, `${id}.pdf`), buf);
      db.prepare(`INSERT INTO books(id,title,author,description,campus,college,uploader_id,filename,filesize,page_count,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id, title, author || '', description || '', campus || '', college || '', user.id, fileName || `${title}.pdf`, buf.length, body.pageCount || null, now());
      logAudit(user.id, 'upload_book', id, { title });
      return send(res, 201, { id });
    }
    if ((m = p.match(/^\/api\/books\/([^/]+)$/)) && req.method === 'DELETE') {
      if (!requireAuth()) return;
      const book = db.prepare(`SELECT * FROM books WHERE id=?`).get(m[1]);
      if (!book) return send(res, 404, { error: 'Not found' });
      if (user.role !== 'admin' && book.uploader_id !== user.id) return send(res, 403, { error: 'Not permitted' });
      db.prepare(`DELETE FROM books WHERE id=?`).run(m[1]);
      try { fs.unlinkSync(path.join(UPLOAD_DIR, `${m[1]}.pdf`)); } catch {}
      logAudit(user.id, 'delete_book', m[1], {});
      return send(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/books\/([^/]+)\/download$/)) && req.method === 'GET') {
      if (!requireApproved()) return;
      const book = db.prepare(`SELECT * FROM books WHERE id=?`).get(m[1]);
      const filePath = path.join(UPLOAD_DIR, `${m[1]}.pdf`);
      if (!book || !fs.existsSync(filePath)) return send(res, 404, { error: 'Not found' });
      db.prepare(`INSERT INTO recent_views(user_id,book_id,viewed_at) VALUES(?,?,?)
                  ON CONFLICT(user_id,book_id) DO UPDATE SET viewed_at=excluded.viewed_at`).run(user.id, m[1], now());
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${(book.filename || 'document.pdf').replace(/"/g, '')}"`,
        'Content-Length': fs.statSync(filePath).size,
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // ---------- BOOKMARKS ----------
    if (p === '/api/bookmarks' && req.method === 'GET') {
      if (!requireAuth()) return;
      const rows = db.prepare(`SELECT b.* FROM bookmarks bm JOIN books b ON b.id=bm.book_id WHERE bm.user_id=? ORDER BY bm.created_at DESC`).all(user.id);
      return send(res, 200, { books: rows });
    }
    if ((m = p.match(/^\/api\/bookmarks\/([^/]+)$/)) && req.method === 'POST') {
      if (!requireAuth()) return;
      db.prepare(`INSERT OR IGNORE INTO bookmarks(user_id,book_id,created_at) VALUES(?,?,?)`).run(user.id, m[1], now());
      return send(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/bookmarks\/([^/]+)$/)) && req.method === 'DELETE') {
      if (!requireAuth()) return;
      db.prepare(`DELETE FROM bookmarks WHERE user_id=? AND book_id=?`).run(user.id, m[1]);
      return send(res, 200, { ok: true });
    }

    // ---------- REQUESTS + VOTES ----------
    if (p === '/api/requests' && req.method === 'GET') {
      if (!requireApproved()) return;
      const status = u.searchParams.get('status');
      let rows = db.prepare(`SELECT * FROM requests ORDER BY created_at DESC`).all();
      if (status) rows = rows.filter(r => r.status === status);
      const withVotes = rows.map(r => ({
        ...r,
        voteCount: db.prepare(`SELECT COUNT(*) c FROM votes WHERE request_id=?`).get(r.id).c,
        votedByMe: !!db.prepare(`SELECT 1 FROM votes WHERE request_id=? AND user_id=?`).get(r.id, user.id),
      }));
      return send(res, 200, { requests: withVotes });
    }
    if (p === '/api/requests' && req.method === 'POST') {
      if (!requireApproved()) return;
      const { title, author, note } = body;
      if (!title) return send(res, 400, { error: 'Title required' });
      const id = uid('req');
      db.prepare(`INSERT INTO requests(id,student_id,title,author,note,status,created_at) VALUES(?,?,?,?,?,?,?)`)
        .run(id, user.id, title, author || '', note || '', 'open', now());
      return send(res, 201, { id });
    }
    if ((m = p.match(/^\/api\/requests\/([^/]+)\/vote$/)) && req.method === 'POST') {
      if (!requireApproved()) return;
      db.prepare(`INSERT OR IGNORE INTO votes(request_id,user_id,created_at) VALUES(?,?,?)`).run(m[1], user.id, now());
      return send(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/requests\/([^/]+)\/vote$/)) && req.method === 'DELETE') {
      if (!requireApproved()) return;
      db.prepare(`DELETE FROM votes WHERE request_id=? AND user_id=?`).run(m[1], user.id);
      return send(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/requests\/([^/]+)\/status$/)) && req.method === 'POST') {
      if (!requireRole('teacher', 'admin')) return;
      const { status } = body;
      if (!['open', 'fulfilled', 'rejected'].includes(status)) return send(res, 400, { error: 'Invalid status' });
      db.prepare(`UPDATE requests SET status=? WHERE id=?`).run(status, m[1]);
      logAudit(user.id, 'request_status', m[1], { status });
      return send(res, 200, { ok: true });
    }

    // ---------- AUDIT ----------
    if (p === '/api/audit' && req.method === 'GET') {
      if (!requireRole('admin')) return;
      return send(res, 200, { audit: db.prepare(`SELECT * FROM audit ORDER BY created_at DESC LIMIT 500`).all() });
    }

    // ---------- SUMMARIES ----------
    if (p === '/api/summaries' && req.method === 'GET') {
      if (!requireAuth()) return;
      const rows = db.prepare(`SELECT * FROM summaries WHERE user_id=? ORDER BY created_at DESC`).all(user.id);
      return send(res, 200, { summaries: rows.map(r => ({ ...r, data: JSON.parse(r.data) })) });
    }
    if (p === '/api/summaries' && req.method === 'POST') {
      if (!requireAuth()) return;
      const id = uid('sum');
      db.prepare(`INSERT INTO summaries(id,user_id,book_id,file_name,title,data,created_at) VALUES(?,?,?,?,?,?,?)`)
        .run(id, user.id, body.bookId || null, body.fileName || '', body.title || body.fileName || 'Untitled', JSON.stringify(body.data || {}), now());
      return send(res, 201, { id });
    }
    if ((m = p.match(/^\/api\/summaries\/([^/]+)$/)) && req.method === 'DELETE') {
      if (!requireAuth()) return;
      db.prepare(`DELETE FROM summaries WHERE id=? AND user_id=?`).run(m[1], user.id);
      return send(res, 200, { ok: true });
    }

    // ---------- QUIZZES ----------
    if (p === '/api/quizzes' && req.method === 'GET') {
      if (!requireAuth()) return;
      const rows = db.prepare(`SELECT * FROM quiz_records WHERE user_id=? ORDER BY created_at DESC`).all(user.id);
      return send(res, 200, { quizzes: rows.map(r => ({ ...r, data: JSON.parse(r.data) })) });
    }
    if (p === '/api/quizzes' && req.method === 'POST') {
      if (!requireAuth()) return;
      const id = uid('qz');
      db.prepare(`INSERT INTO quiz_records(id,user_id,book_id,file_name,data,created_at) VALUES(?,?,?,?,?,?)`)
        .run(id, user.id, body.bookId || null, body.fileName || '', JSON.stringify(body.data || {}), now());
      return send(res, 201, { id });
    }
    if ((m = p.match(/^\/api\/quizzes\/([^/]+)$/)) && req.method === 'DELETE') {
      if (!requireAuth()) return;
      db.prepare(`DELETE FROM quiz_records WHERE id=? AND user_id=?`).run(m[1], user.id);
      return send(res, 200, { ok: true });
    }

    send(res, 404, { error: 'Not found' });
  } catch (e) {
    console.error(e);
    if (String(e.message).includes('too large')) return send(res, 413, { error: 'File too large' });
    send(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => console.log(`Stackroom server running on http://localhost:${PORT}`));
