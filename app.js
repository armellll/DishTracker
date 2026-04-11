// ── STATE ────────────────────────────────────────────────────────────────────
let db = null;
let appRef = null;
let currentUser = null;
let state = { members: [], completions: {}, schedule: {} };

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

// ── INIT ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const saved = localStorage.getItem('dishduty_user');
  if (saved) {
    currentUser = saved;
    showMain();
  }

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
  currentUser = name;
  localStorage.setItem('dishduty_user', name);
  showMain();
}

function showMain() {
  document.getElementById('setup-screen').classList.remove('active');
  document.getElementById('main-screen').classList.add('active');
  document.getElementById('header-user').textContent = currentUser;

  // Only init Firebase once
  if (!db) {
    initFirebase();
  } else {
    render();
  }
}

function switchUser() {
  const name = prompt('Change your name:', currentUser);
  if (name && name.trim()) {
    currentUser = name.trim();
    localStorage.setItem('dishduty_user', currentUser);
    document.getElementById('header-user').textContent = currentUser;
    render();
    showToast('Switched to ' + currentUser);
  }
}

// ── FIREBASE ─────────────────────────────────────────────────────────────────
function initFirebase() {
  try {
    if (firebaseConfig.apiKey === 'PASTE_YOUR_API_KEY_HERE') {
      setSyncState('err', 'no config');
      showToast('Add your Firebase config to firebase-config.js');
      return;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    db = firebase.database();
    appRef = db.ref('dishduty');

    // Real-time listener — fires instantly on any device when data changes
    appRef.on('value', snap => {
      const data = snap.val();
      if (data) {
        state = data;
        // Ensure arrays are arrays (Firebase can turn empty arrays into null)
        if (!state.members) state.members = [];
        if (!state.completions) state.completions = {};
        if (!state.schedule) state.schedule = {};
      }
      setSyncState('live', 'live');
      render();
    }, err => {
      console.error(err);
      setSyncState('err', 'error');
    });

    db.ref('.info/connected').on('value', snap => {
      if (snap.val() === true) {
        setSyncState('live', 'live');
      } else {
        setSyncState('err', 'offline');
      }
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
    .catch(e => {
      console.error(e);
      setSyncState('err', 'error');
      showToast('Save failed — check connection');
    });
}

// ── DATE HELPERS ─────────────────────────────────────────────────────────────
function dateKey(d) { return d.toISOString().slice(0, 10); }
function todayKey() { return dateKey(new Date()); }
function fmtDate(k) {
  return new Date(k + 'T12:00:00').toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ── SCHEDULE ─────────────────────────────────────────────────────────────────
function buildSchedule() {
  if (!state.members || state.members.length === 0) { state.schedule = {}; return; }

  // Always rebuild the full schedule so new members get distributed
  state.schedule = {};

  const base = new Date();
  for (let i = -14; i <= 30; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const k = dateKey(d);

    // Simple index-based round robin: day index from a fixed epoch
    const epoch = new Date('2024-01-01');
    const dayIndex = Math.floor((d - epoch) / 86400000);
    state.schedule[k] = state.members[((dayIndex % state.members.length) + state.members.length) % state.members.length].id;
  }
}

function getAssignee(k) {
  if (!state.schedule || !state.members) return null;
  return state.members.find(m => m.id === state.schedule[k]) || null;
}

// ── MEMBERS ──────────────────────────────────────────────────────────────────
function addMember() {
  const input = document.getElementById('member-input');
  const name = input.value.trim();
  if (!name) return;
  if (!state.members) state.members = [];
  if (state.members.find(m => m.name.toLowerCase() === name.toLowerCase())) {
    showToast('Name already added');
    return;
  }
  const id = 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  state.members.push({ id, name, addedAt: Date.now() });
  buildSchedule(); // Rebuild entire schedule with new member included
  save();
  render();
  input.value = '';
  showToast(name + ' added to the rotation');
}

function removeMember(id) {
  const m = state.members.find(m => m.id === id);
  if (!m) return;
  if (!confirm('Remove ' + m.name + ' from the rotation?')) return;
  state.members = state.members.filter(m => m.id !== id);
  buildSchedule();
  save();
  render();
}

// ── MARK DONE ────────────────────────────────────────────────────────────────
function markDone() {
  const k = todayKey();
  const assignee = getAssignee(k);
  if (!assignee) return;

  // Anti-cheat: your saved name must match today's assignee
  if (assignee.name.toLowerCase() !== currentUser.toLowerCase()) {
    showToast("That's not your turn! 👀");
    return;
  }

  if (!state.completions) state.completions = {};
  state.completions[k] = {
    memberId: assignee.id,
    name: assignee.name,
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
  const assignee = getAssignee(k);
  const comp = state.completions && state.completions[k];
  const d = new Date();

  document.getElementById('hero-date').textContent =
    d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  document.getElementById('hero-name').textContent =
    assignee ? assignee.name : (state.members && state.members.length ? '—' : 'Add members below');

  if (comp) {
    action.innerHTML = `
      <div class="done-status">
        <span class="done-check">✓</span>
        <div>
          <div class="done-text">Done by ${comp.name}</div>
          <div class="done-time">${fmtTime(comp.timestamp)}</div>
        </div>
      </div>`;
  } else if (assignee) {
    const isMyTurn = assignee.name.toLowerCase() === currentUser.toLowerCase();
    if (isMyTurn) {
      action.innerHTML = `<button class="btn-done" onclick="markDone()">✓ I washed the dishes</button>`;
    } else {
      action.innerHTML = `<div class="btn-not-yours">Waiting for ${assignee.name} to mark done…</div>`;
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
  for (let i = -2; i <= 6; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    const k = dateKey(d);
    const assignee = getAssignee(k);
    const done = !!(state.completions && state.completions[k]);
    const isToday = k === tk;
    const isPast = d < base && !isToday;

    let badge = '';
    if (done) badge = '<span class="week-badge badge-done">Done ✓</span>';
    else if (isToday) badge = '<span class="week-badge badge-today">Today</span>';
    else if (isPast) badge = '<span class="week-badge badge-miss">Missed</span>';

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
    el.innerHTML = '<div class="empty-msg">No members yet — add people above</div>';
    return;
  }
  const counts = {};
  if (state.completions) {
    Object.values(state.completions).forEach(c => {
      counts[c.memberId] = (counts[c.memberId] || 0) + 1;
    });
  }
  el.innerHTML = state.members.map((m, i) => {
    const isYou = m.name.toLowerCase() === currentUser.toLowerCase();
    return `<div class="member-row">
      <div class="member-avatar av-${i % 6}">${m.name[0].toUpperCase()}</div>
      <div class="member-name">${m.name}</div>
      <div class="member-count">${counts[m.id] || 0} washes</div>
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
  const sorted = Object.entries(state.completions)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, 20);
  el.innerHTML = sorted.map(([k, c]) => `
    <div class="history-row">
      <div class="history-date">${fmtDate(k)}</div>
      <div class="history-who">${c.name}</div>
      <div class="history-time">${fmtTime(c.timestamp)}</div>
      <div class="history-tick">✓</div>
    </div>`).join('');
}

// ── UI HELPERS ───────────────────────────────────────────────────────────────
function setSyncState(status, label) {
  const dot = document.getElementById('sync-dot');
  const txt = document.getElementById('sync-text');
  dot.className = 'sync-dot ' + status;
  txt.textContent = label;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// Auto re-render at midnight
setInterval(() => {
  const n = new Date();
  if (n.getHours() === 0 && n.getMinutes() === 0) render();
}, 60000);
