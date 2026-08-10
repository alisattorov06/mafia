import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, fakeRoom, setRoles, startAndReveal } from './helpers.js';
import { buildGameView } from '../src/game/view.js';
import { ChatManager } from '../src/game/chat.js';
import { PHASES } from '../src/config.js';

const SIX = ['A', 'B', 'C', 'D', 'E', 'F'];

function bindMafiaPanel(engine, room) {
  room.mafiaPanelState = engine.mafiaPanelState.bind(engine);
  return room;
}

/** Drive night phases up to (and including) the requested phase. */
function nightTo(engine, room, phase) {
  let guard = 0;
  while (room.phase !== phase && guard++ < 20) engine.advancePhase(room);
  if (room.phase !== phase) throw new Error(`expected ${phase}, got ${room.phase}`);
  return room;
}

describe('view.js — information security', () => {
  test('citizen view never leaks roles, teams or private state of others', () => {
    const engine = makeEngine();
    const room = bindMafiaPanel(engine, fakeRoom(SIX));
    startAndReveal(engine, room, { p0: 'MAFIA', p1: 'MAFIA', p2: 'DETECTIVE', p3: 'DOCTOR' });
    // NIGHT_MAFIA: citizen should not see the mafia panel, proposals or final target.
    assert.equal(room.phase, PHASES.NIGHT_MAFIA);

    const view = buildGameView(room, 'p4');
    assert.equal(view.kind, 'game');
    assert.equal(view.teammates, undefined, 'citizen must not see teammates');
    assert.equal(view.mafiaPanel, undefined, 'citizen must not see the mafia panel');
    assert.equal(view.finalTarget, undefined, 'citizen must not see the mafia final target');
    assert.equal(view.detectiveResult, undefined);

    for (const p of view.players) {
      assert.ok(!('role' in p), 'player list must not carry roles');
      assert.ok(!('team' in p), 'player list must not carry teams');
    }
    assert.deepEqual(view.self.role, 'CITIZEN');
    assert.deepEqual(view.self.team, 'TOWN');
  });

  test('mafia view exposes only mafia teammates', () => {
    const engine = makeEngine();
    const room = bindMafiaPanel(engine, fakeRoom(SIX));
    startAndReveal(engine, room, { p0: 'MAFIA', p1: 'MAFIA', p2: 'DETECTIVE', p3: 'DOCTOR' });

    const view = buildGameView(room, 'p0');
    const teammates = view.teammates.map((t) => t.id).sort();
    assert.deepEqual(teammates, ['p1'], 'mafia must see only the other mafia member');
    assert.ok(view.mafiaPanel !== undefined);
    assert.deepEqual(view.self.role, 'MAFIA');
  });

  test('citizen cannot see mafia votes or the locked/final target', () => {
    const engine = makeEngine();
    const room = bindMafiaPanel(engine, fakeRoom(SIX));
    startAndReveal(engine, room, { p0: 'MAFIA', p1: 'MAFIA' });
    engine.mafiaAction(room, 'p0', 'p2');
    engine.mafiaAction(room, 'p1', 'p2');
    engine.mafiaLock(room, 'p0');
    engine.mafiaLock(room, 'p1');

    const view = buildGameView(room, 'p4');
    assert.equal(view.mafiaPanel, undefined);
    assert.equal(view.myProposal, undefined);
    assert.equal(view.finalTarget, undefined);
  });

  test('only the doctor sees their own night target', () => {
    const engine = makeEngine();
    const room = bindMafiaPanel(engine, fakeRoom(SIX));
    startAndReveal(engine, room, { p0: 'MAFIA', p1: 'MAFIA', p2: 'DETECTIVE', p3: 'DOCTOR' });
    engine.mafiaAction(room, 'p0', 'p2');
    engine.mafiaAction(room, 'p1', 'p2');
    engine.advancePhase(room); // bodyguard skipped -> NIGHT_DOCTOR
    assert.equal(room.phase, PHASES.NIGHT_DOCTOR);

    engine.doctorAction(room, 'p3', 'p4');
    const doctorView = buildGameView(room, 'p3');
    assert.equal(doctorView.night.myTarget, 'p4');

    const citizenView = buildGameView(room, 'p5');
    assert.equal(citizenView.night.myTarget, null, 'citizen must not see the doctor target');
    assert.equal(citizenView.night.lastTarget, undefined, 'citizen must not see doctor lastTarget');
  });

  test('detective result is delivered only to the detective', () => {
    const engine = makeEngine();
    const room = bindMafiaPanel(engine, fakeRoom(SIX));
    startAndReveal(engine, room, { p0: 'MAFIA', p1: 'MAFIA', p2: 'DETECTIVE', p3: 'DOCTOR' });
    engine.mafiaAction(room, 'p0', 'p2');
    engine.mafiaAction(room, 'p1', 'p2');
    engine.advancePhase(room);
    engine.doctorAction(room, 'p3', 'p3');
    engine.advancePhase(room);
    assert.equal(room.phase, PHASES.NIGHT_DETECTIVE);
    engine.detectiveAction(room, 'p2', 'p0');

    const det = buildGameView(room, 'p2');
    assert.equal(det.detectiveResult.targetId, 'p0');
    assert.equal(det.detectiveResult.isMafia, true);

    const citizen = buildGameView(room, 'p4');
    assert.equal(citizen.detectiveResult, undefined, 'citizen must not receive the detective result');
  });

  test('dead players roles are hidden unless roleReveal is enabled', () => {
    const engine = makeEngine();
    const room = bindMafiaPanel(engine, fakeRoom(SIX, { roleReveal: false }));
    startAndReveal(engine, room, { p0: 'MAFIA', p1: 'MAFIA', p2: 'DETECTIVE', p3: 'DOCTOR' });
    engine.mafiaAction(room, 'p0', 'p2');
    engine.mafiaAction(room, 'p1', 'p2');
    engine.advancePhase(room);
    engine.doctorAction(room, 'p3', 'p3');
    engine.advancePhase(room);
    engine.detectiveAction(room, 'p2', 'p0');
    engine.advancePhase(room); // resolve -> DAY_START

    assert.equal(room.phase, PHASES.DAY_START);
    const hidden = buildGameView(room, 'p4');
    const deadP2 = hidden.deadPlayers.find((p) => p.id === 'p2');
    assert.ok(deadP2, 'p2 should be listed as dead');
    assert.equal(deadP2.role, null, 'role must be hidden when roleReveal is off');

    room.settings.roleReveal = true;
    const revealed = buildGameView(room, 'p4');
    const deadP2b = revealed.deadPlayers.find((p) => p.id === 'p2');
    assert.equal(deadP2b.role, 'DETECTIVE');
    assert.equal(deadP2b.team, 'TOWN');
  });

  test('elimination role only revealed when reveal is on', () => {
    for (const roleReveal of [false, true]) {
      const engine = makeEngine();
      const room = bindMafiaPanel(engine, fakeRoom(SIX, { roleReveal }));
      startAndReveal(engine, room, { p0: 'MAFIA', p1: 'MAFIA', p2: 'DETECTIVE', p4: 'DOCTOR' });
      // Night: mafia kill citizen p3.
      engine.mafiaAction(room, 'p0', 'p3');
      engine.mafiaAction(room, 'p1', 'p3');
      engine.advancePhase(room);
      engine.doctorAction(room, 'p4', 'p4');
      engine.advancePhase(room);
      engine.detectiveAction(room, 'p2', 'p0');
      engine.advancePhase(room); // -> DAY_START, p3 dead
      engine.advancePhase(room); // -> DISCUSSION
      engine.advancePhase(room); // -> VOTING

      // Everyone votes p2 (the detective) out.
      for (const p of room.players.values()) {
        if (p.alive && p.id !== 'p2') engine.castVote(room, p.id, 'p2');
      }
      engine.advancePhase(room); // -> VOTE_RESULT
      engine.advancePhase(room); // -> p2 eliminated, parity -> GAME_OVER
      assert.equal(room.phase, PHASES.GAME_OVER);

      const view = buildGameView(room, 'p4');
      assert.equal(view.elimination.playerId, 'p2');
      assert.equal(view.elimination.role, roleReveal ? 'DETECTIVE' : null);
      assert.equal(view.elimination.team, roleReveal ? 'TOWN' : null);
    }
  });
});

describe('chat.js — channel access control', () => {
  test('alive citizen: room only', () => {
    const engine = makeEngine();
    const room = fakeRoom(SIX);
    startAndReveal(engine, room, { p0: 'MAFIA', p1: 'MAFIA' });
    const chat = new ChatManager();
    assert.ok(chat.canWrite(room, room.players.get('p2'), 'room').ok);
    assert.ok(!chat.canWrite(room, room.players.get('p2'), 'mafia').ok);
    assert.ok(!chat.canWrite(room, room.players.get('p2'), 'dead').ok);
    assert.deepEqual(chat.readableChannels(room, room.players.get('p2')), ['dead', 'room']);
  });

  test('mafia can use the mafia channel, citizens cannot', () => {
    const engine = makeEngine();
    const room = fakeRoom(SIX);
    startAndReveal(engine, room, { p0: 'MAFIA', p1: 'MAFIA' });
    const chat = new ChatManager();
    assert.ok(chat.canWrite(room, room.players.get('p0'), 'mafia').ok);
    assert.throws(() => chat.add(room, room.players.get('p2'), 'mafia', 'spy'));
    const msg = chat.add(room, room.players.get('p0'), 'mafia', 'kill p2');
    assert.equal(msg.channel, 'mafia');
    assert.equal(room.chat.mafia.length, 1);
  });

  test('dead players use dead chat only (unless spectator mode)', () => {
    const engine = makeEngine();
    const room = fakeRoom(SIX);
    startAndReveal(engine, room, { p0: 'MAFIA', p1: 'MAFIA', p2: 'DETECTIVE', p3: 'DOCTOR' });
    const chat = new ChatManager();
    room.settings.deadChatEnabled = true;
    room.players.get('p2').alive = false;

    assert.ok(chat.canWrite(room, room.players.get('p2'), 'dead').ok);
    assert.ok(!chat.canWrite(room, room.players.get('p2'), 'room').ok);
    assert.ok(!chat.canWrite(room, room.players.get('p2'), 'mafia').ok);

    room.settings.spectatorMode = true;
    assert.ok(chat.canWrite(room, room.players.get('p2'), 'room').ok, 'spectator mode opens public read');
    assert.deepEqual(chat.readableChannels(room, room.players.get('p2')), ['dead', 'room']);
  });

  test('mafia chat is invisible to non-mafia channels and views', () => {
    const engine = makeEngine();
    const room = fakeRoom(SIX);
    startAndReveal(engine, room, { p0: 'MAFIA', p1: 'MAFIA' });
    const chat = new ChatManager();
    chat.add(room, room.players.get('p0'), 'mafia', 'secret');

    const citizen = room.players.get('p2');
    assert.ok(!chat.readableChannels(room, citizen).includes('mafia'));
    const view = buildGameView(room, 'p2');
    assert.ok(!view.chatAccess.channels.includes('mafia'), 'citizen view must not list mafia channel');
    // Even the raw history object is gated by readableChannels at the handler layer.
    const mafia = room.players.get('p0');
    assert.ok(chat.readableChannels(room, mafia).includes('mafia'));
  });
});
