import { api, getToken, rememberName, redirectToGame, TOKEN_KEY } from './api.js';
import { toast } from './toast.js';
import { sound } from './sound.js';

const $ = (id) => document.getElementById(id);
const nameInput = $('name');
const codeInput = $('join-code');

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
  $('btn-create').disabled = true;
  try {
    const res = await api('/api/create', { name, mode: 'CLASSIC' });
    sessionStorage.setItem(TOKEN_KEY, res.token);
    toast(`Room ${res.roomCode} opened.`, 'success');
    redirectToGame(res.roomCode);
  } catch (err) {
    toast(err.message, 'error', 3200);
  } finally {
    $('btn-create').disabled = false;
  }
});

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
    const res = await api('/api/join', { code, name });
    sessionStorage.setItem(TOKEN_KEY, res.token);
    toast('Entering the room…', 'success');
    redirectToGame(code);
  } catch (err) {
    toast(err.message, 'error', 3200);
  } finally {
    $('btn-join').disabled = false;
  }
});

codeInput.addEventListener('keydown', (e) => {
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
