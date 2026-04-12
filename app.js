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
        if (!Array.isArray(state.members)) state.members = [];
        if (!state.completions) state.completions = {};
        if (!Array.isArray(state.queue)) state.queue = [];
      }
      extendQueue();
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

function save(callback) {
  if (!appRef) return;
  setSyncState('saving', 'saving');
  appRef.set(state)
    .then(() => { setSyncState('live', 'live'); if (callback) callback(); })
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
//
// The queue is a simple ordered array of { date, memberId, isDebt }.
// Rules:
//   1. It is ALWAYS extended so it covers at least 30 days from today.
//   2. The next person in the queue is always (lastPersonIndex + 1) % members.
//   3. If a past day has no completion, that person owes a wash.
//      Their owed turn is inserted RIGHT BEFORE whoever is next in the future queue.
//   4. We NEVER recalculate old dates — only append to the future.

function getNextMemberIndex(afterMemberId) {
  if (!state.members.length) return 0;
  const idx = state.members.findIndex(m => m.id === afterMemberId);
  if (idx === -1) return 0;
  return (idx + 1) % state.members.length;
}

function extendQueue() {
  if (!state.members || state.members.length === 0) { state.queue = []; return; }

  const tk = todayKey();
  const targetEnd = addDays(tk, 30);

  // Step 1: figure out what the last date in the queue is
  const sorted = [...(state.queue || [])].sort((a, b) => a.date.localeCompare(b.date));
  let lastDate = sorted.length ? sorted[sorted.length - 1].date : addDays(tk, -1);
  let lastMemberId = sorted.length ? sorted[sorted.length - 1].memberId : state.members[state.members.length - 1].id;

  // Step 2: check for past missed turns and insert debts if not already there
  handleMissedTurns();

  // Step 3: append future dates until we reach targetEnd
  let fillFrom = addDays(lastDate, 1);
  let nextIdx = getNextMemberIndex(lastMemberId);

  // Re-read sorted after handleMissedTurns may have changed the queue
  const sorted2 = [...(state.queue || [])].sort((a, b) => a.date.localeCompare(b.date));
  if (sorted2.length) {
    const last = sorted2[sorted2.length - 1];
    fillFrom = addDays(last.date, 1);
    nextIdx = getNextMemberIndex(last.memberId);
  }

  let changed = false;
  while (fillFrom <= targetEnd) {
    if (!state.queue.find(e => e.date === fillFrom)) {
      state.queue.push({ date: fillFrom, memberId: state.members[nextIdx].id, isDebt: false });
      nextIdx = (nextIdx + 1) % state.members.length;
      changed = true;
    }
    fillFrom = addDays(fillFrom, 1);
  }

  if (changed) save();
}

function handleMissedTurns() {
  const tk = todayKey();

  // Find past queue entries with no completion (genuinely missed, not already a debt)
  const missed = (state.queue || []).filter(e =>
    e.date < tk &&
    !e.isDebt &&
    !(state.completions && state.completions[e.date])
  );

  if (missed.length === 0) return;

  // Remove them from the queue (we'll re-insert as debts)
  state.queue = state.queue.filter(e =>
    !(e.date < tk && !e.isDebt && !(state.completions && state.completions[e.date]))
  );

  // Get future entries sorted
  let future = state.queue.filter(e => e.date >= tk).sort((a, b) => a.date.localeCompare(b.date));

  // Insert each missed person as a debt entry at the FRONT of future
  // (so they wash first before the normal rotation continues)
  missed.reverse().forEach(m => {
    future.unshift({ date: '__reassign__', memberId: m.memberId, isDebt: true, originalDate: m.date });
  });

  // Now reassign actual dates to every future entry in order
  let datePtr = tk;
  const reassigned = [];
  future.forEach(entry => {
    reassigned.push({ ...entry, date: datePtr });
    datePtr = addDays(datePtr, 1);
  });

  // Put it all back together
  const pastEntries = state.queue.filter(e => e.date < tk);
  state.queue = [...pastEntries, ...reassigned];
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

  // New member gets inserted into the future queue fairly:
  // find their first appearance in the queue and interleave them
  interleaveNewMember(id);

  save();
  render();
  input.value = '';
  showToast(name + ' added to the rotation');
}

function interleaveNewMember(newId) {
  // Clear future queue and rebuild it including the new member in round-robin
  const tk = todayKey();
  const future = state.queue.filter(e => e.date >= tk).sort((a, b) => a.date.localeCompare(b.date));
  const past = state.queue.filter(e => e.date < tk);

  // Figure out who was going next before new member was added (without new member)
  // Just rebuild the full future rotation from today with all members including new one
  if (future.length === 0) { extendQueue(); return; }

  // Find who goes first today (keep their slot), then rotate through all members including new
  const firstEntry = future[0];
  const firstIdx = state.members.findIndex(m => m.id === firstEntry.memberId);

  const rebuilt = [];
  for (let i = 0; i < future.length; i++) {
    const idx = ((firstIdx + i) % state.members.length + state.members.length) % state.members.length;
    rebuilt.push({ ...future[i], memberId: state.members[idx].id });
  }

  state.queue = [...past, ...rebuilt];
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

  // Remove their entries from queue and close the date gaps
  const tk = todayKey();
  const past = state.queue.filter(e => e.date < tk);
  let future = state.queue.filter(e => e.date >= tk && e.memberId !== id)
    .sort((a, b) => a.date.localeCompare(b.date));

  // Reassign dates so there are no gaps
  let datePtr = tk;
  future = future.map(e => { const entry = { ...e, date: datePtr }; datePtr = addDays(datePtr, 1); return entry; });

  state.queue = [...past, ...future];
  extendQueue();
  save();
  render();
}

// ── MARK DONE ────────────────────────────────────────────────────────────────
function markDone() {
  const k = todayKey();
  const assignee = getAssigneeForDate(k);
  if (!assignee) return;

  const me = state.members.find(m => m.name.toLowerCase() === myName.toLowerCase());
  if (!me) { showToast('Add yourself to the member list first'); return; }

  // Lock device to this member on first mark
  if (!me.deviceId) {
    me.deviceId = myDeviceId;
  } else if (me.deviceId !== myDeviceId) {
    showToast('This name is registered on another device! 🚫');
    return;
  }

  if (assignee.id !== me.id) {
    showToast("It's " + assignee.name + "'s turn today! 👀");
    return;
  }

  if (!state.completions) state.completions = {};
  state.completions[k] = { memberId: me.id, name: me.name, timestamp: Date.now() };

  // The queue already has tomorrow assigned correctly — just save and re-render
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
    ? `<div class="debt-badge">⚠ Makeup wash — skipped on ${fmtDate(entry.originalDate)}</div>` : '';

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
  if (n.getHours() === 0 && n.getMinutes() === 0) { extendQueue(); render(); }
}, 60000);
