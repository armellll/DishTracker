// ── STATE ─────────────────────────────────────────────────────────────────────
let db = null;
let appRef = null;
let myDeviceId = null;
let myRole = null; // 'admin' | 'member' | null
let myName = null;
let state = { members: [], completions: {}, queue: [], adminHash: null };

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ── SIMPLE HASH (not cryptographic, just obfuscation for casual use) ──────────
function hashPassword(pw) {
  let h = 0;
  for (let i = 0; i < pw.length; i++) h = (Math.imul(31, h) + pw.charCodeAt(i)) | 0;
  return 'dh_' + Math.abs(h).toString(36) + '_' + pw.length;
}

// ── DEVICE IDENTITY ───────────────────────────────────────────────────────────
function getOrCreateDeviceId() {
  let id = localStorage.getItem('dishduty_device_id');
  if (!id) {
    id = 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10);
    localStorage.setItem('dishduty_device_id', id);
  }
  return id;
}

// ── INIT ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  myDeviceId = getOrCreateDeviceId();

  // Check saved session
  const savedRole = localStorage.getItem('dishduty_role');
  const savedName = localStorage.getItem('dishduty_name');

  if (savedRole === 'admin') {
    myRole = 'admin';
    myName = savedName;
    initFirebase('admin');
  } else if (savedRole === 'member' && savedName) {
    myRole = 'member';
    myName = savedName;
    initFirebase('member');
  } else {
    showScreen('landing-screen');
    // Check if admin already exists — if so hide the "Set up admin" button
    checkAdminExists();
  }

  // Enter key support
  document.getElementById('join-name').addEventListener('keydown', e => { if (e.key === 'Enter') joinAsMember(); });
  document.getElementById('admin-password-input').addEventListener('keydown', e => { if (e.key === 'Enter') adminLogin(); });
  document.getElementById('admin-new-password').addEventListener('keydown', e => { if (e.key === 'Enter') createAdmin(); });
  document.getElementById('admin-add-name').addEventListener('keydown', e => { if (e.key === 'Enter') adminAddMember(); });
});

// ── CHECK ADMIN EXISTS ───────────────────────────────────────────────────────
function checkAdminExists() {
  try {
    if (firebaseConfig.apiKey === 'PASTE_YOUR_API_KEY_HERE') return;
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    const tempDb = firebase.database();
    tempDb.ref('dishduty/adminHash').once('value').then(snap => {
      const setupBtn = document.getElementById('admin-setup-btn');
      if (setupBtn) setupBtn.style.display = snap.val() ? 'none' : 'block';
    });
  } catch(e) {}
}

// ── SCREEN NAVIGATION ─────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── JOIN AS MEMBER ────────────────────────────────────────────────────────────
function joinAsMember() {
  const name = document.getElementById('join-name').value.trim();
  if (!name) { showToast('Enter your name first'); return; }

  myName = name;
  myRole = 'member';
  localStorage.setItem('dishduty_role', 'member');
  localStorage.setItem('dishduty_name', name);
  initFirebase('member');
}

// ── ADMIN AUTH ────────────────────────────────────────────────────────────────
function adminLogin() {
  const pw = document.getElementById('admin-password-input').value;
  if (!pw) return;

  // Need to load state first to check hash
  if (!db) {
    // Init firebase just to read, then verify
    try {
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      db = firebase.database();
      appRef = db.ref('dishduty');
    } catch(e) { showToast('Firebase error'); return; }
  }

  appRef.once('value').then(snap => {
    const data = snap.val();
    const adminHash = data && data.adminHash;

    if (!adminHash) {
      // No admin yet — allow first-time setup
      showScreen('admin-setup-screen');
      return;
    }
    if (hashPassword(pw) !== adminHash) {
      document.getElementById('admin-login-error').style.display = 'block';
      return;
    }
    document.getElementById('admin-login-error').style.display = 'none';
    myRole = 'admin';
    myName = data.adminName || 'Admin';
    localStorage.setItem('dishduty_role', 'admin');
    localStorage.setItem('dishduty_name', myName);
    startListening('admin');
  });
}

function createAdmin() {
  const name = document.getElementById('admin-name-input').value.trim();
  const pw1 = document.getElementById('admin-new-password').value;
  const pw2 = document.getElementById('admin-confirm-password').value;
  const errEl = document.getElementById('admin-setup-error');

  // Check Firebase first — block if admin already exists
  if (appRef) {
    appRef.once('value').then(snap => {
      const data = snap.val();
      if (data && data.adminHash) {
        errEl.textContent = 'An admin account already exists. Contact the admin.';
        errEl.style.display = 'block';
        return;
      }
      _doCreateAdmin(name, pw1, pw2, errEl);
    });
    return;
  }
  _doCreateAdmin(name, pw1, pw2, errEl);
}

function _doCreateAdmin(name, pw1, pw2, errEl) {

  if (!name) { errEl.textContent = 'Enter your name'; errEl.style.display = 'block'; return; }
  if (!pw1) { errEl.textContent = 'Enter a password'; errEl.style.display = 'block'; return; }
  if (pw1 !== pw2) { errEl.textContent = 'Passwords do not match'; errEl.style.display = 'block'; return; }
  if (pw1.length < 4) { errEl.textContent = 'Password must be at least 4 characters'; errEl.style.display = 'block'; return; }

  errEl.style.display = 'none';

  if (!db) {
    try {
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      db = firebase.database();
      appRef = db.ref('dishduty');
    } catch(e) { showToast('Firebase error'); return; }
  }

  myRole = 'admin';
  myName = name;
  localStorage.setItem('dishduty_role', 'admin');
  localStorage.setItem('dishduty_name', name);

  // Save admin credentials to Firebase
  appRef.update({ adminHash: hashPassword(pw1), adminName: name }).then(() => {
    startListening('admin');
  });
}

function adminLogout() {
  localStorage.removeItem('dishduty_role');
  localStorage.removeItem('dishduty_name');
  myRole = null;
  myName = null;
  if (appRef) appRef.off();
  db = null;
  appRef = null;
  showScreen('landing-screen');
}

function saveNewPassword() {
  const pw1 = document.getElementById('new-pw-1').value;
  const pw2 = document.getElementById('new-pw-2').value;
  const errEl = document.getElementById('pw-change-error');
  if (!pw1) { errEl.textContent = 'Enter a new password'; errEl.style.display = 'block'; return; }
  if (pw1 !== pw2) { errEl.textContent = 'Passwords do not match'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';
  appRef.update({ adminHash: hashPassword(pw1) }).then(() => {
    closeModal();
    showToast('Password changed!');
  });
}

// ── FIREBASE ──────────────────────────────────────────────────────────────────
function initFirebase(role) {
  try {
    if (firebaseConfig.apiKey === 'PASTE_YOUR_API_KEY_HERE') {
      showToast('Add your Firebase config first');
      showScreen('landing-screen');
      return;
    }
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    appRef = db.ref('dishduty');

    if (role === 'admin') {
      // For returning admin, verify password hash still exists
      appRef.once('value').then(snap => {
        const data = snap.val();
        if (!data || !data.adminHash) {
          showScreen('admin-setup-screen');
          return;
        }
        startListening('admin');
      });
    } else {
      startListening('member');
    }
  } catch(e) {
    console.error(e);
    showToast('Firebase error — check your config');
    showScreen('landing-screen');
  }
}

function startListening(role) {
  appRef.on('value', snap => {
    const data = snap.val();
    if (data) {
      state = data;
      if (!Array.isArray(state.members)) state.members = [];
      if (!state.completions) state.completions = {};
      if (!Array.isArray(state.queue)) state.queue = [];
    }

    if (role === 'member') {
      // Register member in the list on first load
      registerMember();
    }

    handleMissedTurns();
    extendQueue();
    setSyncState('live', 'live');

    if (role === 'admin') {
      document.getElementById('admin-screen').querySelector('header .header-user').textContent = myName;
      showScreen('admin-screen');
      renderAdmin();
    } else {
      document.getElementById('member-header-user').textContent = myName;
      showScreen('member-screen');
      renderMember();
    }
  }, err => {
    console.error(err);
    setSyncState('err', 'error');
  });

  db.ref('.info/connected').on('value', snap => {
    setSyncState(snap.val() ? 'live' : 'err', snap.val() ? 'live' : 'offline');
  });
}

function save() {
  if (!appRef) return;
  setSyncState('saving', 'saving');
  appRef.set(state)
    .then(() => setSyncState('live', 'live'))
    .catch(e => { console.error(e); setSyncState('err', 'error'); });
}

// ── MEMBER REGISTRATION ───────────────────────────────────────────────────────
// Called when a member logs in. Adds them to the list if not already there.
// Does NOT auto-assign them to the schedule — admin does that.
function registerMember() {
  if (!myName || !myDeviceId) return;

  // Check if already registered by device
  const byDevice = state.members.find(m => m.deviceId === myDeviceId);
  if (byDevice) {
    // Name changed on device — sync it
    if (byDevice.name !== myName) {
      const old = byDevice.name;
      byDevice.name = myName;
      Object.keys(state.completions || {}).forEach(k => {
        if (state.completions[k].memberId === byDevice.id) state.completions[k].name = myName;
      });
      save();
    }
    return;
  }

  // Check by name (admin may have pre-added them)
  const byName = state.members.find(m => m.name.toLowerCase() === myName.toLowerCase() && !m.deviceId);
  if (byName) {
    byName.deviceId = myDeviceId;
    save();
    return;
  }

  // New person — add to members list but NOT to queue (admin assigns turns)
  const id = 'mbr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  state.members.push({ id, name: myName, deviceId: myDeviceId, addedAt: Date.now(), inRotation: false });
  save();
}

// ── DATE HELPERS ──────────────────────────────────────────────────────────────
function dateKey(d) { return d.toISOString().slice(0, 10); }
function todayKey() { return dateKey(new Date()); }
function fmtDate(k) { return new Date(k + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' }); }
function fmtTime(ts) { if (!ts) return ''; return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return dateKey(d);
}

// ── QUEUE ─────────────────────────────────────────────────────────────────────
// Queue only contains members that admin has added to rotation (inRotation: true)
function getRotationMembers() {
  return state.members.filter(m => m.inRotation);
}

function extendQueue() {
  const rotation = getRotationMembers();
  if (rotation.length === 0) return;

  const tk = todayKey();
  const targetEnd = addDays(tk, 30);

  const sorted = [...(state.queue || [])].sort((a, b) => a.date.localeCompare(b.date));
  let fillFrom, nextIdx;

  if (sorted.length) {
    const last = sorted[sorted.length - 1];
    fillFrom = addDays(last.date, 1);
    const lastIdx = rotation.findIndex(m => m.id === last.memberId);
    nextIdx = lastIdx === -1 ? 0 : (lastIdx + 1) % rotation.length;
  } else {
    fillFrom = tk;
    nextIdx = 0;
  }

  let changed = false;
  while (fillFrom <= targetEnd) {
    if (!state.queue.find(e => e.date === fillFrom)) {
      state.queue.push({ date: fillFrom, memberId: rotation[nextIdx].id, isDebt: false });
      nextIdx = (nextIdx + 1) % rotation.length;
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

  state.queue = [...state.queue.filter(e => e.date < tk), ...reassigned];
  save();
}

function getQueueEntry(dateStr) { return (state.queue || []).find(e => e.date === dateStr) || null; }
function getAssigneeForDate(dateStr) {
  const entry = getQueueEntry(dateStr);
  if (!entry) return null;
  return state.members.find(m => m.id === entry.memberId) || null;
}

// ── ADMIN: MEMBER MANAGEMENT ──────────────────────────────────────────────────
function adminAddMember() {
  const input = document.getElementById('admin-add-name');
  const name = input.value.trim();
  if (!name) return;
  if (state.members.find(m => m.name.toLowerCase() === name.toLowerCase())) {
    showToast('Already exists'); return;
  }
  const id = 'mbr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  state.members.push({ id, name, deviceId: null, addedAt: Date.now(), inRotation: false });
  save();
  input.value = '';
  showToast(name + ' added');
}

function adminToggleRotation(memberId) {
  const m = state.members.find(m => m.id === memberId);
  if (!m) return;
  m.inRotation = !m.inRotation;

  if (!m.inRotation) {
    // Remove from future queue
    const tk = todayKey();
    state.queue = state.queue.filter(e => !(e.date >= tk && e.memberId === memberId));
  }

  extendQueue();
  save();
  renderAdmin();
  showToast(m.name + (m.inRotation ? ' added to rotation' : ' removed from rotation'));
}

function adminRemoveMember(memberId) {
  const m = state.members.find(m => m.id === memberId);
  if (!m) return;
  if (!confirm('Remove ' + m.name + '?')) return;
  state.members = state.members.filter(m => m.id !== memberId);
  const tk = todayKey();
  state.queue = state.queue.filter(e => !(e.date >= tk && e.memberId === memberId));
  extendQueue();
  save();
  renderAdmin();
}

// ── ADMIN: REASSIGN TURN ──────────────────────────────────────────────────────
let reassignDateTarget = null;

function openReassign(dateStr) {
  reassignDateTarget = dateStr;
  document.getElementById('reassign-date-label').textContent = 'Reassign ' + fmtDate(dateStr);
  const rotation = getRotationMembers();
  document.getElementById('reassign-options').innerHTML = rotation.map(m => `
    <button class="reassign-option" onclick="doReassign('${m.id}')">${m.name}</button>
  `).join('');
  document.getElementById('reassign-modal').style.display = 'flex';
}

function doReassign(memberId) {
  if (!reassignDateTarget) return;
  const entry = getQueueEntry(reassignDateTarget);
  if (entry) {
    entry.memberId = memberId;
  } else {
    state.queue.push({ date: reassignDateTarget, memberId, isDebt: false });
  }

  // Rebalance the queue from this date forward so it stays alternating.
  // Rule: after the reassigned date, the next person must be different from
  // the reassigned person, continuing the round-robin from there.
  rebalanceQueueFrom(reassignDateTarget);

  save();
  closeModal();
  renderAdmin();
  showToast('Turn reassigned');
}

// Rebalance all future queue entries starting the day AFTER dateStr
// so no one appears twice in a row and rotation stays fair.
function rebalanceQueueFrom(fromDate) {
  const rotation = getRotationMembers();
  if (rotation.length < 2) return;

  const tk = todayKey();
  // Sort all future undone entries after fromDate
  const pivot = getQueueEntry(fromDate);
  if (!pivot) return;

  const afterPivot = state.queue
    .filter(e => e.date > fromDate && !(state.completions && state.completions[e.date]))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (afterPivot.length === 0) return;

  // Find where the reassigned member sits in rotation
  let lastMemberId = pivot.memberId;
  let nextIdx = rotation.findIndex(m => m.id === lastMemberId);
  if (nextIdx === -1) nextIdx = 0;

  afterPivot.forEach(entry => {
    nextIdx = (nextIdx + 1) % rotation.length;
    entry.memberId = rotation[nextIdx].id;
    lastMemberId = entry.memberId;
  });
}

// ── ADMIN: UNDO COMPLETION ────────────────────────────────────────────────────
function undoCompletion(dateStr) {
  if (!confirm('Remove the completion for ' + fmtDate(dateStr) + '?')) return;
  delete state.completions[dateStr];
  save();
  renderAdmin();
  showToast('Completion removed');
}

// ── ADMIN: MARK PAST DAY AS DONE ─────────────────────────────────────────────
function adminMarkDone(dateStr, memberId, event) {
  if (event) event.stopPropagation();
  const member = state.members.find(m => m.id === memberId);
  if (!member) return;
  if (!confirm('Mark ' + fmtDate(dateStr) + ' as done by ' + member.name + '?')) return;

  if (!state.completions) state.completions = {};
  state.completions[dateStr] = {
    memberId: member.id,
    name: member.name,
    timestamp: new Date(dateStr + 'T12:00:00').getTime(), // Use noon of that day
    markedByAdmin: true
  };

  // Remove this day from debt queue if it was flagged as missed
  state.queue = state.queue.filter(e => !(e.isDebt && e.originalDate === dateStr));

  save();
  renderAdmin();
  showToast(fmtDate(dateStr) + ' marked as done ✓');
}

// ── MEMBER: MARK DONE ─────────────────────────────────────────────────────────
function markDone() {
  const k = todayKey();
  const assignee = getAssigneeForDate(k);
  if (!assignee) return;

  const me = state.members.find(m => m.deviceId === myDeviceId);
  if (!me) { showToast('Your device is not registered'); return; }

  if (assignee.id !== me.id) {
    showToast("It's " + assignee.name + "'s turn! 👀");
    return;
  }

  if (!state.completions) state.completions = {};
  state.completions[k] = { memberId: me.id, name: me.name, timestamp: Date.now() };
  save();
  renderMember();
  showToast('Dishes marked done! ✓');
}

// ── RENDER: MEMBER ────────────────────────────────────────────────────────────
function renderMember() {
  const k = todayKey();
  const assignee = getAssigneeForDate(k);
  const comp = state.completions && state.completions[k];
  const entry = getQueueEntry(k);
  const me = state.members.find(m => m.deviceId === myDeviceId);

  // Hero date
  document.getElementById('member-hero-date').textContent =
    new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  document.getElementById('member-hero-name').textContent = assignee ? assignee.name : '—';

  const debtBadge = entry && entry.isDebt
    ? `<div class="debt-badge">⚠ Makeup wash — skipped on ${fmtDate(entry.originalDate)}</div>` : '';

  const action = document.getElementById('member-hero-action');
  if (comp) {
    action.innerHTML = `${debtBadge}
      <div class="done-status">
        <span class="done-check">✓</span>
        <div><div class="done-text">Done by ${comp.name}</div><div class="done-time">${fmtTime(comp.timestamp)}</div></div>
      </div>`;
  } else if (assignee && me && assignee.id === me.id) {
    action.innerHTML = `${debtBadge}<button class="btn-done" onclick="markDone()">✓ I washed the dishes</button>`;
  } else if (assignee) {
    action.innerHTML = `${debtBadge}<div class="btn-not-yours">Waiting for ${assignee.name}…</div>`;
  } else {
    action.innerHTML = '<div class="empty-msg">No schedule yet — ask the admin to set it up</div>';
  }

  // Week
  const weekEl = document.getElementById('member-week-list');
  weekEl.innerHTML = buildWeekHTML(false);

  // Members
  const memberEl = document.getElementById('member-member-list');
  memberEl.innerHTML = state.members.filter(m => m.inRotation).map((m, i) => {
    const isYou = m.deviceId === myDeviceId;
    const counts = countCompletions();
    return `<div class="member-row">
      <div class="member-avatar av-${i % 6}">${m.name[0].toUpperCase()}</div>
      <div class="member-name">${m.name}</div>
      <div class="member-count">${counts[m.id] || 0} done</div>
      ${isYou ? '<span class="member-you">you</span>' : ''}
    </div>`;
  }).join('') || '<div class="empty-msg">Waiting for admin to set up rotation</div>';

  // History
  document.getElementById('member-history-list').innerHTML = buildHistoryHTML(false);
}

// ── RENDER: ADMIN ─────────────────────────────────────────────────────────────
function renderAdmin() {
  const k = todayKey();
  const assignee = getAssigneeForDate(k);
  const comp = state.completions && state.completions[k];
  const entry = getQueueEntry(k);

  document.getElementById('admin-hero-date').textContent =
    new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  document.getElementById('admin-hero-name').textContent = assignee ? assignee.name : '—';

  const debtBadge = entry && entry.isDebt
    ? `<div class="debt-badge">⚠ Makeup wash — skipped on ${fmtDate(entry.originalDate)}</div>` : '';

  const heroAction = document.getElementById('admin-hero-action');
  if (comp) {
    heroAction.innerHTML = `${debtBadge}
      <div class="done-status">
        <span class="done-check">✓</span>
        <div style="flex:1"><div class="done-text">Done by ${comp.name}</div><div class="done-time">${fmtTime(comp.timestamp)}</div></div>
        <button class="undo-btn" onclick="undoCompletion('${k}')">Undo</button>
      </div>`;
  } else if (assignee) {
    heroAction.innerHTML = `${debtBadge}<div class="btn-not-yours">Waiting for ${assignee.name}…</div>`;
  } else {
    heroAction.innerHTML = '<div class="empty-msg">Add members to rotation below</div>';
  }

  // Schedule
  document.getElementById('admin-week-list').innerHTML = buildWeekHTML(true);

  // Members
  const counts = countCompletions();
  const allMembers = state.members;
  document.getElementById('admin-member-list').innerHTML = allMembers.length
    ? allMembers.map((m, i) => {
        const inRotation = m.inRotation;
        const registered = !!m.deviceId;
        return `<div class="member-row">
          <div class="member-avatar av-${i % 6}">${m.name[0].toUpperCase()}</div>
          <div class="member-name">
            ${m.name}
            ${!registered ? '<span class="unregistered">not joined</span>' : ''}
          </div>
          <div class="member-stats">
            <span class="member-count">${counts[m.id] || 0} done</span>
          </div>
          <button class="toggle-btn ${inRotation ? 'in' : 'out'}" onclick="adminToggleRotation('${m.id}')">
            ${inRotation ? 'In rotation' : 'Add to rotation'}
          </button>
          <button class="remove-btn" onclick="adminRemoveMember('${m.id}')">✕</button>
        </div>`;
      }).join('')
    : '<div class="empty-msg">No members yet</div>';

  // History
  document.getElementById('admin-history-list').innerHTML = buildHistoryHTML(true);
}

// ── SHARED RENDER HELPERS ─────────────────────────────────────────────────────
function buildWeekHTML(isAdmin) {
  if (!getRotationMembers().length) return '<div class="empty-msg">No rotation set up yet</div>';
  const base = new Date();
  const tk = todayKey();
  let html = '';
  // Show 7 past days for admin (so they can mark missed ones), 2 for members
  const pastDays = isAdmin ? -7 : -2;
  for (let i = pastDays; i <= 9; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const k = dateKey(d);
    const assignee = getAssigneeForDate(k);
    const entry = getQueueEntry(k);
    const done = !!(state.completions && state.completions[k]);
    const isToday = k === tk;
    const isPast = k < tk;
    const isMissed = isPast && !done;

    let badge = '';
    if (done) badge = '<span class="week-badge badge-done">Done ✓</span>';
    else if (isToday) badge = '<span class="week-badge badge-today">Today</span>';
    else if (isMissed) badge = '<span class="week-badge badge-miss">Missed</span>';
    else if (entry && entry.isDebt) badge = '<span class="week-badge badge-debt">Makeup</span>';

    // Admin actions: missed days get a "Mark done" button, future/today gets reassign
    let actions = '';
    if (isAdmin) {
      if (isMissed && assignee) {
        // Mark done for a specific person on that missed day
        actions = `<button class="mark-done-sm" onclick="adminMarkDone('${k}','${assignee.id}',event)">Mark done</button>`;
      } else if (!done) {
        actions = `<button class="edit-hint-btn" onclick="openReassign('${k}')">edit</button>`;
      }
    }

    html += `<div class="week-row${isToday ? ' is-today' : ''}${isMissed && isAdmin ? ' missed-row' : ''}">
      <div class="week-day${isToday ? ' today' : ''}${isMissed ? ' missed' : ''}">${isToday ? 'TODAY' : DAYS[d.getDay()].toUpperCase()}</div>
      <div class="week-person">${assignee ? assignee.name : '—'}</div>
      ${badge}
      ${actions}
    </div>`;
  }
  return html;
}

function buildHistoryHTML(isAdmin) {
  if (!state.completions || !Object.keys(state.completions).length) {
    return '<div class="empty-msg">No completions yet</div>';
  }
  const sorted = Object.entries(state.completions).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 20);
  return sorted.map(([k, c]) => `
    <div class="history-row">
      <div class="history-date">${fmtDate(k)}</div>
      <div class="history-who">${c.name}</div>
      <div class="history-time">${fmtTime(c.timestamp)}</div>
      ${isAdmin
        ? `<button class="undo-btn-sm" onclick="undoCompletion('${k}')">Undo</button>`
        : '<div class="history-tick">✓</div>'}
    </div>`).join('');
}

function countCompletions() {
  const counts = {};
  Object.values(state.completions || {}).forEach(c => { counts[c.memberId] = (counts[c.memberId] || 0) + 1; });
  return counts;
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function closeModal() {
  document.getElementById('reassign-modal').style.display = 'none';
  document.getElementById('change-pw-modal').style.display = 'none';
  reassignDateTarget = null;
}

function openChangePassword() {
  document.getElementById('new-pw-1').value = '';
  document.getElementById('new-pw-2').value = '';
  document.getElementById('pw-change-error').style.display = 'none';
  document.getElementById('change-pw-modal').style.display = 'flex';
}

// ── SYNC STATE ────────────────────────────────────────────────────────────────
function setSyncState(status, label) {
  ['sync-dot', 'admin-sync-dot'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.className = 'sync-dot ' + status;
  });
  ['sync-text', 'admin-sync-text'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  });
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
  if (n.getHours() === 0 && n.getMinutes() === 0) {
    handleMissedTurns();
    extendQueue();
    if (myRole === 'admin') renderAdmin();
    else if (myRole === 'member') renderMember();
  }
}, 60000);
