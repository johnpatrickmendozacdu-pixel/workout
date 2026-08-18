/**
 * Sound, as three <audio> elements and a lock.
 *
 * NEVER Web Audio. That was tried once, for the EMOM cues, and iOS silenced all
 * ~400 lines of it with the ring switch; <audio> plays on the media channel
 * instead. The whole system was deleted rather than fixed, so this is the one
 * note worth carrying forward from it.
 *
 * Nothing here reaches the network. Every clip is a file in the build,
 * precached with everything else, so there is no key to leak, no service to go
 * down and nothing to maintain. A missing file is not an error either — play()
 * rejects, we swallow it, and the app stays silent rather than broken.
 */
import * as db from './db/db.js';

const CLIPS = {
  greeting: '/sfx-greeting.mp3',
  click: '/sfx-click.mp3',
  music: '/sfx-music.mp3',
};

const nodes = {};
let unlocked = false;
let lastGreetingAt = 0;

/** Sounds default ON; music defaults OFF, because music takes the audio channel
 *  from whatever the user is already playing and does not give it back. */
export const soundOn = () => db.prefs.get('sound', true);
export const musicOn = () => db.prefs.get('music', false);
export function setSoundOn(v) { db.prefs.set('sound', !!v); if (!v) stopMusic(); }
export function setMusicOn(v) { db.prefs.set('music', !!v); if (v) startMusic(); else stopMusic(); }

function node(name) {
  if (!nodes[name]) {
    const a = new Audio(CLIPS[name]);
    a.preload = 'auto';
    if (name === 'music') { a.loop = true; a.volume = 0.35; }
    nodes[name] = a;
  }
  return nodes[name];
}

/**
 * iOS will not play anything until a real user gesture has played something.
 * The first tap plays every clip muted and immediately pauses it, which spends
 * the gesture on all of them at once — after this they can start on their own.
 */
export function unlock() {
  if (unlocked) return;
  unlocked = true;
  for (const name of Object.keys(CLIPS)) {
    const a = node(name);
    const wasMuted = a.muted;
    a.muted = true;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
    try { a.pause(); a.currentTime = 0; } catch (e) { /* not ready yet */ }
    a.muted = wasMuted;
  }
  if (musicOn()) startMusic();
}

export function play(name) {
  if (!soundOn() || !unlocked) return;
  const a = node(name);
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
  } catch (e) { /* a clip that will not play is not worth an error */ }
}

/** Once per return-to-front, but never twice inside five seconds: iOS fires
 *  visibilitychange in pairs often enough that the greeting would talk over
 *  its own tail. */
export function greet() {
  const now = Date.now();
  if (now - lastGreetingAt < 5000) return;
  lastGreetingAt = now;
  play('greeting');
}

export function startMusic() {
  if (!soundOn() || !musicOn() || !unlocked) return;
  const a = node('music');
  const p = a.play();
  if (p && p.catch) p.catch(() => {});
}

/** Paused when the app is not in front, so it is not holding the audio channel
 *  — and the user's own music — while the phone is in a pocket. */
export function stopMusic() {
  const a = nodes.music;
  if (a) { try { a.pause(); } catch (e) { /* already stopped */ } }
}
