export const TOKEN_KEY = 'mafia.token';
export const NAME_KEY = 'mafia.name';

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}
export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}
export function getName() {
  return localStorage.getItem(NAME_KEY) || '';
}
export function rememberName(name) {
  localStorage.setItem(NAME_KEY, name);
}

export async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const err = new Error(data.message || 'Something went wrong.');
    err.code = data.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

export function redirectToGame(code) {
  window.location.href = `/game.html?code=${encodeURIComponent(code)}`;
}
