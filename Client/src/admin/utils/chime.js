/**
 * A soft, low-volume two-note chime made with Web Audio (no sound file to load).
 * Browsers only allow audio after the person has interacted with the page, so the
 * audio context is created on the first click or key press and reused afterwards.
 */
const SOUND_KEY = 'pms:notification-sound';
let ctx = null;
let unlocked = false;

function audioContext() {
  if (ctx) return ctx;
  const AC = typeof window !== 'undefined' ? window.AudioContext || window.webkitAudioContext : null;
  if (!AC) return null;
  try {
    ctx = new AC();
  } catch {
    ctx = null;
  }
  return ctx;
}

export function unlockChime() {
  if (unlocked || typeof window === 'undefined') return;
  const unlock = () => {
    const c = audioContext();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
    unlocked = true;
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}

export function soundEnabled() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setSoundEnabled(on) {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: the setting just won't stick */
  }
}

export function playChime() {
  if (!soundEnabled()) return;
  const c = audioContext();
  if (!c || c.state !== 'running') return;
  const now = c.currentTime;
  const master = c.createGain();
  master.gain.value = 0.06;
  master.connect(c.destination);
  [
    { freq: 880, at: 0 },
    { freq: 1318.5, at: 0.12 },
  ].forEach(({ freq, at }) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, now + at);
    gain.gain.linearRampToValueAtTime(1, now + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + at + 0.45);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now + at);
    osc.stop(now + at + 0.5);
  });
}

/**
 * Snooze alarm: a gentle repeating bell for `durationMs` (10 seconds by default).
 * Returns a function that stops it early (when the chat is opened).
 */
export function playAlarm(durationMs = 10000) {
  const c = audioContext();
  if (!c) return () => {};
  if (c.state === 'suspended') c.resume().catch(() => {});
  const master = c.createGain();
  master.gain.value = 0.09;
  master.connect(c.destination);
  const start = c.currentTime + 0.05;
  const end = start + durationMs / 1000;
  const oscs = [];
  // Two quick notes every 1.25 seconds until the time is up.
  for (let t = start; t < end - 0.3; t += 1.25) {
    [
      { freq: 987.8, at: 0 },
      { freq: 1318.5, at: 0.18 },
    ].forEach(({ freq, at }) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t + at);
      gain.gain.linearRampToValueAtTime(1, t + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, t + at + 0.5);
      osc.connect(gain);
      gain.connect(master);
      osc.start(t + at);
      osc.stop(t + at + 0.55);
      oscs.push(osc);
    });
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    try {
      master.gain.setValueAtTime(0, c.currentTime);
      oscs.forEach((o) => {
        try {
          o.stop();
        } catch {
          /* already stopped */
        }
      });
      master.disconnect();
    } catch {
      /* audio already gone */
    }
  };
}
