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

/**
 * How this app asks to share the phone's audio.
 *
 * Without this, playing anything at all seizes the channel and whatever the
 * user had going — Spotify, a podcast — stops and never comes back. There is
 * no way to duck or mix from an <audio> element alone.
 *
 * navigator.audioSession is the API for it, and 'transient' is the exact case:
 * other audio is interrupted for the length of the clip and RESUMES when it
 * ends. Music is different — if someone deliberately turns our music on, it is
 * meant to be the thing playing, so that asks for 'playback'.
 *
 * Safari 16.4 and up supports it, which is the platform that matters here.
 * Everywhere else this is a no-op and the old behaviour stands: a short
 * interruption that does not resume. Nothing breaks, it is just less polite.
 */
function session(type) {
  try {
    if (navigator.audioSession) navigator.audioSession.type = type;
  } catch (e) { /* not supported, and not worth an error */ }
}

const nodes = {};
let unlocked = false;
let lastGreetingAt = 0;
let greetingPending = false;

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
  session('transient');
  if (unlocked) {
    if (greetingPending) { greetingPending = false; greet(); }
    return;
  }
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
  if (greetingPending) { greetingPending = false; greet(); }
  if (musicOn()) startMusic();
}

/**
 * Tries, rather than asking permission first.
 *
 * Whether a browser will play without a gesture is not something you can read
 * off it — Chrome decides from how much the user has engaged with the site,
 * iOS refuses flatly until a gesture, and desktop usually allows it. So the
 * clip is played and the rejection is caught, which is the only honest test.
 * `onBlocked` is how the caller says what to do if it was refused.
 */
export function play(name, onBlocked) {
  if (!soundOn()) return;
  const a = node(name);
  session(name === 'music' ? 'playback' : 'transient');
  try {
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) {
      p.then(() => { unlocked = true; })
       .catch(() => { if (onBlocked) onBlocked(); });
    }
  } catch (e) { if (onBlocked) onBlocked(); }
}

/** Once per return-to-front, but never twice inside five seconds: iOS fires
 *  visibilitychange in pairs often enough that the greeting would talk over
 *  its own tail. */
export function greet() {
  const now = Date.now();
  if (now - lastGreetingAt < 5000) return;
  lastGreetingAt = now;
  // Blocked means the browser wanted a gesture first. The line is not dropped,
  // it is held for the very next tap — so on a cold open it lands on whatever
  // is touched first rather than being lost.
  play('greeting', () => { greetingPending = true; lastGreetingAt = 0; });
}

export function startMusic() {
  if (!soundOn() || !musicOn()) return;
  session('playback');
  const a = node('music');
  const p = a.play();
  if (p && p.catch) p.catch(() => {});
}

/** Paused when the app is not in front, so it is not holding the audio channel
 *  — and the user's own music — while the phone is in a pocket. */
export function stopMusic() {
  const a = nodes.music;
  if (a) { try { a.pause(); } catch (e) { /* already stopped */ } }
  // Back to transient, or the channel stays claimed for playback and the
  // user's own audio has no reason to come back.
  session('transient');
}
