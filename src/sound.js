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
  click: '/sfx-click.mp3',
  music: '/sfx-music.mp3',
  // Spoken lines. Every one of these is a VOICE — see speak(), which is what
  // stops them talking over each other.
  greeting: '/sfx-greeting.mp3',
  plan: '/sfx-plan.mp3',
  planAdd: '/sfx-plan-add.mp3',
  addExercise: '/sfx-add-exercise.mp3',
  addHabit: '/sfx-add-habit.mp3',      // not recorded yet — silent until it is
  progress: '/sfx-progress.mp3',
  social: '/sfx-social.mp3',
  guide: '/sfx-guide.mp3',
};

/** Which clips are speech. A voice interrupts a voice; a tap never does. */
const VOICES = new Set(['greeting', 'plan', 'planAdd', 'addExercise',
  'addHabit', 'progress', 'social', 'guide']);

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

/**
 * Three switches, and NO master over them.
 *
 * There was a master, and it was a trap. It lived on one button in one build
 * and moved in the next, so a phone could be left holding sound:false with
 * nothing on screen saying so — and then the music switch, which read through
 * it, could be tapped forever without lighting up or playing anything. A
 * control that silently decides whether another control works is worse than no
 * control.
 *
 * Each of these answers only for itself, which also means the stale sound:false
 * left on any phone by the old master is now simply ignored.
 *
 * Music alone defaults off: the other two are short enough to live alongside
 * someone else's audio, and a continuous track is not.
 */
/** One setting for every spoken line, greeting included — they are the same
 *  kind of thing, and a screen full of switches for one voice is not a
 *  setting, it is a form. The key keeps its old name so nobody's choice is
 *  reset by the rename. */
export const voiceOn = () => db.prefs.get('sfx-greeting', true);
export const greetingOn = voiceOn;
export const clickOn = () => db.prefs.get('sfx-click', true);
export const musicOn = () => db.prefs.get('music', false);

export function setGreetingOn(v) { db.prefs.set('sfx-greeting', !!v); if (!v) stopVoice(); }
export function setClickOn(v) { db.prefs.set('sfx-click', !!v); }
export function setMusicOn(v) { db.prefs.set('music', !!v); if (v) startMusic(); else stopMusic(); }

/** Whether a given clip is allowed to speak at all. */
const allowed = (name) =>
  name === 'music' ? musicOn() : VOICES.has(name) ? voiceOn() : clickOn();

/**
 * Always 'ambient', for everything, including our own music.
 *
 * Ambient MIXES rather than seizes: Spotify, a podcast, whatever is already
 * playing keeps going underneath and is never interrupted or paused. Turning
 * the channel over to us ('playback') would stop it, and the answer to not
 * wanting our sound is the switch, not a stolen channel.
 *
 * Two consequences, both accepted deliberately. A silenced phone plays nothing,
 * because ambient obeys the ring switch — which is the right answer to someone
 * who silenced their phone. And with our music on over someone else's, both
 * play at once; that is what the switches are for.
 */
const SESSION = 'ambient';

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
  session(SESSION);
  if (unlocked) {
    if (greetingPending) { greetingPending = false; greet(); }
    return;
  }
  unlocked = true;
  for (const name of Object.keys(CLIPS)) {
    if (name === 'music' && !musicOn()) continue;   // do not fetch 704 KB unasked
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
  if (!allowed(name)) return;
  const a = node(name);
  session(SESSION);
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
let speaking = null;
const spokenAt = {};

/** A line is not repeated inside this window. Tabbing out and straight back
 *  would otherwise fire the same sentence twice in two seconds. */
const VOICE_COOLDOWN_MS = 10000;
/** Long enough for the tap to land first, short enough to feel like one event.
 *  Johnny asked for the click, then the line — not both at once. */
const AFTER_TAP_MS = 190;

export function stopVoice() {
  if (speaking && nodes[speaking]) {
    try { nodes[speaking].pause(); nodes[speaking].currentTime = 0; } catch (e) { /* fine */ }
  }
  speaking = null;
}

/**
 * One voice at a time, and never the same line twice in a breath.
 *
 * Without the first rule, crossing three tabs quickly leaves three sentences
 * talking over each other; without the second, bouncing back to a tab you just
 * left repeats it immediately. Both are what makes a voice go from characterful
 * to irritating in a day.
 */
export function speak(name) {
  if (!voiceOn() || !CLIPS[name]) return;
  const now = Date.now();
  if (now - (spokenAt[name] || 0) < VOICE_COOLDOWN_MS) return;
  spokenAt[name] = now;
  stopVoice();
  speaking = name;
  setTimeout(() => {
    if (speaking !== name) return;      // something else started talking
    play(name, () => { speaking = null; });
  }, AFTER_TAP_MS);
}

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
  if (!musicOn()) return;
  session(SESSION);
  const a = node('music');
  const p = a.play();
  if (p && p.catch) p.catch(() => {});
}

/** Paused when the app is not in front, so it is not holding the audio channel
 *  — and the user's own music — while the phone is in a pocket. */
export function stopMusic() {
  const a = nodes.music;
  if (a) { try { a.pause(); } catch (e) { /* already stopped */ } }
  session(SESSION);
}
