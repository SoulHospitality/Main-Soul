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
