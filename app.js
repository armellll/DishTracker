// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// DiceBear avatar system — no auth, no key needed
// Each avatar = { style, seed } → URL generated on the fly
const AVATAR_STYLES = [
  { id: 'adventurer',       label: 'Adventurer' },
  { id: 'avataaars',        label: 'Cartoon'    },
  { id: 'lorelei',          label: 'Lorelei'    },
  { id: 'pixel-art',        label: 'Pixel'      },
  { id: 'big-smile',        label: 'Big Smile'  },
  { id: 'fun-emoji',        label: 'Fun'        },
];

// Preset seeds that produce nice varied characters
const AVATAR_SEEDS = [
  'Sakura','Hiro','Luna','Kai','Mika','Ryu','Nami','Zoro',
  'Yuki','Ren','Aoi','Kira','Sora','Akira','Hana','Daisuke'
];

function avatarUrl(style, seed, size = 80) {
  return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}&size=${size}&radius=50`;
}

// Store avatar as "style:seed" string
function parseAvatar(str) {
  if (!str || !str.includes(':')) return { style: 'adventurer', seed: 'default' };
  const [style, ...rest] = str.split(':');
  return { style, seed: rest.join(':') };
}
function serializeAvatar(style, seed) { return style + ':' + seed; }

// ── STATE ─────────────────────────────────────────────────────────────────────
let db = null, appRef = null;
let myId = null, myName = null;
let myAvatar = 'adventurer:Sakura'; // default
let selectedAvatar = null; // during setup/edit
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
  myAvatar = localStorage.getItem('dd_avatar') || 'adventurer:Sakura';

  buildSetupPicker();

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
    if (me.name !== myName || me.avatar !== myAvatar) {
      save({ [`members/${myId}/name`]: myName, [`members/${myId}/avatar`]: myAvatar });
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
  myAvatar = selectedAvatar || myAvatar;
  localStorage.setItem('dd_name', myName);
  localStorage.setItem('dd_avatar', myAvatar);

  // Add to members
  const updates = {};
  updates[`members/${myId}`] = { id: myId, name: myName, avatar: myAvatar, joinedAt: Date.now() };

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

  save({ [`completions/${k}`]: { memberId: myId, name: myName, avatar: myAvatar, timestamp: Date.now() } });
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
  if (btn) {
    if (me && me.avatar) {
      const { style, seed } = parseAvatar(me.avatar);
      btn.innerHTML = `<img src="${avatarUrl(style, seed, 32)}" style="width:32px;height:32px;border-radius:50%;display:block" alt="avatar" onerror="this.style.display='none'" />`;
    } else {
      btn.textContent = '?';
    }
  }
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
    const av = parseAvatar(assignee.avatar || '');
    avatarWrap.innerHTML = `<img src="${avatarUrl(av.style, av.seed, 56)}" style="width:56px;height:56px;border-radius:50%;display:block" alt="${assignee.name}" />`;
    nameEl.textContent = assignee.name;
  } else {
    avatarWrap.innerHTML = '🍽';
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
    const avStr = assignee ? assignee.avatar : (comp ? comp.avatar : '');
    const avParsed = parseAvatar(avStr || '');
    const displayAvatar = avStr ? `<img src="${avatarUrl(avParsed.style, avParsed.seed, 28)}" style="width:28px;height:28px;border-radius:50%" alt="" />` : '';

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
      <div class="sched-avatar">${displayAvatar}</div>
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
  save({ [`completions/${dateStr}`]: { memberId: myId, name: myName, avatar: myAvatar, timestamp: Date.now(), lateEntry: true } });
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
    const mAv = parseAvatar(m.avatar || '');
    return `<div class="member-row">
      <div class="member-avatar"><img src="${avatarUrl(mAv.style, mAv.seed, 40)}" style="width:40px;height:40px;border-radius:50%;display:block" alt="${m.name}" /></div>
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
    const hAv = parseAvatar(c.avatar || '');
    return `<div class="hist-row">
      <div class="hist-avatar"><img src="${avatarUrl(hAv.style, hAv.seed, 28)}" style="width:28px;height:28px;border-radius:50%;display:block" alt="${c.name}" /></div>
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
// ── DICEBEAR AVATAR PICKER ────────────────────────────────────────────────────
// Shows a style tab bar + seed grid. Selecting any avatar updates immediately.

function buildSetupPicker() {
  const el = document.getElementById('setup-avatar-row');
  if (!el) return;
  const cur = parseAvatar(selectedAvatar || myAvatar);
  el.innerHTML = buildPickerHTML(cur.style, cur.seed, 'setup');
}

function buildPickerHTML(activeStyle, activeSeed, context) {
  const tabsHTML = AVATAR_STYLES.map(s => `
    <button class="av-tab${s.id === activeStyle ? ' active' : ''}"
      onclick="switchAvatarStyle('${s.id}','${context}')">${s.label}</button>
  `).join('');

  const gridHTML = AVATAR_SEEDS.map(seed => {
    const url = avatarUrl(activeStyle, seed, 56);
    const isSelected = seed === activeSeed && activeStyle === activeStyle;
    return `<div class="av-card${seed === activeSeed ? ' selected' : ''}"
      onclick="selectAvatarCard(this,'${activeStyle}','${seed}','${context}')">
      <img src="${url}" alt="${seed}" loading="lazy"
        style="width:56px;height:56px;border-radius:50%;display:block"
        onerror="this.src='https://api.dicebear.com/9.x/fun-emoji/svg?seed=${seed}&size=56'" />
    </div>`;
  }).join('');

  return `<div class="av-tabs">${tabsHTML}</div><div class="av-grid">${gridHTML}</div>`;
}

function switchAvatarStyle(style, context) {
  const cur = parseAvatar(context === 'setup' ? (selectedAvatar || myAvatar) : myAvatar);
  const el = document.getElementById(context === 'setup' ? 'setup-avatar-row' : 'emoji-grid');
  if (el) el.innerHTML = buildPickerHTML(style, cur.seed, context);
}

function selectAvatarCard(el, style, seed, context) {
  document.querySelectorAll('.av-card').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  const av = serializeAvatar(style, seed);
  if (context === 'setup') {
    selectedAvatar = av;
  } else {
    // Profile modal — apply immediately
    myAvatar = av;
    localStorage.setItem('dd_avatar', av);
    const big = document.getElementById('modal-avatar-big');
    if (big) big.innerHTML = `<img src="${avatarUrl(style, seed, 80)}" style="width:80px;height:80px;border-radius:50%;display:block" alt="avatar" />`;
    save({ [`members/${myId}/avatar`]: av });
    renderMain();
  }
}

function showProfileModal() {
  const me = state.members[myId];
  if (!me) return;
  const av = parseAvatar(me.avatar || myAvatar);

  const bigEl = document.getElementById('modal-avatar-big');
  bigEl.innerHTML = `<img src="${avatarUrl(av.style, av.seed, 80)}" style="width:80px;height:80px;border-radius:50%;display:block" alt="avatar" />`;
  document.getElementById('modal-name-display').textContent = me.name;
  document.getElementById('modal-name-input').value = me.name;

  const gridEl = document.getElementById('emoji-grid');
  gridEl.innerHTML = buildPickerHTML(av.style, av.seed, 'modal');

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
