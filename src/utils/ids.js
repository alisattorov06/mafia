import { randomBytes, createHash } from 'node:crypto';

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function randomId(bytes = 8) {
  return randomBytes(bytes).toString('hex');
}

export function roomCode(len = 6) {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += ROOM_ALPHABET[bytes[i] % ROOM_ALPHABET.length];
  return out;
}

export function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}
