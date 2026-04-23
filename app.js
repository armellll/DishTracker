// ── STATE ─────────────────────────────────────────────────────────────────────
let db = null;
let appRef = null;
let myDeviceId = null;
let myRole = null; // 'admin' | 'member' | null
let myName = null;
let state = { members: [], completions: {}, schedule: {}, adminHash: null, adminName: null };

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ── HASH ──────────────────────────────────────────────────────────────────────
function hashPassword(pw) {
  let h = 0;
  for (let i = 0; i < pw.length; i++) h = (Math.imul(31, h) + pw.charCodeAt(i)) | 0;
  return 'dh_' + Math.abs(h).toString(36) + '_' + pw.length;
}

// ── DEVICE ID ─────────────────────────────────────────────────────────────────
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
  const savedRole = localStorage.getItem('dishduty_role');
  const savedName = localStorage.getItem('dishduty_name');

  if (savedRole === 'admin') {
    myRole = 'admin'; myName = savedName;
    initFirebase('admin');
  } else if (savedRole === 'member' && savedName) {
    myRole = 'member'; myName = savedName;
    initFirebase('member');
  } else {
    showScreen('landing-screen');
    checkAdminExists();
  }

  document.getElementById('join-name').addEventListener('keydown', e => { if (e.key === 'Enter') joinAsMember(); });
  document.getElementById('admin-password-input').addEventListener('keydown', e => { if (e.key === 'Enter') adminLogin(); });
  document.getElementById('admin-new-password').addEventListener('keydown', e => { if (e.key === 'Enter') createAdmin(); });
  document.getElementById('admin-add-name').addEventListener('keydown', e => { if (e.key === 'Enter') adminAddMember(); });
});

function checkAdminExists() {
  try {
    if (firebaseConfig.apiKey === 'PASTE_YOUR_API_KEY_HERE') return;
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    firebase.database().ref('dishduty/adminHash').once('value').then(snap => {
      const btn = document.getElementById('admin-setup-btn');
      if (btn) btn.style.display = snap.val() ? 'none' : 'block';
    });
  } catch(e) {}
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ── AUTH ──────────────────────────────────────────────────────────────────────
function joinAsMember() {
  const name = document.getElementById('join-name').value.trim();
  if (!name) { showToast('Enter your name first'); return; }
  myName = name; myRole = 'member';
  localStorage.setItem('dishduty_role', 'member');
  localStorage.setItem('dishduty_name', name);
  initFirebase('member');
}

function adminLogin() {
  const pw = document.getElementById('admin-password-input').value;
  if (!pw) return;
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    if (!db) { db = firebase.database(); appRef = db.ref('dishduty'); }
  } catch(e) { showToast('Firebase error'); return; }

  appRef.once('value').then(snap => {
    const data = snap.val();
    const adminHash = data && data.adminHash;
    if (!adminHash) { showScreen('admin-setup-screen'); return; }
    if (hashPassword(pw) !== adminHash) {
      document.getElementById('admin-login-error').style.display = 'block'; return;
    }
    document.getElementById('admin-login-error').style.display = 'none';
    myRole = 'admin'; myName = data.adminName || 'Admin';
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
  if (!name) { errEl.textContent = 'Enter your name'; errEl.style.display = 'block'; return; }
  if (!pw1)  { errEl.textContent = 'Enter a password'; errEl.style.display = 'block'; return; }
  if (pw1 !== pw2) { errEl.textContent = 'Passwords do not match'; errEl.style.display = 'block'; return; }
  if (pw1.length < 4) { errEl.textContent = 'Password must be at least 4 characters'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';

  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    if (!db) { db = firebase.database(); appRef = db.ref('dishduty'); }
  } catch(e) { showToast('Firebase error'); return; }

  appRef.once('value').then(snap => {
    const data = snap.val();
    if (data && data.adminHash) {
      errEl.textContent = 'An admin account already exists.';
      errEl.style.display = 'block'; return;
    }
    myRole = 'admin'; myName = name;
    localStorage.setItem('dishduty_role', 'admin');
    localStorage.setItem('dishduty_name', name);
    appRef.update({ adminHash: hashPassword(pw1), adminName: name }).then(() => startListening('admin'));
  });
}

function adminLogout() {
  localStorage.removeItem('dishduty_role');
  localStorage.removeItem('dishduty_name');
  myRole = null; myName = null;
  if (appRef) appRef.off();
  db = null; appRef = null;
  showScreen('landing-screen');
  checkAdminExists();
}

function saveNewPassword() {
  const pw1 = document.getElementById('new-pw-1').value;
  const pw2 = document.getElementById('new-pw-2').value;
  const errEl = document.getElementById('pw-change-error');
  if (!pw1) { errEl.textContent = 'Enter a new password'; errEl.style.display = 'block'; return; }
  if (pw1 !== pw2) { errEl.textContent = 'Passwords do not match'; errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';
  appRef.update({ adminHash: hashPassword(pw1) }).then(() => { closeModal(); showToast('Password changed!'); });
}

// ── FIREBASE ──────────────────────────────────────────────────────────────────
function initFirebase(role) {
  try {
    if (firebaseConfig.apiKey === 'PASTE_YOUR_API_KEY_HERE') {
      showToast('Add your Firebase config first'); showScreen('landing-screen'); return;
    }
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    appRef = db.ref('dishduty');
    if (role === 'admin') {
      appRef.once('value').then(snap => {
        const data = snap.val();
        if (!data || !data.adminHash) { showScreen('admin-setup-screen'); return; }
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
      if (!state.schedule) state.schedule = {};
    }
    if (role === 'member') registerMember();
    ensureScheduleStart();
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
  }, err => { console.error(err); setSyncState('err', 'error'); });

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
function registerMember() {
  if (!myName || !myDeviceId) return;
  const byDevice = state.members.find(m => m.deviceId === myDeviceId);
  if (byDevice) {
    if (byDevice.name !== myName) {
      byDevice.name = myName;
      Object.keys(state.completions || {}).forEach(k => {
        if (state.completions[k].memberId === byDevice.id) state.completions[k].name = myName;
      });
      save();
    }
    return;
  }
  const byName = state.members.find(m => m.name.toLowerCase() === myName.toLowerCase() && !m.deviceId);
  if (byName) { byName.deviceId = myDeviceId; save(); return; }
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

// ── SCHEDULE ENGINE ───────────────────────────────────────────────────────────
//
// The schedule is a flat object { "2026-04-23": "memberId", ... } stored in Firebase.
// Admin sets the base rotation order. We never auto-mutate past dates.
//
// getAssigneeForDate(dateStr):
//   1. If that date has a manually set assignment → use it.
//   2. Otherwise compute it by walking forward from the start of the schedule,
//      but: if a day has no completion AND is not today, the same person repeats
//      until they eventually wash. This means a person who misses days keeps
//      getting assigned until they (or the admin) marks it done.

function getRotationMembers() {
  return state.members.filter(m => m.inRotation);
}

// Returns the assigned memberId for a given date.
// Core rule: a person stays "on duty" until they complete their turn.
// Only then does the rotation advance to the next person.
function getAssigneeForDate(targetDate) {
  const rotation = getRotationMembers();
  if (rotation.length === 0) return null;

  // If admin has manually overridden this specific date, use that
  if (state.schedule && state.schedule[targetDate]) {
    return state.members.find(m => m.id === state.schedule[targetDate]) || null;
  }

  // Find the schedule start date and initial member
  const startDate = state.scheduleStart;
  const startMemberId = state.scheduleStartMember;
  if (!startDate || !startMemberId) return null;

  if (targetDate < startDate) return null;

  // Walk from startDate to targetDate
  // Advance rotation index only when a day was completed
  let currentIdx = rotation.findIndex(m => m.id === startMemberId);
  if (currentIdx === -1) currentIdx = 0;

  let d = startDate;
  while (d < targetDate) {
    // Check if there's a manual override for this date
    const overrideMember = state.schedule && state.schedule[d]
      ? state.members.find(m => m.id === state.schedule[d])
      : null;
    const effectiveMemberId = overrideMember ? overrideMember.id : rotation[currentIdx]?.id;

    if (state.completions && state.completions[d]) {
      // Day was completed — advance to next person
      const completedById = state.completions[d].memberId;
      const completedIdx = rotation.findIndex(m => m.id === completedById);
      currentIdx = completedIdx === -1
        ? (currentIdx + 1) % rotation.length
        : (completedIdx + 1) % rotation.length;
    }
    // If not completed: same person stays on duty — do NOT advance
    d = addDays(d, 1);
  }

  // Check for manual override on targetDate itself
  if (state.schedule && state.schedule[targetDate]) {
    return state.members.find(m => m.id === state.schedule[targetDate]) || null;
  }

  return rotation[currentIdx] || null;
}

// Build schedule start if not set yet.
// Also handles migration from old queue-based data.
function ensureScheduleStart() {
  const rotation = getRotationMembers();
  if (rotation.length === 0) return;
  if (state.scheduleStart && state.scheduleStartMember) {
    // Validate that scheduleStartMember is still in rotation
    const still = rotation.find(m => m.id === state.scheduleStartMember);
    if (still) return; // all good
    // Member was removed — reset to first in rotation
    state.scheduleStartMember = rotation[0].id;
    save();
    return;
  }

  // Not set yet — figure out the best start point

  // If there are existing completions, start from the earliest completion date
  // so history is preserved correctly
  const completionDates = Object.keys(state.completions || {}).sort();
  if (completionDates.length > 0) {
    const earliest = completionDates[0];
    const firstComp = state.completions[earliest];
    // Find who was completed first and who should have been before them
    const completedMemberIdx = rotation.findIndex(m => m.id === firstComp.memberId);
    // The start member is whoever was first in rotation on that date
    // Best guess: use the completed member as start (they may have been first)
    state.scheduleStart = earliest;
    state.scheduleStartMember = rotation[completedMemberIdx === -1 ? 0 : completedMemberIdx].id;
  } else {
    // No history — start today with first rotation member
    state.scheduleStart = todayKey();
    state.scheduleStartMember = rotation[0].id;
  }

  // Clean up old queue data if present
  if (state.queue) delete state.queue;

  save();
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
  ensureScheduleStart();
  save();
  renderAdmin();
  showToast(m.name + (m.inRotation ? ' added to rotation' : ' removed from rotation'));
}

function adminRemoveMember(memberId) {
  const m = state.members.find(m => m.id === memberId);
  if (!m) return;
  if (!confirm('Remove ' + m.name + '?')) return;
  state.members = state.members.filter(x => x.id !== memberId);
  // Remove manual overrides for this member
  if (state.schedule) {
    Object.keys(state.schedule).forEach(k => {
      if (state.schedule[k] === memberId) delete state.schedule[k];
    });
  }
  save();
  renderAdmin();
}

// ── ADMIN: REASSIGN A SPECIFIC DATE ──────────────────────────────────────────
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
  if (!state.schedule) state.schedule = {};
  state.schedule[reassignDateTarget] = memberId;
  save();
  closeModal();
  renderAdmin();
  showToast('Turn reassigned');
}

// ── ADMIN: MARK DONE ON BEHALF (today) ───────────────────────────────────────
function adminMarkTodayDone(memberId) {
  const member = state.members.find(m => m.id === memberId);
  if (!member) return;
  if (!confirm('Mark today as done on behalf of ' + member.name + '?')) return;
  const k = todayKey();
  if (!state.completions) state.completions = {};
  state.completions[k] = { memberId: member.id, name: member.name, timestamp: Date.now(), markedByAdmin: true };
  save();
  renderAdmin();
  showToast('Marked done on behalf of ' + member.name + ' ✓');
}

// ── ADMIN: MARK PAST MISSED DAY AS DONE ──────────────────────────────────────
function adminMarkDone(dateStr, memberId, event) {
  if (event) event.stopPropagation();
  const member = state.members.find(m => m.id === memberId);
  if (!member) return;
  if (!confirm('Mark ' + fmtDate(dateStr) + ' as done by ' + member.name + '?')) return;
  if (!state.completions) state.completions = {};
  state.completions[dateStr] = {
    memberId: member.id,
    name: member.name,
    timestamp: new Date(dateStr + 'T12:00:00').getTime(),
    markedByAdmin: true
  };
  save();
  renderAdmin();
  showToast(fmtDate(dateStr) + ' marked as done ✓');
}

// ── ADMIN: UNDO COMPLETION ────────────────────────────────────────────────────
function undoCompletion(dateStr) {
  if (!confirm('Remove completion for ' + fmtDate(dateStr) + '?')) return;
  delete state.completions[dateStr];
  save();
  if (myRole === 'admin') renderAdmin(); else renderMember();
  showToast('Completion removed');
}

// ── MEMBER: MARK DONE ─────────────────────────────────────────────────────────
function markDone() {
  const k = todayKey();
  const assignee = getAssigneeForDate(k);
  if (!assignee) { showToast('No schedule set — ask the admin'); return; }

  const me = state.members.find(m => m.deviceId === myDeviceId);
  if (!me) { showToast('Your device is not registered'); return; }
  if (assignee.id !== me.id) { showToast("It's " + assignee.name + "'s turn! 👀"); return; }
  if (state.completions && state.completions[k]) { showToast('Already marked done'); return; }

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
  const me = state.members.find(m => m.deviceId === myDeviceId);

  document.getElementById('member-hero-date').textContent =
    new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  document.getElementById('member-hero-name').textContent = assignee ? assignee.name : '—';

  const action = document.getElementById('member-hero-action');

  if (comp) {
    action.innerHTML = `
      <div class="done-status">
        <span class="done-check">✓</span>
        <div><div class="done-text">Done by ${comp.name}</div><div class="done-time">${fmtTime(comp.timestamp)}</div></div>
      </div>`;
  } else if (!assignee) {
    action.innerHTML = '<div class="empty-msg">No schedule yet — ask the admin to set it up</div>';
  } else if (me && assignee.id === me.id) {
    action.innerHTML = `<button class="btn-done" onclick="markDone()">✓ I washed the dishes</button>`;
  } else {
    action.innerHTML = `<div class="btn-not-yours">Waiting for ${assignee.name}…</div>`;
  }

  document.getElementById('member-week-list').innerHTML = buildWeekHTML(false);

  const counts = countCompletions();
  document.getElementById('member-member-list').innerHTML =
    state.members.filter(m => m.inRotation).map((m, i) => {
      const isYou = m.deviceId === myDeviceId;
      return `<div class="member-row">
        <div class="member-avatar av-${i % 6}">${m.name[0].toUpperCase()}</div>
        <div class="member-name">${m.name}</div>
        <div class="member-count">${counts[m.id] || 0} done</div>
        ${isYou ? '<span class="member-you">you</span>' : ''}
      </div>`;
    }).join('') || '<div class="empty-msg">Waiting for admin to set up rotation</div>';

  document.getElementById('member-history-list').innerHTML = buildHistoryHTML(false);
}

// ── RENDER: ADMIN ─────────────────────────────────────────────────────────────
function renderAdmin() {
  ensureScheduleStart();
  const k = todayKey();
  const assignee = getAssigneeForDate(k);
  const comp = state.completions && state.completions[k];

  document.getElementById('admin-hero-date').textContent =
    new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  document.getElementById('admin-hero-name').textContent = assignee ? assignee.name : '—';

  const heroAction = document.getElementById('admin-hero-action');
  if (comp) {
    heroAction.innerHTML = `
      <div class="done-status">
        <span class="done-check">✓</span>
        <div style="flex:1"><div class="done-text">Done by ${comp.name}</div><div class="done-time">${fmtTime(comp.timestamp)}</div></div>
        <button class="undo-btn" onclick="undoCompletion('${k}')">Undo</button>
      </div>`;
  } else if (assignee) {
    heroAction.innerHTML = `
      <div class="behalf-wrap">
        <div class="btn-not-yours">Waiting for ${assignee.name}…</div>
        <button class="btn-behalf" onclick="adminMarkTodayDone('${assignee.id}')">
          ✓ Mark done on behalf of ${assignee.name}
        </button>
      </div>`;
  } else {
    heroAction.innerHTML = '<div class="empty-msg">Add members to rotation below</div>';
  }

  document.getElementById('admin-week-list').innerHTML = buildWeekHTML(true);

  const counts = countCompletions();
  document.getElementById('admin-member-list').innerHTML = state.members.length
    ? state.members.map((m, i) => {
        const inRotation = !!m.inRotation;
        const registered = !!m.deviceId;
        return `<div class="member-row">
          <div class="member-avatar av-${i % 6}">${m.name[0].toUpperCase()}</div>
          <div class="member-name">
            ${m.name}
            ${!registered ? '<span class="unregistered">not joined</span>' : ''}
          </div>
          <div class="member-stats"><span class="member-count">${counts[m.id] || 0} done</span></div>
          <button class="toggle-btn ${inRotation ? 'in' : 'out'}" onclick="adminToggleRotation('${m.id}')">
            ${inRotation ? 'In rotation' : 'Add to rotation'}
          </button>
          <button class="remove-btn" onclick="adminRemoveMember('${m.id}')">✕</button>
        </div>`;
      }).join('')
    : '<div class="empty-msg">No members yet</div>';

  document.getElementById('admin-history-list').innerHTML = buildHistoryHTML(true);
}

// ── SHARED RENDER HELPERS ─────────────────────────────────────────────────────
function buildWeekHTML(isAdmin) {
  const rotation = getRotationMembers();
  const base = new Date();
  const tk = todayKey();
  let html = '';
  const pastDays = isAdmin ? -7 : -2;
  let hasAnyRow = false;

  for (let i = pastDays; i <= 9; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const k = dateKey(d);
    const assignee = getAssigneeForDate(k);
    const comp = state.completions && state.completions[k];
    const done = !!comp;
    const isToday = k === tk;
    const isPast = k < tk;
    const isMissed = isPast && !done && !!assignee;

    // For past days with no assignee but with a completion, still show it
    const displayName = assignee ? assignee.name : (comp ? comp.name : (rotation.length ? '—' : ''));
    if (!displayName && !done) continue; // skip empty future rows if no rotation yet

    hasAnyRow = true;

    let badge = '';
    if (done) badge = '<span class="week-badge badge-done">Done ✓</span>';
    else if (isToday) badge = '<span class="week-badge badge-today">Today</span>';
    else if (isMissed) badge = '<span class="week-badge badge-miss">Missed</span>';

    let actions = '';
    if (isAdmin) {
      if (done) {
        // Undo button for any completed day in the schedule view
        actions = `<button class="undo-btn-sm" onclick="undoCompletion('${k}')">Undo</button>`;
      } else if (isMissed && assignee) {
        actions = `<button class="mark-done-sm" onclick="adminMarkDone('${k}','${assignee.id}',event)">Mark done</button>`;
      } else if (assignee) {
        actions = `<button class="edit-hint-btn" onclick="openReassign('${k}')">edit</button>`;
      }
    }

    html += `<div class="week-row${isToday ? ' is-today' : ''}${isMissed && isAdmin ? ' missed-row' : ''}">
      <div class="week-day${isToday ? ' today' : ''}${isMissed ? ' missed' : ''}">${isToday ? 'TODAY' : DAYS[d.getDay()].toUpperCase()}</div>
      <div class="week-person">${displayName}</div>
      ${badge}
      ${actions}
    </div>`;
  }

  if (!hasAnyRow) {
    return rotation.length
      ? '<div class="empty-msg">No activity yet — rotation starts today</div>'
      : '<div class="empty-msg">No rotation set up yet</div>';
  }
  return html;
}

function buildHistoryHTML(isAdmin) {
  if (!state.completions || !Object.keys(state.completions).length)
    return '<div class="empty-msg">No completions yet</div>';
  const me = state.members.find(m => m.deviceId === myDeviceId);
  const sorted = Object.entries(state.completions)
    .filter(([k, c]) => c && c.name) // skip malformed entries
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 30);
  if (!sorted.length) return '<div class="empty-msg">No completions yet</div>';
  return sorted.map(([k, c]) => {
    const canUndo = isAdmin || (me && (c.memberId === me.id || (c.name || '').toLowerCase() === (myName || '').toLowerCase()));
    return `<div class="history-row">
      <div class="history-date">${fmtDate(k)}</div>
      <div class="history-who">${c.name || '?'}</div>
      <div class="history-time">${fmtTime(c.timestamp)}</div>
      ${canUndo
        ? `<button class="undo-btn-sm" onclick="undoCompletion('${k}')">Undo</button>`
        : '<div class="history-tick">✓</div>'}
    </div>`;
  }).join('');
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

// ── SYNC ──────────────────────────────────────────────────────────────────────
function setSyncState(status, label) {
  ['sync-dot','admin-sync-dot'].forEach(id => { const el = document.getElementById(id); if (el) el.className = 'sync-dot ' + status; });
  ['sync-text','admin-sync-text'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = label; });
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

setInterval(() => {
  const n = new Date();
  if (n.getHours() === 0 && n.getMinutes() === 0) {
    if (myRole === 'admin') renderAdmin();
    else if (myRole === 'member') renderMember();
  }
}, 60000);
