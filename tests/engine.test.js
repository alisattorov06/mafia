import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEngine, fakeRoom, setRoles, startAndReveal, runNight } from './helpers.js';
import { buildRoleDeck } from '../src/game/roleBalancer.js';
import { ROLES, TEAM } from '../src/game/roles.js';
import { teamOfRole } from '../src/game/roleBalancer.js';
import { GameError, errorCodes } from '../src/utils/errors.js';

const engine = makeEngine();

test('role balancer produces correct team distribution for 6..20 players', () => {
  for (let n = 6; n <= 20; n += 1) {
    const deck = buildRoleDeck(n, { mode: 'CLASSIC' });
    assert.equal(deck.length, n, `deck length for ${n}`);
    const mafia = deck.filter((r) => teamOfRole(r) === TEAM.MAFIA).length;
    const expected = Math.max(1, Math.floor(n / 4));
    assert.equal(mafia, expected, `mafia count for ${n}`);
    assert.ok(deck.includes(ROLES.DOCTOR));
    assert.ok(deck.includes(ROLES.DETECTIVE));
  }
});

test('don appears at 10+ classic players', () => {
  const deck8 = buildRoleDeck(8, { mode: 'CLASSIC' });
  const deck10 = buildRoleDeck(10, { mode: 'CLASSIC' });
  assert.ok(!deck8.includes(ROLES.DON));
  assert.ok(deck10.includes(ROLES.DON));
});

test('custom mode honors toggles and mafia count', () => {
  const deck = buildRoleDeck(6, {
    mode: 'CUSTOM',
    mafiaCount: 1,
    doctorEnabled: false,
    detectiveEnabled: true,
    donEnabled: false,
    jesterEnabled: false,
    bodyguardEnabled: false
  });
  assert.equal(deck.filter((r) => r === ROLES.MAFIA).length, 1);
  assert.ok(!deck.includes(ROLES.DOCTOR));
  assert.ok(!deck.includes(ROLES.DON));
  assert.ok(deck.includes(ROLES.DETECTIVE));
  assert.equal(deck.filter((r) => r === ROLES.CITIZEN).length, 4);
});

test('mafia kill kills the target at night', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F']);
  startAndReveal(engine, room, { p0: ROLES.MAFIA, p1: ROLES.DOCTOR, p2: ROLES.DETECTIVE });
  assert.equal(room.phase, 'NIGHT_MAFIA');

  engine.mafiaAction(room, 'p0', 'p1');
  runNight(engine, room);

  assert.equal(room.players.get('p1').alive, false);
  assert.equal(room.players.get('p1').eliminationReason, 'NIGHT_KILL');
  assert.equal(room.nightResult.killedId, 'p1');
  assert.equal(room.phase, 'DAY_START');
});

test('doctor save prevents the mafia kill', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F']);
  startAndReveal(engine, room, { p0: ROLES.MAFIA, p1: ROLES.DOCTOR, p2: ROLES.DETECTIVE });

  engine.mafiaAction(room, 'p0', 'p1');
  engine.advancePhase(room); // -> NIGHT_DOCTOR (no bodyguard)
  assert.equal(room.phase, 'NIGHT_DOCTOR');
  engine.doctorAction(room, 'p1', 'p1'); // doctor self-heals
  engine.advancePhase(room); // -> NIGHT_DETECTIVE
  engine.detectiveAction(room, 'p2', 'p0');
  engine.advancePhase(room); // resolve -> DAY_START

  assert.equal(room.nightResult.saved, true);
  assert.equal(room.players.get('p1').alive, true);
  assert.equal(room.stats.successfulSaves, 1);
});

test('doctor cannot protect the same player on consecutive nights when disallowed', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F'], { doctorRepeatProtect: false });
  startAndReveal(engine, room, { p0: ROLES.MAFIA, p1: ROLES.DOCTOR, p2: ROLES.DETECTIVE });

  engine.mafiaAction(room, 'p0', 'p3');
  engine.advancePhase(room);
  engine.doctorAction(room, 'p1', 'p3');
  engine.advancePhase(room);
  engine.detectiveAction(room, 'p2', 'p0');
  engine.advancePhase(room);
  engine.advancePhase(room); // DAY_START -> DISCUSSION
  engine.advancePhase(room); // -> VOTING
  // advance votes with no elimination
  for (const p of room.players.values()) if (p.alive) engine.castVote(room, p.id, null);
  engine.advancePhase(room); // VOTE_RESULT
  engine.advancePhase(room); // -> NIGHT_MAFIA round 2

  engine.mafiaAction(room, 'p0', 'p3');
  engine.advancePhase(room);
  assert.equal(room.phase, 'NIGHT_DOCTOR');
  assert.throws(() => engine.doctorAction(room, 'p1', 'p3'), (e) => e.code === errorCodes.INVALID_ACTION);
});

test('detective investigation returns correct result', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F']);
  startAndReveal(engine, room, { p0: ROLES.MAFIA, p1: ROLES.DOCTOR, p2: ROLES.DETECTIVE });

  engine.mafiaAction(room, 'p0', 'p1');
  engine.advancePhase(room);
  engine.doctorAction(room, 'p1', 'p1');
  engine.advancePhase(room);
  engine.detectiveAction(room, 'p2', 'p0');
  assert.equal(room.detectiveResult.targetId, 'p0');
  assert.equal(room.detectiveResult.isMafia, true);

  engine.advancePhase(room);
  assert.equal(room.phase, 'DAY_START');
});

test('don reads as NOT MAFIA when immunity is enabled', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F']);
  startAndReveal(engine, room, { p0: ROLES.DON, p1: ROLES.DOCTOR, p2: ROLES.DETECTIVE });
  engine.mafiaAction(room, 'p0', 'p1');
  engine.advancePhase(room);
  engine.doctorAction(room, 'p1', 'p1');
  engine.advancePhase(room);
  engine.detectiveAction(room, 'p2', 'p0');
  assert.equal(room.detectiveResult.isMafia, false);
});

test('don reads as MAFIA when immunity is disabled', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F'], { donImmuneToDetective: false });
  startAndReveal(engine, room, { p0: ROLES.DON, p1: ROLES.DOCTOR, p2: ROLES.DETECTIVE });
  engine.mafiaAction(room, 'p0', 'p1');
  engine.advancePhase(room);
  engine.doctorAction(room, 'p1', 'p1');
  engine.advancePhase(room);
  engine.detectiveAction(room, 'p2', 'p0');
  assert.equal(room.detectiveResult.isMafia, true);
});

test('bodyguard dies in place of the guarded target', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  startAndReveal(engine, room, { p0: ROLES.MAFIA, p1: ROLES.DOCTOR, p2: ROLES.DETECTIVE, p3: ROLES.BODYGUARD });

  engine.mafiaAction(room, 'p0', 'p2');
  engine.advancePhase(room); // NIGHT_BODYGUARD
  assert.equal(room.phase, 'NIGHT_BODYGUARD');
  engine.bodyguardAction(room, 'p3', 'p2');
  engine.advancePhase(room); // NIGHT_DOCTOR
  engine.doctorAction(room, 'p1', 'p1');
  engine.advancePhase(room); // NIGHT_DETECTIVE
  engine.detectiveAction(room, 'p2', 'p0');
  engine.advancePhase(room); // resolve

  assert.equal(room.players.get('p2').alive, true, 'guarded target survives');
  assert.equal(room.players.get('p3').alive, false, 'bodyguard dies');
  assert.equal(room.nightResult.bodyguardDied, 'p3');
});

test('mafia majority rule resolves the most-proposed target', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F']);
  startAndReveal(engine, room, { p0: ROLES.MAFIA, p1: ROLES.MAFIA, p2: ROLES.DOCTOR, p3: ROLES.DETECTIVE });

  engine.mafiaAction(room, 'p0', 'p4');
  engine.mafiaAction(room, 'p1', 'p4');
  engine.advancePhase(room);
  engine.doctorAction(room, 'p2', 'p2');
  engine.advancePhase(room);
  engine.detectiveAction(room, 'p3', 'p0');
  engine.advancePhase(room);

  assert.equal(room.nightResult.killedId, 'p4');
});

test('town wins when the last mafia is voted out', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F']);
  startAndReveal(engine, room, { p0: ROLES.MAFIA, p1: ROLES.DOCTOR, p2: ROLES.DETECTIVE });

  engine.mafiaAction(room, 'p0', 'p1');
  engine.advancePhase(room);
  engine.doctorAction(room, 'p1', 'p1');
  engine.advancePhase(room);
  engine.detectiveAction(room, 'p2', 'p0');
  engine.advancePhase(room);
  engine.advancePhase(room); // DAY_START -> DISCUSSION
  engine.advancePhase(room); // -> VOTING

  // Everyone votes out the mafia (p0). The mafia cannot self-vote.
  for (const p of room.players.values()) if (p.alive) engine.castVote(room, p.id, p.id === 'p0' ? null : 'p0');
  engine.advancePhase(room); // -> VOTE_RESULT
  assert.equal(room.computedVote.eliminatedId, 'p0');
  engine.advancePhase(room); // afterVoteResult

  assert.equal(room.phase, 'GAME_OVER');
  assert.equal(room.winner, 'TOWN');
});

test('jester wins when voted out during the day', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F']);
  startAndReveal(engine, room, { p0: ROLES.MAFIA, p1: ROLES.DOCTOR, p2: ROLES.DETECTIVE, p3: ROLES.JESTER });

  engine.mafiaAction(room, 'p0', 'p4');
  engine.advancePhase(room);
  engine.doctorAction(room, 'p1', 'p1');
  engine.advancePhase(room);
  engine.detectiveAction(room, 'p2', 'p0');
  engine.advancePhase(room);
  engine.advancePhase(room); // DISCUSSION
  engine.advancePhase(room); // VOTING

  for (const p of room.players.values()) if (p.alive) engine.castVote(room, p.id, p.id === 'p3' ? null : 'p3');
  engine.advancePhase(room); // VOTE_RESULT
  engine.advancePhase(room); // afterVoteResult

  assert.equal(room.phase, 'GAME_OVER');
  assert.equal(room.winner, 'JESTER');
});

test('mafia wins at parity after a night kill', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F']);
  startAndReveal(engine, room, { p0: ROLES.MAFIA, p1: ROLES.MAFIA, p2: ROLES.DOCTOR, p3: ROLES.DETECTIVE });

  // Kill the detective and doctor over two nights to reach parity:
  // night 1 kill p3 (detective) -> mafia 2, town (p2,p4,p5) 3
  engine.mafiaAction(room, 'p0', 'p3');
  engine.advancePhase(room);
  engine.doctorAction(room, 'p2', 'p2');
  engine.advancePhase(room);
  engine.detectiveAction(room, 'p3', 'p0');
  engine.advancePhase(room);
  assert.equal(room.phase, 'DAY_START');

  engine.advancePhase(room);
  engine.advancePhase(room); // DISCUSSION -> VOTING
  for (const p of room.players.values()) if (p.alive) engine.castVote(room, p.id, null);
  engine.advancePhase(room); // VOTE_RESULT
  engine.advancePhase(room); // -> NIGHT_MAFIA round 2

  // night 2 kill p2 (doctor) -> mafia 2, town 2 -> parity -> mafia wins.
  // The Detective died on night 1, so the detective phase is skipped.
  engine.mafiaAction(room, 'p0', 'p2');
  engine.advancePhase(room);
  assert.equal(room.phase, 'NIGHT_DOCTOR');
  engine.doctorAction(room, 'p2', 'p4');
  engine.advancePhase(room); // resolve -> parity

  assert.equal(room.phase, 'GAME_OVER');
  assert.equal(room.winner, 'MAFIA');
});

test('voting tie with tieRule=none causes no elimination', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F'], { tieRule: 'none' });
  startAndReveal(engine, room, { p0: ROLES.MAFIA, p1: ROLES.DOCTOR, p2: ROLES.DETECTIVE });

  engine.mafiaAction(room, 'p0', 'p5');
  engine.advancePhase(room);
  engine.doctorAction(room, 'p1', 'p1');
  engine.advancePhase(room);
  engine.detectiveAction(room, 'p2', 'p0');
  engine.advancePhase(room);
  engine.advancePhase(room); // DISCUSSION
  engine.advancePhase(room); // VOTING

  // A,B vote p3; C,D vote p4; E abstains -> tie on p3/p4 with 2 each.
  engine.castVote(room, 'p0', 'p3');
  engine.castVote(room, 'p1', 'p3');
  engine.castVote(room, 'p2', 'p4');
  engine.castVote(room, 'p3', 'p4');
  engine.castVote(room, 'p4', null);
  engine.advancePhase(room); // VOTE_RESULT

  assert.equal(room.computedVote.tie, true);
  assert.equal(room.computedVote.eliminatedId, null);
  engine.advancePhase(room); // afterVoteResult -> no elimination -> next night
  assert.equal(room.phase, 'NIGHT_MAFIA');
  assert.equal(room.players.get('p3').alive, true);
  assert.equal(room.players.get('p4').alive, true);
});

test('voting tie with tieRule=runoff re-opens voting among the tied', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F'], { tieRule: 'runoff' });
  startAndReveal(engine, room, { p0: ROLES.MAFIA, p1: ROLES.DOCTOR, p2: ROLES.DETECTIVE });

  engine.mafiaAction(room, 'p0', 'p3');
  engine.advancePhase(room);
  engine.doctorAction(room, 'p1', 'p1');
  engine.advancePhase(room);
  engine.detectiveAction(room, 'p2', 'p0');
  engine.advancePhase(room);
  engine.advancePhase(room); // DISCUSSION
  engine.advancePhase(room); // VOTING

  // p0,p1 -> p4 ; p2,p4 -> p5 ; p5 -> p0  => tie between p4 and p5.
  engine.castVote(room, 'p0', 'p4');
  engine.castVote(room, 'p1', 'p4');
  engine.castVote(room, 'p2', 'p5');
  engine.castVote(room, 'p4', 'p5');
  engine.castVote(room, 'p5', 'p0');
  engine.advancePhase(room); // VOTE_RESULT
  assert.equal(room.computedVote.tie, true);
  assert.deepEqual(new Set(room.computedVote.runoff), new Set(['p4', 'p5']));

  engine.advancePhase(room); // afterVoteResult -> runoff -> back to VOTING
  assert.equal(room.phase, 'VOTING');
  assert.deepEqual(new Set(room.votingCandidates), new Set(['p4', 'p5']));

  // Runoff: everyone but p5 votes p5.
  for (const p of room.players.values()) if (p.alive) engine.castVote(room, p.id, p.id === 'p5' ? null : 'p5');
  engine.advancePhase(room); // VOTE_RESULT
  assert.equal(room.computedVote.eliminatedId, 'p5');
  engine.advancePhase(room); // afterVoteResult -> next night (p5 was a citizen)
  assert.equal(room.phase, 'NIGHT_MAFIA');
  assert.equal(room.players.get('p5').alive, false);
});

test('dead players cannot vote and their votes are dropped', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F']);
  startAndReveal(engine, room, { p0: ROLES.MAFIA, p1: ROLES.DOCTOR, p2: ROLES.DETECTIVE });

  engine.mafiaAction(room, 'p0', 'p4');
  engine.advancePhase(room);
  engine.doctorAction(room, 'p1', 'p1');
  engine.advancePhase(room);
  engine.detectiveAction(room, 'p2', 'p0');
  engine.advancePhase(room); // resolve -> p4 dies
  assert.equal(room.players.get('p4').alive, false);

  engine.advancePhase(room); // DISCUSSION
  engine.advancePhase(room); // VOTING

  // Dead player p4 cannot cast a vote.
  assert.throws(() => engine.castVote(room, 'p4', 'p0'), (e) => e.code === errorCodes.DEAD_PLAYER);

  // Dead vote recorded directly is dropped.
  room.votes.set('p4', 'p0');
  for (const p of room.players.values()) {
    if (p.id !== 'p4' && p.alive) engine.castVote(room, p.id, p.id === 'p0' ? null : 'p0');
  }
  engine.advancePhase(room); // VOTE_RESULT
  const rows = room.computedVote.counts.get('p0');
  assert.equal(rows, 4, 'only the 4 living non-mafia votes count');
});

test('citizen cannot act as mafia; doctor cannot act in detective phase', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F']);
  startAndReveal(engine, room, { p0: ROLES.MAFIA, p1: ROLES.DOCTOR, p2: ROLES.DETECTIVE });

  // Citizen tries to propose a mafia kill.
  assert.throws(() => engine.mafiaAction(room, 'p3', 'p1'), (e) => e.code === errorCodes.INVALID_ROLE);

  engine.mafiaAction(room, 'p0', 'p1');
  engine.advancePhase(room); // -> NIGHT_DOCTOR
  // Detective tries to act during doctor phase.
  assert.throws(() => engine.detectiveAction(room, 'p2', 'p0'), (e) => e.code === errorCodes.INVALID_PHASE);
});

test('cannot target a dead player', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F']);
  startAndReveal(engine, room, { p0: ROLES.MAFIA, p1: ROLES.DOCTOR, p2: ROLES.DETECTIVE });

  room.players.get('p4').alive = false;
  assert.throws(() => engine.mafiaAction(room, 'p0', 'p4'), (e) => e.code === errorCodes.INVALID_ACTION);
});

test('mafia cannot target themselves', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F']);
  startAndReveal(engine, room, { p0: ROLES.MAFIA, p1: ROLES.DOCTOR, p2: ROLES.DETECTIVE });
  assert.throws(() => engine.mafiaAction(room, 'p0', 'p0'), (e) => e.code === errorCodes.INVALID_ACTION);
});

test('rematch resets the room and deals fresh roles', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F']);
  startAndReveal(engine, room, { p0: ROLES.MAFIA, p1: ROLES.DOCTOR, p2: ROLES.DETECTIVE });

  // Simulate game end.
  engine.endGame(room, 'TOWN', 'TOWN', 'test');
  assert.equal(room.phase, 'GAME_OVER');

  engine.resetForRematch(room);
  assert.equal(room.phase, 'ROLE_REVEAL');
  assert.equal(room.status, 'PLAYING');
  assert.equal(room.winner, null);
  for (const p of room.players.values()) {
    assert.equal(p.alive, true);
    assert.ok(p.role, 'a new role was dealt');
  }
  // Fresh, full deck.
  const roles = [...room.players.values()].map((p) => p.role);
  assert.equal(roles.length, 6);
  assert.ok(roles.includes(ROLES.MAFIA));
});

test('returnToLobby resets the room back to the lobby', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F']);
  startAndReveal(engine, room, { p0: ROLES.MAFIA, p1: ROLES.DOCTOR, p2: ROLES.DETECTIVE });
  engine.endGame(room, 'MAFIA', 'MAFIA', 'parity');
  engine.returnToLobby(room);
  assert.equal(room.phase, 'LOBBY');
  assert.equal(room.status, 'WAITING');
  for (const p of room.players.values()) assert.equal(p.role, null);
});

test('invalid transitions are rejected', () => {
  const room = fakeRoom(['A', 'B', 'C', 'D', 'E', 'F']);
  room.phase = 'DISCUSSION';
  assert.throws(() => engine.startGame(room), (e) => e instanceof GameError);
  assert.throws(() => engine.transition(room, 'LOBBY'), (e) => e instanceof Error && /transition/i.test(e.message));
});
