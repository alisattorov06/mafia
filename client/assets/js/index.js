import { api, getToken, rememberName, redirectToGame, TOKEN_KEY } from './api.js';
import { toast } from './toast.js';
import { sound } from './sound.js';

const $ = (id) => document.getElementById(id);
const nameInput = $('name');
const codeInput = $('join-code');
const roomsEl = $('open-rooms');
const accessInput = $('room-access');
const createPasswordInput = $('create-password');
const joinPasswordInput = $('join-password');

nameInput.value = localStorage.getItem('mafia.name') || '';
nameInput.focus();

const urlRoom = new URLSearchParams(location.search).get('room');
if (urlRoom) {
  codeInput.value = urlRoom.trim().toUpperCase().slice(0, 6);
  nameInput.focus();
  nameInput.select();
}

async function guardName() {
  const name = nameInput.value.trim();
  if (!name) {
    toast('Choose an alias first.', 'error');
    nameInput.focus();
    return null;
  }
  rememberName(name);
  sound.unlock();
  return name;
}

$('btn-create').addEventListener('click', async () => {
  const name = await guardName();
  if (!name) return;
  const isPrivate = accessInput.value === 'private';
  const password = createPasswordInput.value;
  if (isPrivate && !password.trim()) {
    toast('Choose a password for the private room.', 'error');
    createPasswordInput.focus();
    return;
  }
  $('btn-create').disabled = true;
  try {
    const res = await api('/api/create', { name, mode: 'CLASSIC', password: isPrivate ? password : undefined });
    sessionStorage.setItem(TOKEN_KEY, res.token);
    toast(`Room ${res.roomCode} opened.`, 'success');
    redirectToGame(res.roomCode);
  } catch (err) {
    toast(err.message, 'error', 3200);
  } finally {
    $('btn-create').disabled = false;
  }
});

function syncRoomAccess() {
  const isPrivate = accessInput.value === 'private';
  $('create-password-wrap').classList.toggle('hidden', !isPrivate);
  $('btn-create').textContent = isPrivate ? 'Open a private room' : 'Open a public room';
  if (!isPrivate) createPasswordInput.value = '';
}

accessInput.addEventListener('change', syncRoomAccess);
syncRoomAccess();

$('btn-join').addEventListener('click', async () => {
  const name = await guardName();
  if (!name) return;
  const code = codeInput.value.trim().toUpperCase();
  if (!code) {
    toast('Enter the room code.', 'error');
    return;
  }
  $('btn-join').disabled = true;
  try {
    const res = await api('/api/join', { code, name, password: joinPasswordInput.value });
    sessionStorage.setItem(TOKEN_KEY, res.token);
    toast('Entering the room…', 'success');
    redirectToGame(code);
  } catch (err) {
    toast(err.message, 'error', 3200);
  } finally {
    $('btn-join').disabled = false;
  }
});

async function joinRoom(code, button) {
  const name = await guardName();
  if (!name) return;
  button.disabled = true;
  try {
    const res = await api('/api/join', { code, name });
    sessionStorage.setItem(TOKEN_KEY, res.token);
    toast('Entering the room…', 'success');
    redirectToGame(res.roomCode);
  } catch (err) {
    toast(err.message, 'error', 3200);
    loadPublicRooms(); // A room may have filled up or started while listed.
  } finally {
    button.disabled = false;
  }
}

function renderPublicRooms(rooms) {
  roomsEl.replaceChildren();
  if (!rooms.length) {
    const empty = document.createElement('p');
    empty.className = 'text-dim text-sm py-3 text-center';
    empty.textContent = 'No open rooms yet. Be the first to open one.';
    roomsEl.append(empty);
    return;
  }

  for (const room of rooms) {
    const row = document.createElement('div');
    row.className = 'flex items-center gap-3 border border-[color:var(--line-faint)] bg-black/10 px-3 py-3';

    const details = document.createElement('div');
    details.className = 'min-w-0 flex-1';
    const code = document.createElement('div');
    code.className = 'font-mono text-brass text-sm tracking-[.18em]';
    code.textContent = room.code;
    const meta = document.createElement('div');
    meta.className = 'text-dim text-xs mt-1';
    meta.textContent = `${room.playerCount}/${room.maxPlayers} players · ${room.mode.toLowerCase()}`;
    details.append(code, meta);

    const join = document.createElement('button');
    join.type = 'button';
    join.className = 'btn text-xs px-3 py-2 shrink-0';
    join.textContent = 'Join';
    join.addEventListener('click', () => joinRoom(room.code, join));
    row.append(details, join);
    roomsEl.append(row);
  }
}

async function loadPublicRooms() {
  try {
    const res = await fetch('/api/rooms');
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error('Could not load rooms.');
    renderPublicRooms(data.rooms);
  } catch {
    roomsEl.replaceChildren();
    const message = document.createElement('p');
    message.className = 'text-dim text-sm py-3 text-center';
    message.textContent = 'Could not load rooms. Try refreshing.';
    roomsEl.append(message);
  }
}

$('btn-refresh-rooms').addEventListener('click', loadPublicRooms);

codeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-join').click();
});
joinPasswordInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-join').click();
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-create').click();
});

// If a session already exists, skip straight back into the room.
(async () => {
  const token = getToken();
  if (!token) return;
  try {
    const res = await api(`/api/session?token=${encodeURIComponent(token)}`, undefined);
    if (res.ok) redirectToGame(res.roomCode);
  } catch {
    /* session expired — stay on the landing page */
  }
})();

loadPublicRooms();
window.setInterval(loadPublicRooms, 15000);
