// ---------- API ----------
const API = {
  token: localStorage.getItem('sr_token') || null,
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
  setToken(t) { this.token = t; if (t) localStorage.setItem('sr_token', t); else localStorage.removeItem('sr_token'); }
};

let ME = null;

// ---------- helpers ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function toast(msg, kind) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast' + (kind ? ' ' + kind : '');
  t.style.display = 'block';
  clearTimeout(t._tid);
  t._tid = setTimeout(() => t.style.display = 'none', 3400);
}
function emptyState(icon, text) {
  return `<div class="empty-state"><div class="empty-icon">${icon}</div><p>${text}</p></div>`;
}
function pillRole(role) {
  return `<span class="pill pill-${role}">${role}</span>`;
}

// ---------- page routing ----------
function showHome() {
  document.getElementById('page-home').style.display = 'block';
  document.getElementById('page-auth').style.display = 'none';
  document.getElementById('page-app').style.display = 'none';
}
function showAuth(mode) {
  document.getElementById('page-home').style.display = 'none';
  document.getElementById('page-auth').style.display = 'block';
  document.getElementById('page-app').style.display = 'none';
  document.getElementById('form-login').style.display = mode === 'login' ? 'block' : 'none';
  document.getElementById('form-register').style.display = mode === 'register' ? 'block' : 'none';
  document.getElementById('tab-login').classList.toggle('active', mode === 'login');
  document.getElementById('tab-register').classList.toggle('active', mode === 'register');
  document.getElementById('login-msg').textContent = '';
  document.getElementById('register-msg').textContent = '';
}
function showApp() {
  document.getElementById('page-home').style.display = 'none';
  document.getElementById('page-auth').style.display = 'none';
  document.getElementById('page-app').style.display = 'block';
}

// ---------- tab definitions ----------
const TABS = [
  { id: 'browse',    label: 'Library',   icon: '📚', roles: null },
  { id: 'upload',    label: 'Upload',    icon: '📤', roles: ['teacher','admin'] },
  { id: 'requests',  label: 'Requests',  icon: '🗳️', roles: null },
  { id: 'bookmarks', label: 'Bookmarks', icon: '🔖', roles: null },
  { id: 'summarize', label: 'Summarize', icon: '🧠', roles: ['student','teacher'] },
  { id: 'quiz',      label: 'Quiz',      icon: '✏️', roles: ['student','teacher'] },
  { id: 'admin',     label: 'Admin',     icon: '⚙️', roles: ['admin'] },
];

function visibleTabs() {
  return TABS.filter(t => !t.roles || t.roles.includes(ME.role));
}

function buildNav() {
  const tabs = visibleTabs();
  // sidebar
  document.getElementById('sidebar-nav').innerHTML = tabs.map(t => `
    <button class="snav-item" data-tab="${t.id}" onclick="switchTab('${t.id}')">
      <span class="snav-icon">${t.icon}</span> ${t.label}
    </button>`).join('');
  // mobile nav (show up to 5)
  document.getElementById('mobile-nav').innerHTML = tabs.slice(0, 5).map(t => `
    <button data-tab="${t.id}" onclick="switchTab('${t.id}')">
      <span class="mni">${t.icon}</span>${t.label}
    </button>`).join('');
}

function switchTab(id) {
  document.querySelectorAll('.subview').forEach(v => v.classList.remove('active'));
  const sv = document.getElementById('sv-' + id);
  if (sv) sv.classList.add('active');
  document.querySelectorAll('#sidebar-nav .snav-item, #mobile-nav button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === id);
  });
  if (id === 'browse') loadBooks();
  if (id === 'requests') loadRequests();
  if (id === 'bookmarks') loadBookmarks();
  if (id === 'summarize') loadSummaries();
  if (id === 'quiz') loadQuizzes();
  if (id === 'admin') loadAdmin();
}

function enterApp() {
  showApp();
  document.getElementById('sidebar-avatar').textContent = ME.username[0].toUpperCase();
  document.getElementById('sidebar-name').textContent = ME.username;
  document.getElementById('sidebar-role').textContent = ME.role;
  buildNav();
  switchTab('browse');
}

// ---------- auth ----------
async function doLogin() {
  const username = document.getElementById('l-username').value.trim();
  const password = document.getElementById('l-password').value;
  const msg = document.getElementById('login-msg');
  msg.textContent = '';
  try {
    const data = await API.call('POST', '/login', { username, password });
    API.setToken(data.token);
    ME = data.user;
    enterApp();
  } catch (err) { msg.textContent = err.message; }
}

async function doRegister() {
  const username = document.getElementById('r-username').value.trim();
  const password = document.getElementById('r-password').value;
  const role = document.getElementById('r-role').value;
  const campus = document.getElementById('r-campus').value.trim();
  const college = document.getElementById('r-college').value.trim();
  const msg = document.getElementById('register-msg');
  msg.textContent = '';
  if (!username || !password) { msg.textContent = 'Username and password are required.'; return; }
  try {
    await API.call('POST', '/register', { username, password, role, campus, college });
    msg.className = 'auth-msg ok';
    msg.textContent = '✓ Account created! Wait for admin approval, then log in.';
    setTimeout(() => showAuth('login'), 2000);
  } catch (err) { msg.textContent = err.message; }
}

function doLogout() {
  API.call('POST', '/logout').catch(() => {});
  API.setToken(null);
  ME = null;
  showHome();
}

// ---------- browse & download ----------
let myBookmarks = new Set();

async function loadBooks() {
  const q = document.getElementById('search-q').value;
  const el = document.getElementById('books-grid');
  el.innerHTML = '<p style="color:var(--ink-soft);padding:20px 0;">Loading…</p>';
  try {
    const [{ books }, { books: bms }] = await Promise.all([
      API.call('GET', '/books?q=' + encodeURIComponent(q)),
      API.call('GET', '/bookmarks')
    ]);
    myBookmarks = new Set(bms.map(b => b.id));
    if (!books.length) { el.innerHTML = emptyState('📭', 'No books in the library yet.'); return; }
    el.innerHTML = `<div class="book-grid">${books.map(b => bookCard(b)).join('')}</div>`;
  } catch (err) { el.innerHTML = emptyState('⚠️', esc(err.message)); }
}

function bookCard(b) {
  const bmed = myBookmarks.has(b.id);
  return `
  <div class="book-card">
    <div class="book-cover" style="background:linear-gradient(135deg,${strColor(b.title)} 0%,${strColor(b.author||'X')} 100%);">
      <span style="font-size:42px;opacity:.18;">${b.title[0]}</span>
    </div>
    <div class="book-body">
      <div class="book-call mono">${esc(b.campus||'')}${b.college?' · '+esc(b.college):''}</div>
      <h4>${esc(b.title)}</h4>
      <div class="book-author">${esc(b.author||'Unknown author')}</div>
      <div class="book-tags">${b.campus?`<span class="tag">${esc(b.campus)}</span>`:''}</div>
      <div class="book-actions">
        <a class="btn btn-solid btn-sm" href="/api/books/${b.id}/download?t=${encodeURIComponent(API.token)}" target="_blank" rel="noopener">⬇ Download</a>
        <button class="btn btn-sm bookmark-btn ${bmed?'bookmarked':''}" onclick="toggleBookmark('${b.id}',this)">${bmed?'🔖':'☆'}</button>
      </div>
    </div>
  </div>`;
}

function strColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  const colors = ['#0F2A3F','#136B41','#1E5A7A','#4A3728','#2F4A3F','#1A3A5C'];
  return colors[Math.abs(h) % colors.length];
}

async function toggleBookmark(id, btn) {
  const isBookmarked = myBookmarks.has(id);
  try {
    if (isBookmarked) {
      await API.call('DELETE', '/bookmarks/' + id);
      myBookmarks.delete(id);
      btn.textContent = '☆'; btn.classList.remove('bookmarked');
      toast('Bookmark removed');
    } else {
      await API.call('POST', '/bookmarks/' + id);
      myBookmarks.add(id);
      btn.textContent = '🔖'; btn.classList.add('bookmarked');
      toast('Bookmarked!', 'success');
    }
  } catch (e) { toast(e.message, 'error'); }
}

async function loadBookmarks() {
  const el = document.getElementById('bookmarks-grid');
  el.innerHTML = '<p style="color:var(--ink-soft);padding:20px 0;">Loading…</p>';
  try {
    const { books } = await API.call('GET', '/bookmarks');
    myBookmarks = new Set(books.map(b => b.id));
    if (!books.length) { el.innerHTML = emptyState('🔖', 'No bookmarks yet. Browse the library and bookmark books you use often.'); return; }
    el.innerHTML = `<div class="book-grid">${books.map(b => `
      <div class="book-card">
        <div class="book-cover" style="background:linear-gradient(135deg,${strColor(b.title)} 0%,${strColor(b.author||'X')} 100%);">
          <span style="font-size:42px;opacity:.18;">${b.title[0]}</span>
        </div>
        <div class="book-body">
          <h4>${esc(b.title)}</h4>
          <div class="book-author">${esc(b.author||'Unknown author')}</div>
          <div class="book-actions">
            <a class="btn btn-solid btn-sm" href="/api/books/${b.id}/download?t=${encodeURIComponent(API.token)}" target="_blank">⬇ Download</a>
            <button class="btn btn-sm btn-danger" onclick="removeBookmark('${b.id}',this.closest('.book-card'))">Remove</button>
          </div>
        </div>
      </div>`).join('')}</div>`;
  } catch (err) { el.innerHTML = emptyState('⚠️', esc(err.message)); }
}

async function removeBookmark(id, card) {
  await API.call('DELETE', '/bookmarks/' + id);
  card.remove();
  toast('Bookmark removed');
}

// ---------- upload ----------
function onFileChosen(input) {
  const f = input.files[0];
  document.getElementById('file-drop-label').textContent = f ? f.name : 'Click to choose a PDF file';
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

async function doUpload() {
  const title = document.getElementById('up-title').value.trim();
  const file = document.getElementById('up-file').files[0];
  const msg = document.getElementById('up-msg');
  if (!title) { msg.textContent = 'Title is required.'; return; }
  if (!file) { msg.textContent = 'Please choose a PDF file.'; return; }
  msg.textContent = 'Uploading… please wait';
  document.getElementById('upload-btn').disabled = true;
  try {
    const base64 = await fileToBase64(file);
    let pageCount = null;
    try {
      const pdf = await pdfjsLib.getDocument({ data: atob(base64) }).promise;
      pageCount = pdf.numPages;
    } catch {}
    await API.call('POST', '/books', {
      title,
      author: document.getElementById('up-author').value.trim(),
      description: document.getElementById('up-desc').value.trim(),
      campus: document.getElementById('up-campus').value.trim(),
      college: document.getElementById('up-college').value.trim(),
      fileName: file.name, base64, pageCount
    });
    msg.textContent = '';
    toast('Book uploaded successfully!', 'success');
    document.getElementById('up-title').value = '';
    document.getElementById('up-author').value = '';
    document.getElementById('up-desc').value = '';
    document.getElementById('up-file').value = '';
    document.getElementById('file-drop-label').textContent = 'Click to choose a PDF file';
  } catch (err) { msg.textContent = err.message; }
  document.getElementById('upload-btn').disabled = false;
}

// ---------- requests ----------
async function doCreateRequest() {
  const title = document.getElementById('req-title').value.trim();
  if (!title) { toast('Please enter a book title', 'error'); return; }
  try {
    await API.call('POST', '/requests', {
      title,
      author: document.getElementById('req-author').value.trim(),
      note: document.getElementById('req-note').value.trim()
    });
    document.getElementById('req-title').value = '';
    document.getElementById('req-author').value = '';
    document.getElementById('req-note').value = '';
    toast('Request submitted!', 'success');
    loadRequests();
  } catch (err) { toast(err.message, 'error'); }
}

async function loadRequests() {
  const el = document.getElementById('requests-list');
  el.innerHTML = '<p style="color:var(--ink-soft);padding:10px 0;">Loading…</p>';
  try {
    const { requests } = await API.call('GET', '/requests');
    if (!requests.length) { el.innerHTML = emptyState('🗳️', 'No book requests yet. Be the first to request one!'); return; }
    el.innerHTML = requests.map(r => `
      <div class="req-card">
        <div class="req-top">
          <div>
            <div class="req-title">${esc(r.title)}</div>
            <div class="req-meta">${r.author ? esc(r.author) + ' · ' : ''}${r.note ? esc(r.note) : ''}</div>
          </div>
          <span class="req-status ${r.status}">${r.status}</span>
        </div>
        <div class="req-actions">
          <button class="vote-btn ${r.votedByMe ? 'voted' : ''}" onclick="voteRequest('${r.id}',${r.votedByMe})">
            ${r.votedByMe ? '★' : '☆'} ${r.voteCount} vote${r.voteCount !== 1 ? 's' : ''}
          </button>
          ${(ME.role === 'admin' || ME.role === 'teacher') && r.status === 'open' ? `
            <button class="btn btn-sm btn-solid" onclick="setReqStatus('${r.id}','fulfilled')">Mark fulfilled</button>
            <button class="btn btn-sm btn-danger" onclick="setReqStatus('${r.id}','rejected')">Reject</button>` : ''}
        </div>
      </div>`).join('');
  } catch (err) { el.innerHTML = emptyState('⚠️', esc(err.message)); }
}

async function voteRequest(id, already) {
  await API.call(already ? 'DELETE' : 'POST', `/requests/${id}/vote`);
  loadRequests();
}

async function setReqStatus(id, status) {
  await API.call('POST', `/requests/${id}/status`, { status });
  toast('Request updated', 'success');
  loadRequests();
}

// ---------- PDF text extraction ----------
async function extractPdfText(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = '';
  for (let i = 1; i <= Math.min(pdf.numPages, 30); i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(it => it.str).join(' ') + '\n';
  }
  return { text, pageCount: pdf.numPages };
}

function splitSentences(text) {
  return text.replace(/\s+/g, ' ').trim().split(/(?<=[.?!])\s+/).filter(s => s.length > 50 && s.length < 400);
}

// ---------- summarize ----------
async function doSummarize() {
  const file = document.getElementById('sum-file').files[0];
  if (!file) { toast('Please choose a PDF file first', 'error'); return; }
  const box = document.getElementById('sum-result');
  box.style.display = 'block';
  box.innerHTML = '<div class="sum-result"><p>Reading PDF… please wait</p></div>';
  try {
    const { text, pageCount } = await extractPdfText(file);
    const sentences = splitSentences(text);
    const overview = sentences.slice(0, 3).join(' ') || 'Could not extract enough text from this PDF.';
    const keyPoints = sentences.slice(3, 12);
    const data = { fileName: file.name, pageCount, overview, keyPoints, generatedAt: new Date().toISOString() };
    box.innerHTML = `
      <div class="sum-result">
        <h4>📄 ${esc(file.name)}</h4>
        <p style="font-size:12px;color:var(--ink-soft);margin-bottom:12px;">${pageCount} pages · Generated ${new Date().toLocaleString()}</p>
        <h4>Overview</h4>
        <p>${esc(overview)}</p>
        ${keyPoints.length ? `<h4 style="margin-top:14px;">Key Points</h4><ul>${keyPoints.map(p => `<li>${esc(p)}</li>`).join('')}</ul>` : ''}
        <div class="sum-result-actions">
          <button class="btn btn-solid btn-sm" onclick='saveSummary(${JSON.stringify(JSON.stringify(data))})'>💾 Save summary</button>
        </div>
      </div>`;
  } catch (err) { box.innerHTML = `<div class="sum-result"><p style="color:var(--maroon);">${esc(err.message)}</p></div>`; }
}

async function saveSummary(dataStr) {
  const data = JSON.parse(dataStr);
  await API.call('POST', '/summaries', { fileName: data.fileName, title: data.fileName, data });
  toast('Summary saved!', 'success');
  loadSummaries();
}

async function loadSummaries() {
  const el = document.getElementById('summaries-list');
  try {
    const { summaries } = await API.call('GET', '/summaries');
    if (!summaries.length) { el.innerHTML = emptyState('🧠', 'No saved summaries yet.'); return; }
    el.innerHTML = summaries.map(s => `
      <div class="saved-row">
        <div><b>${esc(s.title)}</b><div class="meta">${new Date(s.created_at).toLocaleString()}</div></div>
        <div class="saved-actions">
          <button class="btn btn-sm btn-danger" onclick="deleteSummary('${s.id}')">Delete</button>
        </div>
      </div>`).join('');
  } catch (err) { el.innerHTML = emptyState('⚠️', esc(err.message)); }
}

async function deleteSummary(id) {
  await API.call('DELETE', '/summaries/' + id);
  toast('Deleted');
  loadSummaries();
}

// ---------- quiz ----------
async function doQuiz() {
  const file = document.getElementById('quiz-file').files[0];
  if (!file) { toast('Please choose a PDF file first', 'error'); return; }
  const box = document.getElementById('quiz-result');
  box.style.display = 'block';
  box.innerHTML = '<div class="sum-result"><p>Reading PDF… please wait</p></div>';
  try {
    const { text } = await extractPdfText(file);
    const sentences = splitSentences(text).slice(0, 10);
    if (!sentences.length) { box.innerHTML = '<div class="sum-result"><p>Could not extract enough text from this PDF to generate questions.</p></div>'; return; }
    const questions = sentences.map((s, i) => ({
      id: i,
      q: `Explain in your own words: "${s.slice(0, 130)}${s.length > 130 ? '…' : ''}"`
    }));
    const data = { fileName: file.name, questions, generatedAt: new Date().toISOString() };
    box.innerHTML = `
      <div class="sum-result">
        <h4>✏️ ${esc(file.name)} — Practice Questions</h4>
        <p style="font-size:12px;color:var(--ink-soft);margin-bottom:14px;">${questions.length} questions generated</p>
        <div class="quiz-q-list">
          ${questions.map((q, i) => `
            <div class="quiz-q">
              <div class="quiz-q-num">Q${i + 1}</div>
              <p>${esc(q.q)}</p>
            </div>`).join('')}
        </div>
        <div class="sum-result-actions">
          <button class="btn btn-solid btn-sm" onclick='saveQuiz(${JSON.stringify(JSON.stringify(data))})'>💾 Save quiz</button>
        </div>
      </div>`;
  } catch (err) { box.innerHTML = `<div class="sum-result"><p style="color:var(--maroon);">${esc(err.message)}</p></div>`; }
}

async function saveQuiz(payloadStr) {
  const payload = JSON.parse(payloadStr);
  await API.call('POST', '/quizzes', { fileName: payload.fileName, data: payload });
  toast('Quiz saved!', 'success');
  loadQuizzes();
}

async function loadQuizzes() {
  const el = document.getElementById('quizzes-list');
  try {
    const { quizzes } = await API.call('GET', '/quizzes');
    if (!quizzes.length) { el.innerHTML = emptyState('✏️', 'No saved quizzes yet.'); return; }
    el.innerHTML = quizzes.map(q => `
      <div class="saved-row">
        <div><b>${esc(q.file_name)}</b><div class="meta">${new Date(q.created_at).toLocaleString()}</div></div>
        <div class="saved-actions">
          <button class="btn btn-sm btn-danger" onclick="deleteQuiz('${q.id}')">Delete</button>
        </div>
      </div>`).join('');
  } catch (err) { el.innerHTML = emptyState('⚠️', esc(err.message)); }
}

async function deleteQuiz(id) {
  await API.call('DELETE', '/quizzes/' + id);
  toast('Deleted');
  loadQuizzes();
}

// ---------- admin ----------
async function loadAdmin() {
  try {
    const [{ users }, { books }, { requests }, { audit }] = await Promise.all([
      API.call('GET', '/users'),
      API.call('GET', '/books'),
      API.call('GET', '/requests'),
      API.call('GET', '/audit')
    ]);

    // stat cards
    document.getElementById('admin-stats').innerHTML = `
      <div class="stat-card"><div class="s-label">Total users</div><div class="s-val">${users.length}</div></div>
      <div class="stat-card"><div class="s-label">Pending approval</div><div class="s-val">${users.filter(u=>!u.approved).length}</div></div>
      <div class="stat-card"><div class="s-label">Books in library</div><div class="s-val">${books.length}</div></div>
      <div class="stat-card"><div class="s-label">Open requests</div><div class="s-val">${requests.filter(r=>r.status==='open').length}</div></div>`;

    // pending approvals
    const pending = users.filter(u => !u.approved);
    document.getElementById('admin-pending').innerHTML = pending.length
      ? pending.map(u => `
        <div class="user-row">
          <div class="user-info"><b>${esc(u.username)}</b><span>${u.role} · ${esc(u.campus||'')} ${esc(u.college||'')}</span></div>
          <div class="user-actions">
            <button class="btn btn-sm btn-solid" onclick="approveUser('${u.id}')">✓ Approve</button>
            <button class="btn btn-sm btn-danger" onclick="deleteUser('${u.id}')">Delete</button>
          </div>
        </div>`).join('')
      : '<div class="empty-state" style="padding:20px 0;"><p>No pending approvals 🎉</p></div>';

    // all users
    document.getElementById('admin-users').innerHTML = users.map(u => `
      <div class="user-row">
        <div class="user-info">
          <b>${esc(u.username)}</b>
          <span>${pillRole(u.role)} ${u.approved ? '' : '<span class="pill pill-pending">pending</span>'} ${esc(u.campus||'')} ${esc(u.college||'')}</span>
        </div>
        <div class="user-actions">
          <select onchange="changeRole('${u.id}',this.value)">
            ${['student','teacher','admin'].map(r => `<option value="${r}"${r===u.role?' selected':''}>${r}</option>`).join('')}
          </select>
          ${u.id !== ME.id ? `<button class="btn btn-sm btn-danger" onclick="deleteUser('${u.id}')">Delete</button>` : '<span class="mono" style="font-size:11px;color:var(--ink-soft);">(you)</span>'}
        </div>
      </div>`).join('');

    // book requests (admin view shows requester info)
    document.getElementById('admin-requests').innerHTML = requests.length
      ? requests.map(r => `
        <div class="req-card">
          <div class="req-top">
            <div>
              <div class="req-title">${esc(r.title)}</div>
              <div class="req-meta">${r.author ? esc(r.author) + ' · ' : ''}${r.note ? esc(r.note) + ' · ' : ''}<span class="mono" style="font-size:11px;">${new Date(r.created_at).toLocaleDateString()}</span></div>
            </div>
            <span class="req-status ${r.status}">${r.status}</span>
          </div>
          <div class="req-actions">
            <span class="vote-btn">${r.voteCount} vote${r.voteCount!==1?'s':''}</span>
            ${r.status==='open'?`
              <button class="btn btn-sm btn-solid" onclick="setReqStatus('${r.id}','fulfilled')">Mark fulfilled</button>
              <button class="btn btn-sm btn-danger" onclick="setReqStatus('${r.id}','rejected')">Reject</button>`:''}
          </div>
        </div>`).join('')
      : emptyState('🗳️', 'No book requests yet.');

    // audit log
    document.getElementById('admin-audit').innerHTML = audit.slice(0, 80).map(a => `
      <div class="audit-row">
        <span class="audit-action">${esc(a.action)}</span>
        <span style="color:var(--ink-soft);font-size:12px;">${esc(a.target||'')}</span>
        <span class="audit-time">${new Date(a.created_at).toLocaleString()}</span>
      </div>`).join('') || emptyState('🗒️', 'No audit events yet.');

  } catch (err) { toast(err.message, 'error'); }
}

async function approveUser(id) {
  await API.call('POST', `/users/${id}/approve`);
  toast('User approved!', 'success');
  loadAdmin();
}

async function changeRole(id, role) {
  try { await API.call('POST', `/users/${id}/role`, { role }); loadAdmin(); }
  catch (e) { toast(e.message, 'error'); }
}

async function deleteUser(id) {
  if (!confirm('Delete this user? This cannot be undone.')) return;
  try { await API.call('DELETE', `/users/${id}`); loadAdmin(); }
  catch (e) { toast(e.message, 'error'); }
}

// ---------- keyboard shortcuts ----------
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('page-auth').style.display !== 'none') {
    if (document.getElementById('form-login').style.display !== 'none') doLogin();
    else doRegister();
  }
});

// ---------- boot ----------
(async function boot() {
  if (API.token) {
    try {
      const { user } = await API.call('GET', '/me');
      ME = user;
      enterApp();
      return;
    } catch { API.setToken(null); }
  }
  showHome();
})();
