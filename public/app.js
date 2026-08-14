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
  ['login','register','forgot'].forEach(m => {
    document.getElementById('form-' + m).style.display = m === mode ? 'block' : 'none';
  });
  document.getElementById('tab-login').classList.toggle('active', mode === 'login');
  document.getElementById('tab-register').classList.toggle('active', mode === 'register');
  document.getElementById('login-msg').textContent = '';
  document.getElementById('register-msg').textContent = '';
  document.getElementById('forgot-msg').textContent = '';
}
function showApp() {
  document.getElementById('page-home').style.display = 'none';
  document.getElementById('page-auth').style.display = 'none';
  document.getElementById('page-app').style.display = 'block';
}

// ---------- tab definitions ----------
// Summarize & Quiz: students only
// Teacher: Browse, Upload, Book Requested, Bookmarks
// Admin: Browse, Upload, Book Requested, Bookmarks, Admin
const TABS = [
  { id: 'browse',    label: 'Library',                                          icon: '📚', roles: null },
  { id: 'upload',    label: 'Upload',                                           icon: '📤', roles: ['teacher','admin'] },
  { id: 'requests',  label: () => ME.role === 'student' ? 'Request a Book' : 'Book Requested', icon: '🗳️', roles: null },
  { id: 'bookmarks', label: 'Bookmarks',                                        icon: '🔖', roles: null },
  { id: 'summarize', label: 'Summarize',                                        icon: '🧠', roles: ['student'] },
  { id: 'quiz',      label: 'Quiz',                                             icon: '✏️', roles: ['student'] },
  { id: 'admin',     label: 'Admin',                                            icon: '⚙️', roles: ['admin'] },
];

function visibleTabs() {
  return TABS.filter(t => !t.roles || t.roles.includes(ME.role));
}

function tabLabel(t) { return typeof t.label === 'function' ? t.label() : t.label; }

function buildNav() {
  const tabs = visibleTabs();
  document.getElementById('sidebar-nav').innerHTML = tabs.map(t => `
    <button class="snav-item" data-tab="${t.id}" onclick="switchTab('${t.id}')">
      <span class="snav-icon">${t.icon}</span> ${tabLabel(t)}
    </button>`).join('');
  document.getElementById('mobile-nav').innerHTML = tabs.slice(0, 5).map(t => `
    <button data-tab="${t.id}" onclick="switchTab('${t.id}')">
      <span class="mni">${t.icon}</span>${tabLabel(t)}
    </button>`).join('');
}

function switchTab(id) {
  document.querySelectorAll('.subview').forEach(v => v.classList.remove('active'));
  const sv = document.getElementById('sv-' + id);
  if (sv) sv.classList.add('active');
  document.querySelectorAll('#sidebar-nav .snav-item, #mobile-nav button').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === id);
  });
  if (id === 'browse')    loadBooks();
  if (id === 'requests') {
    const isStudent = ME.role === 'student';
    const h = document.getElementById('requests-heading');
    const s = document.getElementById('requests-subheading');
    const form = document.getElementById('req-form-block');
    if (h) h.textContent = isStudent ? '🗳️ Request a Book' : '🗳️ Book Requested';
    if (s) s.textContent = isStudent ? 'Request a book not yet in the library and vote on others\' requests' : 'All book requests submitted by students';
    if (form) form.style.display = isStudent ? 'block' : 'none';
    loadRequests();
  }
  if (id === 'bookmarks') loadBookmarks();
  if (id === 'summarize') loadSummaries();
  if (id === 'quiz')      loadQuizzes();
  if (id === 'admin')     loadAdmin();
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
  if (!username || !password) { msg.textContent = 'Enter your username and password.'; return; }
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
  const secQ = document.getElementById('r-secq').value;
  const secA = document.getElementById('r-seca').value.trim();
  const msg = document.getElementById('register-msg');
  msg.textContent = '';
  if (!username || !password) { msg.textContent = 'Username and password are required.'; return; }
  if (!secA) { msg.textContent = 'Please answer the security question.'; return; }
  try {
    await API.call('POST', '/register', { username, password, role, campus, college, secQ, secA });
    msg.className = 'auth-msg ok';
    msg.textContent = '✓ Account created! Wait for admin approval, then log in.';
    setTimeout(() => showAuth('login'), 2200);
  } catch (err) { msg.textContent = err.message; }
}

// ---------- forgot password ----------
async function doForgotLookup() {
  const username = document.getElementById('fp-username').value.trim();
  const msg = document.getElementById('forgot-msg');
  msg.textContent = '';
  if (!username) { msg.textContent = 'Enter your username.'; return; }
  try {
    const data = await API.call('POST', '/forgot/lookup', { username });
    document.getElementById('fp-question-text').textContent = data.question;
    document.getElementById('fp-step1').style.display = 'none';
    document.getElementById('fp-step2').style.display = 'block';
    window._fpUsername = username;
  } catch (err) { msg.textContent = err.message; }
}

async function doForgotReset() {
  const answer = document.getElementById('fp-answer').value.trim();
  const newPass = document.getElementById('fp-newpass').value;
  const msg = document.getElementById('forgot-msg');
  msg.textContent = '';
  if (!answer || !newPass) { msg.textContent = 'Fill in all fields.'; return; }
  try {
    await API.call('POST', '/forgot/reset', { username: window._fpUsername, answer, newPassword: newPass });
    msg.className = 'auth-msg ok';
    msg.textContent = '✓ Password changed! You can now log in.';
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

function strColor(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = s.charCodeAt(i) + ((h << 5) - h);
  const colors = ['#0F2A3F','#136B41','#1E5A7A','#4A3728','#2F4A3F','#1A3A5C'];
  return colors[Math.abs(h) % colors.length];
}

function bookCard(b) {
  const bmed = myBookmarks.has(b.id);
  const hasFile = b.hasFile;
  return `
  <div class="book-card" id="bc-${b.id}">
    <div class="book-cover" style="background:linear-gradient(135deg,${strColor(b.title)} 0%,${strColor(b.author||'X')} 100%);">
      <span style="font-size:38px;opacity:.18;">${b.title[0]}</span>
      <span class="approved-badge">Approved</span>
    </div>
    <div class="book-body">
      <div class="book-call-row">
        <span class="call-number mono">${esc(b.call_number||'')}</span>
      </div>
      <h4 class="book-title">${esc(b.title)}</h4>
      <div class="book-author">Author: ${esc(b.author||'Unknown')}</div>
      <div class="book-tags">
        ${b.category?`<span class="tag">${esc(b.category.toUpperCase())}</span>`:''}
        ${b.college?`<span class="tag">${esc(b.college.toUpperCase())}</span>`:''}
        <span class="tag">${b.downloads||0} DOWNLOADS</span>
        ${!hasFile?'<span class="tag no-file">NO FILE YET</span>':''}
      </div>
      <div class="book-actions">
        <button class="btn btn-sm" onclick="previewBook('${b.id}')">Preview</button>
        <a class="btn btn-solid btn-sm" href="/api/books/${b.id}/download?t=${encodeURIComponent(API.token)}" target="_blank" rel="noopener">Download</a>
        <button class="btn btn-sm bookmark-btn ${bmed?'bookmarked':''}" onclick="toggleBookmark('${b.id}',this)">${bmed?'★ Saved':'☆ Save'}</button>
      </div>
      <div class="reaction-row">
        <button class="react-btn ${b.myReaction==='up'?'reacted':''}" onclick="reactBook('${b.id}','up',this)">👍 <span id="up-${b.id}">${b.up||0}</span></button>
        <button class="react-btn ${b.myReaction==='down'?'reacted':''}" onclick="reactBook('${b.id}','down',this)">👎 <span id="dn-${b.id}">${b.down||0}</span></button>
      </div>
    </div>
  </div>`;
}

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

    // For students: show Recommended + All Books sections
    if (ME.role === 'student') {
      let recsHtml = '';
      try {
        const { books: recs } = await API.call('GET', '/recommendations');
        if (recs.length) {
          recsHtml = `
            <div class="section-block">
              <div class="section-block-title">Recommended for you
                <span class="section-block-sub">${ME.college ? 'Based on your college: ' + esc(ME.college) : 'Top downloads'}</span>
              </div>
              <div class="book-grid">${recs.map(b => bookCard(b)).join('')}</div>
            </div>`;
        }
      } catch {}
      el.innerHTML = recsHtml + `
        <div class="section-block" style="margin-top:${recsHtml?'24px':'0'}">
          <div class="section-block-title">All books</div>
          <div class="book-grid">${books.map(b => bookCard(b)).join('')}</div>
        </div>`;
    } else {
      el.innerHTML = `<div class="book-grid">${books.map(b => bookCard(b)).join('')}</div>`;
    }
  } catch (err) { el.innerHTML = emptyState('⚠️', esc(err.message)); }
}

async function previewBook(id) {
  const url = `/api/books/${id}/download?t=${encodeURIComponent(API.token)}`;
  window.open(url, '_blank');
}

async function reactBook(id, kind, btn) {
  try {
    const data = await API.call('POST', `/books/${id}/react`, { kind });
    document.getElementById('up-' + id).textContent = data.up;
    document.getElementById('dn-' + id).textContent = data.down;
    // toggle reacted class
    const card = document.getElementById('bc-' + id);
    card.querySelectorAll('.react-btn').forEach(b => b.classList.remove('reacted'));
    // if same kind was toggled off, neither is active; otherwise mark the clicked one
    const upBtn = card.querySelector('[onclick*="up"]');
    const dnBtn = card.querySelector('[onclick*="down"]');
    if (kind === 'up' && data.up > (parseInt(upBtn.querySelector('span').textContent)||0) - 1) btn.classList.add('reacted');
    if (kind === 'down' && data.down > (parseInt(dnBtn.querySelector('span').textContent)||0) - 1) btn.classList.add('reacted');
  } catch (e) { toast(e.message, 'error'); }
}

async function toggleBookmark(id, btn) {
  const isBookmarked = myBookmarks.has(id);
  try {
    if (isBookmarked) {
      await API.call('DELETE', '/bookmarks/' + id);
      myBookmarks.delete(id);
      btn.textContent = '☆ Save'; btn.classList.remove('bookmarked');
      toast('Bookmark removed');
    } else {
      await API.call('POST', '/bookmarks/' + id);
      myBookmarks.add(id);
      btn.textContent = '★ Saved'; btn.classList.add('bookmarked');
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
    // Enrich with hasFile placeholder
    const enriched = books.map(b => ({ ...b, hasFile: true, up: 0, down: 0, myReaction: null }));
    el.innerHTML = `<div class="book-grid">${enriched.map(b => bookCard(b)).join('')}</div>`;
  } catch (err) { el.innerHTML = emptyState('⚠️', esc(err.message)); }
}

async function removeBookmark(id, card) {
  await API.call('DELETE', '/bookmarks/' + id);
  card.remove();
  toast('Bookmark removed');
}

// ---------- upload ----------
function onFileChosen(input) {
  document.getElementById('file-drop-label').textContent = input.files[0]?.name || 'Click to choose a PDF file';
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
    try { const pdf = await pdfjsLib.getDocument({ data: atob(base64) }).promise; pageCount = pdf.numPages; } catch {}
    await API.call('POST', '/books', {
      title,
      author: document.getElementById('up-author').value.trim(),
      description: document.getElementById('up-desc').value.trim(),
      campus: document.getElementById('up-campus').value.trim(),
      college: document.getElementById('up-college').value.trim(),
      category: document.getElementById('up-category').value,
      fileName: file.name, base64, pageCount
    });
    msg.textContent = '';
    toast('Book uploaded successfully!', 'success');
    ['up-title','up-author','up-desc','up-file'].forEach(id => document.getElementById(id).value = '');
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
    ['req-title','req-author','req-note'].forEach(id => document.getElementById(id).value = '');
    toast('Request submitted!', 'success');
    loadRequests();
  } catch (err) { toast(err.message, 'error'); }
}

async function loadRequests() {
  const el = document.getElementById('requests-list');
  el.innerHTML = '<p style="color:var(--ink-soft);padding:10px 0;">Loading…</p>';
  const isStudent = ME.role === 'student';
  try {
    const { requests } = await API.call('GET', '/requests');

    // Students only see their OWN requests
    const visible = isStudent
      ? requests.filter(r => r.student_id === ME.id)
      : requests;

    if (isStudent && !visible.length) {
      el.innerHTML = emptyState('🗳️', 'You have not requested any book yet. Use the form above to request one!');
      return;
    }
    if (!isStudent && !visible.length) {
      el.innerHTML = emptyState('🗳️', 'No book requests from students yet.');
      return;
    }

    el.innerHTML = visible.map(r => `
      <div class="req-card">
        <div class="req-top">
          <div>
            <div class="req-title">${esc(r.title)}</div>
            <div class="req-meta">
              ${r.author ? esc(r.author) + ' · ' : ''}
              ${r.note ? esc(r.note) + ' · ' : ''}
              <span class="mono" style="font-size:11px;">${new Date(r.created_at).toLocaleDateString()}</span>
            </div>
          </div>
          <span class="req-status ${r.status}">${r.status}</span>
        </div>
        <div class="req-actions">
          ${!isStudent ? `<span class="vote-btn">${r.voteCount} vote${r.voteCount!==1?'s':''}</span>` : ''}
          ${!isStudent && r.status === 'open' ? `
            <button class="btn btn-sm btn-solid" onclick="setReqStatus('${r.id}','fulfilled')">Mark fulfilled</button>
            <button class="btn btn-sm btn-danger" onclick="setReqStatus('${r.id}','rejected')">Reject</button>` : ''}
          ${isStudent ? `<span class="muted" style="font-size:12px;">Status: <b>${r.status}</b></span>` : ''}
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
function cleanText(raw) {
  return raw
    .replace(/\f/g, ' ')                          // form feeds
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') // control chars
    .replace(/([a-z])([A-Z])/g, '$1 $2')           // merged words like "helloWorld"
    .replace(/\s+/g, ' ')                          // collapse whitespace
    .trim();
}

function goodSentences(text) {
  // Split on sentence boundaries, keep only clean readable sentences
  return text
    .split(/(?<=[.?!])\s+/)
    .map(s => s.trim())
    .filter(s =>
      s.length > 40 &&           // not too short
      s.length < 500 &&          // not too long
      s.split(' ').length > 6 && // has enough words
      /[a-zA-Z]/.test(s) &&      // has letters
      !/^[\d\W]+$/.test(s)       // not just numbers/symbols
    )
    .map(s => {
      // Capitalise first letter, ensure ends with full stop
      let cleaned = s.charAt(0).toUpperCase() + s.slice(1);
      if (!/[.?!]$/.test(cleaned)) cleaned += '.';
      return cleaned;
    });
}

function extractKeyTerms(text) {
  // Find capitalised multi-word phrases (likely important terms)
  const matches = text.match(/[A-Z][a-z]+(?: [A-Z][a-z]+)+/g) || [];
  const freq = {};
  matches.forEach(t => { freq[t] = (freq[t] || 0) + 1; });
  return Object.entries(freq)
    .filter(([, c]) => c > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([term]) => term);
}

async function doSummarize() {
  const file = document.getElementById('sum-file').files[0];
  if (!file) { toast('Please choose a PDF file first', 'error'); return; }
  const box = document.getElementById('sum-result');
  box.style.display = 'block';
  box.innerHTML = '<div class="sum-result"><p>📖 Reading and analysing PDF… please wait</p></div>';
  try {
    const { text: rawText, pageCount } = await extractPdfText(file);
    const text = cleanText(rawText);
    const sentences = goodSentences(text);

    if (sentences.length < 3) {
      box.innerHTML = '<div class="sum-result"><p style="color:var(--maroon);">This PDF does not contain enough readable text to summarise. Try a text-based PDF rather than a scanned image.</p></div>';
      return;
    }

    // Overview: best 2-3 opening sentences
    const overview = sentences.slice(0, 3).join(' ');

    // Key points: pick evenly-spaced sentences from the rest
    const rest = sentences.slice(3);
    const step = Math.max(1, Math.floor(rest.length / 8));
    const keyPoints = [];
    for (let i = 0; i < rest.length && keyPoints.length < 8; i += step) keyPoints.push(rest[i]);

    // Conclusion: last 1-2 sentences
    const conclusion = sentences.slice(-2).join(' ');

    // Key terms
    const keyTerms = extractKeyTerms(text);

    const data = { fileName: file.name, pageCount, overview, keyPoints, conclusion, keyTerms, generatedAt: new Date().toISOString() };

    box.innerHTML = `
      <div class="sum-result">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
          <div>
            <h4 style="margin-bottom:2px;">📄 ${esc(file.name)}</h4>
            <p style="font-size:12px;color:var(--ink-soft);">${pageCount} pages · Summarised ${new Date().toLocaleString()}</p>
          </div>
          <button class="btn btn-solid btn-sm" onclick='saveSummary(${JSON.stringify(JSON.stringify(data))})'>💾 Save</button>
        </div>

        <div class="sum-section">
          <div class="sum-section-label">📝 Overview</div>
          <p class="sum-paragraph">${esc(overview)}</p>
        </div>

        ${keyPoints.length ? `
        <div class="sum-section">
          <div class="sum-section-label">🔑 Key Points</div>
          <ul class="sum-list">${keyPoints.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
        </div>` : ''}

        ${keyTerms.length ? `
        <div class="sum-section">
          <div class="sum-section-label">📌 Key Terms</div>
          <div class="sum-terms">${keyTerms.map(t => `<span class="sum-term">${esc(t)}</span>`).join('')}</div>
        </div>` : ''}

        ${conclusion && conclusion !== overview ? `
        <div class="sum-section">
          <div class="sum-section-label">✅ Conclusion</div>
          <p class="sum-paragraph">${esc(conclusion)}</p>
        </div>` : ''}
      </div>`;
  } catch (err) {
    box.innerHTML = `<div class="sum-result"><p style="color:var(--maroon);">${esc(err.message)}</p></div>`;
  }
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
function generateMCQ(sentence, allSentences) {
  const words = sentence.replace(/["""''(){}\[\]]/g, '').split(' ').filter(w => w.length > 4 && /^[a-zA-Z]/.test(w));
  if (words.length < 5) return null;
  const answerWord = words[Math.floor(words.length * 0.45)];
  const question = sentence.replace(answerWord, '______');
  const pool = allSentences
    .flatMap(s => s.split(' ').filter(w => w.length > 4 && /^[a-zA-Z]/.test(w) && w !== answerWord))
    .filter((w, i, arr) => arr.indexOf(w) === i);
  const distractors = pool.sort(() => Math.random() - 0.5).slice(0, 3);
  while (distractors.length < 3) distractors.push('None of the above');
  const options = [answerWord, ...distractors].sort(() => Math.random() - 0.5);
  const correctIndex = options.indexOf(answerWord);
  return { question, options, correctIndex, type: 'mcq' };
}

function generateTrueFalse(sentence) {
  const words = sentence.split(' ');
  const isTrue = Math.random() > 0.5;
  let statement = sentence;
  if (!isTrue && words.length > 8) {
    const flipIndex = Math.floor(words.length * 0.5);
    const negations = ['not', 'never', 'rarely', 'cannot', 'seldom'];
    statement = words.slice(0, flipIndex).join(' ') + ' ' + negations[Math.floor(Math.random() * negations.length)] + ' ' + words.slice(flipIndex).join(' ');
  }
  return { question: statement, answer: isTrue, type: 'truefalse' };
}

function generateFillBlank(sentence) {
  const words = sentence.split(' ').filter(w => w.length > 4 && /^[a-zA-Z]/.test(w));
  if (words.length < 4) return null;
  const answerWord = words[Math.floor(words.length * 0.5)];
  const question = sentence.replace(answerWord, '_________');
  return { question, answer: answerWord.replace(/[^a-zA-Z]/g, ''), type: 'fillblank' };
}

let currentQuiz = null;

async function doQuiz() {
  const file = document.getElementById('quiz-file').files[0];
  const count = parseInt(document.getElementById('quiz-count').value) || 10;
  const qtype = document.getElementById('quiz-type').value;
  const difficulty = document.getElementById('quiz-difficulty').value;
  if (!file) { toast('Please choose a PDF file first', 'error'); return; }
  const box = document.getElementById('quiz-result');
  box.style.display = 'block';
  box.innerHTML = '<div class="sum-result"><p>Reading PDF and generating questions…</p></div>';
  try {
    const { text: rawText, pageCount } = await extractPdfText(file);
    const text = cleanText(rawText);
    const sentences = goodSentences(text);
    if (sentences.length < 4) {
      box.innerHTML = '<div class="sum-result"><p style="color:var(--maroon);">Not enough readable text. Try a text-based PDF, not a scanned image.</p></div>';
      return;
    }
    let pool = [...sentences];
    if (difficulty === 'easy') pool = pool.filter(s => s.split(' ').length < 18) ;
    if (difficulty === 'hard') pool = pool.filter(s => s.split(' ').length > 16);
    if (pool.length < 4) pool = sentences;
    const step = Math.max(1, Math.floor(pool.length / count));
    const picked = [];
    for (let i = 0; i < pool.length && picked.length < count; i += step) picked.push(pool[i]);
    const questions = picked.map((s, idx) => {
      if (qtype === 'mcq') return generateMCQ(s, pool);
      if (qtype === 'truefalse') return generateTrueFalse(s);
      if (qtype === 'fillblank') return generateFillBlank(s);
      // mixed
      const t = ['mcq','truefalse','fillblank'][idx % 3];
      if (t === 'mcq') return generateMCQ(s, pool);
      if (t === 'truefalse') return generateTrueFalse(s);
      return generateFillBlank(s);
    }).filter(Boolean).slice(0, count);
    if (!questions.length) {
      box.innerHTML = '<div class="sum-result"><p style="color:var(--maroon);">Could not generate questions. Try a different question type or file.</p></div>';
      return;
    }
    currentQuiz = { fileName: file.name, pageCount, questions, qtype, difficulty, answers: {}, submitted: false };
    renderQuiz(box);
  } catch (err) {
    box.innerHTML = '<div class="sum-result"><p style="color:var(--maroon);">' + esc(err.message) + '</p></div>';
  }
}

function renderQuiz(box) {
  const { fileName, questions, qtype, difficulty } = currentQuiz;
  const typeLabel = { mcq: 'Multiple Choice', truefalse: 'True / False', fillblank: 'Fill in the Blank', mixed: 'Mixed' };
  const diffLabel = { easy: '🟢 Easy', medium: '🟡 Medium', hard: '🔴 Hard' };
  box.innerHTML =
    '<div class="sum-result">' +
    '<div style="margin-bottom:16px;">' +
    '<h4 style="margin-bottom:4px;">✏️ ' + esc(fileName) + '</h4>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px;">' +
    '<span class="tag">' + (typeLabel[qtype]||'Mixed') + '</span>' +
    '<span class="tag">' + (diffLabel[difficulty]||'🟡 Medium') + '</span>' +
    '<span class="tag">' + questions.length + ' Questions</span>' +
    '</div></div>' +
    '<div id="quiz-questions">' + questions.map((q, qi) => renderQuestion(q, qi)).join('') + '</div>' +
    '<div class="sum-result-actions" style="margin-top:20px;">' +
    '<button class="btn btn-solid btn-sm" onclick="submitQuiz()">✅ Submit answers</button>' +
    '<button class="btn btn-sm" onclick=\'saveQuiz(' + JSON.stringify(JSON.stringify({ fileName, questions })) + ')\'>💾 Save quiz</button>' +
    '</div><div id="quiz-score" style="display:none;margin-top:16px;"></div></div>';
}

function renderQuestion(q, qi) {
  const labels = ['A','B','C','D'];
  if (q.type === 'mcq') {
    return '<div class="quiz-q" id="qq-' + qi + '">' +
      '<div class="quiz-q-num">Q' + (qi+1) + ' · Multiple Choice</div>' +
      '<p style="font-weight:600;margin-bottom:10px;">' + esc(q.question) + '</p>' +
      '<ul class="quiz-options">' +
      q.options.map((opt, oi) =>
        '<li id="qo-' + qi + '-' + oi + '" onclick="selectOption(' + qi + ',' + oi + ')"><b>' + labels[oi] + '.</b> ' + esc(opt) + '</li>'
      ).join('') + '</ul></div>';
  }
  if (q.type === 'truefalse') {
    return '<div class="quiz-q" id="qq-' + qi + '">' +
      '<div class="quiz-q-num">Q' + (qi+1) + ' · True or False</div>' +
      '<p style="font-weight:600;margin-bottom:10px;">' + esc(q.question) + '</p>' +
      '<ul class="quiz-options">' +
      '<li id="qo-' + qi + '-0" onclick="selectOption(' + qi + ',0)"><b>A.</b> True</li>' +
      '<li id="qo-' + qi + '-1" onclick="selectOption(' + qi + ',1)"><b>B.</b> False</li>' +
      '</ul></div>';
  }
  if (q.type === 'fillblank') {
    return '<div class="quiz-q" id="qq-' + qi + '">' +
      '<div class="quiz-q-num">Q' + (qi+1) + ' · Fill in the Blank</div>' +
      '<p style="font-weight:600;margin-bottom:10px;">' + esc(q.question) + '</p>' +
      '<input id="qo-fill-' + qi + '" style="width:100%;padding:10px 12px;border:1.5px solid var(--line);border-radius:2px;font-size:14px;" ' +
      'placeholder="Type your answer here…" oninput="currentQuiz.answers[' + qi + ']=this.value.trim().toLowerCase()">' +
      '</div>';
  }
  return '';
}

function selectOption(qi, oi) {
  if (currentQuiz.submitted) return;
  currentQuiz.answers[qi] = oi;
  const q = currentQuiz.questions[qi];
  const optCount = q.type === 'truefalse' ? 2 : 4;
  for (let i = 0; i < optCount; i++) {
    const el = document.getElementById('qo-' + qi + '-' + i);
    if (!el) continue;
    el.style.background = i === oi ? 'var(--parchment-deep)' : '';
    el.style.borderColor = i === oi ? 'var(--ink)' : '';
    el.style.fontWeight = i === oi ? '600' : '';
  }
}

function submitQuiz() {
  if (currentQuiz.submitted) return;
  const { questions, answers } = currentQuiz;
  const labels = ['A','B','C','D'];
  const unanswered = questions.map((_, i) => i).filter(i => answers[i] === undefined || answers[i] === '');
  if (unanswered.length) { toast('Please answer all questions (' + unanswered.length + ' left)', 'error'); return; }
  currentQuiz.submitted = true;
  let correct = 0;
  questions.forEach((q, qi) => {
    if (q.type === 'mcq') {
      const chosen = answers[qi];
      const ok = chosen === q.correctIndex;
      if (ok) correct++;
      q.options.forEach((opt, oi) => {
        const el = document.getElementById('qo-' + qi + '-' + oi);
        if (!el) return;
        if (oi === q.correctIndex) { el.classList.add('correct'); el.innerHTML = '<b>' + labels[oi] + '.</b> ' + esc(opt) + ' ✓'; }
        else if (oi === chosen && !ok) { el.classList.add('wrong'); el.innerHTML = '<b>' + labels[oi] + '.</b> ' + esc(opt) + ' ✗'; }
      });
    } else if (q.type === 'truefalse') {
      const chosen = answers[qi];
      const correctIndex = q.answer ? 0 : 1;
      const ok = chosen === correctIndex;
      if (ok) correct++;
      [0,1].forEach(oi => {
        const el = document.getElementById('qo-' + qi + '-' + oi);
        if (!el) return;
        if (oi === correctIndex) { el.classList.add('correct'); el.innerHTML += ' ✓'; }
        else if (oi === chosen && !ok) { el.classList.add('wrong'); el.innerHTML += ' ✗'; }
      });
    } else if (q.type === 'fillblank') {
      const userAns = (answers[qi] || '').toLowerCase().trim();
      const correctAns = q.answer.toLowerCase().trim();
      const ok = userAns === correctAns || correctAns.includes(userAns) || userAns.includes(correctAns);
      if (ok) correct++;
      const input = document.getElementById('qo-fill-' + qi);
      if (input) { input.disabled = true; input.style.borderColor = ok ? 'var(--brass)' : 'var(--maroon)'; input.style.background = ok ? '#EAFBF1' : '#FBEAEA'; }
      const qEl = document.getElementById('qq-' + qi);
      if (qEl) {
        const hint = document.createElement('p');
        hint.style.cssText = 'font-size:13px;margin-top:8px;color:' + (ok ? 'var(--brass-dark)' : 'var(--maroon)');
        hint.textContent = ok ? '✓ Correct! Answer: ' + q.answer : '✗ Correct answer: ' + q.answer;
        qEl.appendChild(hint);
      }
    }
  });
  const pct = Math.round((correct / questions.length) * 100);
  const grade = pct >= 80 ? '🎉 Excellent!' : pct >= 60 ? '👍 Good effort!' : pct >= 40 ? '📖 Keep studying!' : '💪 Don\'t give up!';
  const scoreEl = document.getElementById('quiz-score');
  scoreEl.style.display = 'block';
  scoreEl.innerHTML =
    '<div style="background:var(--parchment-deep);border:1px solid var(--line);border-radius:4px;padding:20px;text-align:center;">' +
    '<div style="font-family:Fraunces,serif;font-size:48px;color:var(--ink);">' + pct + '%</div>' +
    '<div style="font-size:15px;font-weight:600;color:var(--ink);margin-top:4px;">' + grade + '</div>' +
    '<div style="font-size:13px;color:var(--ink-soft);margin-top:6px;">' + correct + ' of ' + questions.length + ' correct</div>' +
    '<button class="btn btn-sm" style="margin-top:14px;" onclick="doQuiz()">🔄 Try again with same settings</button>' +
    '</div>';
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

    document.getElementById('admin-stats').innerHTML = `
      <div class="stat-card"><div class="s-label">Total users</div><div class="s-val">${users.length}</div></div>
      <div class="stat-card"><div class="s-label">Pending approval</div><div class="s-val">${users.filter(u=>!u.approved).length}</div></div>
      <div class="stat-card"><div class="s-label">Books in library</div><div class="s-val">${books.length}</div></div>
      <div class="stat-card"><div class="s-label">Open requests</div><div class="s-val">${requests.filter(r=>r.status==='open').length}</div></div>`;

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
      : '<div class="empty-state" style="padding:16px 0;"><p>No pending approvals 🎉</p></div>';

    document.getElementById('admin-users').innerHTML = users.map(u => `
      <div class="user-row">
        <div class="user-info">
          <b>${esc(u.username)}</b>
          <span>${pillRole(u.role)} ${u.approved ? '' : '<span class="pill pill-pending">pending</span>'} ${esc(u.campus||'')} ${esc(u.college||'')}</span>
        </div>
        <div class="user-actions">
          <select onchange="changeRole('${u.id}',this.value)">
            ${['student','teacher','admin'].map(r=>`<option value="${r}"${r===u.role?' selected':''}>${r}</option>`).join('')}
          </select>
          ${u.id !== ME.id ? `<button class="btn btn-sm btn-danger" onclick="deleteUser('${u.id}')">Delete</button>` : '<span class="mono" style="font-size:11px;color:var(--ink-soft);">(you)</span>'}
        </div>
      </div>`).join('');

    document.getElementById('admin-requests').innerHTML = requests.length
      ? requests.map(r => `
        <div class="req-card">
          <div class="req-top">
            <div>
              <div class="req-title">${esc(r.title)}</div>
              <div class="req-meta">${r.author ? esc(r.author)+' · ' : ''}${r.note ? esc(r.note)+' · ' : ''}<span class="mono" style="font-size:11px;">${new Date(r.created_at).toLocaleDateString()}</span></div>
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

    document.getElementById('admin-audit').innerHTML = audit.slice(0,80).map(a => `
      <div class="audit-row">
        <span class="audit-action">${esc(a.action)}</span>
        <span style="color:var(--ink-soft);font-size:12px;">${esc(a.target||'')}</span>
        <span class="audit-time">${new Date(a.created_at).toLocaleString()}</span>
      </div>`).join('') || emptyState('🗒️','No audit events yet.');

  } catch (err) { toast(err.message, 'error'); }
}

async function approveUser(id) { await API.call('POST',`/users/${id}/approve`); toast('User approved!','success'); loadAdmin(); }
async function changeRole(id, role) { try { await API.call('POST',`/users/${id}/role`,{role}); loadAdmin(); } catch(e){toast(e.message,'error');} }
async function deleteUser(id) { if(!confirm('Delete this user?')) return; try{await API.call('DELETE',`/users/${id}`);loadAdmin();}catch(e){toast(e.message,'error');} }

// ---------- keyboard ----------
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const auth = document.getElementById('page-auth');
  if (auth.style.display === 'none' || !auth.style.display) return;
  if (document.getElementById('form-login').style.display !== 'none') doLogin();
  else if (document.getElementById('form-register').style.display !== 'none') doRegister();
  else if (document.getElementById('form-forgot').style.display !== 'none') {
    if (document.getElementById('fp-step2').style.display === 'block') doForgotReset();
    else doForgotLookup();
  }
});

// ---------- boot ----------
(async function boot() {
  if (API.token) {
    try { const { user } = await API.call('GET','/me'); ME = user; enterApp(); return; }
    catch { API.setToken(null); }
  }
  showHome();
})();
