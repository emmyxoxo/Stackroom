// ---------- API client ----------
const API = {
  token: localStorage.getItem('stackroom_token') || null,
  async call(method, path, body) {
    const opts = { method, headers: {} };
    if (this.token) opts.headers['Authorization'] = 'Bearer ' + this.token;
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    const res = await fetch('/api' + path, opts);
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error((data && data.error) || 'Request failed');
    return data;
  },
  setToken(t) { this.token = t; if (t) localStorage.setItem('stackroom_token', t); else localStorage.removeItem('stackroom_token'); }
};

let ME = null;

function toast(msg, kind) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast' + (kind ? ' ' + kind : '');
  t.style.display = 'block';
  setTimeout(() => t.style.display = 'none', 3200);
}

function showAuthMode(mode) {
  document.getElementById('login-form').style.display = mode === 'login' ? 'block' : 'none';
  document.getElementById('register-form').style.display = mode === 'register' ? 'block' : 'none';
  document.getElementById('tab-login').classList.toggle('active', mode === 'login');
  document.getElementById('tab-register').classList.toggle('active', mode === 'register');
}
showAuthMode('login');

async function doLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  try {
    const data = await API.call('POST', '/login', { username, password });
    API.setToken(data.token);
    ME = data.user;
    enterApp();
  } catch (err) { document.getElementById('auth-msg').textContent = err.message; }
}

async function doRegister(e) {
  e.preventDefault();
  const username = document.getElementById('reg-username').value;
  const password = document.getElementById('reg-password').value;
  const role = document.getElementById('reg-role').value;
  const campus = document.getElementById('reg-campus').value;
  const college = document.getElementById('reg-college').value;
  try {
    await API.call('POST', '/register', { username, password, role, campus, college });
    document.getElementById('auth-msg').textContent = 'Account created — wait for admin approval, then log in.';
    showAuthMode('login');
  } catch (err) { document.getElementById('auth-msg').textContent = err.message; }
}

function logout() { API.setToken(null); ME = null; location.reload(); }

const TABS = [
  { id: 'browse', label: 'Browse', roles: null },
  { id: 'upload', label: 'Upload', roles: ['teacher', 'admin'] },
  { id: 'requests', label: 'Requests', roles: null },
  { id: 'bookmarks', label: 'Bookmarks', roles: null },
  { id: 'summaries', label: 'Summarize', roles: null },
  { id: 'quizzes', label: 'Quiz', roles: null },
  { id: 'admin', label: 'Admin', roles: ['admin'] },
];

function switchTab(id) {
  document.querySelectorAll('#view-app > .view').forEach(v => v.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  document.querySelectorAll('#main-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  if (id === 'browse') loadBooks();
  if (id === 'requests') loadRequests();
  if (id === 'bookmarks') loadBookmarks();
  if (id === 'summaries') loadSummaries();
  if (id === 'quizzes') loadQuizzes();
  if (id === 'admin') loadAdmin();
}

function enterApp() {
  document.getElementById('view-auth').classList.remove('active');
  document.getElementById('view-app').classList.add('active');
  document.getElementById('who-box').innerHTML =
    `<span class="muted">Signed in as <b>${escapeHtml(ME.username)}</b> (${ME.role})</span> <button class="btn btn-sm" onclick="logout()">Log out</button>`;
  const nav = document.getElementById('main-tabs');
  nav.innerHTML = '';
  TABS.filter(t => !t.roles || t.roles.includes(ME.role)).forEach((t, i) => {
    const b = document.createElement('button');
    b.textContent = t.label; b.dataset.tab = t.id;
    b.onclick = () => switchTab(t.id);
    nav.appendChild(b);
  });
  switchTab('browse');
}

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------- Browse / download ----------
async function loadBooks() {
  const q = document.getElementById('search-input').value;
  const el = document.getElementById('books-list');
  el.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const { books } = await API.call('GET', '/books?q=' + encodeURIComponent(q));
    if (!books.length) { el.innerHTML = '<div class="empty">No books yet.</div>'; return; }
    el.innerHTML = books.map(b => `
      <div class="card">
        <div class="row">
          <div>
            <h4>${escapeHtml(b.title)}</h4>
            <div class="muted">${escapeHtml(b.author || 'Unknown author')} ${b.campus ? '· ' + escapeHtml(b.campus) : ''} ${b.college ? '· ' + escapeHtml(b.college) : ''}</div>
          </div>
          <div class="row" style="gap:6px;">
            <a class="btn btn-sm" href="/api/books/${b.id}/download?t=${encodeURIComponent(API.token)}" target="_blank">View / Download</a>
            <button class="btn btn-sm" onclick="toggleBookmark('${b.id}')">☆ Bookmark</button>
          </div>
        </div>
      </div>`).join('');
  } catch (err) { el.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; }
}

async function toggleBookmark(id) {
  try { await API.call('POST', '/bookmarks/' + id); toast('Bookmarked', 'success'); } catch (e) { toast(e.message, 'error'); }
}

async function loadBookmarks() {
  const el = document.getElementById('bookmarks-list');
  el.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const { books } = await API.call('GET', '/bookmarks');
    if (!books.length) { el.innerHTML = '<div class="empty">No bookmarks yet.</div>'; return; }
    el.innerHTML = books.map(b => `
      <div class="card row">
        <div><h4>${escapeHtml(b.title)}</h4><div class="muted">${escapeHtml(b.author || '')}</div></div>
        <div class="row" style="gap:6px;">
          <a class="btn btn-sm" href="/api/books/${b.id}/download?t=${encodeURIComponent(API.token)}" target="_blank">Open</a>
          <button class="btn btn-sm btn-danger" onclick="removeBookmark('${b.id}')">Remove</button>
        </div>
      </div>`).join('');
  } catch (err) { el.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; }
}
async function removeBookmark(id) { await API.call('DELETE', '/bookmarks/' + id); loadBookmarks(); }

// ---------- Upload ----------
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

async function doUpload(e) {
  e.preventDefault();
  const msg = document.getElementById('up-msg');
  const file = document.getElementById('up-file').files[0];
  if (!file) return;
  msg.textContent = 'Uploading…';
  try {
    const base64 = await fileToBase64(file);
    let pageCount = null;
    try {
      const pdf = await pdfjsLib.getDocument({ data: atob(base64) }).promise;
      pageCount = pdf.numPages;
    } catch {}
    await API.call('POST', '/books', {
      title: document.getElementById('up-title').value,
      author: document.getElementById('up-author').value,
      description: document.getElementById('up-desc').value,
      campus: document.getElementById('up-campus').value,
      college: document.getElementById('up-college').value,
      fileName: file.name, base64, pageCount
    });
    msg.textContent = 'Uploaded!';
    e.target.reset();
    toast('Book uploaded', 'success');
  } catch (err) { msg.textContent = err.message; }
}

// ---------- Requests ----------
async function doCreateRequest(e) {
  e.preventDefault();
  try {
    await API.call('POST', '/requests', {
      title: document.getElementById('req-title').value,
      author: document.getElementById('req-author').value,
      note: document.getElementById('req-note').value
    });
    e.target.reset();
    loadRequests();
  } catch (err) { toast(err.message, 'error'); }
}
async function loadRequests() {
  const el = document.getElementById('requests-list');
  el.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const { requests } = await API.call('GET', '/requests');
    if (!requests.length) { el.innerHTML = '<div class="empty">No requests yet.</div>'; return; }
    el.innerHTML = requests.map(r => `
      <div class="card row">
        <div>
          <h4>${escapeHtml(r.title)} <span class="pill ${r.status}">${r.status}</span></h4>
          <div class="muted">${escapeHtml(r.author || '')} ${r.note ? '· ' + escapeHtml(r.note) : ''}</div>
        </div>
        <div class="row" style="gap:6px;">
          <button class="btn btn-sm" onclick="voteRequest('${r.id}', ${r.votedByMe})">${r.votedByMe ? '★' : '☆'} ${r.voteCount}</button>
          ${(ME.role === 'admin' || ME.role === 'teacher') ? `
            <button class="btn btn-sm" onclick="setReqStatus('${r.id}','fulfilled')">Mark fulfilled</button>
            <button class="btn btn-sm btn-danger" onclick="setReqStatus('${r.id}','rejected')">Reject</button>` : ''}
        </div>
      </div>`).join('');
  } catch (err) { el.innerHTML = `<div class="empty">${escapeHtml(err.message)}</div>`; }
}
async function voteRequest(id, already) { await API.call(already ? 'DELETE' : 'POST', `/requests/${id}/vote`); loadRequests(); }
async function setReqStatus(id, status) { await API.call('POST', `/requests/${id}/status`, { status }); loadRequests(); }

// ---------- Local heuristic summary/quiz generation (no external AI call) ----------
async function extractPdfText(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => it.str).join(' ') + '\n';
  }
  return { text, pageCount: pdf.numPages };
}
function splitSentences(text) {
  return text.replace(/\s+/g, ' ').trim().split(/(?<=[.?!])\s+/).filter(s => s.length > 40 && s.length < 400);
}
function buildLocalSummary(text, pageCount, fileName) {
  const sentences = splitSentences(text);
  const overview = sentences.slice(0, 3).join(' ');
  const keyPoints = sentences.slice(3, 10);
  return { fileName, generatedAt: new Date().toISOString(), pageCount, overview, keyPoints };
}
function buildLocalQuiz(text) {
  const sentences = splitSentences(text).slice(0, 8);
  return sentences.map((s, i) => ({ q: `Explain, in your own words: "${s.slice(0, 120)}..."`, id: i }));
}

async function doSummarize() {
  const file = document.getElementById('sum-file').files[0];
  if (!file) return toast('Choose a PDF first', 'error');
  const box = document.getElementById('sum-result');
  box.style.display = 'block'; box.innerHTML = 'Reading PDF…';
  try {
    const { text, pageCount } = await extractPdfText(file);
    const data = buildLocalSummary(text, pageCount, file.name);
    box.innerHTML = `<h4>Overview</h4><p>${escapeHtml(data.overview)}</p><h4>Key points</h4><ul>${data.keyPoints.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>
      <button class="btn btn-sm btn-solid" onclick='saveSummary(${JSON.stringify(JSON.stringify(data))})'>Save</button>`;
  } catch (err) { box.innerHTML = escapeHtml(err.message); }
}
async function saveSummary(dataStr) {
  const data = JSON.parse(dataStr);
  await API.call('POST', '/summaries', { fileName: data.fileName, title: data.fileName, data });
  toast('Summary saved', 'success'); loadSummaries();
}
async function loadSummaries() {
  const el = document.getElementById('summaries-list');
  const { summaries } = await API.call('GET', '/summaries');
  el.innerHTML = summaries.length ? summaries.map(s => `
    <div class="card row"><div><b>${escapeHtml(s.title)}</b><div class="muted">${new Date(s.created_at).toLocaleString()}</div></div>
    <button class="btn btn-sm btn-danger" onclick="deleteSummary('${s.id}')">Delete</button></div>`).join('') : '<div class="empty">No saved summaries.</div>';
}
async function deleteSummary(id) { await API.call('DELETE', '/summaries/' + id); loadSummaries(); }

async function doQuiz() {
  const file = document.getElementById('quiz-file').files[0];
  if (!file) return toast('Choose a PDF first', 'error');
  const box = document.getElementById('quiz-result');
  box.style.display = 'block'; box.innerHTML = 'Reading PDF…';
  try {
    const { text } = await extractPdfText(file);
    const data = buildLocalQuiz(text);
    box.innerHTML = `<ol>${data.map(q => `<li>${escapeHtml(q.q)}</li>`).join('')}</ol>
      <button class="btn btn-sm btn-solid" onclick='saveQuiz(${JSON.stringify(JSON.stringify({ fileName: file.name, data }))})'>Save</button>`;
  } catch (err) { box.innerHTML = escapeHtml(err.message); }
}
async function saveQuiz(payloadStr) {
  const payload = JSON.parse(payloadStr);
  await API.call('POST', '/quizzes', payload);
  toast('Quiz saved', 'success'); loadQuizzes();
}
async function loadQuizzes() {
  const el = document.getElementById('quizzes-list');
  const { quizzes } = await API.call('GET', '/quizzes');
  el.innerHTML = quizzes.length ? quizzes.map(q => `
    <div class="card row"><div><b>${escapeHtml(q.file_name)}</b><div class="muted">${new Date(q.created_at).toLocaleString()}</div></div>
    <button class="btn btn-sm btn-danger" onclick="deleteQuiz('${q.id}')">Delete</button></div>`).join('') : '<div class="empty">No saved quizzes.</div>';
}
async function deleteQuiz(id) { await API.call('DELETE', '/quizzes/' + id); loadQuizzes(); }

// ---------- Admin ----------
async function loadAdmin() {
  const { users } = await API.call('GET', '/users');
  const pending = users.filter(u => !u.approved);
  document.getElementById('admin-pending').innerHTML = pending.length ? pending.map(u => `
    <div class="card row"><div><b>${escapeHtml(u.username)}</b> <span class="muted">(${u.role})</span></div>
    <button class="btn btn-sm btn-solid" onclick="approveUser('${u.id}')">Approve</button></div>`).join('') : '<div class="empty">No pending approvals.</div>';
  document.getElementById('admin-users').innerHTML = users.map(u => `
    <div class="card row">
      <div><b>${escapeHtml(u.username)}</b> <span class="pill">${u.role}</span> ${u.approved ? '' : '<span class="pill open">pending</span>'}</div>
      <div class="row" style="gap:6px;">
        <select onchange="changeRole('${u.id}', this.value)">
          ${['student', 'teacher', 'admin'].map(r => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
        <button class="btn btn-sm btn-danger" onclick="deleteUser('${u.id}')">Delete</button>
      </div>
    </div>`).join('');
  const { audit } = await API.call('GET', '/audit');
  document.getElementById('admin-audit').innerHTML = audit.slice(0, 100).map(a => `
    <div class="muted" style="padding:4px 0;border-bottom:1px solid var(--line);">${new Date(a.created_at).toLocaleString()} — ${escapeHtml(a.action)} ${escapeHtml(a.target || '')}</div>`).join('');
}
async function approveUser(id) { await API.call('POST', `/users/${id}/approve`); loadAdmin(); }
async function changeRole(id, role) { try { await API.call('POST', `/users/${id}/role`, { role }); loadAdmin(); } catch (e) { toast(e.message, 'error'); } }
async function deleteUser(id) { if (!confirm('Delete this user?')) return; try { await API.call('DELETE', `/users/${id}`); loadAdmin(); } catch (e) { toast(e.message, 'error'); } }

// ---------- boot ----------
(async function boot() {
  if (API.token) {
    try { const { user } = await API.call('GET', '/me'); ME = user; enterApp(); }
    catch { API.setToken(null); }
  }
})();
