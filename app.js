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
  if (!db) initFirebase(); else { autoAddSelf(); render(); }
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
      autoAddSelf();
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

// ── AUTO-ADD SELF ─────────────────────────────────────────────────────────────
// As soon as someone hits "Let's go", they're automatically added to the member list.
// Their device ID is locked to their member record immediately.
function autoAddSelf() {
  if (!myName || !myDeviceId) return;

  // Check if there's already a member with this device ID
  const byDevice = state.members.find(m => m.deviceId === myDeviceId);
  if (byDevice) {
    // If name changed on device, sync it everywhere
    if (byDevice.name !== myName) {
      renameMember(byDevice.id, byDevice.name, myName);
    }
    return;
  }

  // Check if there's a member with matching name but no device yet (added manually)
  const byName = state.members.find(m => m.name.toLowerCase() === myName.toLowerCase() && !m.deviceId);
  if (byName) {
    byName.deviceId = myDeviceId;
    save();
    return;
  }

  // Not in the list at all — add them
  const id = 'mbr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  state.members.push({ id, name: myName, deviceId: myDeviceId, addedAt: Date.now() });
  interleaveNewMember(id);
  save();
}

// ── NAME CHANGE ───────────────────────────────────────────────────────────────
function changeMyName() {
  const newName = prompt('Change your name to:', myName);
  if (!newName || !newName.trim()) return;
  const trimmed = newName.trim();
  if (trimmed.toLowerCase() === myName.toLowerCase()) return;

  // Check no one else has that name
  const conflict = state.members.find(m =>
    m.name.toLowerCase() === trimmed.toLowerCase() && m.deviceId !== myDeviceId
  );
  if (conflict) { showToast('That name is already taken'); return; }

  const oldName = myName;
  myName = trimmed;
  lockName(trimmed);
  document.getElementById('header-user').textContent = myName;

  // Find my member record and rename everywhere
  const me = state.members.find(m => m.deviceId === myDeviceId);
  if (me) renameMember(me.id, oldName, trimmed);
  else save();

  showToast('Name changed to ' + trimmed);
}

function renameMember(memberId, oldName, newName) {
  // Update member record
  const m = state.members.find(m => m.id === memberId);
  if (m) m.name = newName;

  // Update all completions that have this member's name
  Object.keys(state.completions || {}).forEach(k => {
    if (state.completions[k].memberId === memberId) {
      state.completions[k].name = newName;
    }
  });

  // Queue entries use memberId so they're fine — no changes needed there
  save();
  render();
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

  handleMissedTurns();

  const sorted = [...(state.queue || [])].sort((a, b) => a.date.localeCompare(b.date));
  let fillFrom, nextIdx;

  if (sorted.length) {
    const last = sorted[sorted.length - 1];
    fillFrom = addDays(last.date, 1);
    nextIdx = getNextMemberIndex(last.memberId);
  } else {
    fillFrom = tk;
    nextIdx = 0;
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
  const missed = (state.queue || []).filter(e =>
    e.date < tk && !e.isDebt && !(state.completions && state.completions[e.date])
  );
  if (missed.length === 0) return;

  state.queue = state.queue.filter(e =>
    !(e.date < tk && !e.isDebt && !(state.completions && state.completions[e.date]))
  );

  let future = state.queue.filter(e => e.date >= tk).sort((a, b) => a.date.localeCompare(b.date));
  missed.reverse().forEach(m => {
    future.unshift({ date: '__reassign__', memberId: m.memberId, isDebt: true, originalDate: m.date });
  });

  let datePtr = tk;
  const reassigned = future.map(entry => {
    const e = { ...entry, date: datePtr };
    datePtr = addDays(datePtr, 1);
    return e;
  });

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
  // No deviceId — they'll claim it when they open the app and set their name
  state.members.push({ id, name, deviceId: null, addedAt: Date.now() });
  interleaveNewMember(id);
  save();
  render();
  input.value = '';
  showToast(name + ' added — they need to open the app and enter this name');
}

function interleaveNewMember(newId) {
  const tk = todayKey();
  const future = state.queue.filter(e => e.date >= tk).sort((a, b) => a.date.localeCompare(b.date));
  const past = state.queue.filter(e => e.date < tk);
  if (future.length === 0) { extendQueue(); return; }

  const firstIdx = state.members.findIndex(m => m.id === future[0].memberId);
  const rebuilt = future.map((entry, i) => {
    const idx = ((firstIdx + i) % state.members.length + state.members.length) % state.members.length;
    return { ...entry, memberId: state.members[idx].id };
  });
  state.queue = [...past, ...rebuilt];
}

function removeMember(id) {
  const m = state.members.find(m => m.id === id);
  if (!m) return;
  if (!confirm('Remove ' + m.name + ' from the rotation?')) return;
  state.members = state.members.filter(m => m.id !== id);
  const tk = todayKey();
  const past = state.queue.filter(e => e.date < tk);
  let future = state.queue
    .filter(e => e.date >= tk && e.memberId !== id)
    .sort((a, b) => a.date.localeCompare(b.date));
  let datePtr = tk;
  future = future.map(e => { const r = { ...e, date: datePtr }; datePtr = addDays(datePtr, 1); return r; });
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

  const me = state.members.find(m => m.deviceId === myDeviceId);
  if (!me) { showToast('Your device is not registered yet'); return; }

  if (assignee.id !== me.id) {
    showToast("It's " + assignee.name + "'s turn today! 👀");
    return;
  }

  if (!state.completions) state.completions = {};
  state.completions[k] = { memberId: me.id, name: me.name, timestamp: Date.now() };
  save();
  render();
  showToast('Dishes marked done! ✓');
}

// ── EDIT COMPLETION ───────────────────────────────────────────────────────────
function undoCompletion(dateStr) {
  if (!state.completions || !state.completions[dateStr]) return;
  if (!confirm('Undo completion for ' + fmtDate(dateStr) + '?')) return;
  delete state.completions[dateStr];
  save();
  render();
  showToast('Completion removed');
}

function canUndoEntry(comp) {
  // Today's entry — either person can undo (admin-style for 2-person household)
  if (!comp) return false;
  const me = state.members.find(m => m.deviceId === myDeviceId);
  if (!me) return false;
  // Can undo if: it's your entry by memberId, OR by name match (covers old entries before device lock)
  return comp.memberId === me.id || comp.name.toLowerCase() === myName.toLowerCase();
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
    assignee ? assignee.name : (state.members && state.members.length ? '—' : 'Opening app adds you automatically');

  const debtBadge = (entry && entry.isDebt)
    ? `<div class="debt-badge">⚠ Makeup wash — skipped on ${fmtDate(entry.originalDate)}</div>` : '';

  if (comp) {
    action.innerHTML = `${debtBadge}
      <div class="done-status">
        <span class="done-check">✓</span>
        <div style="flex:1">
          <div class="done-text">Done by ${comp.name}</div>
          <div class="done-time">${fmtTime(comp.timestamp)}</div>
        </div>
        ${canUndoEntry(comp) ? `<button class="undo-btn" onclick="undoCompletion('${k}')">Undo</button>` : ''}
      </div>`;
  } else if (assignee) {
    const me = state.members.find(m => m.deviceId === myDeviceId);
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
    el.innerHTML = '<div class="empty-msg">Open the app on each device to join the rotation</div>';
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
    el.innerHTML = '<div class="empty-msg">No members yet — open the app to join</div>';
    return;
  }
  const counts = {};
  const debts = {};
  if (state.completions) Object.values(state.completions).forEach(c => { counts[c.memberId] = (counts[c.memberId] || 0) + 1; });
  (state.queue || []).filter(e => e.isDebt).forEach(e => { debts[e.memberId] = (debts[e.memberId] || 0) + 1; });

  el.innerHTML = state.members.map((m, i) => {
    const isYou = m.deviceId === myDeviceId;
    const debt = debts[m.id] || 0;
    const registered = !!m.deviceId;
    return `<div class="member-row">
      <div class="member-avatar av-${i % 6}">${m.name[0].toUpperCase()}</div>
      <div class="member-name">${m.name}${!registered ? ' <span class="unregistered">not joined yet</span>' : ''}</div>
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
  el.innerHTML = sorted.map(([k, c]) => {
    const canUndo = canUndoEntry(c);
    return `<div class="history-row">
      <div class="history-date">${fmtDate(k)}</div>
      <div class="history-who">${c.name}</div>
      <div class="history-time">${fmtTime(c.timestamp)}</div>
      ${canUndo
        ? `<button class="undo-btn-sm" onclick="undoCompletion('${k}')">Undo</button>`
        : '<div class="history-tick">✓</div>'
      }
    </div>`;
  }).join('');
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
