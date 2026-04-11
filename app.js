// ── STATE ────────────────────────────────────────────────────────────────────
let db = null;
let appRef = null;
let myDeviceId = null;
let myName = null;
let state = { members: [], completions: {}, queue: [] };

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ── DEVICE IDENTITY ───────────────────────────────────────────────────────────
function getOrCreateDeviceId() {
  let id = localStorage.getItem('dishduty_device_id');
  if (!id) {
    id = 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('dishduty_device_id', id);
  }
  return id;
}

function getLockedName() { return localStorage.getItem('dishduty_locked_name'); }
function lockName(name) { localStorage.setItem('dishduty_locked_name', name); }

// ── INIT ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  myDeviceId = getOrCreateDeviceId();
  const saved = getLockedName();
  if (saved) { myName = saved; showMain(); }

  document.getElementById('setup-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') setupDone();
  });
  document.getElementById('member-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addMember();
  });
});

function setupDone() {
  const name = document.getElementById('setup-name').value.trim();
  if (!name) { showToast('Enter your name first'); return; }
  myName = name;
  lockName(name);
  showMain();
}

function showMain() {
  document.getElementById('setup-screen').classList.remove('active');
  document.getElementById('main-screen').classList.add('active');
  document.getElementById('header-user').textContent = myName;
  if (!db) initFirebase(); else render();
}

// ── FIREBASE ─────────────────────────────────────────────────────────────────
function initFirebase() {
  try {
    if (firebaseConfig.apiKey === 'PASTE_YOUR_API_KEY_HERE') {
      setSyncState('err', 'no config');
      showToast('Add your Firebase config to firebase-config.js');
      return;
    }
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    appRef = db.ref('dishduty');

    appRef.on('value', snap => {
      const data = snap.val();
      if (data) {
        state = data;
        if (!state.members) state.members = [];
        if (!state.completions) state.completions = {};
        if (!state.queue) state.queue = [];
      }
      processOverdueDays();
      setSyncState('live', 'live');
      render();
    }, err => { console.error(err); setSyncState('err', 'error'); });

    db.ref('.info/connected').on('value', snap => {
      setSyncState(snap.val() ? 'live' : 'err', snap.val() ? 'live' : 'offline');
    });
  } catch(e) {
    console.error(e);
    setSyncState('err', 'error');
    showToast('Firebase error — check your config');
  }
}

function save() {
  if (!appRef) return;
  setSyncState('saving', 'saving');
  appRef.set(state)
    .then(() => setSyncState('live', 'live'))
    .catch(e => { console.error(e); setSyncState('err', 'error'); });
}

// ── DATE HELPERS ──────────────────────────────────────────────────────────────
function dateKey(d) { return d.toISOString().slice(0, 10); }
function todayKey() { return dateKey(new Date()); }
function fmtDate(k) {
  return new Date(k + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

// ── QUEUE SYSTEM ──────────────────────────────────────────────────────────────
// The queue is a flat ordered list of { date, memberId, isDebt? }.
// When someone misses a day, processOverdueDays() detects it and re-inserts
// their entry at the front of the future queue, pushing everyone else back by 1 day.

function rebuildQueue() {
  if (!state.members || state.members.length === 0) { state.queue = []; return; }

  const tk = todayKey();
  const epoch = new Date('2024-01-01T12:00:00');
  const todayDate = new Date(tk + 'T12:00:00');
  const startIdx = Math.floor((todayDate - epoch) / 86400000);

  // Keep completed past entries, rebuild everything from today forward
  const pastDone = (state.queue || []).filter(e => e.date < tk && state.completions && state.completions[e.date]);

  const future = [];
  let offset = 0;
  for (let i = 0; i <= 30; i++) {
    const k = addDays(tk, i);
    const memberIdx = ((startIdx + offset) % state.members.length + state.members.length) % state.members.length;
    future.push({ date: k, memberId: state.members[memberIdx].id, isDebt: false });
    offset++;
  }

  state.queue = [...pastDone, ...future];
}

function processOverdueDays() {
  if (!state.members || !state.members.length) return;

  const tk = todayKey();
  let needsSave = false;

  // Find past days with no completion that are in the queue
  const missed = (state.queue || []).filter(e =>
    e.date < tk && !(state.completions && state.completions[e.date]) && !e.isDebt
  );

  if (missed.length === 0) return;

  // Remove missed entries from queue (they'll be re-inserted as debts)
  state.queue = state.queue.filter(e => !(e.date < tk && !(state.completions && state.completions[e.date]) && !e.isDebt));

  // Get the future queue from today onward
  let future = state.queue.filter(e => e.date >= tk).sort((a, b) => a.date.localeCompare(b.date));

  // Insert each missed person's debt at the front of the future queue
  missed.forEach(m => {
    future.unshift({ date: '__pending__', memberId: m.memberId, isDebt: true, originalDate: m.date });
  });

  // Reassign real dates: go through the future list and assign the next available date
  let datePtr = tk;
  const reassigned = [];
  future.forEach(entry => {
    reassigned.push({ ...entry, date: datePtr });
    datePtr = addDays(datePtr, 1);
  });

  // Extend to 30 days if needed
  while (datePtr <= addDays(tk, 30)) {
    const epoch = new Date('2024-01-01T12:00:00');
    const d = new Date(datePtr + 'T12:00:00');
    const dayIdx = Math.floor((d - epoch) / 86400000);
    const memberIdx = ((dayIdx) % state.members.length + state.members.length) % state.members.length;
    reassigned.push({ date: datePtr, memberId: state.members[memberIdx].id, isDebt: false });
    datePtr = addDays(datePtr, 1);
  }

  const pastDone = state.queue.filter(e => e.date < tk);
  state.queue = [...pastDone, ...reassigned];
  needsSave = true;

  if (needsSave) save();
}

function getQueueEntry(dateStr) {
  return (state.queue || []).find(e => e.date === dateStr) || null;
}

function getAssigneeForDate(dateStr) {
  const entry = getQueueEntry(dateStr);
  if (!entry) return null;
  return state.members.find(m => m.id === entry.memberId) || null;
}

// ── MEMBERS ──────────────────────────────────────────────────────────────────
function addMember() {
  const input = document.getElementById('member-input');
  const name = input.value.trim();
  if (!name) return;
  if (!state.members) state.members = [];
  if (state.members.find(m => m.name.toLowerCase() === name.toLowerCase())) {
    showToast('Name already added'); return;
  }
  const id = 'mbr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  state.members.push({ id, name, deviceId: null, addedAt: Date.now() });
  autoRegisterDevice();
  rebuildQueue();
  save();
  render();
  input.value = '';
  showToast(name + ' added to the rotation');
}

function autoRegisterDevice() {
  if (!myName || !myDeviceId) return;
  const me = state.members.find(m => m.name.toLowerCase() === myName.toLowerCase());
  if (me && !me.deviceId) me.deviceId = myDeviceId;
}

function removeMember(id) {
  const m = state.members.find(m => m.id === id);
  if (!m) return;
  if (!confirm('Remove ' + m.name + ' from the rotation?')) return;
  state.members = state.members.filter(m => m.id !== id);
  state.queue = (state.queue || []).filter(e => e.memberId !== id);
  rebuildQueue();
  save();
  render();
}

// ── MARK DONE ────────────────────────────────────────────────────────────────
function markDone() {
  const k = todayKey();
  const assignee = getAssigneeForDate(k);
  if (!assignee) return;

  // Find my member record
  const me = state.members.find(m => m.name.toLowerCase() === myName.toLowerCase());
  if (!me) { showToast("Add yourself to the member list first"); return; }

  // Lock device to member on first mark
  if (!me.deviceId) {
    me.deviceId = myDeviceId;
  } else if (me.deviceId !== myDeviceId) {
    // Someone else's device is trying to use this name
    showToast("This name is locked to another device! 🚫");
    return;
  }

  // Must be your turn
  if (assignee.id !== me.id) {
    showToast("It's " + assignee.name + "'s turn today! 👀");
    return;
  }

  if (!state.completions) state.completions = {};
  state.completions[k] = {
    memberId: me.id,
    name: me.name,
    timestamp: Date.now()
  };

  save();
  render();
  showToast('Dishes marked done! ✓');
}

// ── RENDER ───────────────────────────────────────────────────────────────────
function render() {
  renderHero();
  renderWeek();
  renderMembers();
  renderHistory();
}

function renderHero() {
  const action = document.getElementById('hero-action');
  const k = todayKey();
  const assignee = getAssigneeForDate(k);
  const comp = state.completions && state.completions[k];
  const entry = getQueueEntry(k);

  document.getElementById('hero-date').textContent =
    new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  document.getElementById('hero-name').textContent =
    assignee ? assignee.name : (state.members && state.members.length ? '—' : 'Add members below');

  const debtBadge = (entry && entry.isDebt)
    ? `<div class="debt-badge">⚠ Makeup wash — was skipped on ${fmtDate(entry.originalDate)}</div>` : '';

  if (comp) {
    action.innerHTML = `${debtBadge}
      <div class="done-status">
        <span class="done-check">✓</span>
        <div>
          <div class="done-text">Done by ${comp.name}</div>
          <div class="done-time">${fmtTime(comp.timestamp)}</div>
        </div>
      </div>`;
  } else if (assignee) {
    const me = state.members.find(m => m.name.toLowerCase() === myName.toLowerCase());
    const isMyTurn = me && assignee.id === me.id;
    if (isMyTurn) {
      action.innerHTML = `${debtBadge}<button class="btn-done" onclick="markDone()">✓ I washed the dishes</button>`;
    } else {
      action.innerHTML = `${debtBadge}<div class="btn-not-yours">Waiting for ${assignee.name} to wash up…</div>`;
    }
  } else {
    action.innerHTML = '';
  }
}

function renderWeek() {
  const el = document.getElementById('week-list');
  if (!state.members || !state.members.length) {
    el.innerHTML = '<div class="empty-msg">Add members to see the schedule</div>';
    return;
  }
  const base = new Date();
  const tk = todayKey();
  let html = '';
  for (let i = -2; i <= 9; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const k = dateKey(d);
    const assignee = getAssigneeForDate(k);
    const entry = getQueueEntry(k);
    const done = !!(state.completions && state.completions[k]);
    const isToday = k === tk;
    const isPast = k < tk;

    let badge = '';
    if (done) badge = '<span class="week-badge badge-done">Done ✓</span>';
    else if (isToday) badge = '<span class="week-badge badge-today">Today</span>';
    else if (isPast) badge = '<span class="week-badge badge-miss">Missed</span>';
    else if (entry && entry.isDebt) badge = '<span class="week-badge badge-debt">Makeup</span>';

    html += `<div class="week-row${isToday ? ' is-today' : ''}">
      <div class="week-day${isToday ? ' today' : ''}">${isToday ? 'TODAY' : DAYS[d.getDay()].toUpperCase()}</div>
      <div class="week-person">${assignee ? assignee.name : '—'}</div>
      ${badge}
    </div>`;
  }
  el.innerHTML = html;
}

function renderMembers() {
  const el = document.getElementById('member-list');
  if (!state.members || !state.members.length) {
    el.innerHTML = '<div class="empty-msg">No members yet — add people below</div>';
    return;
  }
  const counts = {};
  const debts = {};
  if (state.completions) Object.values(state.completions).forEach(c => { counts[c.memberId] = (counts[c.memberId] || 0) + 1; });
  (state.queue || []).filter(e => e.isDebt).forEach(e => { debts[e.memberId] = (debts[e.memberId] || 0) + 1; });

  el.innerHTML = state.members.map((m, i) => {
    const isYou = m.name.toLowerCase() === myName.toLowerCase();
    const debt = debts[m.id] || 0;
    return `<div class="member-row">
      <div class="member-avatar av-${i % 6}">${m.name[0].toUpperCase()}</div>
      <div class="member-name">${m.name}</div>
      <div class="member-stats">
        <span class="member-count">${counts[m.id] || 0} done</span>
        ${debt > 0 ? `<span class="member-debt">${debt} owed</span>` : ''}
      </div>
      ${isYou ? '<span class="member-you">you</span>' : ''}
      <button class="remove-btn" onclick="removeMember('${m.id}')" title="Remove">✕</button>
    </div>`;
  }).join('');
}

function renderHistory() {
  const el = document.getElementById('history-list');
  if (!state.completions || !Object.keys(state.completions).length) {
    el.innerHTML = '<div class="empty-msg">No completed tasks yet</div>';
    return;
  }
  const sorted = Object.entries(state.completions).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 20);
  el.innerHTML = sorted.map(([k, c]) => `
    <div class="history-row">
      <div class="history-date">${fmtDate(k)}</div>
      <div class="history-who">${c.name}</div>
      <div class="history-time">${fmtTime(c.timestamp)}</div>
      <div class="history-tick">✓</div>
    </div>`).join('');
}

// ── UI HELPERS ────────────────────────────────────────────────────────────────
function setSyncState(status, label) {
  document.getElementById('sync-dot').className = 'sync-dot ' + status;
  document.getElementById('sync-text').textContent = label;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

setInterval(() => {
  const n = new Date();
  if (n.getHours() === 0 && n.getMinutes() === 0) { processOverdueDays(); render(); }
}, 60000);
