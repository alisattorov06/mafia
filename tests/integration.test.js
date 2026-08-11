import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { io as ioClient } from 'socket.io-client';
import { createServer } from '../src/server.js';
import { PHASES } from '../src/config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn, { timeout = 8000, interval = 50 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (fn()) return true;
    await sleep(interval);
  }
  return false;
}

class Agent {
  constructor(socket, name) {
    this.socket = socket;
    this.name = name;
    this.gameStates = [];
    this.lobbyStates = [];
    this.chatMessages = [];
    this.errors = [];
    socket.on('game:state', (s) => this.gameStates.push(s));
    socket.on('lobby:state', (s) => this.lobbyStates.push(s));
    socket.on('chat:message', (m) => this.chatMessages.push(m));
    socket.on('error', (e) => this.errors.push(e));
  }
  get state() {
    return this.gameStates[this.gameStates.length - 1] || null;
  }
  get lobby() {
    return this.lobbyStates[this.lobbyStates.length - 1] || null;
  }
  get id() {
    return this.state?.self?.id || this.lobby?.self?.id;
  }
  get role() {
    return this.state?.self?.role;
  }
  get team() {
    return this.state?.self?.team;
  }
  get phase() {
    return this.state?.phase;
  }
}

const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel'];

describe('end-to-end over real sockets', () => {
  let httpServer;
  let manager;
  let io;
  let base;
  const sockets = [];

  const connect = (token) => {
    const s = ioClient(base, { auth: { token }, transports: ['websocket'], forceNew: true, reconnection: false });
    sockets.push(s);
    return s;
  };

  const closeAll = () => {
    for (const s of sockets.splice(0)) {
      try { s.disconnect(); } catch { /* noop */ }
    }
    for (const code of [...(manager?.rooms?.keys() || [])]) manager?.destroyRoom(code);
  };

  test.beforeEach(() => {
    const created = createServer();
    httpServer = created.httpServer;
    io = created.io;
    manager = created.manager;
    return new Promise((resolve) => httpServer.listen(0, resolve)).then(() => {
      base = `http://127.0.0.1:${httpServer.address().port}`;
    });
  });

  test.afterEach(async () => {
    closeAll();
    await new Promise((resolve) => httpServer.close(resolve));
    await sleep(50);
  });

  after(() => {
    if (io && io._mafiaTicker) clearInterval(io._mafiaTicker);
  });

  async function createRoomWithPlayers(count) {
    const tokens = [];
    const createRes = await fetch(`${base}/api/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: NAMES[0], mode: 'CLASSIC' })
    });
    const created = await createRes.json();
    assert.equal(created.ok, true);
    tokens.push(created.token);
    for (let i = 1; i < count; i += 1) {
      const joinRes = await fetch(`${base}/api/join`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: created.roomCode, name: NAMES[i] })
      });
      const joined = await joinRes.json();
      assert.equal(joined.ok, true);
      tokens.push(joined.token);
    }
    const agents = tokens.map((t, i) => new Agent(connect(t), NAMES[i]));
    const ok = await until(() => agents.every((a) => a.lobby && a.lobby.playerCount === count));
    assert.ok(ok, 'all agents should receive the lobby state');
    return { roomCode: created.roomCode, agents };
  }

  test('public room browser lists only joinable password-free lobbies', async () => {
    const first = await fetch(`${base}/api/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'PublicHost', mode: 'CLASSIC' })
    }).then((res) => res.json());
    const privateRoom = await fetch(`${base}/api/create`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'PrivateHost', mode: 'CLASSIC', password: 'secret' })
    }).then((res) => res.json());

    let listed = await fetch(`${base}/api/rooms`).then((res) => res.json());
    assert.equal(listed.ok, true);
    assert.ok(listed.rooms.some((room) => room.code === first.roomCode));
    assert.ok(!listed.rooms.some((room) => room.code === privateRoom.roomCode));
    const publicRoom = listed.rooms.find((room) => room.code === first.roomCode);
    assert.deepEqual(Object.keys(publicRoom).sort(), ['code', 'createdAt', 'maxPlayers', 'minPlayers', 'mode', 'playerCount']);

    const room = manager.rooms.get(first.roomCode);
    room.phase = PHASES.DISCUSSION;
    listed = await fetch(`${base}/api/rooms`).then((res) => res.json());
    assert.ok(!listed.rooms.some((entry) => entry.code === first.roomCode));
  });

  test('full 8-player game over real sockets: save, detective, voting, town win, chat secrecy', async () => {
    const { roomCode, agents } = await createRoomWithPlayers(8);
    const room = manager.rooms.get(roomCode);
    assert.ok(room);

    // Host starts the game.
    agents[0].socket.emit('room:startGame');
    assert.ok(await until(() => agents.every((a) => a.phase === PHASES.ROLE_REVEAL)), 'all players see ROLE_REVEAL');
    assert.equal(room.phase, PHASES.ROLE_REVEAL);

    // Everyone confirms their secret role, then the reveal ends (mirrors the timer).
    for (const a of agents) a.socket.emit('game:ready');
    await sleep(120);
    if (room.phase === PHASES.ROLE_REVEAL) manager._advance(room);
    assert.equal(room.phase, PHASES.NIGHT_MAFIA);

    const roleOf = (playerId) => room.players.get(playerId).role;
    const mafiaIds = [...room.players.values()].filter((p) => p.team === 'MAFIA').map((p) => p.id);
    const doctorId = [...room.players.values()].find((p) => p.role === 'DOCTOR').id;
    const detectiveId = [...room.players.values()].find((p) => p.role === 'DETECTIVE').id;
    const citizenId = [...room.players.values()].find((p) => p.role === 'CITIZEN').id;
    assert.equal(mafiaIds.length, 2, 'CLASSIC 8-player deck should have 2 mafia');

    const aliveIds = () => [...room.players.values()].filter((p) => p.alive).map((p) => p.id);

    // --- Night 1: mafia targets the doctor (who self-heals) ---
    const mafiaAgents = agents.filter((a) => a.team === 'MAFIA');
    const citizenAgents = agents.filter((a) => a.team === 'TOWN');
    assert.equal(mafiaAgents.length, 2);

    // Chat secrecy while the mafia are choosing.
    mafiaAgents[0].socket.emit('chat:send', { channel: 'mafia', text: 'kill the doctor tonight' });
    const otherMafia = mafiaAgents[1];
    const spy = agents.find((a) => a.id === citizenId);
    assert.ok(
      await until(() => otherMafia.chatMessages.some((m) => m.text.includes('kill the doctor'))),
      'mafia teammate receives mafia chat'
    );
    assert.ok(
      !spy.chatMessages.some((m) => m.text.includes('kill the doctor')),
      'citizen must never receive mafia chat'
    );
    spy.socket.emit('chat:send', { channel: 'mafia', text: 'i am spying' });
    await sleep(150);
    assert.ok(
      spy.errors.some((e) => e.code === 'INVALID_ACTION'),
      'citizen sending to mafia chat must be rejected'
    );

    for (const id of mafiaIds) {
      const agent = agents.find((a) => a.id === id);
      agent.socket.emit('mafia:target', { targetId: doctorId });
      if (id === mafiaIds[0]) agent.socket.emit('mafia:lock');
    }
    assert.ok(await until(() => room.phase === PHASES.NIGHT_DOCTOR, { timeout: 2000 }));

    const doctorAgent = agents.find((a) => a.id === doctorId);
    doctorAgent.socket.emit('doctor:target', { targetId: doctorId }); // self-heal
    assert.ok(await until(() => room.phase === PHASES.NIGHT_DETECTIVE, { timeout: 2000 }));

    const detectiveAgent = agents.find((a) => a.id === detectiveId);
    detectiveAgent.socket.emit('detective:target', { targetId: mafiaIds[0] });
    assert.ok(await until(() => room.phase === PHASES.DAY_START, { timeout: 2000 }));

    // Doctor self-heal saved them; detective learned the truth.
    const docView = doctorAgent.state;
    assert.equal(docView.morning.saved, true, 'doctor must have been saved');
    assert.equal(docView.morning.killedId, null);
    const detView = detectiveAgent.state;
    assert.equal(detView.detectiveResult.targetId, mafiaIds[0]);
    assert.equal(detView.detectiveResult.isMafia, true);

    // --- Day 1: town votes the mafia out ---
    manager._advance(room); // DAY_START -> DISCUSSION
    manager._advance(room); // DISCUSSION -> VOTING
    assert.equal(room.phase, PHASES.VOTING);
    const votingTarget = mafiaIds[0];
    for (const a of agents) {
      if (room.players.get(a.id)?.alive) {
        a.socket.emit('vote:cast', { targetId: a.id === votingTarget ? null : votingTarget });
      }
    }
    assert.ok(await until(() => room.phase !== PHASES.VOTING, { timeout: 2000 }));
    if (room.phase === PHASES.VOTE_RESULT) manager._advance(room); // apply elimination
    assert.equal(room.phase, PHASES.NIGHT_MAFIA, 'round 2 starts after the vote');
    assert.equal(roleOf(votingTarget), 'MAFIA');
    assert.equal(room.players.get(votingTarget).alive, false);
    const elimState = detectiveAgent.gameStates.filter((s) => s.phase === PHASES.VOTE_RESULT).pop();
    assert.ok(elimState, 'vote result must be broadcast');
    assert.equal(elimState.elimination.reveal, true);
    assert.equal(elimState.elimination.role, 'MAFIA');

    // --- Night 2: mafia kills the detective; doctor guards a citizen ---
    const mafiaLeft = aliveIds().filter((id) => roleOf(id) === 'MAFIA')[0];
    const mafiaLeftAgent = agents.find((a) => a.id === mafiaLeft);
    mafiaLeftAgent.socket.emit('mafia:target', { targetId: detectiveId });
    assert.ok(await until(() => room.phase === PHASES.NIGHT_DOCTOR, { timeout: 2000 }));
    doctorAgent.socket.emit('doctor:target', { targetId: citizenId });
    assert.ok(await until(() => room.phase === PHASES.NIGHT_DETECTIVE, { timeout: 2000 }));
    // The detective is still alive at this point (kills resolve after the phase).
    detectiveAgent.socket.emit('detective:target', { targetId: mafiaLeft });
    assert.ok(await until(() => room.phase === PHASES.DAY_START, { timeout: 2000 }));
    assert.equal(room.players.get(detectiveId).alive, false, 'detective dies in night 2');
    assert.equal(room.players.get(doctorId).alive, true);

    // --- Day 2: vote the last mafia out -> TOWN wins ---
    manager._advance(room);
    manager._advance(room);
    assert.equal(room.phase, PHASES.VOTING);
    const lastMafia = aliveIds().filter((id) => roleOf(id) === 'MAFIA')[0];
    for (const a of agents) {
      if (room.players.get(a.id)?.alive) {
        a.socket.emit('vote:cast', { targetId: a.id === lastMafia ? null : lastMafia });
      }
    }
    assert.ok(await until(() => room.phase !== PHASES.VOTING, { timeout: 2000 }));
    if (room.phase === PHASES.VOTE_RESULT) manager._advance(room);
    assert.equal(room.phase, PHASES.GAME_OVER, 'game ends by day vote');
    assert.equal(room.winner, 'TOWN');

    // Audit: no non-mafia player ever saw a teammates list or another player's role.
    for (const a of agents) {
      if (a.team === 'MAFIA') continue;
      for (const s of a.gameStates) {
        assert.equal(s.teammates, undefined, 'non-mafia must never see teammates');
        assert.equal(s.mafiaPanel, undefined, 'non-mafia must never see the mafia panel');
        if (a.id !== detectiveId) {
          assert.equal(s.detectiveResult, undefined, 'only the detective sees investigation results');
        }
        for (const p of s.players) {
          assert.ok(!('role' in p) && !('team' in p), 'player list must never carry roles/teams');
        }
      }
    }
  });

  test('host migration on disconnect, rematch re-deals roles', async () => {
    const { roomCode, agents } = await createRoomWithPlayers(6);
    const room = manager.rooms.get(roomCode);
    const oldHost = agents[0];
    assert.equal(room.hostId, oldHost.id);

    // Host goes offline; another player must inherit host.
    oldHost.socket.disconnect();
    const ok = await until(() => room.hostId !== oldHost.id);
    assert.ok(ok, 'host should migrate');
    const newHost = agents.find((a) => a.id === room.hostId);
    assert.ok(newHost, 'new host is a real player');

    // Start and finish a quick game via the engine, then rematch over sockets.
    agents[1].socket.emit('room:startGame');
    assert.ok(await until(() => room.phase === PHASES.ROLE_REVEAL));
    for (const a of agents) a.socket.emit('game:ready');
    await sleep(120);
    if (room.phase === PHASES.ROLE_REVEAL) manager._advance(room);
    assert.equal(room.phase, PHASES.NIGHT_MAFIA);

    // Force an immediate mafia win so we can test the rematch flow.
    manager.engine.endGame(room, 'MAFIA', 'MAFIA', 'Forced for test.');
    manager.afterPhaseChange(room);
    assert.equal(room.phase, PHASES.GAME_OVER);

    newHost.socket.emit('game:rematch');
    assert.ok(await until(() => room.phase === PHASES.ROLE_REVEAL, { timeout: 2000 }), 'rematch re-enters role reveal');
    const connected = agents.slice(1);
    const rolesAfter = connected.map((a) => a.state?.self?.role).filter(Boolean);
    assert.equal(rolesAfter.length, connected.length, 'every connected player got a new role');
    assert.ok(room.players.get(newHost.id).alive, 'players are alive again after rematch');

    // Roles were re-dealt; drive straight into night to confirm playability.
    for (const a of agents) a.socket.emit('game:ready');
    await sleep(120);
    if (room.phase === PHASES.ROLE_REVEAL) manager._advance(room);
    assert.equal(room.phase, PHASES.NIGHT_MAFIA);
    assert.equal(room.round, 1);
  });

  test('room:leave removes the player and destroys the room when empty', async () => {
    const { roomCode, agents } = await createRoomWithPlayers(3);
    assert.ok(manager.rooms.has(roomCode));
    agents[0].socket.emit('room:leave');
    await sleep(150);
    assert.equal(manager.rooms.get(roomCode)?.players.size, 2);
    for (const a of agents.slice(1)) a.socket.emit('room:leave');
    await sleep(150);
    assert.ok(!manager.rooms.has(roomCode), 'room is destroyed when empty');
  });

  test('host can update settings in the lobby; invalid settings are rejected', async () => {
    const { agents } = await createRoomWithPlayers(7);
    const host = agents[0];

    host.socket.emit('room:updateSettings', {
      settings: { discussionDuration: 60, maxPlayers: 8 }
    });
    const applied = await until(() => host.lobby?.settings?.discussionDuration === 60);
    assert.ok(applied, 'lobby should reflect the new settings without an error');
    assert.equal(host.errors.length, 0, 'no error should be emitted');

    host.socket.emit('room:updateSettings', {
      settings: { maxPlayers: 6 }
    });
    const rejected = await until(() => host.errors.length > 0);
    assert.ok(rejected, 'lowering maxPlayers below the current player count must fail');
    assert.equal(host.errors[host.errors.length - 1].code, 'INVALID_SETTINGS');
  });
});
