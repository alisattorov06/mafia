export const ROLE_META = {
  CITIZEN: {
    name: 'Citizen',
    team: 'TOWN',
    blurb: 'A plain soul with a sharp eye. Argue well, vote true.',
    icon: 'mask'
  },
  MAFIA: {
    name: 'Mafia',
    team: 'MAFIA',
    blurb: 'Every night, the family chooses who disappears.',
    icon: 'knife'
  },
  DON: {
    name: 'Don',
    team: 'MAFIA',
    blurb: 'The godfather. Your word tips the scales, and the detective cannot expose you.',
    icon: 'crown'
  },
  DOCTOR: {
    name: 'Doctor',
    team: 'TOWN',
    blurb: 'Each night you shield one soul from the knife — perhaps even your own.',
    icon: 'syringe'
  },
  DETECTIVE: {
    name: 'Detective',
    team: 'TOWN',
    blurb: 'Each night you probe one suspect. You learn if they belong to the family.',
    icon: 'glass'
  },
  BODYGUARD: {
    name: 'Bodyguard',
    team: 'TOWN',
    blurb: 'Guard a target with your life. If the Mafia come, you take the blade.',
    icon: 'shield'
  },
  JESTER: {
    name: 'Jester',
    team: 'NEUTRAL',
    blurb: 'You win when the town votes you out. Make them fear your smile.',
    icon: 'skull'
  }
};

export const TEAM_META = {
  TOWN: { label: 'Town', color: '#b3c6de' },
  MAFIA: { label: 'Mafia', color: '#e55646' },
  NEUTRAL: { label: 'Neutral', color: '#b7c98a' }
};

export function teamColor(team) {
  return TEAM_META[team]?.color || '#ece3cd';
}

export const ICONS = {
  mask: '<path d="M7 10c0 2.5 2 4 5 4s5-1.5 5-4c0-2.5-2-4-5-4s-5 1.5-5 4z" /><path d="M7 10l-2 6 3-1 2 3 2-3 3 1-2-6" />',
  knife: '<path d="M3 19l8-8M14 6l4-3 3 3-3 4z" />',
  crown: '<path d="M5 16l-2-9 5 4 4-7 4 7 5-4-2 9z" /><path d="M5 19h14" />',
  syringe: '<path d="M13 3l3 3M8 8l5 5 3-3-5-5zM8 8l-4 4 5 5 4-4M11 11l3 3" />',
  glass: '<circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21" />',
  shield: '<path d="M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z" />',
  skull: '<circle cx="9" cy="10" r="2" /><circle cx="15" cy="10" r="2" /><path d="M7 19v-3a5 5 0 0110 0v3z" />',
  moon: '<path d="M20 14.5A8 8 0 119.5 4 6.5 6.5 0 0020 14.5z" />',
  target: '<circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" />',
  vote: '<path d="M6 15l6-10 6 10M6 15l-2 4h16l-2-4M12 15v4" />'
};

export function roleIcon(role) {
  const key = ROLE_META[role]?.icon || 'mask';
  return ICONS[key] || ICONS.mask;
}

export function svg(d, className = '') {
  return `<svg class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
}

export function roleSvg(role, className = '') {
  return svg(roleIcon(role), className);
}
