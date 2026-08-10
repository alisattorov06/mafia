import { getToken, clearToken, redirectToGame } from './api.js';
import { toast } from './toast.js';
import { sound } from './sound.js';
import { esc } from './views.js';
import * as V from './views.js';

/* ============================================================ state */

const state = {
  kind: null, // 'lobby' | 'game'
  lobby: null,
  game: null,
  roomCode: null,
  phaseDeadline: null,
  pendingVote: undefined,
  seenRole: false,
  lastPhase: null
};

let socket = null;
const $ = (id) => document.getElementById(id);
const stage = $('stage');

/* ============================================================ timer */

function phaseTotalMs(phase, settings = {}) {
  const map = {
    ROLE_REVEAL: settings.roleRevealDuration,
    NIGHT_MAFIA: settings.nightDuration,
    NIGHT_DOCTOR: settings.nightDuration,
    NIGHT_DETECTIVE: settings.nightDuration,
    NIGHT_BODYGUARD: settings.nightDuration,
    DAY_START: settings.morningDuration,
    DISCUSSION: settings.discussionDuration,
    VOTING: settings.votingDuration,
    VOTE_RESULT: 7
  };
  const s = map[phase];
  return s == null ? null : s * 1000;
}

function paintTimer() {
  const fill = $('timer-fill');
  const note = $('timer-note');
  const round = $('round-label');
  if (!fill) return;

  const s = state.game || state.lobby;
  const phase = state.game?.phase;
  round.textContent = phase
    ? phase.startsWith('NIGHT_')
      ? `Night ${state.game.round}`
      : `Day ${state.game.round}`
    : '';

  if (!state.phaseDeadline || !phase) {
    fill.style.width = '0%';
    note.textContent = '';
    return;
  }
  const total = phaseTotalMs(phase, state.game?.settings);
  const remain = Math.max(0, state.phaseDeadline - Date.now());
  const pct = total ? Math.max(0, Math.min(100, (remain / total) * 100)) : 0;
  fill.style.width = `${pct}%`;
  note.textContent = V.countdown(remain);
  if (remain <= 4000 && remain > 0 && Math.floor(remain / 1000) !== Math.floor((remain + 260) / 1000)) {
    sound.tick();
  }
}

setInterval(paintTimer, 250);

/* ============================================================ header */

function paintHeader() {
  $('room-code').textContent = state.roomCode || '';
  const phase = state.game?.phase;
  $('phase-label').textContent = phase ? V.PHASE_TITLES[phase] : 'Ante Room';
}

/* ============================================================ sounds */

function onPhaseChange() {
  const phase = state.game?.phase;
  if (!phase || phase === state.lastPhase) return;

  if (phase.startsWith('NIGHT_')) sound.night();
  else if (phase === 'ROLE_REVEAL') sound.reveal();
  else if (phase === 'VOTE_RESULT') sound.vote();
  else if (phase === 'GAME_OVER') sound.win();
  else sound.phase();

  if (phase === 'DAY_START' && state.game?.morning?.killedId) sound.kill();
}

function paintVeil() {
  document.body.classList.toggle('night', V.phaseIsNight(state.game?.phase));
  spawnStars();
}
function spawnStars() {
  const veil = $('night-veil');
  if (!veil || veil.childElementCount > 0) return;
  for (let i = 0; i < 26; i += 1) {
    const s = document.createElement('span');
    s.className = 'star';
    s.style.left = `${Math.random() * 100}%`;
    s.style.top = `${Math.random() * 55}%`;
    s.style.animationDelay = `${Math.random() * 4}s`;
    s.style.animationDuration = `${2.4 + Math.random() * 2.4}s`;
    veil.appendChild(s);
  }
}

/* ============================================================ render */

function render() {
  paintHeader();
  paintTimer();
  paintVeil();
  onPhaseChange();
  state.lastPhase = state.game?.phase || state.lastPhase;

  const s = state.game;
  if (s) {
    switch (s.phase) {
      case 'ROLE_REVEAL':
        stage.innerHTML = V.roleRevealView(s);
        bindRoleReveal();
        break;
      case 'NIGHT_MAFIA':
      case 'NIGHT_DOCTOR':
      case 'NIGHT_DETECTIVE':
      case 'NIGHT_BODYGUARD':
        stage.innerHTML = V.nightView(s);
        bindNight();
        break;
      case 'DAY_START':
        stage.innerHTML = V.morningView(s);
        break;
      case 'DISCUSSION':
        stage.innerHTML = V.discussionView(s);
        break;
      case 'VOTING':
        stage.innerHTML = V.votingView(s, null, state.pendingVote);
        bindVoting();
        break;
      case 'VOTE_RESULT':
        stage.innerHTML = V.voteResultView(s);
        break;
      case 'GAME_OVER':
        stage.innerHTML = V.gameOverView(s);
        bindGameOver();
        break;
      default:
        stage.innerHTML = '';
    }
  } else if (state.lobby) {
    stage.innerHTML = V.lobbyView(state.lobby, null, { showSettings: false });
    bindLobby();
  } else {
    stage.innerHTML = `<div class="text-center mono-tag mt-20 fade-in">Connecting to the table…</div>`;
  }
  renderChatTabs();
}

/* ============================================================ lobby bind */

function bindLobby() {
  const s = state.lobby;
  const me = s.self;

  $('copy-link')?.addEventListener('click', () => {
    const url = `${location.origin}/?room=${encodeURIComponent(s.roomCode)}`;
    navigator.clipboard?.writeText(url).then(
      () => toast('Invite link copied.', 'success'),
      () => toast(`Share this code: ${s.roomCode}`, 'info')
    );
  });

  $('start-btn')?.addEventListener('click', () => emit('room:startGame', {}));
  $('settings-btn')?.addEventListener('click', () => $('settings-sheet')?.classList.toggle('hidden'));

  if (me.isHost) {
    $('settings-sheet')?.querySelectorAll('[data-set]').forEach((el) => {
      el.addEventListener('change', () => {
        const key = el.dataset.set;
        const value = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
        emit('room:updateSettings', { settings: { ...s.settings, [key]: value } });
      });
    });
  }

  document.querySelectorAll('[data-kick]').forEach((btn) => {
    btn.addEventListener('click', () => emit('room:kick', { targetId: btn.dataset.kick }));
  });
}

/* ============================================================ role reveal */

function bindRoleReveal() {
  $('seen-btn')?.addEventListener('click', () => {
    if (state.seenRole) return;
    state.seenRole = true;
    sound.reveal();
    emit('game:ready', {});
  });
}

/* ============================================================ night */

function bindNight() {
  const phase = state.game.phase;
  document.querySelectorAll('#stage [data-pid]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.pid;
      if (phase === 'NIGHT_MAFIA') emit('mafia:target', { targetId });
      else if (phase === 'NIGHT_DOCTOR') emit('doctor:target', { targetId });
      else if (phase === 'NIGHT_DETECTIVE') emit('detective:target', { targetId });
      else if (phase === 'NIGHT_BODYGUARD') emit('bodyguard:target', { targetId });
    });
  });
  $('lock-btn')?.addEventListener('click', () => emit('mafia:lock', {}));
}

/* ============================================================ voting */

function bindVoting() {
  const s = state.game;
  document.querySelectorAll('#stage [data-pid]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.pid;
      state.pendingVote = state.pendingVote === id ? undefined : id;
      sound.click();
      render();
    });
  });
  $('vote-confirm')?.addEventListener('click', () => {
    if (state.pendingVote === undefined) return;
    emit('vote:cast', { targetId: state.pendingVote });
    state.pendingVote = undefined;
  });
  $('vote-abstain')?.addEventListener('click', () => {
    state.pendingVote = undefined;
    emit('vote:cast', { targetId: null });
  });
}

/* ============================================================ game over */

function bindGameOver() {
  $('rematch-btn')?.addEventListener('click', () => emit('game:rematch', {}));
  $('lobby-btn')?.addEventListener('click', () => emit('game:returnToLobby', {}));
  $('leave-btn')?.addEventListener('click', leave);
  $('leave-btn-2')?.addEventListener('click', leave);
}

async function leave() {
  const token = getToken();
  try {
    await fetch('/api/leave', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  } catch { /* best effort */ }
  clearToken();
  redirectToGame('');
  window.location.href = '/';
}

/* ============================================================ chat */

const chatState = { active: null, channels: [] };

function renderChatTabs() {
  const s = state.game || state.lobby;
  const allowed = s?.chatAccess?.channels || (state.lobby ? ['room'] : ['room']);
  chatState.channels = allowed;

  const tabs = $('chat-tabs');
  tabs.innerHTML = allowed
    .map(
      (ch) => `
      <button data-ch="${ch}" class="mono-tag px-3 py-1 border transition-colors
        ${chatState.active === ch ? 'border-brass text-brass-bright' : 'border-brass/20 text-dim hover:text-cream'}">${tabLabel(ch)}</button>`
    )
    .join('');
  tabs.querySelectorAll('[data-ch]').forEach((b) =>
    b.addEventListener('click', () => {
      chatState.active = b.dataset.ch;
      renderChatTabs();
      renderChatLog(false);
    })
  );

  if (!allowed.includes(chatState.active)) chatState.active = allowed[0] || 'room';
  $('chat-form')?.classList.toggle('hidden', !allowed.includes(chatState.active));
  renderChatLog(false);
}

function tabLabel(ch) {
  return ch === 'room' ? 'Room' : ch === 'mafia' ? 'The Family' : 'The Dead';
}

function renderChatLog(initial) {
  const log = $('chat-log');
  const ch = chatState.active;
  if (!ch || !log) return;
  if (initial) log.innerHTML = '';
  const scrollToBottom = () => (log.scrollTop = log.scrollHeight);
  scrollToBottom();
}

function appendChat(msg) {
  if (!msg || !chatState.channels.includes(msg.channel)) return;
  const log = $('chat-log');
  if (!log) return;
  const el = document.createElement('div');
  if (msg.system) {
    el.className = 'font-serif-italic text-brass/90 text-center text-sm';
    el.textContent = msg.text;
  } else {
    el.innerHTML = `<span class="font-mono text-[10px] text-brass mr-2">${esc(msg.name)}</span><span class="text-cream/90 break-words">${esc(msg.text)}</span>`;
  }
  el.style.animation = 'fadeUp .3s ease both';
  log.appendChild(el);
  if (chatState.active !== msg.channel && !msg.system) {
    const tab = $(`[data-ch="${msg.channel}"]`);
    if (tab && !tab.textContent.includes('●')) tab.textContent = `● ${tab.textContent}`;
  }
  log.scrollTop = log.scrollHeight;
}

$('chat-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text || !chatState.active) return;
  emit('chat:send', { channel: chatState.active, text });
  input.value = '';
});

/* ============================================================ sockets */

function emit(event, payload) {
  if (!socket) return;
  socket.emit(event, payload);
}

function connect() {
  const token = getToken();
  if (!token) {
    window.location.href = '/';
    return;
  }
  const url = `${location.protocol}//${location.host}`;
  socket = window.io(url, { auth: { token }, reconnectionAttempts: 8, reconnectionDelay: 800 });

  socket.on('connect', () => {
    toast('Connected.', 'success', 1200);
  });
  socket.on('connect_error', (err) => {
    if (String(err?.message).startsWith('UNAUTHORIZED')) goHome();
    else toast('Connection failed. Retrying…', 'error');
  });
  socket.on('disconnect', () => {
    toast('Connection lost. Reconnecting…', 'error');
  });

  socket.on('lobby:state', (s) => {
    state.kind = 'lobby';
    state.lobby = s;
    state.game = null;
    state.roomCode = s.roomCode;
    state.phaseDeadline = null;
    state.lastPhase = null;
    render();
  });

  socket.on('game:state', (s) => {
    state.kind = 'game';
    state.game = s;
    state.lobby = null;
    state.roomCode = s.roomCode;
    state.phaseDeadline = s.timer?.deadline || state.phaseDeadline;
    render();
  });

  socket.on('game:timer', (t) => {
    if (t.phase === state.game?.phase) state.phaseDeadline = t.deadline;
  });

  socket.on('chat:message', appendChat);

  socket.on('error', (e) => {
    const { code, message } = e || {};
    if (['SESSION_EXPIRED', 'ROOM_NOT_FOUND', 'UNAUTHORIZED', 'NOT_HOST'].includes(code)) {
      stage.innerHTML = V.errorScreen(message || 'You are no longer welcome at this table.');
      $('go-home')?.addEventListener('click', goHome);
    } else if (code === 'INVALID_NAME') {
      toast(message, 'error', 3000);
      goHome();
    } else {
      toast(message || 'The night rejected that move.', 'error', 3200);
      sound.kill();
    }
  });

  socket.on('session:replaced', () => {
    toast('This seat opened on another tab.', 'error', 4000);
  });
  socket.on('session:terminated', (e) => {
    toast(e?.reason || 'You left the room.', 'info', 3000);
    clearToken();
    setTimeout(goHome, 1200);
  });
}

function goHome() {
  clearToken();
  window.location.href = '/';
}

connect();
