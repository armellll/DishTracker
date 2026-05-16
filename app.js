// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const EMOJIS = ['🐱','🐶','🦊','🐼','🐨','🐸','🦁','🐯','🐻','🐺',
                '🦄','🐙','🦋','🐧','🦅','🌵','🍀','🌸','⭐','🔥'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ── STATE ─────────────────────────────────────────────────────────────────────
let db = null, appRef = null;
let myId = null, myName = null, myEmoji = '🐱';
let selectedEmoji = null;
let state = { members: {}, completions: {}, scheduleStart: null, scheduleOrder: [] };

// ── DEVICE ID ─────────────────────────────────────────────────────────────────
function getDeviceId() {
  let id = localStorage.getItem('dd_id');
  if (!id) { id = 'u_' + Date.now() + '_' + Math.random().toString(36).slice(2,8); localStorage.setItem('dd_id', id); }
  return id;
}

// ── INIT ──────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  myId = getDeviceId();
  myName = localStorage.getItem('dd_name');
  myEmoji = localStorage.getItem('dd_emoji') || '🐱';

  buildAvatarPicker('setup-avatar-row', (e) => { selectedEmoji = e; });

  document.getElementById('setup-name').addEventListener('keydown', ev => { if (ev.key === 'Enter') joinApp(); });

  initFirebase();
});

// ── FIREBASE ──────────────────────────────────────────────────────────────────
function initFirebase() {
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    appRef = db.ref('dishduty2');
    appRef.on('value', snap => {
      const data = snap.val();
      if (data) {
        state.members     = data.members     || {};
        state.completions = data.completions || {};
        state.scheduleStart  = data.scheduleStart  || null;
        state.scheduleOrder  = data.scheduleOrder  || [];
      }
      setSyncState('live', 'live');
      onStateLoaded();
    }, () => setSyncState('err', 'err'));
    db.ref('.info/connected').on('value', s => setSyncState(s.val() ? 'live' : 'err', s.val() ? 'live' : 'offline'));
  } catch(e) { console.error(e); setSyncState('err', 'err'); }
}

function save(updates) {
  if (!appRef) return;
  setSyncState('saving', 'saving');
  appRef.update(updates)
    .then(() => setSyncState('live', 'live'))
    .catch(e => { console.error(e); setSyncState('err', 'err'); });
}

// ── STATE LOADED ──────────────────────────────────────────────────────────────
function onStateLoaded() {
  // Show setup or main
  const isMember = myName && state.members[myId];
  if (isMember) {
    // Update my info if changed
    const me = state.members[myId];
    if (me.name !== myName || me.emoji !== myEmoji) {
      save({ [`members/${myId}/name`]: myName, [`members/${myId}/emoji`]: myEmoji });
    }
    showMain();
  } else {
    showSetup();
  }
}

// ── JOIN ──────────────────────────────────────────────────────────────────────
function joinApp() {
  const name = document.getElementById('setup-name').value.trim();
  if (!name) { showToast('Enter your name first'); return; }

  myName = name;
  myEmoji = selectedEmoji || myEmoji;
  localStorage.setItem('dd_name', myName);
  localStorage.setItem('dd_emoji', myEmoji);

  // Add to members
  const updates = {};
  updates[`members/${myId}`] = { id: myId, name: myName, emoji: myEmoji, joinedAt: Date.now() };

  // Add to schedule order if not already in it
  const order = [...(state.scheduleOrder || [])];
  if (!order.includes(myId)) {
    order.push(myId);
    updates['scheduleOrder'] = order;
  }

  // Set schedule start if this is the first member
  if (!state.scheduleStart) {
    updates['scheduleStart'] = todayKey();
  }

  save(updates);
  showToast('Welcome, ' + myName + '!');
}

// ── LEAVE ──────────────────────────────────────────────────────────────────────
function leaveDuty() {
  if (!confirm('Leave the dish rotation?')) return;
  const updates = {};
  updates[`members/${myId}`] = null;
  const order = (state.scheduleOrder || []).filter(id => id !== myId);
  updates['scheduleOrder'] = order;
  save(updates);
  localStorage.removeItem('dd_name');
  myName = null;
  closeProfileModal();
  showSetup();
  showToast('You left the rotation');
}

// ── SCREENS ───────────────────────────────────────────────────────────────────
function showSetup() {
  document.getElementById('setup-screen').classList.add('active');
  document.getElementById('main-screen').classList.remove('active');
  renderSetupAlreadyJoined();
}

function showMain() {
  document.getElementById('setup-screen').classList.remove('active');
  document.getElementById('main-screen').classList.add('active');
  renderMain();
}

// ── DATE HELPERS ──────────────────────────────────────────────────────────────
function dateKey(d) { return d.toISOString().slice(0, 10); }
function todayKey() { return dateKey(new Date()); }
function addDays(s, n) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return dateKey(d); }
function fmtDate(k) { return new Date(k + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' }); }
function fmtTime(ts) { if (!ts) return ''; return new Date(ts).toLocaleTimeString([], { hour:'numeric', minute:'2-digit' }); }

// ── SCHEDULE ENGINE ───────────────────────────────────────────────────────────
// Rules:
//  - rotation order = state.scheduleOrder (list of member IDs)
//  - start from scheduleStart with scheduleOrder[0]
//  - advance to next person ONLY when current person's day has a completion
//  - missed days: person stays on duty until they wash — no skipping ever
function getAssigneeForDate(targetDate) {
  const order = (state.scheduleOrder || []).filter(id => state.members[id]);
  if (!order.length || !state.scheduleStart) return null;
  if (targetDate < state.scheduleStart) return null;

  let idx = 0;
  let d = state.scheduleStart;

  while (d < targetDate) {
    if (state.completions && state.completions[d]) {
      // Completed — advance to next person
      idx = (idx + 1) % order.length;
    }
    // Not completed — same person stays, no advance
    d = addDays(d, 1);
  }

  return state.members[order[idx]] || null;
}

// ── MARK DONE ─────────────────────────────────────────────────────────────────
function markDone() {
  const k = todayKey();
  if (state.completions && state.completions[k]) { showToast('Already marked done'); return; }
  const assignee = getAssigneeForDate(k);
  if (!assignee) { showToast('No schedule yet'); return; }
  if (assignee.id !== myId) { showToast("It's " + assignee.name + "'s turn!"); return; }

  save({ [`completions/${k}`]: { memberId: myId, name: myName, emoji: myEmoji, timestamp: Date.now() } });
  showToast('Done! ✓');
}

function undoCompletion(dateKey) {
  if (!confirm('Remove this completion?')) return;
  save({ [`completions/${dateKey}`]: null });
  showToast('Removed');
}

// ── RENDER SETUP ──────────────────────────────────────────────────────────────
function renderSetupAlreadyJoined() {
  const members = Object.values(state.members || {});
  const el = document.getElementById('already-joined');
  const list = document.getElementById('already-list');
  if (!members.length) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  list.innerHTML = `<div class="already-chips">${members.map(m => `
    <div class="already-chip">
      <span class="already-chip-avatar">${m.emoji || '🐱'}</span>
      <span>${m.name}</span>
    </div>`).join('')}</div>`;
}

// ── RENDER MAIN ───────────────────────────────────────────────────────────────
function renderMain() {
  renderTopBar();
  renderHero();
  renderStats();
  renderSchedule();
  renderMembers();
  renderHistory();
}

function renderTopBar() {
  const me = state.members[myId];
  const btn = document.getElementById('my-profile-btn');
  if (btn) btn.textContent = me ? (me.emoji || '🐱') : '?';
}

function renderHero() {
  const k = todayKey();
  const assignee = getAssigneeForDate(k);
  const comp = state.completions && state.completions[k];
  const d = new Date();

  document.getElementById('today-dayname').textContent = DAYS[d.getDay()].toUpperCase();
  document.getElementById('today-fulldate').textContent = d.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });

  const avatarWrap = document.getElementById('today-avatar-wrap');
  const nameEl = document.getElementById('today-name');
  const actionEl = document.getElementById('today-action');

  if (assignee) {
    avatarWrap.textContent = assignee.emoji || '🐱';
    nameEl.textContent = assignee.name;
  } else {
    avatarWrap.textContent = '🍽';
    nameEl.textContent = 'No one yet';
  }

  if (comp) {
    const canUndo = comp.memberId === myId;
    actionEl.innerHTML = `
      <div class="done-strip">
        <span class="done-strip-check">✅</span>
        <div class="done-strip-text">
          <div class="done-strip-name">${comp.name} washed up</div>
          <div class="done-strip-time">${fmtTime(comp.timestamp)}</div>
        </div>
        ${canUndo ? `<button class="undo-btn" onclick="undoCompletion('${k}')">Undo</button>` : ''}
      </div>`;
  } else if (assignee && assignee.id === myId) {
    actionEl.innerHTML = `<button class="btn-done" onclick="markDone()">✓ I washed the dishes</button>`;
  } else if (assignee) {
    actionEl.innerHTML = `<div class="btn-not-mine">Waiting for ${assignee.name} to wash up…</div>`;
  } else {
    actionEl.innerHTML = `<div class="btn-not-mine">Join to start the rotation</div>`;
  }
}

function renderStats() {
  const el = document.getElementById('stats-row');
  const counts = {};
  Object.values(state.completions || {}).forEach(c => { counts[c.memberId] = (counts[c.memberId] || 0) + 1; });
  const myCount = counts[myId] || 0;
  const total = Object.keys(state.completions || {}).length;

  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-num">${myCount}</div>
      <div class="stat-label">My washes</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${total}</div>
      <div class="stat-label">Total done</div>
    </div>
    <div class="stat-card">
      <div class="stat-num">${Object.keys(state.members || {}).length}</div>
      <div class="stat-label">Members</div>
    </div>`;
}

function renderSchedule() {
  const el = document.getElementById('schedule-list');
  const order = (state.scheduleOrder || []).filter(id => state.members[id]);
  if (!order.length || !state.scheduleStart) {
    el.innerHTML = '<div class="empty-row">No rotation yet — be the first to join!</div>'; return;
  }

  const base = new Date();
  const tk = todayKey();
  let html = '';

  for (let i = -3; i <= 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const k = dateKey(d);
    if (k < state.scheduleStart && i < 0) continue;

    const assignee = getAssigneeForDate(k);
    if (!assignee && k > tk) continue;

    const comp = state.completions && state.completions[k];
    const done = !!comp;
    const isToday = k === tk;
    const isPast = k < tk;
    const isMissed = isPast && !done && !!assignee;

    const dayLabel = isToday ? 'TODAY' : DAYS[d.getDay()].toUpperCase();
    const displayName = assignee ? assignee.name : (comp ? comp.name : '—');
    const displayEmoji = assignee ? (assignee.emoji || '🐱') : (comp ? (comp.emoji || '🐱') : '');

    let badge = '';
    if (done) badge = '<span class="sched-badge badge-done">Done ✓</span>';
    else if (isToday) badge = '<span class="sched-badge badge-today">Today</span>';
    else if (isMissed) badge = '<span class="sched-badge badge-missed">Missed</span>';

    let action = '';
    if (done && (comp.memberId === myId)) {
      action = `<button class="sched-undo" onclick="undoCompletion('${k}')">Undo</button>`;
    } else if (isMissed && assignee && assignee.id === myId) {
      // It's your missed day — you can mark it done
      action = `<button class="sched-markdone" onclick="markMissedDone('${k}','${assignee.id}')">Mark done</button>`;
    }

    html += `<div class="sched-row${isToday ? ' is-today' : ''}${isMissed ? ' is-missed' : ''}">
      <div class="sched-day${isToday ? ' today' : ''}${isMissed ? ' missed' : ''}">${dayLabel}</div>
      <div class="sched-avatar">${displayEmoji}</div>
      <div class="sched-name">${displayName}</div>
      ${badge}
      ${action}
    </div>`;
  }

  el.innerHTML = html || '<div class="empty-row">No schedule data yet</div>';
}

function markMissedDone(dateStr, memberId) {
  if (memberId !== myId) { showToast("That's not your turn"); return; }
  if (!confirm('Mark ' + fmtDate(dateStr) + ' as done?')) return;
  save({ [`completions/${dateStr}`]: { memberId: myId, name: myName, emoji: myEmoji, timestamp: Date.now(), lateEntry: true } });
  showToast('Marked as done ✓');
}

function renderMembers() {
  const el = document.getElementById('member-list');
  const members = Object.values(state.members || {});
  if (!members.length) { el.innerHTML = '<div class="empty-row">No members yet</div>'; return; }

  const counts = {};
  Object.values(state.completions || {}).forEach(c => { counts[c.memberId] = (counts[c.memberId] || 0) + 1; });

  // Sort by schedule order
  const order = state.scheduleOrder || [];
  members.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  el.innerHTML = members.map(m => {
    const isMe = m.id === myId;
    return `<div class="member-row">
      <div class="member-avatar">${m.emoji || '🐱'}</div>
      <div class="member-name">${m.name}</div>
      ${isMe ? '<span class="member-you">you</span>' : ''}
      <div class="member-count">${counts[m.id] || 0} done</div>
    </div>`;
  }).join('');
}

function renderHistory() {
  const el = document.getElementById('history-list');
  const comps = Object.entries(state.completions || {})
    .filter(([k, c]) => c && c.name)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 20);

  if (!comps.length) { el.innerHTML = '<div class="empty-row">No history yet</div>'; return; }

  el.innerHTML = comps.map(([k, c]) => {
    const isMe = c.memberId === myId;
    return `<div class="hist-row">
      <div class="hist-avatar">${c.emoji || '🐱'}</div>
      <div class="hist-name">${c.name}</div>
      <div>
        <div class="hist-date">${fmtDate(k)}</div>
        <div class="hist-time">${fmtTime(c.timestamp)}</div>
      </div>
      ${isMe ? `<button class="hist-undo" onclick="undoCompletion('${k}')">Undo</button>` : '<span style="font-size:14px;color:var(--green)">✓</span>'}
    </div>`;
  }).join('');
}

// ── PROFILE MODAL ─────────────────────────────────────────────────────────────
function buildAvatarPicker(containerId, onSelect) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = EMOJIS.map(e => `
    <div class="avatar-opt${e === myEmoji ? ' selected' : ''}" onclick="selectEmoji(this,'${e}','${containerId}',${onSelect.name ? "window." + onSelect.name : 'null'})">
      ${e}
    </div>`).join('');
}

// Simpler global approach
let _pickerCallback = null;
function buildEmojiGrid(containerId, currentEmoji, callback) {
  const el = document.getElementById(containerId);
  if (!el) return;
  _pickerCallback = callback;
  el.innerHTML = EMOJIS.map(e => `
    <div class="emoji-opt${e === currentEmoji ? ' selected' : ''}" data-emoji="${e}" onclick="pickEmoji(this,'${e}')">
      ${e}
    </div>`).join('');
}

function pickEmoji(el, emoji) {
  document.querySelectorAll('.emoji-opt').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  if (_pickerCallback) _pickerCallback(emoji);
}

// Setup screen avatar pick
function buildSetupPicker() {
  const el = document.getElementById('setup-avatar-row');
  if (!el) return;
  el.innerHTML = EMOJIS.map(e => `
    <div class="avatar-opt${e === (selectedEmoji || myEmoji) ? ' selected' : ''}" onclick="pickSetupEmoji(this,'${e}')">${e}</div>`).join('');
}

function pickSetupEmoji(el, emoji) {
  document.querySelectorAll('.avatar-opt').forEach(e => e.classList.remove('selected'));
  el.classList.add('selected');
  selectedEmoji = emoji;
}

// Rebuild setup picker on load
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(buildSetupPicker, 100);
});

function showProfileModal() {
  const me = state.members[myId];
  if (!me) return;

  document.getElementById('modal-avatar-big').textContent = me.emoji || '🐱';
  document.getElementById('modal-name-display').textContent = me.name;
  document.getElementById('modal-name-input').value = me.name;

  buildEmojiGrid('emoji-grid', me.emoji || '🐱', (emoji) => {
    myEmoji = emoji;
    document.getElementById('modal-avatar-big').textContent = emoji;
    save({ [`members/${myId}/emoji`]: emoji });
    localStorage.setItem('dd_emoji', emoji);
    renderMain();
  });

  document.getElementById('profile-modal').style.display = 'flex';
}

function closeProfileModal(e) {
  if (e && e.target !== document.getElementById('profile-modal')) return;
  document.getElementById('profile-modal').style.display = 'none';
}

function saveName() {
  const name = document.getElementById('modal-name-input').value.trim();
  if (!name) { showToast('Enter a name'); return; }
  myName = name;
  localStorage.setItem('dd_name', name);
  document.getElementById('modal-name-display').textContent = name;

  // Update all completions with old name
  const updates = {};
  updates[`members/${myId}/name`] = name;
  Object.entries(state.completions || {}).forEach(([k, c]) => {
    if (c && c.memberId === myId) updates[`completions/${k}/name`] = name;
  });
  save(updates);
  renderMain();
  showToast('Name updated');
}

// ── SYNC UI ───────────────────────────────────────────────────────────────────
function setSyncState(status, label) {
  const dot = document.getElementById('sync-dot');
  const lbl = document.getElementById('sync-label');
  if (dot) dot.className = 'sync-dot ' + status;
  if (lbl) lbl.textContent = label;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(window._tt);
  window._tt = setTimeout(() => t.classList.remove('show'), 2600);
}

// Re-render at midnight
setInterval(() => {
  const n = new Date();
  if (n.getHours() === 0 && n.getMinutes() === 0 && myName) renderMain();
}, 60000);
