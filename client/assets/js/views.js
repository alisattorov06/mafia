import { ROLE_META, TEAM_META, roleSvg, teamColor } from './roles.js';

export const PHASE_TITLES = {
  LOBBY: 'Ante Room',
  ROLE_REVEAL: 'The Envelope',
  NIGHT_MAFIA: 'The Family Meets',
  NIGHT_DOCTOR: 'The Doctor Rounds',
  NIGHT_DETECTIVE: 'The Detective Watches',
  NIGHT_BODYGUARD: 'The Bodyguard Stands Guard',
  DAY_START: 'First Light',
  DISCUSSION: 'The Town Speaks',
  VOTING: 'The Vote',
  VOTE_RESULT: 'The Verdict',
  GAME_OVER: 'The Reckoning'
};

export const PHASE_SUBTITLES = {
  NIGHT_MAFIA: 'Someone is not safe tonight.',
  NIGHT_DOCTOR: 'A quiet tread in the corridor…',
  NIGHT_DETECTIVE: 'One suspect. One truth.',
  NIGHT_BODYGUARD: 'Protect the innocent.',
  DAY_START: 'The sun finds the bodies.',
  DISCUSSION: 'Weigh every word. Someone is lying.',
  VOTING: 'Cast your ballot. The town will decide.',
  VOTE_RESULT: 'The town has spoken.'
};

export function esc(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function phaseIsNight(phase) {
  return !!phase && phase.startsWith('NIGHT_');
}

/* ------------------------------------------------------------- shared bits */

function chip(player, { selected = false, blood = false, hostId = null } = {}) {
  const cls = ['chip', 'rounded-sm px-3 py-2 flex items-center gap-2 text-sm select-none'];
  if (!player.alive) cls.push('dead');
  if (player.offline) cls.push('offline');
  if (selected) cls.push(blood ? 'selected-blood' : 'selected');
  const mark = player.alive ? (player.offline ? '◌' : '●') : '✕';
  const host = player.id === hostId ? ' <span class="text-brass">★</span>' : '';
  return `<button type="button" class="${cls.join(' ')}" data-pid="${esc(player.id)}">
    <span class="text-[10px] font-mono ${player.alive ? 'text-dim' : 'text-blood'}">${mark}</span>
    <span class="truncate">${esc(player.name)}${host}</span>
  </button>`;
}

function playerGrid(players, hostId) {
  return `<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${players.map((p) => chip(p, { hostId })).join('')}</div>`;
}

function panel(title, inner, className = '') {
  return `<section class="panel panel-corner p-5 md:p-6 ${className}">${inner}</section>`;
}

function countdown(msLeft) {
  if (msLeft == null) return '—';
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ------------------------------------------------------------- lobby */

export function lobbyView(state, A, opts) {
  const me = state.self;
  const isHost = me.isHost;
  const enough = state.playerCount >= state.minPlayers;

  const playerList = playerGrid(state.players, state.hostId);

  const kickBtns = isHost
    ? state.players
        .filter((p) => p.id !== me.id)
        .map((p) => `<button class="btn text-xs px-2 py-1 btn-blood" data-kick="${esc(p.id)}">Kick</button>`)
        .join('')
    : '';

  const hostControls = isHost
    ? `<div class="flex flex-wrap gap-2 mt-5">
         <button id="start-btn" class="btn btn-primary" ${enough ? '' : 'disabled'} title="${enough ? '' : `Need ${state.minPlayers} players`}">
           Start the game
         </button>
         <button id="settings-btn" class="btn">House rules</button>
       </div>
       <p class="font-mono text-[11px] text-dim mt-3 ${enough ? '' : 'text-blood'}">
         ${enough ? `${state.playerCount}/${state.maxPlayers} seated · minimum ${state.minPlayers}` : `Waiting for ${state.minPlayers - state.playerCount} more player(s)…`}
       </p>`
    : `<p class="font-mono text-[11px] text-dim mt-5">The host will deal the cards when ${state.minPlayers} players are seated.</p>`;

  return `
    <div class="max-w-3xl mx-auto fade-up">
      <div class="flex items-center justify-between flex-wrap gap-3 mb-6">
        <div>
          <div class="mono-tag mb-1">Room</div>
          <div class="font-mono text-3xl md:text-4xl tracking-[.4em] text-brass-bright" style="text-shadow:0 0 24px rgba(214,161,75,.35)">${esc(state.roomCode)}</div>
        </div>
        <button id="copy-link" class="btn text-sm">Copy invite</button>
      </div>

      <div class="flex items-center justify-between mb-3">
        <div class="mono-tag">The Table · ${state.playerCount}</div>
        <div class="mono-tag text-dim">${esc(state.mode)} room</div>
      </div>
      <div class="reveal-stagger">${playerList}</div>

      ${hostControls}
      ${state.settings ? settingsSheet(state, opts) : ''}
    </div>`;
}

function settingsSheet(state, opts) {
  const s = state.settings;
  const toggles = [
    ['doctorEnabled', 'Doctor'],
    ['detectiveEnabled', 'Detective'],
    ['donEnabled', 'Don'],
    ['jesterEnabled', 'Jester'],
    ['bodyguardEnabled', 'Bodyguard'],
    ['roleReveal', 'Reveal roles when eliminated'],
    ['anonymousVoting', 'Anonymous ballot'],
    ['selfVote', 'Allow voting for yourself'],
    ['doctorSelfHeal', 'Doctor may heal self'],
    ['doctorRepeatProtect', 'Doctor may repeat protection'],
    ['bodyguardDiesForTarget', 'Bodyguard dies for their target'],
    ['donImmuneToDetective', 'Don invisible to the Detective'],
    ['deadChatEnabled', 'Dead may chat'],
    ['spectatorMode', 'Spectator mode for the dead']
  ];
  const strs = [
    ['tieRule', 'Tie rule', { none: 'No one hangs', runoff: 'Runoff ballot', random: 'Random pick' }],
    ['mafiaKillRule', 'Kill decision', { majority: 'Majority', don: 'The Don decides', random: 'Random' }]
  ];
  const nums = [
    ['nightDuration', 'Night (s)'],
    ['discussionDuration', 'Discussion (s)'],
    ['votingDuration', 'Voting (s)'],
    ['morningDuration', 'Morning (s)'],
    ['roleRevealDuration', 'Role reveal (s)']
  ];

  const inner = `
    <div class="mono-tag mb-4">House Rules</div>
    <div class="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      ${toggles
        .map(
          ([key, label]) => `
        <label class="flex items-center gap-3 py-1 cursor-pointer select-none">
          <input type="checkbox" data-set="${key}" ${s[key] ? 'checked' : ''} class="accent-[#d6a14b] w-4 h-4" />
          <span class="text-sm text-cream/90">${label}</span>
        </label>`
        )
        .join('')}
    </div>
    <div class="hairline-top my-4"></div>
    <div class="grid gap-x-6 gap-y-2 sm:grid-cols-2">
      ${strs
        .map(
          ([key, label, options]) => `
        <label class="flex items-center justify-between gap-3 py-1">
          <span class="text-sm text-cream/90">${label}</span>
          <select data-set="${key}" class="field text-sm py-1.5">
            ${Object.entries(options)
              .map(([v, l]) => `<option value="${v}" ${s[key] === v ? 'selected' : ''}>${l}</option>`)
              .join('')}
          </select>
        </label>`
        )
        .join('')}
      ${nums
        .map(
          ([key, label]) => `
        <label class="flex items-center justify-between gap-3 py-1">
          <span class="text-sm text-cream/90">${label}</span>
          <input type="number" min="5" max="300" data-set="${key}" value="${s[key]}" class="field text-sm py-1.5 w-20 text-right" />
        </label>`
        )
        .join('')}
    </div>`;

  return `<div id="settings-sheet" class="mt-6 panel p-5 hidden">${inner}</div>`;
}

/* ------------------------------------------------------------- role reveal */

export function roleRevealView(state) {
  const r = state.roleReveal;
  const meta = ROLE_META[r.role];
  const color = teamColor(r.team);

  const teammates =
    r.team === 'MAFIA' && r.teammates?.length
      ? `<div class="mt-5 hairline-top pt-4">
           <div class="mono-tag mb-2">Your family</div>
           <div class="flex flex-col gap-1">
             ${r.teammates.map((t) => `<div class="flex items-center justify-between text-sm"><span>${esc(t.name)}</span><span class="text-dim font-mono text-[11px]">${t.alive ? 'alive' : 'dead'}</span></div>`).join('')}
           </div>
         </div>`
      : '';

  return `
    <div class="max-w-md mx-auto flex flex-col items-center fade-in">
      <div class="mono-tag mb-6">Secret · for your eyes only</div>
      <div class="role-card ${state.self.hasSeenRole ? 'flipped' : ''}" id="role-card">
        <div class="role-inner">
          <div class="role-face bg-noir-900 border border-brass/30 flex flex-col items-center justify-center gap-4" style="background:radial-gradient(80% 70% at 50% 30%, #1c1811, #0b0a08)">
            <div class="text-brass">${roleSvg('crown', 'w-10 h-10')}</div>
            <div class="mono-tag">Dealt to ${esc(state.self.name)}</div>
            <div class="text-dim text-sm text-center px-6">Turn the card when the room is quiet.</div>
          </div>
          <div class="role-face role-back flex flex-col items-center justify-between p-7 text-center" style="background:linear-gradient(180deg, #241d12, #14100a);color:${color}">
            <div class="w-full hairline-bottom pb-4 flex justify-between"><span class="mono-tag">Identity</span><span class="mono-tag">${esc(state.roomCode)}</span></div>
            <div class="flex flex-col items-center gap-3 py-4">
              ${roleSvg(r.role, 'w-16 h-16')}
              <div class="font-display text-3xl tracking-wide">${esc(meta.name)}</div>
              <div class="mono-tag" style="color:${color}">${esc(TEAM_META[r.team].label)}</div>
              <p class="text-sm text-cream/75 max-w-[24ch] font-serif-italic text-lg leading-snug">${esc(meta.blurb)}</p>
            </div>
            <div class="w-full">${teammates}</div>
          </div>
        </div>
      </div>
      <button id="seen-btn" class="btn btn-primary mt-8 ${state.self.hasSeenRole ? 'opacity-40 pointer-events-none' : ''}">
        ${state.self.hasSeenRole ? 'Card locked in…' : 'I have seen my role'}
      </button>
    </div>`;
}

/* ------------------------------------------------------------- night */

export function nightView(state, A) {
  const phase = state.phase;
  const self = state.self;
  const players = state.players;
  const alive = players.filter((p) => p.alive);

  const isMafia = self.team === 'MAFIA';
  const roleMatches = (role) => self.role === role;

  let body = '';
  let acting = false;

  if (phase === 'NIGHT_MAFIA') {
    if (isMafia) {
      acting = true;
      const candidates = alive.filter((p) => p.id !== self.id);
      const panelRows = (state.mafiaPanel || []).map(
        (m) => `
          <div class="flex items-center justify-between text-sm py-1 ${m.locked ? 'text-brass' : ''}">
            <span>${esc(m.name)}</span>
            <span class="font-mono text-[11px] text-dim">
              ${m.targetId ? `${esc(players.find((p) => p.id === m.targetId)?.name || '?')}` : '—'} ${m.locked ? '· locked' : ''}
            </span>
          </div>`
      );
      body = `
        <div class="mono-tag mb-4">Choose who the night swallows</div>
        ${state.finalTarget ? `<div class="mb-4 text-sm text-blood">The family has settled on ${esc(players.find((p) => p.id === state.finalTarget)?.name || 'someone')}.</div>` : ''}
        ${state.myProposal ? `<div class="mb-4 text-sm text-cream/80">Your proposal: <span class="text-brass">${esc(players.find((p) => p.id === state.myProposal)?.name || '?')}</span></div>` : ''}
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-5">${candidates.map((p) => chip(p, { selected: state.myProposal === p.id, blood: true })).join('')}</div>
        <div class="mb-5">
          <button id="lock-btn" class="btn" ${state.locked ? 'disabled' : ''}>${state.locked ? 'Locked in' : 'Lock my vote'}</button>
        </div>
        ${panelRows.length ? `<div class="panel p-4 max-w-sm"><div class="mono-tag mb-2">At the table</div>${panelRows.join('')}</div>` : ''}`;
    } else {
      body = sleeping('The Family is deciding. Do not make a sound.');
    }
  } else if (phase === 'NIGHT_DOCTOR') {
    if (roleMatches('DOCTOR')) {
      acting = true;
      const candidates = alive.filter((p) => state.settings.doctorSelfHeal || p.id !== self.id);
      body = `
        <div class="mono-tag mb-4">Whose life do you shield?</div>
        ${state.night?.lastTarget ? `<div class="mb-4 text-sm text-dim">Last night you protected ${esc(players.find((p) => p.id === state.night.lastTarget)?.name || 'no one')}.</div>` : ''}
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${candidates.map((p) => chip(p, { selected: state.night?.myTarget === p.id })).join('')}</div>`;
    } else {
      body = sleeping('The Doctor moves in the dark.');
    }
  } else if (phase === 'NIGHT_DETECTIVE') {
    if (roleMatches('DETECTIVE')) {
      acting = true;
      const candidates = alive.filter((p) => p.id !== self.id);
      body = `
        <div class="mono-tag mb-4">Choose one suspect</div>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${candidates.map((p) => chip(p, { selected: state.night?.myTarget === p.id })).join('')}</div>`;
    } else {
      body = sleeping('The Detective studies the darkness.');
    }
  } else if (phase === 'NIGHT_BODYGUARD') {
    if (roleMatches('BODYGUARD')) {
      acting = true;
      const candidates = alive.filter((p) => p.id !== self.id);
      body = `
        <div class="mono-tag mb-4">Guard a life with yours</div>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${candidates.map((p) => chip(p, { selected: state.night?.myTarget === p.id })).join('')}</div>`;
    } else {
      body = sleeping('The Bodyguard stands in the doorway.');
    }
  }

  return `
    <div class="max-w-3xl mx-auto fade-in">
      <div class="text-center mb-8">
        <div class="mx-auto w-16 h-16 text-brass moon mb-4">${roleSvg('moon', 'w-16 h-16')}</div>
        <h2 class="font-display text-3xl md:text-4xl tracking-wide">${PHASE_TITLES[phase]}</h2>
        <p class="font-serif-italic text-brass text-lg mt-2">${PHASE_SUBTITLES[phase] || ''}</p>
      </div>
      <div class="panel panel-corner p-6">
        ${body}
        ${acting ? '' : `<div class="text-sm text-dim mt-4">The room waits on its actors. The night will not end until they decide.</div>`}
      </div>
      ${isMafia && phase === 'NIGHT_MAFIA' ? `<div class="mono-tag mt-4 text-center opacity-60">The family sees you. Trust no one else.</div>` : ''}
    </div>`;

  function sleeping(text) {
    return `
      <div class="flex flex-col items-center gap-4 py-8 text-center">
        <div class="text-dim">${roleSvg('moon', 'w-10 h-10 opacity-60')}</div>
        <p class="font-serif-italic text-2xl text-cream/80">${text}</p>
        ${!self.alive ? '<p class="mono-tag mt-2">You are beyond the veil — watch, and wait.</p>' : ''}
      </div>`;
  }
}

/* ------------------------------------------------------------- day */

export function morningView(state) {
  const m = state.morning;
  const pieces = [];
  if (m) {
    if (m.saved) {
      pieces.push(`<div class="stamp stamp-saved">Saved</div>`);
    }
    if (m.bodyguardDiedId) {
      const bg = state.players.find((p) => p.id === m.bodyguardDiedId);
      pieces.push(`<div class="stamp mt-3">The guard fell</div><p class="text-sm text-cream/85 mt-2">${esc(bg?.name || 'The Bodyguard')} gave their life shielding another.</p>`);
    }
    if (m.killedId) {
      pieces.push(`<div class="stamp">Hanged in the dark</div>`);
    } else if (!m.saved && !m.bodyguardDiedId) {
      pieces.push(`<div class="stamp stamp-saved">A quiet night</div><p class="text-sm text-cream/85 mt-2">No one was taken.</p>`);
    }
  }

  return `
    <div class="max-w-xl mx-auto fade-in text-center">
      <h2 class="font-display text-3xl md:text-4xl tracking-wide mb-6">${PHASE_TITLES.DAY_START}</h2>
      <div class="panel panel-corner p-8">${pieces.join('')}</div>
    </div>`;
}

export function discussionView(state, A) {
  const dead = state.deadPlayers;
  return `
    <div class="max-w-3xl mx-auto fade-up">
      ${state.morning ? recap() : ''}
      ${dead.length ? `<div class="mb-5"><div class="mono-tag mb-2">Gone from the table</div><div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${dead.map((p) => chip({ ...p, alive: false, offline: false })).join('')}</div></div>` : ''}
      <div class="mb-5"><div class="mono-tag mb-2">At the table · ${state.players.filter((p) => p.alive).length}</div>${playerGrid(state.players, state.roomCode ? null : null)}</div>
      <p class="font-serif-italic text-brass text-xl text-center">Make your case. Someone in this room is lying.</p>
    </div>`;

  function recap() {
    const m = state.morning;
    const lines = [];
    if (m.saved) lines.push(`<span class="text-moss">Someone was saved last night.</span>`);
    if (m.bodyguardDiedId) lines.push(`<span class="text-blood">A bodyguard fell defending the town.</span>`);
    if (m.killedId) lines.push(`<span class="text-blood">${esc(m.killedName || 'Someone')} was found in the night.</span>`);
    if (!lines.length) lines.push(`<span class="text-cream/70">A quiet night. No one was taken.</span>`);
    return `<div class="panel p-4 mb-5 text-sm text-cream/85 flex flex-wrap gap-x-6 gap-y-1">${lines.join(' ')}</div>`;
  }
}

export function votingView(state, A, pending) {
  const v = state.voting;
  const me = state.self;
  const candidates = v.candidates.filter((p) => p.id !== me.id || state.settings.selfVote);
  const sel = pending !== undefined ? pending : v.myVote;
  const voted = v.votedCount ?? 0;

  const targetName = sel ? state.players.find((p) => p.id === sel)?.name : null;

  return `
    <div class="max-w-3xl mx-auto fade-up">
      <div class="flex items-center justify-between mb-6">
        <div class="mono-tag">Ballot · ${voted}/${v.totalVoters} cast</div>
        ${v.runoff ? '<div class="mono-tag text-blood">Runoff ballot</div>' : v.anonymous ? '<div class="mono-tag text-dim">Anonymous</div>' : ''}
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2 reveal-stagger">
        ${candidates.map((p) => chip(p, { selected: sel === p.id, blood: true, hostId: null })).join('')}
      </div>
      <div class="mt-6 flex items-center gap-3 flex-wrap">
        <button id="vote-confirm" class="btn btn-blood" ${sel ? '' : 'disabled'}>
          ${targetName ? `Vote ${esc(targetName)}` : 'Select a candidate'}
        </button>
        <button id="vote-abstain" class="btn ${sel === null ? 'opacity-40' : ''}">Abstain</button>
      </div>
      ${sel === null ? `<p class="mono-tag mt-4 text-dim">You are abstaining.</p>` : ''}
    </div>`;
}

export function voteResultView(state, A) {
  const vr = state.voteResult;
  const elim = state.elimination;
  const anonymous = state.settings.anonymousVoting;

  let rows = '';
  if (vr) {
    rows = vr.rows
      .map((r, i) => {
        const name = anonymous ? `Vote #${i + 1}` : esc(r.name || 'Unknown');
        const pct = vr.totalVotes ? Math.round((r.count / vr.totalVotes) * 100) : 0;
        const isElim = !anonymous && r.playerId === vr.eliminatedId;
        return `
          <div class="flex items-center gap-3 py-1.5 ${isElim ? 'text-blood' : 'text-cream/85'}">
            <span class="w-40 truncate text-sm">${name}</span>
            <div class="flex-1 h-2 bg-noir-950/80 rounded-sm overflow-hidden">
              <div class="h-full rounded-sm" style="width:${pct}%;background:${isElim ? '#c13a2e' : '#d6a14b'}"></div>
            </div>
            <span class="font-mono text-xs">${r.count}</span>
          </div>`;
      })
      .join('');
  }

  let verdict = '';
  if (vr?.runoff) {
    verdict = `<div class="mt-6"><div class="stamp">Tie</div><p class="font-serif-italic text-2xl text-cream/85 mt-4">A deadlock. The vote reopens among the leaders.</p></div>`;
  } else if (vr?.tie) {
    verdict = `<div class="mt-6"><div class="stamp">Tie</div><p class="font-serif-italic text-2xl text-cream/85 mt-4">No one can gather enough trust tonight.</p></div>`;
  } else if (elim) {
    const who = anonymous ? 'The accused' : esc(elim.name);
    const role = elim.reveal ? ` — ${esc(elim.role || '')}` : '';
    verdict = `<div class="mt-6">
      <div class="stamp">${elim.jesterWin ? 'Tricked you all' : 'Eliminated'}</div>
      <p class="font-serif-italic text-3xl text-cream mt-4">${who}${role}</p>
      ${elim.reveal && elim.role ? `<div class="mono-tag mt-2" style="color:${teamColor(elim.team)}">${esc(TEAM_META[elim.team]?.label)}</div>` : ''}
    </div>`;
  }

  return `
    <div class="max-w-xl mx-auto fade-in text-center">
      <h2 class="font-display text-3xl tracking-wide mb-6">${PHASE_TITLES.VOTE_RESULT}</h2>
      <div class="panel panel-corner p-6 text-left">${rows || '<div class="mono-tag">No votes were cast.</div>'}</div>
      ${verdict}
    </div>`;
}

/* ------------------------------------------------------------- game over */

export function gameOverView(state, A) {
  const r = state.results;
  const winner = state.winningTeam || state.winner;
  const color = teamColor(winner);
  const isHost = state.self.isHost;

  const rows = (r.players || []).map(
    (p) => `
      <div class="flex items-center justify-between gap-3 py-1.5 hairline-bottom text-sm">
        <span class="flex items-center gap-2 truncate">
          <span class="font-mono text-[10px] ${p.alive ? 'text-moss' : 'text-blood'}">${p.alive ? '●' : '✕'}</span>
          <span class="truncate">${esc(p.name)}</span>
        </span>
        <span class="flex items-center gap-3 shrink-0">
          <span class="mono-tag text-[10px]" style="color:${teamColor(p.team)}">${esc(p.role)}</span>
          <span class="text-dim font-mono text-[10px] w-20 text-right">${esc(p.result)}</span>
        </span>
      </div>`
  ).join('');

  const hostActions = isHost
    ? `<div class="flex gap-2 flex-wrap justify-center mt-8">
         <button id="rematch-btn" class="btn btn-primary">Rematch</button>
         <button id="lobby-btn" class="btn">Back to the ante room</button>
       </div>`
    : `<div class="mt-8 flex justify-center"><button id="leave-btn" class="btn">Leave the room</button></div>`;

  return `
    <div class="max-w-2xl mx-auto fade-in text-center">
      <div class="mono-tag mb-4">The reckoning</div>
      <div class="font-display text-5xl md:text-6xl tracking-wide mb-2" style="color:${color};text-shadow:0 0 40px ${color}55">${esc(winner)}</div>
      <p class="font-serif-italic text-2xl text-cream/85 mb-8">${esc(state.winReason || 'The night has spoken.')}</p>
      <div class="grid grid-cols-3 gap-3 mb-8">
        <div class="panel p-4"><div class="font-display text-2xl">${r.rounds ?? 0}</div><div class="mono-tag text-[10px] mt-1">nights</div></div>
        <div class="panel p-4"><div class="font-display text-2xl">${r.durationSec ?? 0}s</div><div class="mono-tag text-[10px] mt-1">game length</div></div>
        <div class="panel p-4"><div class="font-display text-2xl">${r.playerCount ?? 0}</div><div class="mono-tag text-[10px] mt-1">players</div></div>
      </div>
      <div class="panel panel-corner p-5 text-left">${rows}</div>
      ${hostActions}
      <button id="leave-btn-2" class="mono-tag mt-6 text-dim hover:text-blood transition-colors">Abandon the room</button>
    </div>`;
}

/* ------------------------------------------------------------- misc */

export function errorScreen(message, kind = 'error') {
  return `
    <div class="max-w-md mx-auto fade-in text-center mt-16">
      <div class="panel panel-corner p-8">
        <div class="mono-tag mb-4">${kind === 'error' ? 'The game interrupted' : 'Connection lost'}</div>
        <p class="font-serif-italic text-2xl text-cream/85">${esc(message)}</p>
        <button id="go-home" class="btn mt-6">Return to the street</button>
      </div>
    </div>`;
}

export { countdown };
