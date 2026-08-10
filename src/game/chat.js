import { GameError, errorCodes } from '../utils/errors.js';
import { sanitizeText } from '../utils/sanitize.js';
import { isMafiaRole } from './roles.js';

export const CHANNELS = Object.freeze({
  ROOM: 'room',
  MAFIA: 'mafia',
  DEAD: 'dead'
});

const MAX_MESSAGE_LENGTH = 200;
const MAX_HISTORY = 100;

export class ChatManager {
  reset(room) {
    room.chat = { [CHANNELS.ROOM]: [], [CHANNELS.MAFIA]: [], [CHANNELS.DEAD]: [] };
  }

  getHistory(room, channel) {
    return (room.chat && room.chat[channel]) || [];
  }

  /**
   * Validate + store a message. Throws when the sender may not write there.
   */
  add(room, player, channel, text) {
    const msg = sanitizeText(text, MAX_MESSAGE_LENGTH);
    if (!msg) throw new GameError(errorCodes.INVALID_ACTION, 'Message cannot be empty.');

    const allowed = this.canWrite(room, player, channel);
    if (!allowed.ok) throw new GameError(errorCodes.INVALID_ACTION, allowed.error);

    const entry = {
      id: `${room.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      channel,
      playerId: player.id,
      name: player.name,
      text: msg,
      ts: Date.now(),
      system: false
    };
    room.chat[channel].push(entry);
    if (room.chat[channel].length > MAX_HISTORY) room.chat[channel].shift();
    return entry;
  }

  system(room, channel, text) {
    const entry = {
      id: `${room.id}:sys:${Date.now()}`,
      channel,
      playerId: null,
      name: null,
      text,
      ts: Date.now(),
      system: true
    };
    room.chat[channel].push(entry);
    if (room.chat[channel].length > MAX_HISTORY) room.chat[channel].shift();
    return entry;
  }

  /**
   * Which channels a given player may *read*.
   * Dead players cannot see the living players' discussion unless spectator
   * mode is enabled (then public chat is read-only).
   */
  readableChannels(room, player) {
    const out = [CHANNELS.DEAD];
    if (player.alive) out.push(CHANNELS.ROOM);
    if (player.alive && isMafiaRole(player.role)) out.push(CHANNELS.MAFIA);
    if (!player.alive && room.settings.spectatorMode) out.push(CHANNELS.ROOM);
    return out;
  }

  canWrite(room, player, channel) {
    if (!player) return { ok: false, error: 'Not a member of this room.' };
    if (!this.readableChannels(room, player).includes(channel)) {
      return { ok: false, error: 'You cannot send messages there.' };
    }
    if (channel === CHANNELS.MAFIA && (!player.alive || !isMafiaRole(player.role))) {
      return { ok: false, error: 'Only living Mafia members can use the Mafia chat.' };
    }
    if (channel === CHANNELS.DEAD && player.alive) {
      return { ok: false, error: 'Living players cannot use the dead chat.' };
    }
    if (channel === CHANNELS.DEAD && !player.alive && !room.settings.deadChatEnabled) {
      return { ok: false, error: 'The dead chat is disabled.' };
    }
    return { ok: true };
  }
}
