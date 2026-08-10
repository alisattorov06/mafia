let ctx = null;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = 'sine', gain = 0.08, delay = 0, slide = 0 } = {}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export const sound = {
  unlock() {
    ac();
  },
  click() {
    tone(520, 0.06, { type: 'triangle', gain: 0.05 });
  },
  phase() {
    tone(392, 0.16, { type: 'sine', gain: 0.06 });
    tone(587, 0.22, { type: 'sine', gain: 0.05, delay: 0.08 });
  },
  night() {
    tone(220, 0.7, { type: 'sine', gain: 0.05, slide: -120 });
    tone(110, 1.1, { type: 'triangle', gain: 0.04, delay: 0.1, slide: -50 });
  },
  reveal() {
    tone(440, 0.12, { type: 'triangle', gain: 0.05 });
    tone(660, 0.18, { type: 'triangle', gain: 0.05, delay: 0.09 });
  },
  tick() {
    tone(880, 0.04, { type: 'square', gain: 0.02 });
  },
  vote() {
    tone(300, 0.1, { type: 'triangle', gain: 0.06, slide: 160 });
  },
  kill() {
    tone(180, 0.5, { type: 'sawtooth', gain: 0.06, slide: -120 });
    tone(90, 0.7, { type: 'sine', gain: 0.06, delay: 0.05, slide: -40 });
  },
  win() {
    tone(523, 0.2, { type: 'triangle', gain: 0.06 });
    tone(659, 0.2, { type: 'triangle', gain: 0.06, delay: 0.14 });
    tone(784, 0.34, { type: 'triangle', gain: 0.06, delay: 0.28 });
  }
};
