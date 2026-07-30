import './style.css';
import { registerSW } from 'virtual:pwa-register';
import * as db from './db/db.js';
import {
  todayISO,
  addDays,
  formatDisplayDate,
  uid,
  getEffectiveTarget,
  isScheduledOn,
  scheduleLabel,
  isBreakDay,
  setDayOverride,
  migrateOverrides,
  calcTotal,
  calcDayStats,
  calcStreakInfo,
  calcWeeklyCompletion,
  addSet as addSetPure,
  removeSetAt as removeSetAtPure,
  undoLastSet as undoLastSetPure,
  updateSetAt as updateSetAtPure,
  decrementLast as decrementLastPure,
  removeExercise as removeExercisePure,
  purgeExerciseSets as purgeExerciseSetsPure,
  setDayTotal as setDayTotalPure,
  getTimer as getTimerPure,
  timerPhase,
  sessionSealed,
  workoutSealed,
  markPushingOn,
  reopenTimer as reopenTimerPure,
  timerElapsedMs,
  startTimer as startTimerPure,
  pauseTimer as pauseTimerPure,
  resumeTimer as resumeTimerPure,
  finishTimer as finishTimerPure,
  resetTimer as resetTimerPure,
  bumpTargetIfPR as bumpTargetIfPRPure,
  versionStatus,
  setTargetForDay as setTargetForDayPure,
  buildBackup,
  validateBackup,
  mergeBackup,
  mergeSyncSnapshots,
  emomPhase,
  EMOM_DEFAULT_WORK_SEC,
  EMOM_DEFAULT_REST_SEC,
} from './domain/domain.js';
import * as gsync from './sync/googleSync.js';
import { allStats, exerciseStats, recentDayStates, streakTier, dayHistory, trajectorySeries, formatDuration, formatCount, formatClock } from './domain/stats.js';

// Every number is on screen — no hunting, no typing. One tap applies it in
// whichever direction the lever is set to.
const DAY_PAGE = 7;   // a week at a time — the list grows only on request
const REP_PAD = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20, 25, 30, 50];

/* ============================= STATE ============================= */
const state = {
  view: db.prefs.get('view', 'today'),
  exercises: [],
  setsLog: {},
  timersLog: {},
  meta: { lastExportAt: null },
  profile: { username: '', weight: null, height: null },
  sync: { status: 'signed-out', email: null, error: null, pending: false },
  streakOverrides: {},
  storageError: false,
  updateAvailable: false,
  applyUpdate: null,
  modal: null,
  expandedDay: null,
  showArchived: false,
  editingPlanTarget: null,
  editingTodayTotal: null,
  editingDayTarget: null,
  editingTopSet: null,
  editingDayTotal: null,
  openExercise: null,
  dayLimits: {},
  repMode: 'add',   // 'add' | 'sub' — the pad lever
  version: { local: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev', status: 'unknown' },
  panel: null,          // 'stats' — mobile drawer only
};

// Chosen to read as the movement itself at a glance, not generic "sport".
// Every glyph here is Emoji 5.0 or older, so it renders on every iOS/Android
// version in use — the newer additions (chair, rope) simply have no glyph on
// older phones, which is why icons were showing up blank.
const EMOJI_PRESETS = [
  '🤸', // push ups
  '🦵', // squats / legs
  '🧗', // pull ups
  '💪', // arms / curls
  '🏋️', // dips / weights
  '🤾', // burpees
  '🏃', // cardio / run
  '🚴', // cycling
  '🏊', // swimming
  '🧘', // mobility / stretch
  '🥊', // boxing
  '⛹️', // athletic / general
  '🚶', // walking
  '🤺', // lunges
  '⏱', // timed hold / plank
  '🔥', // finisher
];

function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function getSetsFor(exId, dateStr) {
  return (state.setsLog[dateStr] && state.setsLog[dateStr][exId]) || [];
}

/* ============================= STORAGE ============================= */
async function loadAll() {
  const [exercises, setsLog, meta, timersLog, profile, streakOverrides] = await Promise.all([
    db.getItem('exercises'),
    db.getItem('sets-log'),
    db.getItem('app-meta'),
    db.getItem('timers-log'),
    db.getItem('profile'),
    db.getItem('streak-overrides'),
  ]);

  state.exercises = exercises || [];
  state.setsLog = setsLog || {};
  state.meta = meta || { lastExportAt: null };
  state.timersLog = timersLog || {};
  state.profile = profile || { username: '', weight: null, height: null };
  state.streakOverrides = migrateOverrides(streakOverrides || {});
}
/** Called by every persist* that changes real data. Bumps a timestamp (used to
 * decide who "wins" during Drive sync) and, if signed in, schedules a push. */
function markDirty() {
  state.meta.updatedAt = Date.now();
  db.setItem('app-meta', state.meta).catch(() => {});
  scheduleSyncPush();
}

async function persistExercises() {
  try {
    await db.setItem('exercises', state.exercises);
    if (state.storageError) { state.storageError = false; renderBanner(); }
    markDirty();
    return true;
  } catch (e) {
    state.storageError = true; renderBanner();
    return false;
  }
}
async function persistSets() {
  try {
    await db.setItem('sets-log', state.setsLog);
    if (state.storageError) { state.storageError = false; renderBanner(); }
    markDirty();
    return true;
  } catch (e) {
    state.storageError = true; renderBanner();
    return false;
  }
}
async function persistMeta() {
  try {
    await db.setItem('app-meta', state.meta);
    return true;
  } catch (e) {
    return false;
  }
}
async function persistTimers() {
  try {
    await db.setItem('timers-log', state.timersLog);
    markDirty();
    return true;
  } catch (e) {
    return false;
  }
}
async function persistProfile() {
  try {
    await db.setItem('profile', state.profile);
    markDirty();
    return true;
  } catch (e) {
    return false;
  }
}
async function persistStreakOverrides() {
  try {
    await db.setItem('streak-overrides', state.streakOverrides);
    markDirty();
    return true;
  } catch (e) {
    return false;
  }
}

/* ============================= GOOGLE DRIVE SYNC ============================= */
let applyingRemote = false;
let syncPushTimer = null;

function buildSyncSnapshot() {
  return {
    version: 1,
    updatedAt: state.meta.updatedAt || Date.now(),
    exercises: state.exercises,
    setsLog: state.setsLog,
    timersLog: state.timersLog,
    profile: state.profile,
    streakOverrides: state.streakOverrides,
  };
}

/** Writes an already-merged snapshot down. Never called with a raw remote: what
 *  lands here is always the union of both sides, so nothing local is dropped. */
async function applyMergedSnapshot(merged) {
  applyingRemote = true;
  state.exercises = merged.exercises || [];
  state.setsLog = merged.setsLog || {};
  state.timersLog = merged.timersLog || {};
  state.profile = merged.profile || { username: '', weight: null, height: null };
  state.streakOverrides = merged.streakOverrides || {};
  state.meta.updatedAt = merged.updatedAt || Date.now();
  await Promise.all([
    db.setItem('exercises', state.exercises),
    db.setItem('sets-log', state.setsLog),
    db.setItem('timers-log', state.timersLog),
    db.setItem('profile', state.profile),
    db.setItem('streak-overrides', state.streakOverrides),
    db.setItem('app-meta', state.meta),
  ]);
  applyingRemote = false;
  rerender();
}

/** True when this browser has a remembered Google account. Deliberately looser
 *  than gsync.isSignedIn(): the access token may be stale right now and still
 *  be silently renewable, so sync work is gated on the account, not the token.
 *  The token is refreshed lazily inside the sync calls themselves. */
function hasSyncAccount() {
  if (state.sync.status === 'signed-out') return false;
  // Never gate on the email: it comes from a background userinfo lookup and is
  // display-only, so requiring it stalled sync for the first seconds after
  // sign-in — the window in which sync actually matters most.
  return gsync.isSignedIn() || !!state.sync.connected || !!state.sync.email;
}

/** Token trouble means "reconnect", anything else means the network/Drive is
 *  unhappy — two different messages, because only one is actionable. */
function noteSyncFailure(err) {
  const code = err && err.message;
  if (code === 'token-expired' || code === 'not-signed-in') {
    endSyncing('reconnect');
  } else {
    endSyncing('error', 'Could not reach Google Drive.');
  }
}

/**
 * Last-resort guarantee that 'syncing' is never a terminal state. Every path
 * into it is supposed to finish on its own, but a stuck spinner with no way
 * out is the worst possible failure here — the app is local-first and works
 * fine offline, so it should always fall through to something actionable.
 */
let syncWatchdog = null;
const SYNC_WATCHDOG_MS = 20000;

function beginSyncing() {
  state.sync.status = 'syncing';
  clearTimeout(syncWatchdog);
  syncWatchdog = setTimeout(() => {
    if (state.sync.status !== 'syncing') return;
    // A stalled sync with no network is waiting, not a consent problem. Only
    // one of these statuses asks the person to do something, so it matters
    // which one a hang falls back to.
    if (!isOnline()) {
      markSyncPending();
      state.sync.status = 'pending';
    } else {
      state.sync.status = state.sync.email ? 'reconnect' : 'signed-out';
    }
    state.sync.error = null;
    renderSyncUI();
  }, SYNC_WATCHDOG_MS);
}

function endSyncing(status, error) {
  clearTimeout(syncWatchdog);
  syncWatchdog = null;
  state.sync.status = status;
  state.sync.error = error || null;
}

/**
 * Offline is a normal state for a local-first app, not a failure. Work done
 * without a connection is recorded as pending and flushed by the `online`
 * listener; the flag is persisted so closing the app while offline does not
 * lose the fact that there is something to send.
 */
function markSyncPending() {
  state.sync.pending = true;
  db.setItem('sync-pending', true).catch(() => {});
}

async function clearSyncPending() {
  state.sync.pending = false;
  await db.setItem('sync-pending', false).catch(() => {});
}

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function scheduleSyncPush() {
  if (applyingRemote || !hasSyncAccount()) return;
  if (!isOnline()) {
    // Don't burn a request we know will fail — queue it and say so.
    markSyncPending();
    endSyncing('pending');
    renderSyncUI();
    return;
  }
  clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(() => { syncNow(); }, 2500);
}

function renderSyncUI() {
  if (state.modal && state.modal.type === 'profile') renderModal();
  renderTopbar();
}

/**
 * One sync cycle: take what is in the cloud, union it with what is here, keep
 * the result locally, and put the same result back. Both devices therefore
 * converge on the union instead of one of them winning and the other's work
 * disappearing.
 *
 * Pushing what was just merged is the part that matters: without it, the other
 * device re-introduces the same conflict on its next pull.
 */
async function syncNow() {
  if (!hasSyncAccount()) { endSyncing(state.sync.connected ? 'reconnect' : 'signed-out'); renderSyncUI(); return; }
  if (!isOnline()) { markSyncPending(); endSyncing('pending'); renderSyncUI(); return; }
  try {
    beginSyncing(); renderSyncUI();
    const remote = await gsync.downloadBackup();
    const merged = mergeSyncSnapshots(buildSyncSnapshot(), remote);
    // Only rewrite local state when the cloud actually contributed something.
    if (remote) await applyMergedSnapshot(merged);
    await gsync.uploadBackup(merged);
    await clearSyncPending();
    endSyncing('synced');
  } catch (e) {
    // The work is still safe on this device; remember that it needs sending.
    markSyncPending();
    noteSyncFailure(e);
  }
  renderSyncUI();
}

/* Kept as names the rest of the app already calls. Both now mean "run a full
 * merge cycle" — there is no longer a push-only path that could clobber the
 * cloud with a snapshot that never saw it. */
const pullAndMerge = syncNow;

async function googleSignInHandler() {
  beginSyncing(); state.sync.error = null; renderModal();
  const ok = await gsync.signIn();
  if (ok) {
    // The email may not have arrived yet (background lookup) — record the
    // connection itself, which is what sync and resume actually depend on.
    state.sync.connected = true;
    await db.setItem('sync-enabled', true).catch(() => {});
    state.sync.email = gsync.getSignedInEmail() || state.sync.email;
    if (state.sync.email) await db.setItem('sync-account', state.sync.email).catch(() => {});
    await pullAndMerge();
    // Pick up the address once the background lookup lands, for display + hint.
    const late = gsync.getSignedInEmail();
    if (late && late !== state.sync.email) {
      state.sync.email = late;
      db.setItem('sync-account', late).catch(() => {});
      renderSyncUI();
    }
  } else {
    // Falling back to 'reconnect' (not 'error') keeps the retry affordance on
    // screen for someone who was already signed in.
    endSyncing(state.sync.email ? 'reconnect' : 'signed-out',
      state.sync.email ? null : 'Sign-in didn\u2019t go through — try again.');
    renderSyncUI();
  }
}
async function googleSignOutHandler() {
  gsync.signOut();
  clearTimeout(syncWatchdog);
  state.sync = { status: 'signed-out', email: null, error: null, connected: false };
  await Promise.all([
    db.setItem('sync-account', null).catch(() => {}),
    db.setItem('sync-enabled', false).catch(() => {}),
  ]);
  renderModal();
  renderTopbar();
}
async function googleSyncNowHandler() {
  await pullAndMerge();
}
/** Attempted once on app load — reconnects silently (no popup) if this browser
 * signed in before and still has an active Google session. */
async function tryResumeSync() {
  const [savedEmail, enabled, pending] = await Promise.all([
    db.getItem('sync-account').catch(() => null),
    db.getItem('sync-enabled').catch(() => null),
    db.getItem('sync-pending').catch(() => null),
  ]);
  // Resume on either signal: the email may never have been captured (the
  // userinfo lookup can fail while sync itself works fine), so the connection
  // flag is the authoritative one.
  if (!savedEmail && !enabled) return;
  // Queued work survives being closed while offline.
  state.sync.pending = !!pending;

  // Show the account immediately, before the handshake — the person never
  // signed out, so the app shouldn't flash a signed-out avatar on every load.
  state.sync.email = savedEmail || null;
  state.sync.connected = true;

  // Offline on launch is not a handshake failure: say what is true and wait for
  // the network rather than reporting Drive as unreachable.
  if (!isOnline()) {
    endSyncing('pending');
    renderSyncUI();
    return;
  }
  beginSyncing();
  renderSyncUI();

  const ok = await gsync.trySilentSignIn(savedEmail);
  if (ok) {
    state.sync.email = gsync.getSignedInEmail() || savedEmail || null;
    if (state.sync.email) db.setItem('sync-account', state.sync.email).catch(() => {});
    await pullAndMerge();
  } else {
    // Google wouldn't renew silently (signed out of Google, or third-party
    // cookies blocked). Keep the account visible and offer a one-tap reconnect
    // rather than pretending we've forgotten them.
    endSyncing('reconnect');
    renderSyncUI();
  }
}
async function saveProfile() {
  const username = (document.getElementById('f-username').value || '').trim().slice(0, 24);
  const weightRaw = document.getElementById('f-weight').value;
  const heightRaw = document.getElementById('f-height').value;
  const weight = weightRaw === '' ? null : Math.max(0, parseFloat(weightRaw));
  const height = heightRaw === '' ? null : Math.max(0, parseFloat(heightRaw));
  state.profile = { username, weight: isNaN(weight) ? null : weight, height: isNaN(height) ? null : height };
  await persistProfile();
  renderTopbar();
  showToast('Profile saved');
}

/* ============================= MUTATIONS ============================= */
async function logSet(exId, value) {
  if (!(value > 0)) return;
  if (sealedToday(exId)) return;
  const d = todayISO();
  const prevTotal = calcTotal(getSetsFor(exId, d));
  state.setsLog = addSetPure(state.setsLog, d, exId, value);
  const ex = state.exercises.find((e) => e.id === exId);
  const total = calcTotal(getSetsFor(exId, d));
  const now = Date.now();

  // First logged set of the day for this exercise auto-starts its timer.
  state.timersLog = startTimerPure(state.timersLog, d, exId, now);

  let newPR = false;
  if (ex) {
    const bumped = bumpTargetIfPRPure(ex, d, total);
    if (bumped !== ex) {
      state.exercises = state.exercises.map((e) => (e.id === exId ? bumped : e));
      newPR = true;
    }
  }

  const liveEx = state.exercises.find((e) => e.id === exId);
  const targetNow = liveEx ? getEffectiveTarget(liveEx, d) : null;
  // Prompt only on the crossing — the set that takes the total from below the
  // target to at or above it. Stateless, so it can't double-prompt while
  // someone keeps going, and it re-arms correctly if sets are removed later.
  const crossed = targetNow && prevTotal < targetNow && total >= targetNow;
  if (crossed) {
    state.timersLog = pauseTimerPure(state.timersLog, d, exId, now);
  }

  await Promise.all([persistSets(), persistTimers(), newPR ? persistExercises() : Promise.resolve()]);

  const unit = ex && ex.unit ? ' ' + ex.unit : '';
  if (crossed) {
    const t = getTimerPure(state.timersLog, d, exId);
    state.modal = { type: 'complete', exId, total, elapsedMs: t ? t.elapsedMs : 0 };
    renderModal();
  } else {
    const msg = newPR ? `🏆 New PR! Target raised to ${total}${unit}` : `Logged ${value}${unit}`;
    showToast(msg, () => undoLastSetHandler(exId));
  }
  rerender();
}

/** "Take the win" — bank the workout and stop the clock. */
async function takeTheWinHandler(exId) {
  const d = todayISO();
  const ex = state.exercises.find((e) => e.id === exId);
  state.timersLog = finishTimerPure(state.timersLog, d, exId, Date.now(), 'completed');
  await persistTimers();
  const t = getTimerPure(state.timersLog, d, exId);
  closeModal();
  rerender();

}

/** "Keep going" — clock resumes, everything keeps counting. */
async function keepGoingHandler(exId) {
  // Record the choice, don't infer it from the clock: the day is past its
  // target now, so without this marker the next pause would seal it.
  state.timersLog = markPushingOn(state.timersLog, todayISO(), exId);
  state.timersLog = resumeTimerPure(state.timersLog, todayISO(), exId, Date.now());
  await persistTimers();
  // Straight back into the logger — "keep going" means keep logging, so
  // bouncing out to the day view would be the wrong place to land.
  state.modal = { type: 'logger', exId };
  renderModal();
  rerender();
  ensureGlobalTick();
}
async function undoLastSetHandler(exId) {
  if (sealedToday(exId)) return;
  const d = todayISO();
  state.setsLog = undoLastSetPure(state.setsLog, d, exId);
  await persistSets();
  rerender();
}
async function removeSetHandler(exId, dateStr, index) {
  if (sealedToday(exId, dateStr)) return;
  state.setsLog = removeSetAtPure(state.setsLog, dateStr, exId, index);
  await persistSets();
  rerender();
}
async function updateSetHandler(exId, dateStr, index, value) {
  if (sealedToday(exId, dateStr)) return;
  state.setsLog = updateSetAtPure(state.setsLog, dateStr, exId, index, value);
  await persistSets();
  if (state.modal && state.modal.type === 'logger') state.modal.editIndex = null;
  renderModal();
  renderView();
}
async function decrementHandler(exId, amount) {
  if (sealedToday(exId)) return;
  const d = todayISO();
  state.setsLog = decrementLastPure(state.setsLog, d, exId, amount);
  await persistSets();
  rerender();
}
/**
 * Correcting the record is not the same as working out. The seal stops you
 * *training* an exercise you already finished; it must not stop you fixing a
 * number you got wrong, which is what the Progress day list is for. So this
 * takes no seal guard — only the sealed card's own inline edit does.
 *
 * Consistency comes for free: totals are stored, everything else is derived,
 * so correcting a total below its target unseals the day and moves it back to
 * To do on its own.
 */
async function setTotalHandler(exId, dateStr, rawValue) {
  const parsed = rawValue === '' || rawValue == null ? null : parseFloat(rawValue);
  const value = (parsed == null || isNaN(parsed) || parsed <= 0) ? null : Math.round(parsed * 100) / 100;
  state.setsLog = setDayTotalPure(state.setsLog, dateStr, exId, value);
  await persistSets();
  state.editingTodayTotal = null;
  if (state.modal && state.modal.type === 'logger') state.modal.editingTotal = false;
  renderView();
  if (state.modal && state.modal.type === 'logger') renderModal();
}
async function pauseTimerHandler(exId) {
  state.timersLog = pauseTimerPure(state.timersLog, todayISO(), exId, Date.now());
  await persistTimers();
  renderModal();
  renderView();
}
async function resumeTimerHandler(exId) {
  state.timersLog = resumeTimerPure(state.timersLog, todayISO(), exId, Date.now());
  await persistTimers();
  renderModal();
  renderView();
}
async function giveUpTimerHandler(exId) {
  state.timersLog = finishTimerPure(state.timersLog, todayISO(), exId, Date.now(), 'gaveup');
  await persistTimers();
  // Confirmed from the give-up sheet, so land back on the card the sheet came
  // from — now reading "Ended early" — rather than re-rendering the question.
  if (state.modal && state.modal.type === 'giveup') state.modal = { type: 'logger', exId };
  renderModal();
  renderView();
}
/**
 * Hiding a button is a hint, not a lock. Every mutation that lands on today
 * asks this first, so a sealed day holds even against a stale node left in the
 * DOM, a repeated tap racing a re-render, or an edit arriving from Progress.
 */
function sealedToday(exId, dateStr) {
  if (dateStr && dateStr !== todayISO()) return false;
  const d = todayISO();
  const ex = state.exercises.find((e) => e.id === exId);
  if (!ex) return false;
  return workoutSealed(getTimerPure(state.timersLog, d, exId), calcTotal(getSetsFor(exId, d)), getEffectiveTarget(ex, d));
}

/** The deliberate way out of a sealed day. Lands paused, keeping the time. */
async function reopenSessionHandler(exId) {
  state.timersLog = reopenTimerPure(state.timersLog, todayISO(), exId);
  await persistTimers();
  renderModal();
  renderView();
  const ex = state.exercises.find((e) => e.id === exId);
  showToast(`${ex ? ex.name : 'Session'} is open again — clock is paused`);
}

async function resetTimerHandler(exId) {
  state.timersLog = resetTimerPure(state.timersLog, todayISO(), exId);
  await persistTimers();
  renderModal();
  renderView();
}
async function toggleDayOverrideHandler(dateStr) {
  const cur = state.streakOverrides[dateStr];
  const next = cur === undefined ? true : (cur === true ? false : undefined);
  const updated = { ...state.streakOverrides };
  if (next === undefined) delete updated[dateStr];
  else updated[dateStr] = next;
  state.streakOverrides = updated;
  await persistStreakOverrides();
  rerender();
}
async function deleteExerciseHandler(id) {
  state.exercises = removeExercisePure(state.exercises, id);
  state.setsLog = purgeExerciseSetsPure(state.setsLog, id);
  await Promise.all([persistExercises(), persistSets()]);
  closeModal();
  rerender();
}
async function addExercise(data) {
  const now = todayISO();
  const maxOrder = state.exercises.filter((e) => e.active).reduce((m, e) => Math.max(m, e.order || 0), -1);
  const ex = {
    id: uid('ex'),
    name: data.name.trim(),
    icon: data.icon || '💪',
    unit: (data.unit || 'reps').trim(),
    active: true,
    archived: false,
    order: maxOrder + 1,
    createdDate: now,
    schedule: data.schedule || 'daily',
    timerMode: data.timerMode === 'emom' ? 'emom' : 'normal',
    emomWorkSec: data.emomWorkSec || EMOM_DEFAULT_WORK_SEC,
    emomRestSec: data.emomRestSec != null ? data.emomRestSec : EMOM_DEFAULT_REST_SEC,
    targetHistory: [{ effectiveDate: now, target: data.target || null }],
  };
  state.exercises.push(ex);
  await persistExercises();
}
function applyTargetChange(ex, newTarget) {
  const today = todayISO();
  const currentTarget = getEffectiveTarget(ex, today);
  if (newTarget !== currentTarget) {
    const todEntry = ex.targetHistory.find((h) => h.effectiveDate === today);
    if (todEntry) todEntry.target = newTarget;
    else ex.targetHistory.push({ effectiveDate: today, target: newTarget });
  }
}
async function updateExercise(id, data) {
  const ex = state.exercises.find((e) => e.id === id);
  if (!ex) return;
  ex.name = data.name.trim();
  ex.icon = data.icon || ex.icon;
  ex.unit = (data.unit || 'reps').trim();
  ex.schedule = data.schedule || 'daily';
  if (data.timerMode !== undefined) ex.timerMode = data.timerMode === 'emom' ? 'emom' : 'normal';
  if (data.emomWorkSec != null) ex.emomWorkSec = data.emomWorkSec;
  if (data.emomRestSec != null) ex.emomRestSec = data.emomRestSec;
  applyTargetChange(ex, data.target || null);
  await persistExercises();
}
/** Lightweight target-only edit, used by the inline Plan-row editor (no full form needed). */
async function updateTargetHandler(id, rawValue) {
  const ex = state.exercises.find((e) => e.id === id);
  if (!ex) return;
  const parsed = rawValue === '' || rawValue == null ? null : parseFloat(rawValue);
  const value = (parsed == null || isNaN(parsed) || parsed <= 0) ? null : Math.round(parsed * 100) / 100;
  applyTargetChange(ex, value);
  await persistExercises();
  state.editingPlanTarget = null;
  renderView();
}
/** Corrects the target for one past day (from Progress). Scoped to that day —
 *  later days keep the target they already had. */
async function setDayTargetHandler(exId, dateStr, rawValue) {
  const ex = state.exercises.find((e) => e.id === exId);
  state.editingDayTarget = null;
  if (!ex) { renderView(); return; }

  const updated = setTargetForDayPure(ex, dateStr, rawValue === '' ? null : parseFloat(rawValue));
  if (updated === ex) { renderView(); return; }

  const wasComplete = calcDayStats(state.exercises, state.setsLog, dateStr, state.streakOverrides).allComplete;
  state.exercises = state.exercises.map((e) => (e.id === exId ? updated : e));
  await persistExercises();
  renderView();

  const nowComplete = calcDayStats(state.exercises, state.setsLog, dateStr, state.streakOverrides).allComplete;
  const label = formatDisplayDate(dateStr, { month: 'short', day: 'numeric' });
  const newTarget = getEffectiveTarget(updated, dateStr);
  const base = newTarget ? `${label} target set to ${newTarget} ${ex.unit}` : `${label} target cleared`;
  showToast(!wasComplete && nowComplete ? `${base} · day now counts` : base);
}
async function setArchived(id, archived) {
  const ex = state.exercises.find((e) => e.id === id);
  if (!ex) return;
  ex.archived = archived;
  ex.active = !archived;
  if (!archived) {
    const maxOrder = state.exercises.filter((e) => e.active && e.id !== id).reduce((m, e) => Math.max(m, e.order || 0), -1);
    ex.order = maxOrder + 1;
  }
  await persistExercises();
}
async function reorder(id, dir) {
  const active = state.exercises.filter((e) => e.active).sort((a, b) => a.order - b.order);
  const idx = active.findIndex((e) => e.id === id);
  const swapIdx = idx + dir;
  if (idx < 0 || swapIdx < 0 || swapIdx >= active.length) return;
  const a = active[idx], b = active[swapIdx];
  const tmp = a.order; a.order = b.order; b.order = tmp;
  await persistExercises();
}

/* ============================= EXPORT / IMPORT ============================= */
async function doExport() {
  const data = buildBackup(state.exercises, state.setsLog);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `workout-tracker-backup-${todayISO()}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  state.meta.lastExportAt = new Date().toISOString();
  await persistMeta();
  showToast('Backup downloaded');
  rerender();
}
let pendingImport = null;
async function doImport(obj, mode) {
  if (mode === 'replace') {
    state.exercises = obj.exercises;
    state.setsLog = obj.setsLog;
  } else {
    const merged = mergeBackup(state.exercises, state.setsLog, obj);
    state.exercises = merged.exercises;
    state.setsLog = merged.setsLog;
  }
  await Promise.all([persistExercises(), persistSets()]);
  showToast('Import complete');
  closeModal(); rerender();
}

/* ============================= ICONS ============================= */
/**
 * The Sets mark: an S whose body is the dragon — head at the top terminal,
 * tail at the bottom — knocked into a disc. Original artwork, in the same
 * tradition as other hard-edged creature-in-a-disc emblems rather than derived
 * from any of them.
 *
 * The topbar takes the outlined cut, not the filled one. Neon is rationed to
 * marking what is live or achieved, and a solid neon disc sitting in the bar
 * all day would spend that signal on nothing. The filled cut lives in
 * `public/icon.svg`, where a home screen needs it to punch.
 */
const LOGO_MARK = `<svg class="brand-mark" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" stroke-width="4"/>
  <path fill="none" stroke="currentColor" stroke-width="15" stroke-linejoin="round"
        d="M66 31 C48 21, 29 29, 33 42 C36 53, 59 52, 63 62 C67 74, 45 82, 29 73"/>
  <polygon fill="currentColor" points="57,23 68,16 80,20 94,31 89,36 79,33 87,42 74,41 59,34"/>
  <polygon fill="currentColor" points="67,17 54,11 64,21"/>
  <polygon fill="currentColor" points="75,41 70,52 73,40"/>
  <polygon fill="currentColor" points="34,68 27,78 15,79"/>
  <polygon fill="var(--paper)" points="74,24 82,27 75,29"/>
</svg>`;

const ICONS = {
  today: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M12 8v4l2.5 2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/></svg>`,
  plan: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 7h14M5 12h14M5 17h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  progress: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 19V10M12 19V5M19 19v-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  flame: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 2c1 3-2 4-2 7a4 4 0 108 0c0-1-.4-2-1-3 2 1 4 3.5 4 6.5A7 7 0 015 12.5C5 8 8 6 12 2z" fill="var(--accent)"/></svg>`,
  close: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  plus: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  chevron: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  trash: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 12a1 1 0 001 1h6a1 1 0 001-1l1-12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  up: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M6 15l6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  down: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  edit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 20l.8-3.6L16.6 4.6a1.5 1.5 0 012.1 0l.7.7a1.5 1.5 0 010 2.1L7.6 19.2 4 20z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  archive: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M5 7v11a1 1 0 001 1h12a1 1 0 001-1V7M9 11h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  restore: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 8a8 8 0 111.6 6.4M4 4v4h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  check: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="var(--success)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  help: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="M9.6 9.2a2.5 2.5 0 114.2 1.9c-.9.7-1.3 1.1-1.3 2.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>`,
  gear: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" stroke-width="1.7"/><path d="M19.4 13.5a1.7 1.7 0 000-3l-1-.2a6.6 6.6 0 00-.7-1.6l.6-.9a1.7 1.7 0 00-2.4-2.4l-.9.6a6.6 6.6 0 00-1.6-.7l-.2-1a1.7 1.7 0 00-3 0l-.2 1a6.6 6.6 0 00-1.6.7l-.9-.6a1.7 1.7 0 00-2.4 2.4l.6.9a6.6 6.6 0 00-.7 1.6l-1 .2a1.7 1.7 0 000 3l1 .2a6.6 6.6 0 00.7 1.6l-.6.9a1.7 1.7 0 002.4 2.4l.9-.6a6.6 6.6 0 001.6.7l.2 1a1.7 1.7 0 003 0l.2-1a6.6 6.6 0 001.6-.7l.9.6a1.7 1.7 0 002.4-2.4l-.6-.9a6.6 6.6 0 00.7-1.6l1-.2z" stroke="currentColor" stroke-width="1.3"/></svg>`,
  play: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M7 5.5v13l11-6.5-11-6.5z" fill="currentColor"/></svg>`,
  pause: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M8 5.5h3v13H8v-13zM13 5.5h3v13h-3v-13z" fill="currentColor"/></svg>`,
  flag: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M6 3v18M6 4h11l-2.5 3.5L17 11H6" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
  trophy: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M7 4h10v4a5 5 0 01-10 0V4z" stroke="currentColor" stroke-width="1.6"/><path d="M7 5H4a3 3 0 003 3M17 5h3a3 3 0 01-3 3M12 13v3m-3 4h6m-3-4v0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  google: `<svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.2-2.2H12v4.2h6.5c-.1 1.1-.9 2.7-2.5 3.8l4 3.1c2.4-2.2 3.5-5.4 3.5-8.9z"/><path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.8l-4-3.1c-1.1.7-2.5 1.2-3.9 1.2-3 0-5.6-2-6.5-4.8l-4.1 3.2C3.4 21.5 7.4 24 12 24z"/><path fill="#FBBC05" d="M5.5 14.5c-.2-.7-.4-1.4-.4-2.5s.1-1.7.4-2.5L1.4 6.3C.5 8 0 9.9 0 12s.5 4 1.4 5.7l4.1-3.2z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3 .8 3.7 1.4l3.5-3.4C17.4 1 14.8 0 12 0 7.4 0 3.4 2.5 1.4 6.3l4.1 3.2C6.4 6.8 9 4.8 12 4.8z"/></svg>`,
  user: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.6" stroke="currentColor" stroke-width="1.7"/><path d="M4.5 20c1.5-4 4.3-6 7.5-6s6 2 7.5 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
};
function ring(percent, size, stroke, complete, iconHtml) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, off = c - Math.min(Math.max(percent, 0), 1) * c;
  const color = complete ? 'var(--success)' : 'var(--accent)';
  return `<div class="ex-ring-wrap" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="var(--border-strong)" stroke-width="${stroke}" fill="none"/>
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" stroke="${color}" stroke-width="${stroke}" fill="none" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}" style="transition:stroke-dashoffset .3s ease"/>
    </svg>
    ${complete ? `<div class="ex-check">${ICONS.check}</div>` : `<div class="ex-icon">${iconHtml}</div>`}
  </div>`;
}
function tallyMarks(count) {
  if (!count) return '<span class="tally-empty">No sets yet</span>';
  let html = '', full = Math.floor(count / 5), rem = count % 5;
  const group = (n) => {
    let bars = ''; for (let i = 0; i < Math.min(n, 4); i++) bars += '<span class="tally-bar"></span>';
    const strike = n === 5 ? '<span class="tally-strike"></span>' : '';
    return `<span class="tally-group">${bars}${strike}</span>`;
  };
  for (let i = 0; i < full; i++) html += group(5);
  if (rem > 0) html += group(rem);
  return html;
}

/* ============================= TOAST ============================= */
let toastTimer = null;
function showToast(text, onUndo) {
  const root = document.getElementById('toast-root');
  clearTimeout(toastTimer);
  root.innerHTML = `<div class="toast"><span>${escapeHtml(text)}</span>${onUndo ? '<button id="toast-undo-btn">Undo</button>' : ''}</div>`;
  if (onUndo) document.getElementById('toast-undo-btn').onclick = () => { root.innerHTML = ''; onUndo(); };
  toastTimer = setTimeout(() => { root.innerHTML = ''; }, 4200);
}

/* ============================= BANNERS ============================= */
function renderBanner() {
  const el = document.getElementById('banner-area');
  if (!el) return;
  const banners = [];

  if (state.updateAvailable) {
    banners.push(`<div class="banner warn"><span>A new version is ready.</span><button data-action="apply-update">Reload</button></div>`);
  }
  // No periodic "back up your data" nag — Drive sync covers it. This banner
  // stays only for the case where a write actually failed, where exporting is
  // the immediate remedy rather than a reminder.
  if (state.storageError) {
    banners.push(`<div class="banner"><span>Couldn't save your last change. Export a backup so nothing's lost.</span><button data-action="export">Export</button></div>`);
  }
  el.innerHTML = banners.join('');
}

/* ============================= RENDER: SHELL ============================= */
/**
 * A manual Top Set is a display correction only. It records the number you
 * give and changes nothing else — no logged set is rewritten, so daily totals,
 * Max, lifetime reps and streaks stay exactly as they were. Clearing the field
 * hands the figure back to the logged data.
 */
async function saveTopSetHandler(exId, rawValue) {
  const ex = state.exercises.find((e) => e.id === exId);
  state.editingTopSet = null;
  if (!ex) { renderPanels(); return; }

  const parsed = rawValue === '' || rawValue == null ? null : parseFloat(rawValue);
  const value = parsed == null || isNaN(parsed) || parsed <= 0 ? null : Math.round(parsed * 100) / 100;

  ex.topSetOverride = value;
  await persistExercises();
  renderPanels();
  showToast(value == null ? 'Top set back to your logged data' : `Top set set to ${value}. Nothing else changed.`);
}

/**
 * The trajectory: daily totals across 30 days against the target that applied
 * on each day.
 *
 * Decisions worth not re-deriving, all of them from the dataviz pass:
 *
 * - Points sit at their real calendar position, not their index in a list, so a
 *   week off reads as a week off instead of one smooth step.
 * - The line is SILVER, never neon. A whole chart in the accent would spend the
 *   one signal this palette rations to "live or achieved".
 * - A day that met its target is a FILLED marker; a short day is HOLLOW. That
 *   shape difference is not decoration: the palette validator put neon and
 *   silver at ΔE 7.8 for deutan colour blindness, which is too close to carry
 *   achievement by colour alone. Shape carries it; colour reinforces.
 * - No gridlines at all, which also keeps the dashed target line unambiguous —
 *   dashed already means "target" elsewhere in this app.
 * - Labels only on the newest and best points. A number on every dot stops
 *   being a label and becomes noise.
 *
 * The 300x96 viewBox scales to ~0.997 inside a card at 375px, so the 2px
 * strokes and 8px markers arrive at very close to their intended size.
 */
function trajectoryChartHtml(ex) {
  const { points, span, maxY, minY } = trajectorySeries(ex, state.setsLog, 30);
  if (points.length < 2) {
    return `<div class="traj-empty">Two logged days and this becomes a trajectory.</div>`;
  }

  const W = 300, H = 96, padL = 8, padR = 8, padT = 14, padB = 18;
  // Fit the range rather than pinning to zero: a climb from 60 to 130 squashed
  // against a zero baseline reads as flat, and the two numbers worth reading are
  // labelled with the full list of exact totals directly below.
  const lo = Math.max(0, minY - (maxY - minY) * 0.25 - 1);
  const hi = maxY + (maxY - minY) * 0.1 + 1;
  const x = (i) => padL + (i / (span - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);

  const line = points.map((p) => `${x(p.dayIndex).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ');

  // Stepped target: hold each day's target until the next logged day, so the
  // line shows what you were actually chasing rather than today's number painted
  // backwards over history. The final segment runs to the plot edge, because
  // today's target still applies — and a zero-length last segment would draw
  // nothing while still making the key claim a target line exists.
  let targetPath = '';
  let hasTargetLine = false;
  points.forEach((p, i) => {
    if (!(p.target > 0)) return;
    const x0 = x(p.dayIndex);
    const x1 = i + 1 < points.length ? x(points[i + 1].dayIndex) : (W - padR);
    if (x1 - x0 < 0.5) return;
    const yy = y(p.target).toFixed(1);
    targetPath += `M${x0.toFixed(1)},${yy} L${x1.toFixed(1)},${yy} `;
    hasTargetLine = true;
  });

  const best = points.reduce((m, p) => (p.total > m.total ? p : m), points[0]);
  const last = points[points.length - 1];
  const label = (p, anchor) => `<text class="traj-label" x="${x(p.dayIndex).toFixed(1)}" y="${(y(p.total) - 8).toFixed(1)}" text-anchor="${anchor}">${p.total}</text>`;
  // Two labels that land on top of each other are worse than one. The latest
  // value always wins; the best is only named when it is far enough away to read.
  const labelBest = best !== last && Math.abs(x(best.dayIndex) - x(last.dayIndex)) > 34;

  const marks = points.map((p) => `<circle class="traj-dot ${p.hit ? 'hit' : 'short'}" cx="${x(p.dayIndex).toFixed(1)}" cy="${y(p.total).toFixed(1)}" r="4"/>`).join('');

  return `<div class="traj">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily totals over the last 30 days for ${escapeHtml(ex.name)}, from ${points[0].total} on ${escapeHtml(points[0].date)} to ${last.total} on ${escapeHtml(last.date)}, best ${best.total}">
      ${hasTargetLine ? `<path class="traj-target" d="${targetPath.trim()}"/>` : ''}
      <polyline class="traj-line" points="${line}"/>
      ${marks}
      ${label(last, 'end')}
      ${labelBest ? label(best, 'middle') : ''}
      <text class="traj-axis" x="${padL}" y="${H - 4}" text-anchor="start">${escapeHtml(formatDisplayDate(points[0].date, { month: 'short', day: 'numeric' }))}</text>
      <text class="traj-axis" x="${W - padR}" y="${H - 4}" text-anchor="end">${escapeHtml(formatDisplayDate(last.date, { month: 'short', day: 'numeric' }))}</text>
    </svg>
    <div class="traj-key">
      <span class="traj-key-item"><i class="traj-swatch hit"></i>Target met</span>
      <span class="traj-key-item"><i class="traj-swatch short"></i>Short</span>
      ${hasTargetLine ? '<span class="traj-key-item"><i class="traj-swatch target"></i>Target</span>' : ''}
    </div>
  </div>`;
}

/**
 * One exercise, one card — used on Progress and inside the break picker, so a
 * resting exercise reads as the same object in a different state rather than a
 * second design. The strip is CSS dots over recentDayStates, so it is the same
 * derived data as the streak number printed beside it and cannot disagree.
 */
function exerciseCard(ex, s, opts = {}) {
  const days = recentDayStates(ex, state.setsLog, state.streakOverrides, 7);
  const strip = days.map((d) => `<i class="dot ${d.state}${d.isToday ? ' today' : ''}"></i>`).join('');
  const tier = streakTier(s.currentStreak);
  const full = days.every((d) => d.state === 'hit' || d.state === 'break' || d.state === 'rest');
  const open = state.openExercise === ex.id;

  const action = opts.resting !== undefined
    ? `<button class="rest-toggle ${opts.resting ? 'on' : ''}" data-action="toggle-break" data-id="${ex.id}" aria-pressed="${opts.resting}">${opts.resting ? 'Resting' : 'Rest'}</button>`
    : (opts.expandable
      ? `<span class="ex-stat-chev ${open ? 'open' : ''}">${ICONS.chevron}</span>`
      : '');

  const head = opts.expandable
    ? `<button class="ex-stat-head" data-action="toggle-ex-history" data-id="${ex.id}" aria-expanded="${open}">
        <span class="ex-stat-icon">${escapeHtml(ex.icon)}</span>
        <h3>${escapeHtml(ex.name)}</h3>
        ${action}
      </button>`
    : `<header class="ex-stat-head static">
        <span class="ex-stat-icon">${escapeHtml(ex.icon)}</span>
        <h3>${escapeHtml(ex.name)}</h3>
        ${action}
      </header>`;

  return `<article class="ex-stat ${opts.resting ? 'is-resting' : ''} ${open ? 'is-open' : ''}">
    ${head}
    <div class="strip ${full ? 'unbroken' : ''}" aria-label="Last seven days">${strip}</div>
    <div class="ex-stat-nums">
      <div class="streak-now">
        <b data-len="${String(s.currentStreak).length}" data-tier="${tier}">${s.currentStreak}</b>
        ${tier >= 3 ? `<span class="streak-flame" aria-hidden="true">${ICONS.flame}</span>` : ''}
        <span>day streak${s.breakDays ? ` · ${s.breakDays} rest` : ''}</span>
      </div>
      <div class="streak-best">best ${s.bestStreak}</div>
    </div>
    ${open ? exerciseHistory(ex, s) : ''}
  </article>`;
}

/** Everything about one exercise, folded inside its own card — its numbers,
 *  its best day and its own recent days. Nothing from any other exercise. */
function exerciseHistory(ex, s) {
  const u = escapeHtml(ex.unit);
  const today = todayISO();

  // "Max" and "Best day" were the same question — biggest daily total — asked
  // twice from two code paths, one of which could not see whether the day was
  // sealed. One tile now, dated, straight from the derived stats.
  const num = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const numbers = `<dl class="ex-numbers">
    ${num('Top set', s.topSet != null ? `<button class="mini-num" data-action="edit-top-set" data-id="${ex.id}">${s.topSet}</button>` : '—')}
    ${num('Best day', s.maxReps != null
      ? `${s.maxReps}${s.maxRepsDate ? ` <i>${escapeHtml(formatDisplayDate(s.maxRepsDate, { month: 'short', day: 'numeric' }))}</i>` : ''}`
      : '—')}
    ${num('Lifetime', `${formatCount(s.totalReps)}${s.since ? ` <i>since ${escapeHtml(s.since)}</i>` : ''}`)}
    ${num('Best time', formatDuration(s.bestTime))}
    ${num('Average', formatDuration(s.avgTime))}
  </dl>`;

  const chart = trajectoryChartHtml(ex);

  // Reach is unbounded; only the rendered slice grows, and only when asked.
  const limit = state.dayLimits[ex.id] || DAY_PAGE;
  const { rows: history, remaining } = dayHistory(ex, state.setsLog, state.streakOverrides, limit);

  const rows = history.map((r) => {
    const editing = state.editingDayTotal === `${r.date}|${ex.id}`;
    return `<div class="exday ${r.rest ? 'rest' : r.hit ? 'hit' : 'miss'}">
      <span class="exday-when">${r.isToday ? 'Today' : escapeHtml(formatDisplayDate(r.date, { weekday: 'short', day: 'numeric', month: 'short' }))}</span>
      ${editing
        ? `<span class="inline-target-edit" data-stop>
            <input type="number" min="0" step="any" id="day-total-input-${ex.id}" class="target-edit-input" value="${r.total || ''}" placeholder="0">
            <button class="mini-btn" data-action="save-day-total" data-id="${ex.id}" data-date="${r.date}" aria-label="Save">${ICONS.check}</button>
            <button class="mini-btn" data-action="cancel-day-total" aria-label="Cancel">${ICONS.close}</button>
          </span>`
        : `<button class="day-num total" data-editable-day-total data-id="${ex.id}" data-date="${r.date}" aria-label="Edit total">${r.rest ? '🌙' : r.total}</button>
           <span class="day-sep">/</span>
           <button class="day-num target" data-editable-day-target data-id="${ex.id}" data-date="${r.date}" aria-label="Edit target">${r.target || '—'}</button>
           <span class="exday-unit">${u}</span>`}
    </div>`;
  }).join('');

  const more = remaining > 0
    ? `<button class="exday-more" data-action="more-days" data-id="${ex.id}">+${remaining.toLocaleString()} earlier</button>`
    : (limit > DAY_PAGE ? `<button class="exday-more" data-action="less-days" data-id="${ex.id}">Show less</button>` : '');

  // Chart above the day list: the list IS the table view the chart needs, so the
  // exact numbers are always a glance below the shape they make.
  return `<div class="ex-history">${numbers}${chart}<div class="exday-list">${rows}</div>${more}</div>`;
}

/* ============================= SIDE PANELS ============================= *//* ============================= SIDE PANELS ============================= */
function renderPanels() {
  const shell = document.getElementById('shell');
  if (shell) shell.dataset.panel = state.panel || '';
}

const NAV_ITEMS = [
  { view: 'today', label: 'Today', icon: 'today' },
  { view: 'plan', label: 'Plan', icon: 'plan' },
  { view: 'progress', label: 'Progress', icon: 'progress' },
];

function renderNav() {
  const el = document.getElementById('bottom-nav');
  if (!el) return;
  el.innerHTML = `<div class="nav-inner">${NAV_ITEMS.map((n) => `
    <button class="nav-btn ${state.view === n.view ? 'active' : ''}" data-action="nav" data-view="${n.view}"
      aria-current="${state.view === n.view ? 'page' : 'false'}">${ICONS[n.icon]}<span>${n.label}</span></button>`).join('')}</div>`;
}

function render() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="banner-area"></div>
    <header id="topbar"></header>
    <div id="shell" data-panel="">
      <main id="view-container"></main>
    </div>
    <nav id="bottom-nav"></nav>
  `;
  renderNav();
  renderTopbar();
  renderBanner();
  renderView();
  renderPanels();
}
function rerender() {
  renderPanels();
  renderTopbar();
  renderBanner();
  renderView();
  renderModal();
}

/**
 * Answers "am I running the newest build?" by comparing the id compiled into
 * this bundle against version.json on the server. version.json is excluded
 * from the precache globs, so this always reaches the network rather than the
 * service worker's copy — which is the whole point.
 */
async function checkVersion() {
  try {
    const res = await fetch('./version.json', { cache: 'no-store' });
    if (!res.ok) return;
    const { build } = await res.json();
    state.version.status = versionStatus(state.version.local, build);
  } catch (e) {
    state.version.status = 'unknown'; // offline — say nothing rather than guess
  }
  renderTopbar();
}

/** Stats drawer toggle — phone only; at desktop width the rail is always visible. */
/**
 * A hint that retires itself. Each one is shown until the thing it describes
 * has been done, then never again — so the app explains itself once and then
 * gets out of the way. Kept in prefs (localStorage), not synced data: it is
 * about this device's reader, not the workout record.
 */
function tipHtml(key, text) {
  return `<p class="tip" data-tip="${key}">${escapeHtml(text)}</p>`;
}

function helpChipHtml() {
  return `<button class="help-chip" data-action="open-guide" aria-label="How this works">${ICONS.help}</button>`;
}

function railButtonsHtml() {
  return `<button class="rail-btn" data-action="toggle-panel" data-panel="stats" aria-label="Performance">${ICONS.progress}</button>`;
}

function versionChipHtml() {
  const { local, status } = state.version;
  const label = { latest: 'Up to date', stale: 'Update ready — tap to reload', unknown: 'Version unknown (offline?)' }[status];
  return `<button class="version-chip ${status}" data-action="${status === 'stale' ? 'apply-update' : 'check-version'}"
    title="Build ${escapeHtml(local)} · ${label}" aria-label="${label}">${status === 'latest' ? '\u2713' : status === 'stale' ? '\u21bb' : '\u2022'}</button>`;
}

function avatarChipHtml() {
  const p = state.profile || {};
  const sync = state.sync || { status: 'signed-out' };
  const signedIn = sync.status !== 'signed-out';
  const source = p.username || sync.email;
  const initial = source ? escapeHtml(source[0].toUpperCase()) : '';
  return `<button class="avatar-chip ${signedIn ? 'signed-in' : 'signed-out'}" data-action="open-profile" aria-label="Profile">
    ${initial || ICONS.user}
  </button>`;
}

function renderTopbar() {
  const el = document.getElementById('topbar');
  if (!el) return;
  if (state.view === 'today') {
    const perEx = allStats(
      state.exercises.filter((e) => e.active && !e.archived),
      state.setsLog, state.timersLog, null, state.streakOverrides,
    );
    const runs = Object.values(perEx);
    const streak = runs.reduce((m, s2) => Math.max(m, s2.currentStreak), 0);
    const si = { breaks: runs.reduce((m, s2) => Math.max(m, s2.breakDays || 0), 0) };
    const uname = state.profile && state.profile.username;
    el.innerHTML = `
      <div class="topbar-row">
        <div class="topbar-left">
          ${LOGO_MARK}
          <div class="topbar-titles">
            <div class="app-title">${uname ? `Hey, ${escapeHtml(uname)}` : 'Sets'}</div>
            <div class="date-heading">${formatDisplayDate(todayISO())}</div>
          </div>
        </div>
        <div class="topbar-right">
          <div class="streak-pill" title="Longest run currently going">${ICONS.flame}${streak}</div>
          ${helpChipHtml()}
          ${avatarChipHtml()}
        </div>
      </div>`;
  } else if (state.view === 'plan') {
    el.innerHTML = `
      <div class="topbar-row">
        <div class="topbar-left">${LOGO_MARK}<div class="screen-title">Plan</div></div>
        <div class="topbar-right">
          <button class="add-btn" data-action="open-add-exercise">${ICONS.plus} Add</button>
          ${helpChipHtml()}
          ${versionChipHtml()}
          ${avatarChipHtml()}
        </div>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="topbar-row">
        <div class="topbar-left">${LOGO_MARK}<div class="screen-title">Progress</div></div>
        <div class="topbar-right">
          <button class="icon-btn" data-action="open-data">${ICONS.gear}</button>
          ${helpChipHtml()}
          ${versionChipHtml()}
          ${avatarChipHtml()}
        </div>
      </div>`;
  }
}

function renderView() {
  const el = document.getElementById('view-container');
  if (!el) return;
  if (state.view === 'today') el.innerHTML = viewToday();
  else if (state.view === 'plan') el.innerHTML = viewPlan();
  else el.innerHTML = viewProgress();
}

/* ============================= VIEW: TODAY ============================= */
function viewToday() {
  const today = todayISO();
  const all = state.exercises.filter((e) => e.active).sort((a, b) => a.order - b.order);
  const scheduled = all.filter((e) => isScheduledOn(e, today));
  const resting = all.filter((e) => !isScheduledOn(e, today));

  if (scheduled.length === 0 && resting.length === 0) {
    return `<div class="empty-card">
      <div class="glyph">🗓️</div>
      <h3>No exercises yet</h3>
      <p>Add your first exercise to start logging sets in seconds.</p>
      <button class="primary-btn" data-action="open-add-exercise">Add your first exercise</button>
    </div>`;
  }

  const read = (ex) => {
    const target = getEffectiveTarget(ex, today);
    const arr = getSetsFor(ex.id, today);
    const total = calcTotal(arr);
    const hasTarget = !!target && target > 0;
    const left = hasTarget ? Math.max(0, target - total) : 0;
    // A session you deliberately ended is not work still owing. Today answers
    // "what's left"; it should not keep asking for reps you already declined.
    const endedEarly = timerPhase(getTimerPure(state.timersLog, today, ex.id)) === 'gaveup';
    return {
      ex, target, total, hasTarget, left, endedEarly,
      done: endedEarly || isBreakDay(state.streakOverrides, today, ex.id) || (hasTarget ? total >= target : total > 0),
      rest: isBreakDay(state.streakOverrides, today, ex.id),
      pct: hasTarget ? Math.min(1, total / target) : (total > 0 ? 1 : 0),
      timer: getTimerPure(state.timersLog, today, ex.id),
    };
  };

  const rows = scheduled.map(read);
  const todo = rows.filter((r) => !r.done);
  const done = rows.filter((r) => r.done);

  /* What is left to do, largest thing on the row. One tap starts it. */
  const todoCard = (r) => {
    const running = r.timer && r.timer.status === 'running';
    return `<button class="today-card" data-action="open-logger" data-id="${r.ex.id}">
      <span class="today-icon">${escapeHtml(r.ex.icon)}</span>
      <span class="today-body">
        <span class="today-name">${escapeHtml(r.ex.name)}</span>
        <span class="today-meter" aria-hidden="true"><i style="width:${Math.round(r.pct * 100)}%"></i></span>
        <span class="today-sub">${r.hasTarget ? `${r.total} of ${r.target} ${escapeHtml(r.ex.unit)}` : `${r.total} ${escapeHtml(r.ex.unit)} · no target`}${running ? ` · <b data-elapsed="${r.ex.id}">${formatElapsed(timerElapsedMs(r.timer, Date.now()))}</b>` : ''}</span>
      </span>
      <span class="today-left">
        ${r.hasTarget ? `<b>${r.left}</b><em>to go</em>` : `<b>${r.total}</b><em>logged</em>`}
      </span>
    </button>`;
  };

  /* Finished work steps back: one quiet line, no colour blast. */
  const doneRow = (r) => {
    // Ended early is closed out, not won: it keeps the quiet row but takes a
    // flag instead of the tick, and shows the shortfall honestly.
    const short = r.endedEarly && r.hasTarget && r.total < r.target;
    return `<button class="done-row${short ? ' ended-early' : ''}" data-action="open-logger" data-id="${r.ex.id}">
      <span class="done-tick">${r.rest ? '🌙' : (short ? ICONS.flag : ICONS.check)}</span>
      <span class="done-name">${escapeHtml(r.ex.name)}</span>
      <span class="done-num">${r.rest ? 'Rest' : (short ? `${r.total} of ${r.target}` : `${r.total} ${escapeHtml(r.ex.unit)}`)}</span>
    </button>`;
  };

  let html = tipHtml('open-ex', 'Tap an exercise to log reps.');

  if (todo.length) {
    html += `<div class="section-label">To do${todo.length > 1 ? ` · ${todo.length}` : ''}</div>`;
    html += todo.map(todoCard).join('');
  } else if (scheduled.length) {
    html += `<div class="all-clear"><b>All done today</b><span>Every target met. Rest up.</span></div>`;
  }

  if (done.length) {
    html += `<div class="section-label">Done</div>` + done.map(doneRow).join('');
  }

  if (resting.length) {
    html += `<div class="section-label">Not scheduled</div>` + resting.map((ex) => `<div class="rest-row">
      <span class="rest-icon">${escapeHtml(ex.icon)}</span>
      <span class="rest-name">${escapeHtml(ex.name)}</span>
      <span class="rest-when">${escapeHtml(scheduleLabel(ex))}</span>
    </div>`).join('');
  }

  const onBreak = scheduled.filter((ex) => isBreakDay(state.streakOverrides, today, ex.id));
  html += onBreak.length
    ? `<p class="break-nudge resting">🌙 Resting today: ${onBreak.map((e) => escapeHtml(e.name)).join(', ')}</p>`
    : `<p class="break-nudge">Not training one today? Open it and take a break — the streak holds.</p>`;

  return html;
}

/* ============================= VIEW: PLAN ============================= */
function viewPlan() {
  const active = state.exercises.filter((e) => e.active).sort((a, b) => a.order - b.order);
  const archived = state.exercises.filter((e) => e.archived);
  let html = '';
  if (active.length === 0) {
    html += `<div class="empty-card"><div class="glyph">➕</div><h3>Build your plan</h3><p>Add exercises with an optional daily target. Untargeted exercises still track totals, just don't affect your streak.</p><button class="primary-btn" data-action="open-add-exercise">Add an exercise</button></div>`;
  } else {
    html += `<div class="section-label">Active</div>`;
    active.forEach((ex, i) => {
      const target = getEffectiveTarget(ex, todayISO());
      const targetSub = target ? `${target} ${escapeHtml(ex.unit)}/day` : `no target · ${escapeHtml(ex.unit)}`;
      html += `<div class="plan-row">
        <button class="plan-row-open" data-action="open-edit-exercise" data-id="${ex.id}" aria-label="Edit ${escapeHtml(ex.name)}">
        <div class="ex-icon-badge">${escapeHtml(ex.icon)}</div>
        <div class="plan-row-body">
          <div class="plan-row-name">${escapeHtml(ex.name)}</div>
          <div class="plan-row-sub">${targetSub}</div>
          <div class="plan-row-schedule">${escapeHtml(scheduleLabel(ex))}</div>
        </div>
        </button>
        <div class="plan-row-actions">
          <button class="mini-btn" data-action="reorder" data-dir="-1" data-id="${ex.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${ICONS.up}</button>
          <button class="mini-btn" data-action="reorder" data-dir="1" data-id="${ex.id}" ${i === active.length - 1 ? 'disabled' : ''} aria-label="Move down">${ICONS.down}</button>
          <button class="mini-btn" data-action="archive" data-id="${ex.id}" aria-label="Archive">${ICONS.archive}</button>
          <button class="mini-btn danger" data-action="delete-exercise" data-id="${ex.id}" data-name="${escapeHtml(ex.name)}" aria-label="Delete permanently">${ICONS.trash}</button>
        </div>
      </div>`;
    });
  }
  if (archived.length > 0) {
    html += `<button class="archived-toggle" data-action="toggle-archived">${state.showArchived ? ICONS.down : ICONS.chevron} Archived (${archived.length})</button>`;
    if (state.showArchived) {
      archived.forEach((ex) => {
        html += `<div class="plan-row archived">
          <div class="ex-icon-badge">${escapeHtml(ex.icon)}</div>
          <div class="plan-row-body">
            <div class="plan-row-name">${escapeHtml(ex.name)}</div>
            <div class="plan-row-sub">archived</div>
          </div>
          <div class="plan-row-actions">
            <button class="mini-btn" data-action="restore" data-id="${ex.id}" aria-label="Restore">${ICONS.restore}</button>
            <button class="mini-btn danger" data-action="delete-exercise" data-id="${ex.id}" data-name="${escapeHtml(ex.name)}" aria-label="Delete permanently">${ICONS.trash}</button>
          </div>
        </div>`;
      });
    }
  }
  return html;
}

/* ============================= VIEW: PROGRESS ============================= */
/**
 * The "/ 200" half of a "105 / 200 reps" line in an expanded day. On past days
 * this is tappable: correcting it rewrites that day's target only, and the
 * streak/dot/fraction above recompute on the next render. Today stays
 * read-only — today's target belongs to the Plan screen, so there's exactly
 * one editor for the standing value.
 */
function renderDayTargetPart(dt, dateStr, isToday) {
  if (isToday) return dt.hasTarget ? `<span class="day-sep">/</span><span class="day-num readonly">${dt.target}</span>` : '';
  if (state.editingDayTarget === `${dateStr}|${dt.ex.id}`) {
    return ` / <span class="inline-target-edit" data-stop>
      <input type="number" min="0" step="any" id="day-target-input-${dt.ex.id}" class="target-edit-input" value="${dt.hasTarget ? dt.target : ''}" placeholder="none">
      <button class="mini-btn" data-action="save-day-target-inline" data-id="${dt.ex.id}" data-date="${dateStr}" aria-label="Save">${ICONS.check}</button>
      <button class="mini-btn" data-action="cancel-day-target-inline" aria-label="Cancel">${ICONS.close}</button>
    </span>`;
  }
  return `<span class="day-sep">/</span><button class="day-num target" data-editable-day-target data-id="${dt.ex.id}" data-date="${dateStr}" aria-label="Edit target for this day">${dt.hasTarget ? dt.target : '—'}</button>`;
}

function viewProgress() {
  const activeEx = state.exercises.filter((e) => e.active && !e.archived).sort((a, b) => a.order - b.order);
  if (!activeEx.length) return `<p class="rail-empty">Add an exercise to start a streak.</p>`;
  const stats = allStats(activeEx, state.setsLog, state.timersLog, null, state.streakOverrides);
  return activeEx.map((ex) => exerciseCard(ex, stats[ex.id], { expandable: true })).join('')
    + tipHtml('progress-open', 'Tap an exercise for its history and numbers.');
}

/* ============================= MODALS ============================= */
let globalTickHandle = null;
/**
 * One interval for the whole app. Any running timer keeps ticking while you
 * move between Today, Plan, Progress or any modal — the clock belongs to the
 * workout, not to the screen you happen to be looking at. Updates only the
 * text inside [data-elapsed] nodes rather than re-rendering, so a running
 * timer costs nothing in interaction latency.
 */
function ensureGlobalTick() {
  if (globalTickHandle) { clearInterval(globalTickHandle); globalTickHandle = null; }
  const anyRunning = () => {
    const day = state.timersLog[todayISO()] || {};
    return Object.keys(day).some((id) => day[id] && day[id].status === 'running');
  };
  if (!anyRunning()) return;
  globalTickHandle = setInterval(() => {
    if (!anyRunning()) { clearInterval(globalTickHandle); globalTickHandle = null; return; }
    const now = Date.now();
    document.querySelectorAll('[data-elapsed]').forEach((el) => {
      const t = getTimerPure(state.timersLog, todayISO(), el.dataset.elapsed);
      if (t) el.textContent = formatElapsed(timerElapsedMs(t, now));
    });
    tickEmomBands(now);
  }, 1000);
}

/**
 * The clock, in every phase including the one before it starts. Drawing a
 * dormant block rather than nothing is the whole point: the rule that your
 * first rep starts the clock has to be readable *before* you trip over it, and
 * the block no longer materialises under your thumb mid-tap.
 *
 * The note is permanent signage in the same slot every phase, and it states a
 * consequence rather than a sentiment — a session you end early really is
 * excluded from your best and average times by `completedTimes`.
 */
const TIMER_COPY = {
  idle: ['Not started', 'Starts on your first rep.'],
  running: ['In progress', 'Pause any time — stepping away costs you nothing.'],
  paused: ['Paused', 'Clock stopped. Your reps still count. Resume when you’re back.'],
  completed: ['Target hit', 'Banked. This time counts toward your best.'],
  gaveup: ['Ended early', 'Your reps still count. The time doesn’t.'],
};

/* On a sealed day the live copy lies: nothing is going to start on your next
 * rep, and there is no Resume to come back to. */
const TIMER_COPY_SEALED = {
  idle: ['No clock', 'This one was logged without a clock running.'],
  running: ['In progress', 'Stopped where you left it.'],
  paused: ['Paused', 'Stopped where you left it.'],
};

function timerBlockHtml(exId, timer, sealed) {
  const phase = timerPhase(timer);
  const [statusLabel, note] = (sealed && TIMER_COPY_SEALED[phase]) || TIMER_COPY[phase];
  const elapsed = formatElapsed(timerElapsedMs(timer, Date.now()));
  const finishedClock = timer ? formatClock(timer.finishedAt) : null;
  // A day sealed by its target can still be sitting on a merely-paused clock,
  // which must not keep offering Resume and Give up.
  const live = !sealed && (phase === 'running' || phase === 'paused');

  // Nothing to pause, end or reset before the first rep; nothing to touch at
  // all once the day is sealed. Only a live session carries controls.
  const controls = live ? `<div class="timer-controls">
      ${phase === 'running'
        ? `<button class="timer-btn" data-action="pause-timer" data-id="${exId}">${ICONS.pause}Pause</button>`
        : `<button class="timer-btn" data-action="resume-timer" data-id="${exId}">${ICONS.play}Resume</button>`}
      <button class="timer-btn giveup" data-action="giveup-timer" data-id="${exId}">${ICONS.flag}Give up</button>
      <button class="timer-btn reset" data-action="reset-timer" data-id="${exId}">${ICONS.restore}Reset</button>
    </div>` : '';

  return `<div class="timer-block status-${phase}">
    <div class="timer-top">
      <span class="timer-clock" id="timer-display" data-elapsed="${exId}" data-status="${phase}">${elapsed}</span>
      <span class="timer-status">${phase === 'completed' ? ICONS.trophy : ''}${statusLabel}${finishedClock ? ` · ${escapeHtml(finishedClock)}` : ''}</span>
    </div>
    ${live ? emomBandHtml(exId, timer) : ''}
    ${controls}
    <p class="timer-note">${escapeHtml(note)}</p>
  </div>`;
}

/**
 * A short generated tone — no audio files, no network, no permissions, nothing
 * to maintain. Two notes so WORK and REST are distinguishable without looking.
 *
 * The context is created lazily and resumed on a real gesture because iOS will
 * not let a page make sound otherwise; the tap that logs a rep or starts the
 * clock is the gesture that unlocks it.
 */
let audioCtx = null;
function unlockAudio() {
  try {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* no audio available; the band on screen is the real signal */ }
}

function beep(kind) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  try {
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = kind === 'work' ? 880 : 440;
    // Short, with a quick fade so it reads as a cue and not an alarm.
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.18);
  } catch (e) { /* ignore — never let a cue break the workout */ }
}

/**
 * Repaints any EMOM band in place, and beeps when the phase actually changes.
 * Text-only updates, so a running EMOM session costs no re-renders — the same
 * approach the elapsed clock already uses.
 */
const emomLastPhase = {};
function tickEmomBands(now) {
  document.querySelectorAll('[data-emom]').forEach((el) => {
    const exId = el.dataset.emom;
    const ex = state.exercises.find((e) => e.id === exId);
    const t = getTimerPure(state.timersLog, todayISO(), exId);
    if (!ex || !t) return;
    const e = emomPhase(timerElapsedMs(t, now), ex.emomWorkSec, ex.emomRestSec);
    if (!e) return;

    el.className = `emom-band phase-${e.phase}`;
    const phaseEl = el.querySelector('.emom-phase');
    const leftEl = el.querySelector('.emom-left b');
    const roundEl = el.querySelector('.emom-round');
    if (phaseEl) phaseEl.textContent = e.phase === 'work' ? 'Work' : 'Rest';
    if (leftEl) leftEl.textContent = e.secondsLeft;
    if (roundEl) roundEl.textContent = `Round ${e.round}`;

    const key = `${exId}:${e.phase}:${e.round}`;
    if (emomLastPhase[exId] && emomLastPhase[exId] !== key) beep(e.phase);
    emomLastPhase[exId] = key;
  });
}

/**
 * The EMOM round, shown only while a session is live on an EMOM exercise.
 *
 * The phase word is the largest element on purpose: the beep cannot be relied
 * on (iOS mutes Web Audio on the silent switch, and a backgrounded tab has its
 * audio suspended), so the screen has to be the primary signal and the sound
 * only a bonus.
 */
function emomBandHtml(exId, timer) {
  const ex = state.exercises.find((e) => e.id === exId);
  if (!ex || ex.timerMode !== 'emom') return '';
  const e = emomPhase(timerElapsedMs(timer, Date.now()), ex.emomWorkSec, ex.emomRestSec);
  if (!e) return '';
  return `<div class="emom-band phase-${e.phase}" data-emom="${exId}">
    <span class="emom-phase">${e.phase === 'work' ? 'Work' : 'Rest'}</span>
    <span class="emom-left"><b>${e.secondsLeft}</b>s</span>
    <span class="emom-round">Round ${e.round}</span>
  </div>`;
}

/** Target reached: bank it, or push past it. Timer is already paused. */
function modalComplete() {
  const m = state.modal;
  const ex = state.exercises.find((e) => e.id === m.exId);
  if (!ex) return '';
  return `<div class="modal-backdrop">
    <div class="modal-sheet center celebrate" data-stop>
      <div class="celebrate-glyph">${escapeHtml(ex.icon)}</div>
      <h2>Target reached</h2>
      <div class="celebrate-line">${escapeHtml(ex.name)}</div>
      <div class="celebrate-stat">${m.total} ${escapeHtml(ex.unit)} <span>•</span> ${formatDuration(m.elapsedMs)}</div>
      <div class="celebrate-actions">
        <button class="primary-btn" data-action="take-the-win" data-id="${m.exId}">Take the win</button>
        <button class="secondary-btn" data-action="keep-going" data-id="${m.exId}">Keep going</button>
      </div>
      <div class="hint">Keep going resumes the clock and carries on counting reps, sets and time.</div>
    </div>
  </div>`;
}

/**
 * Ending early is the same moment as reaching the target with the opposite
 * sign, so it gets the same sheet rather than a native confirm() — which in an
 * installed PWA arrives as a system alert and shows you none of your numbers.
 * The clock keeps running underneath: this is a question, not a pause.
 */
function modalGiveUp() {
  const m = state.modal;
  const ex = state.exercises.find((e) => e.id === m.exId);
  if (!ex) return '';
  const today = todayISO();
  const total = calcTotal(getSetsFor(m.exId, today));
  const target = getEffectiveTarget(ex, today);
  const timer = getTimerPure(state.timersLog, today, m.exId);
  const done = target ? `${total} of ${target} ${escapeHtml(ex.unit)}` : `${total} ${escapeHtml(ex.unit)}`;
  return `<div class="modal-backdrop">
    <div class="modal-sheet center celebrate" data-stop>
      <div class="celebrate-glyph">${escapeHtml(ex.icon)}</div>
      <h2>End here?</h2>
      <div class="celebrate-line">${escapeHtml(ex.name)}</div>
      <div class="celebrate-stat">${done} <span>•</span> ${formatDuration(timerElapsedMs(timer, Date.now()))}</div>
      <div class="celebrate-actions">
        <button class="primary-btn danger" data-action="confirm-giveup" data-id="${m.exId}">Log what I did</button>
        <button class="secondary-btn" data-action="keep-going" data-id="${m.exId}">Keep going</button>
      </div>
      <div class="hint">Everything above is kept. Today just won't count as hitting the target.</div>
    </div>
  </div>`;
}

/**
 * iOS Safari ignores overscroll-behavior on the page itself: with a sheet open,
 * dragging still scrolls the document underneath. Pinning the body to its
 * current scroll offset is the only reliable fix, and the offset is restored on
 * close so the view doesn't jump.
 */
let lockedScrollY = 0;
function setBodyScrollLock(locked) {
  const body = document.body;
  if (locked) {
    if (body.classList.contains('scroll-locked')) return;
    lockedScrollY = window.scrollY || 0;
    body.style.top = `-${lockedScrollY}px`;
    body.classList.add('scroll-locked');
  } else {
    if (!body.classList.contains('scroll-locked')) return;
    body.classList.remove('scroll-locked');
    body.style.top = '';
    window.scrollTo(0, lockedScrollY);
  }
}

/**
 * The guide covers the screen you are standing on and nothing else — you never
 * read about Plan while looking at Progress. Entries that don't apply to your
 * data are dropped, so it shrinks as well as grows with the app.
 */
function modalGuide() {
  const has = state.exercises.filter((e) => e.active && !e.archived);
  const anyTarget = has.some((e) => getEffectiveTarget(e, todayISO()));
  const anyHistory = Object.keys(state.setsLog).length > 0;

  const byView = {
    today: [
      has.length && ['Log reps', 'Tap the exercise, then a number.'],
      has.length && ['Take reps off', 'Flip the lever to Subtract.'],
      has.length && ['The clock', 'Starts on your first rep. Pause any time.'],
      anyTarget && ['Hit the target', 'Take the win, or Keep going.'],
      has.length && ['End early', 'Give up keeps your reps and stops the clock.'],
      anyTarget && ['Once it is done', 'Hitting the target locks the card. Train again to reopen it.'],
      anyTarget && ['Rest a day', 'Open the exercise, Take a break. Streak holds.'],
      !has.length && ['Start', 'Add an exercise.'],
    ],
    plan: [
      ['Edit', 'Tap the exercise.'],
      ['Schedule', 'Every day, or pick weekdays. A day off is never a miss.'],
      has.length && ['Retire', 'Archive keeps history. Delete removes it.'],
    ],
    progress: [
      ['The strip', 'Filled = hit, 🌙 = rest, hollow = missed, faint = day off.'],
      ['Open a card', 'Its numbers, best day and recent days.'],
      anyHistory && ['Fix a number', 'Tap a total or target inside a card.'],
      ['Top set vs Max', 'Best single set, versus biggest day.'],
    ],
  };

  const title = { today: 'Today', plan: 'Plan', progress: 'Progress' }[state.view] || 'Today';
  const items = (byView[state.view] || byView.today).filter(Boolean);

  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <h2>${title}</h2>
        <button class="sheet-close" data-action="close-modal">${ICONS.close}</button>
      </div>
      <dl class="guide-list">${items.map(([what, how]) => `<div><dt>${escapeHtml(what)}</dt><dd>${how}</dd></div>`).join('')}</dl>
      <div class="hint">Switch screens for that screen's guide.</div>
    </div>
  </div>`;
}

/** Streaks belong to an exercise, so a break has to name one. Same card as
 *  Progress, with a rest toggle — one object, two states. */
function modalConfirmBreak() {
  const today = todayISO();
  const active = state.exercises
    .filter((e) => e.active && !e.archived && isScheduledOn(e, today))
    .sort((a, b) => a.order - b.order);
  const stats = allStats(active, state.setsLog, state.timersLog, null, state.streakOverrides);

  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <h2>Take a break</h2>
        <button class="sheet-close" data-action="close-modal">${ICONS.close}</button>
      </div>
      <p class="break-copy">Resting keeps that exercise's streak alive and records the day as rest.</p>
      ${active.length
        ? `<div class="break-list">${active.map((ex) => exerciseCard(ex, stats[ex.id], {
            resting: isBreakDay(state.streakOverrides, today, ex.id),
          })).join('')}</div>`
        : '<p class="rail-empty">Nothing scheduled today.</p>'}
      ${active.length > 1 ? `<button class="secondary-btn" style="width:100%;margin-top:12px" data-action="rest-all">Rest everything today</button>` : ''}
    </div>
  </div>`;
}

function closeModal() { state.modal = null; renderModal(); }
let lastModalKey = null;
function renderModal() {
  const root = document.getElementById('modal-root');
  if (!root) return;
  if (!state.modal) { root.innerHTML = ''; lastModalKey = null; setBodyScrollLock(false); ensureGlobalTick(); return; }
  const m = state.modal;
  if (m.type === 'complete') root.innerHTML = modalComplete();
  else if (m.type === 'giveup') root.innerHTML = modalGiveUp();
  else if (m.type === 'confirmBreak') root.innerHTML = modalConfirmBreak();
  else if (m.type === 'guide') root.innerHTML = modalGuide();
  else if (m.type === 'logger') root.innerHTML = modalLogger(m.exId);
  else if (m.type === 'exerciseForm') root.innerHTML = modalExerciseForm(m.exId);
  else if (m.type === 'confirmDeleteSet') root.innerHTML = modalConfirm(m);
  else if (m.type === 'confirmDeleteExercise') root.innerHTML = modalConfirmDeleteExercise(m);
  else if (m.type === 'data') root.innerHTML = modalData();
  else if (m.type === 'profile') root.innerHTML = modalProfile();
  else if (m.type === 'importChoice') root.innerHTML = modalImportChoice();
  const key = `${m.type}:${m.exId || ''}`;
  if (key !== lastModalKey) {
    const sheet = root.querySelector('.modal-sheet');
    if (sheet) sheet.classList.add('entering');
    lastModalKey = key;
  }
  bindModalEvents();
  setBodyScrollLock(true);
  ensureGlobalTick();
}

/**
 * Signage for a sealed day, in the slot the "tap any number" note occupies
 * while the card is live — the place you look before reaching for the pad.
 *
 * It carries the one way out. A seal with no escape is a trap: a mis-tapped
 * "Take the win" or a miscounted set would otherwise be uncorrectable for the
 * rest of the day, and this app's whole record is built on staying editable.
 * Reopen is a deliberate second action, not a control you brush past.
 */
function sealedNoteHtml(exId, phase) {
  const line = phase === 'gaveup'
    ? 'You ended this one early. It is closed for today — nothing here can change.'
    : phase === 'completed'
      ? 'You took the win. It is closed for today — nothing here can change.'
      // sealed by simply reaching the number, which is how most days actually end
      : 'Target met. This one is done for today — nothing here can change.';
  return `<p class="tip sealed-note">
    <span>${line}</span>
    <button class="reopen-btn" data-action="reopen-session" data-id="${exId}">Train again</button>
  </p>`;
}

function modalLogger(exId) {
  const ex = state.exercises.find((e) => e.id === exId);
  if (!ex) return '';
  const today = todayISO();
  const target = getEffectiveTarget(ex, today);
  const hasTarget = !!target && target > 0;
  const arr = getSetsFor(exId, today);
  const total = calcTotal(arr);
  // A closed session is a record, not a workspace: the card still shows and
  // scrolls exactly as before, but nothing in it can be changed by accident.
  const sealed = workoutSealed(getTimerPure(state.timersLog, today, exId), total, target);
  const editIndex = state.modal && !sealed && state.modal.editIndex != null ? state.modal.editIndex : null;
  const listItems = arr.map((v, i) => ({ v, i })).reverse().map(({ v, i }) => {
    const isLatest = i === arr.length - 1;
    if (i === editIndex) {
      return `<div class="set-row editing" data-stop>
        <input type="number" id="edit-set-input" class="set-edit-input" value="${v}" step="any" autofocus>
        <div class="set-edit-actions">
          <button class="mini-btn" data-action="edit-set-save" data-id="${exId}" data-date="${today}" data-index="${i}" aria-label="Save">${ICONS.check}</button>
          <button class="mini-btn" data-action="edit-set-cancel" aria-label="Cancel">${ICONS.close}</button>
        </div>
      </div>`;
    }
    return `<div class="set-row">
      <div class="set-row-left"><span class="set-badge"${sealed ? '' : ` data-editable-set data-index="${i}" title="Tap to edit"`}>${v}</span>${isLatest ? '<span class="set-latest-tag">Latest</span>' : ''}</div>
      ${sealed ? '' : `<button class="set-del" data-action="delete-set" data-id="${exId}" data-date="${today}" data-index="${i}" aria-label="Remove set">${ICONS.trash}</button>`}
    </div>`;
  }).join('');
  const editingTotal = !!(state.modal && !sealed && state.modal.editingTotal);
  const totalDisplay = editingTotal
    ? `<span class="inline-total-edit" data-stop>
         <input type="number" min="0" step="any" id="logger-total-input" class="total-edit-input large" value="${total || ''}" placeholder="0" autofocus>
         <button class="mini-btn" data-action="save-logger-total-inline" data-id="${exId}" data-date="${today}" aria-label="Save">${ICONS.check}</button>
         <button class="mini-btn" data-action="cancel-logger-total-inline" aria-label="Cancel">${ICONS.close}</button>
       </span>`
    : sealed
      ? `<div class="logger-total">${total}</div>`
      : `<div class="logger-total editable-target" data-editable-logger-total data-id="${exId}" title="Tap to edit total">${total}</div>`;

  const timer = getTimerPure(state.timersLog, today, exId);
  const timerHtml = timerBlockHtml(exId, timer, sealed);

  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <h2>${escapeHtml(ex.icon)} ${escapeHtml(ex.name)}</h2>
        <button class="sheet-close" data-action="close-modal">${ICONS.close}</button>
      </div>
      <div class="logger-total-row">
        ${totalDisplay}
        ${hasTarget ? `<div class="logger-target">/ ${target}</div>` : ''}
      </div>
      <div class="logger-unit">${escapeHtml(ex.unit)} logged today</div>
      ${timerHtml}
      <div class="tally-rail logger-tally">${tallyMarks(arr.length)}</div>

      ${sealed
        ? sealedNoteHtml(exId, timerPhase(timer))
        : (state.repMode === 'sub'
          ? tipHtml('sub-rep', 'Tap any number to subtract it straight away.')
          : tipHtml('log-rep', 'Tap any number to add it straight away.'))}
      <div class="rep-lever" role="group" aria-label="Add or subtract reps">
        <button class="lever-opt ${state.repMode === 'add' ? 'on' : ''}" data-action="rep-mode" data-mode="add" ${sealed ? 'disabled' : ''}>Add</button>
        <button class="lever-opt sub ${state.repMode === 'sub' ? 'on' : ''}" data-action="rep-mode" data-mode="sub" ${sealed ? 'disabled' : ''}>Subtract</button>
      </div>
      <div class="rep-pad ${state.repMode === 'sub' ? 'subtracting' : ''}">
        ${REP_PAD.map((n) => `<button class="rep-key" data-action="rep-tap" data-id="${exId}" data-val="${n}" ${sealed || (state.repMode === 'sub' && !arr.length) ? 'disabled' : ''}>${state.repMode === 'sub' ? '−' : '+'}${n}</button>`).join('')}
      </div>

      ${(() => {
        const resting = isBreakDay(state.streakOverrides, today, exId);
        return `<button class="logger-rest ${resting ? 'on' : ''}" data-action="toggle-break" data-id="${exId}" aria-pressed="${resting}" ${sealed ? 'disabled' : ''}>
          <span>${resting ? '🌙 Resting today' : 'Rest today'}</span>
          <em>${sealed ? 'Today is already closed.' : (resting ? 'Your streak is safe. Tap to undo.' : 'Counts as rest — your streak keeps going.')}</em>
        </button>`;
      })()}

      <div class="set-list">
        <div class="set-list-head"><span>Set history</span><span>${arr.length} set${arr.length === 1 ? '' : 's'}</span></div>
        ${arr.length ? listItems : '<div class="empty-sets">No sets logged yet today.</div>'}
      </div>
    </div>
  </div>`;
}

function modalExerciseForm(exId) {
  const editing = !!exId;
  const ex = editing ? state.exercises.find((e) => e.id === exId) : null;
  const target = ex ? getEffectiveTarget(ex, todayISO()) : null;
  const chosenIcon = ex ? ex.icon : EMOJI_PRESETS[0];
  // Draft lives in modal state so toggling days re-renders without saving.
  if (state.modal && state.modal.sched === undefined) {
    state.modal.sched = ex && Array.isArray(ex.schedule) ? ex.schedule.slice() : 'daily';
  }
  const draftSched = state.modal ? state.modal.sched : 'daily';
  const schedIsDaily = draftSched === 'daily';
  const schedDays = Array.isArray(draftSched) ? draftSched : [];
  // Timer mode is a draft too, so toggling it reveals the work/rest fields
  // without saving anything yet.
  if (state.modal && state.modal.tmode === undefined) {
    state.modal.tmode = (ex && ex.timerMode === 'emom') ? 'emom' : 'normal';
  }
  const isEmom = state.modal ? state.modal.tmode === 'emom' : false;
  const workSec = (ex && ex.emomWorkSec) || EMOM_DEFAULT_WORK_SEC;
  const restSec = (ex && ex.emomRestSec != null) ? ex.emomRestSec : EMOM_DEFAULT_REST_SEC;
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <h2>${editing ? 'Edit exercise' : 'Add exercise'}</h2>
        <button class="sheet-close" data-action="close-modal">${ICONS.close}</button>
      </div>
      <div class="field">
        <label>Name</label>
        <input id="f-name" type="text" placeholder="e.g. Push-ups" value="${escapeHtml(ex ? ex.name : '')}" autocomplete="off">
      </div>
      <div class="field">
        <label>Icon</label>
        <div class="emoji-row">
          ${EMOJI_PRESETS.map((e) => `<button type="button" class="emoji-chip ${e === chosenIcon ? 'selected' : ''}" data-action="pick-emoji" data-emoji="${e}">${e}</button>`).join('')}
        </div>
      </div>
      <div class="field">
        <label>Unit</label>
        <input id="f-unit" type="text" list="unit-options" placeholder="reps" value="${escapeHtml(ex ? ex.unit : 'reps')}" autocomplete="off">
        <datalist id="unit-options"><option value="reps"><option value="kg"><option value="lb"><option value="sec"><option value="min"><option value="km"><option value="mi"></datalist>
      </div>
      <div class="field">
        <label>Schedule</label>
        <div class="sched-modes">
          <button type="button" class="sched-mode ${schedIsDaily ? 'on' : ''}" data-action="sched-daily">Every day</button>
          <button type="button" class="sched-mode ${schedIsDaily ? '' : 'on'}" data-action="sched-custom">Chosen days</button>
        </div>
        <div class="sched-days ${schedIsDaily ? 'disabled' : ''}">
          ${['S','M','T','W','T','F','S'].map((d, i) => `<button type="button" class="sched-day ${(!schedIsDaily && schedDays.includes(i)) ? 'on' : ''}" data-action="sched-toggle" data-day="${i}" aria-label="${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i]}" aria-pressed="${!schedIsDaily && schedDays.includes(i)}">${d}</button>`).join('')}
        </div>
        <div class="hint">Days you don't train aren't counted as missed, so a rest day never breaks a streak.</div>
      </div>
      <div class="field">
        <label>Daily target (optional)</label>
        <input id="f-target" type="number" min="0" step="any" placeholder="Leave blank for no target" value="${target ? target : ''}">
        <div class="hint">${editing ? 'Changing this only affects today onward — past days keep their original target.' : 'Untargeted exercises still track totals but don’t count toward your streak.'}</div>
      </div>
      <div class="field">
        <label>Timer</label>
        <div class="sched-modes">
          <button type="button" class="sched-mode ${isEmom ? '' : 'on'}" data-action="timer-mode" data-mode="normal">Normal</button>
          <button type="button" class="sched-mode ${isEmom ? 'on' : ''}" data-action="timer-mode" data-mode="emom">EMOM</button>
        </div>
        <div class="emom-fields ${isEmom ? '' : 'disabled'}">
          <label class="emom-sub">Work<input id="f-emom-work" type="number" min="1" max="3600" step="1" value="${workSec}"></label>
          <label class="emom-sub">Rest<input id="f-emom-rest" type="number" min="0" max="3600" step="1" value="${restSec}"></label>
        </div>
        <div class="hint">${isEmom
          ? 'Seconds. Work then rest, on repeat, while the normal clock keeps running. Pausing freezes the round too.'
          : 'Normal runs one clock from your first rep. EMOM adds work/rest rounds on top of it.'}</div>
      </div>
      <div class="form-actions">
        <button class="secondary-btn" data-action="close-modal">Cancel</button>
        <button class="primary-btn" data-action="save-exercise" data-id="${exId || ''}">Save</button>
      </div>
    </div>
  </div>`;
}

function modalConfirm(m) {
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet center" data-stop>
      <h2 style="font-size:16px;margin:0 0 8px">Remove this set?</h2>
      <p style="font-size:13.5px;color:var(--text-dim);margin:0 0 18px;line-height:1.5">This will change today's total.</p>
      <div class="form-actions">
        <button class="secondary-btn" data-action="close-modal">Cancel</button>
        <button class="primary-btn" style="background:var(--danger);color:#fff" data-action="confirm-delete-set" data-id="${m.exId || ''}" data-date="${m.date || ''}" data-index="${m.index != null ? m.index : ''}">Remove</button>
      </div>
    </div>
  </div>`;
}

function modalConfirmDeleteExercise(m) {
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet center" data-stop>
      <h2 style="font-size:16px;margin:0 0 8px">Delete “${escapeHtml(m.name || '')}”?</h2>
      <p style="font-size:13.5px;color:var(--text-dim);margin:0 0 18px;line-height:1.5">This permanently deletes the exercise and every set ever logged for it. This can't be undone — use Archive instead if you just want it out of the way but recoverable.</p>
      <div class="form-actions">
        <button class="secondary-btn" data-action="close-modal">Cancel</button>
        <button class="primary-btn" style="background:var(--danger);color:#fff" data-action="confirm-delete-exercise" data-id="${m.exId || ''}">Delete forever</button>
      </div>
    </div>
  </div>`;
}

function modalProfile() {
  const p = state.profile || {};
  const sync = state.sync || { status: 'signed-out' };
  const initial = ((p.username || sync.email || '?')[0] || '?').toUpperCase();
  const syncHtml = (() => {
    if (sync.status === 'signed-out') {
      return `<button class="secondary-btn" style="width:100%" data-action="google-sign-in">${ICONS.google || ''} Sign in with Google</button>
        <div class="hint">Syncs your data to a private, hidden spot in your own Google Drive — free, and readable only by this app.</div>`;
    }
    // Offline is not an error and needs no action — the work is already safe
    // here and will go up on its own. Saying "waiting" instead of "couldn't
    // reach Drive" is the difference between information and a false alarm.
    if (sync.status === 'pending') {
      return `<div class="sync-status pending">Waiting for connection${sync.email ? ` · ${escapeHtml(sync.email)}` : ''}</div>
        <div class="sync-actions">
          <button class="secondary-btn" data-action="google-sync-now">Try now</button>
          <button class="secondary-btn" data-action="google-sign-out">Sign out</button>
        </div>
        <div class="hint">Everything you log is saved on this device. It syncs by itself as soon as you're back online.</div>`;
    }
    if (sync.status === 'syncing') {
      // Keep the account and an escape hatch on screen — a bare spinner with no
      // way out is what made a slow handshake feel like a hang.
      return `<div class="sync-status syncing">Syncing…${sync.email ? ` · ${escapeHtml(sync.email)}` : ''}</div>
        <div class="sync-actions">
          <button class="secondary-btn" data-action="google-sign-out">Sign out</button>
        </div>`;
    }
    // Signed in as far as this app is concerned, but Google wouldn't renew the
    // token without a prompt. Everything still works locally; one tap resumes.
    if (sync.status === 'reconnect') {
      return `<div class="sync-status error">Sync paused${sync.email ? ` · ${escapeHtml(sync.email)}` : ''}</div>
        <div class="sync-actions">
          <button class="secondary-btn" data-action="google-sign-in">Reconnect to sync</button>
          <button class="secondary-btn" data-action="google-sign-out">Sign out</button>
        </div>
        <div class="hint">Your workouts are all here and safe on this device. Google just needs you to confirm it's you again before syncing resumes.</div>`;
    }
    const statusLine = sync.status === 'error'
      ? `<div class="sync-status error">${escapeHtml(sync.error || 'Sync error')}</div>`
      : `<div class="sync-status ok">${ICONS.check} Synced${sync.email ? ` · ${escapeHtml(sync.email)}` : ''}</div>`;
    return `${statusLine}
      <div class="sync-actions">
        <button class="secondary-btn" data-action="google-sync-now">Sync now</button>
        <button class="secondary-btn" data-action="google-sign-out">Sign out</button>
      </div>`;
  })();
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head"><h2>Profile</h2><button class="sheet-close" data-action="close-modal">${ICONS.close}</button></div>

      <div class="profile-avatar-big">${initial}</div>

      <div class="field">
        <label>Cross-device sync</label>
        ${syncHtml}
      </div>

      <div class="field">
        <label>Username</label>
        <input id="f-username" type="text" maxlength="24" placeholder="Your name" value="${escapeHtml(p.username || '')}">
      </div>
      <div class="profile-row">
        <div class="field">
          <label>Weight (kg)</label>
          <input id="f-weight" type="number" min="0" step="any" placeholder="—" value="${p.weight != null ? p.weight : ''}">
        </div>
        <div class="field">
          <label>Height (cm)</label>
          <input id="f-height" type="number" min="0" step="any" placeholder="—" value="${p.height != null ? p.height : ''}">
        </div>
      </div>
      <button class="secondary-btn" style="width:100%" data-action="save-profile">Save profile</button>
    </div>
  </div>`;
}

function modalData() {
  const last = state.meta.lastExportAt;
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head"><h2>Backup & data</h2><button class="sheet-close" data-action="close-modal">${ICONS.close}</button></div>
      <div class="field">
        <label>App version</label>
        <div class="build-line"><b>${escapeHtml(state.version.local)}</b><span>${{ latest: 'Up to date', stale: 'Update available', unknown: 'Offline \u2014 can\u2019t check' }[state.version.status]}</span></div>
        <button class="secondary-btn" style="width:100%;margin-top:8px" data-action="force-update">Force update now</button>
        <div class="hint">Clears the cached app and reloads the newest build. Your workouts are stored separately and are not touched.</div>
      </div>
      <p style="font-size:13.5px;color:var(--text-dim);line-height:1.5;margin-top:0">Your data lives in this browser's storage and stays on this device. Export a JSON backup any time — it's the only way to move data to another device without Google sync, and iOS Safari can clear site data if you don't open the app for about a week.</p>
      <div class="hint" style="margin-bottom:18px">${last ? `Last export: ${new Date(last).toLocaleString()}` : 'No export yet.'}</div>
      <button class="primary-btn" style="width:100%;margin-bottom:10px" data-action="export">Export backup (.json)</button>
      <label class="secondary-btn" style="width:100%;display:block;text-align:center;margin-bottom:4px;cursor:pointer">
        Import backup
        <input type="file" id="import-file" accept="application/json" style="display:none">
      </label>
      <div class="hint">Import validates the file first and never overwrites your data without asking merge or replace.</div>
    </div>
  </div>`;
}

function modalImportChoice() {
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet center" data-stop>
      <h2 style="font-size:16px;margin:0 0 8px">Import backup</h2>
      <p style="font-size:13.5px;color:var(--text-dim);margin:0 0 18px;line-height:1.5">Merge keeps your current data and adds anything new from the file. Replace wipes current data and uses the file instead.</p>
      <div class="form-actions" style="margin-bottom:10px">
        <button class="secondary-btn" data-action="do-import" data-mode="merge">Merge</button>
        <button class="primary-btn" style="background:var(--danger);color:#fff" data-action="do-import" data-mode="replace">Replace</button>
      </div>
      <button class="ghost-btn" data-action="close-modal" style="width:100%;text-align:center">Cancel</button>
    </div>
  </div>`;
}

/* ============================= EVENTS ============================= */
function bindModalEvents() {
  const fileInput = document.getElementById('import-file');
  if (fileInput) {
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const obj = JSON.parse(text);
        const err = validateBackup(obj);
        if (err) { showToast(err); return; }
        pendingImport = obj;
        state.modal = { type: 'importChoice' };
        renderModal();
      } catch (err) {
        showToast("That file couldn't be read as a backup.");
      }
    };
  }
}

document.addEventListener('click', async (e) => {
  const backdrop = e.target.closest('[data-action="backdrop"]');
  if (backdrop && !e.target.closest('[data-stop]')) { closeModal(); return; }

  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  switch (action) {
    case 'nav':
      state.view = btn.dataset.view;
      db.prefs.set('view', state.view);
      state.expandedDay = null;
      renderNav(); renderTopbar(); renderView(); renderBanner();
      break;

    case 'open-add-exercise': state.modal = { type: 'exerciseForm', exId: null }; renderModal(); break;
    case 'open-edit-exercise': state.modal = { type: 'exerciseForm', exId: btn.dataset.id }; renderModal(); break;
    case 'close-modal': closeModal(); break;

    case 'pick-emoji': {
      document.querySelectorAll('.emoji-chip').forEach((c) => c.classList.remove('selected'));
      btn.classList.add('selected');
      break;
    }
    case 'save-exercise': {
      const name = document.getElementById('f-name').value.trim();
      if (!name) { showToast('Name is required.'); return; }
      const unit = document.getElementById('f-unit').value.trim() || 'reps';
      const targetRaw = document.getElementById('f-target').value;
      const target = targetRaw === '' ? null : Math.max(0, parseFloat(targetRaw));
      const iconEl = document.querySelector('.emoji-chip.selected');
      const icon = iconEl ? iconEl.dataset.emoji : '💪';
      const id = btn.dataset.id;
      const schedule = state.modal && state.modal.sched ? state.modal.sched : 'daily';
      const timerMode = state.modal && state.modal.tmode === 'emom' ? 'emom' : 'normal';
      // Read the fields even in normal mode so switching back to EMOM later
      // remembers what you had typed rather than snapping to the defaults.
      const rawWork = parseInt(document.getElementById('f-emom-work').value, 10);
      const rawRest = parseInt(document.getElementById('f-emom-rest').value, 10);
      const emomWorkSec = rawWork > 0 ? Math.min(3600, rawWork) : EMOM_DEFAULT_WORK_SEC;
      const emomRestSec = rawRest >= 0 ? Math.min(3600, rawRest) : EMOM_DEFAULT_REST_SEC;
      const timer = { timerMode, emomWorkSec, emomRestSec };
      if (id) await updateExercise(id, { name, unit, target, schedule, ...timer });
      else await addExercise({ name, unit, target, icon, schedule, ...timer });
      closeModal(); rerender();
      break;
    }

    case 'archive': await setArchived(btn.dataset.id, true); rerender(); break;
    case 'restore': await setArchived(btn.dataset.id, false); rerender(); break;
    case 'reorder': await reorder(btn.dataset.id, parseInt(btn.dataset.dir, 10)); rerender(); break;
    case 'toggle-archived': state.showArchived = !state.showArchived; renderView(); break;

    case 'open-logger': state.modal = { type: 'logger', exId: btn.dataset.id }; renderModal(); break;
    case 'timer-mode':
      if (state.modal) { state.modal.tmode = btn.dataset.mode; renderModal(); }
      break;
    case 'sched-daily':
      if (state.modal) { state.modal.sched = 'daily'; renderModal(); }
      break;
    case 'sched-custom':
      if (state.modal && state.modal.sched === 'daily') {
        state.modal.sched = [new Date().getDay()]; // seed with today
        renderModal();
      }
      break;
    case 'sched-toggle': {
      if (!state.modal) break;
      const day = parseInt(btn.dataset.day, 10);
      const cur = Array.isArray(state.modal.sched) ? state.modal.sched.slice() : [];
      const idx = cur.indexOf(day);
      if (idx >= 0) cur.splice(idx, 1); else cur.push(day);
      state.modal.sched = cur.length ? cur : 'daily'; // no days chosen means every day
      renderModal();
      break;
    }
    case 'save-day-total': {
      const input = document.getElementById(`day-total-input-${btn.dataset.id}`);
      state.editingDayTotal = null;
      await setTotalHandler(btn.dataset.id, btn.dataset.date, input ? input.value : '');
      renderView();
      break;
    }
    case 'cancel-day-total':
      state.editingDayTotal = null;
      renderView();
      break;
    case 'take-break':
      state.modal = { type: 'confirmBreak' };
      renderModal();
      break;
    case 'toggle-break': {
      const d = todayISO();
      const id = btn.dataset.id;
      if (sealedToday(id)) break;
      const was = isBreakDay(state.streakOverrides, d, id);
      state.streakOverrides = setDayOverride(state.streakOverrides, d, id, was ? null : 'break');
      await persistStreakOverrides();
      renderModal();
      rerender();
      break;
    }
    case 'rest-all': {
      const d = todayISO();
      let next = state.streakOverrides;
      state.exercises.filter((e) => e.active && !e.archived && isScheduledOn(e, d))
        .forEach((ex) => { next = setDayOverride(next, d, ex.id, 'break'); });
      state.streakOverrides = next;
      await persistStreakOverrides();
      renderModal();
      rerender();
      showToast('Resting everything today');
      break;
    }
    case 'open-guide':
      state.modal = { type: 'guide' };
      renderModal();
      break;
    case 'edit-top-set':
      state.editingTopSet = btn.dataset.id;
      renderPanels();
      { const i = document.getElementById(`topset-input-${btn.dataset.id}`); if (i) { i.focus(); i.select(); } }
      break;
    case 'save-top-set': {
      const input = document.getElementById(`topset-input-${btn.dataset.id}`);
      await saveTopSetHandler(btn.dataset.id, input ? input.value : '');
      break;
    }
    case 'cancel-top-set':
      state.editingTopSet = null;
      renderPanels();
      break;
    case 'rep-mode':
      state.repMode = btn.dataset.mode;
      renderModal();
      break;
    case 'rep-tap': {
      // This tap is the gesture iOS requires before a page may make sound.
      unlockAudio();
      const n = parseFloat(btn.dataset.val);
      if (state.repMode === 'sub') await decrementHandler(btn.dataset.id, n);
      else await logSet(btn.dataset.id, n);
      if (state.modal && state.modal.type === 'logger') renderModal();
      break;
    }
    case 'chip-log':
      await logSet(btn.dataset.id, parseFloat(btn.dataset.val));
      if (state.modal && state.modal.type === 'logger') renderModal();
      break;
    case 'chip-minus':
      await decrementHandler(btn.dataset.id, parseFloat(btn.dataset.val));
      if (state.modal && state.modal.type === 'logger') renderModal();
      break;
    case 'delete-set': {
      const arr = getSetsFor(btn.dataset.id, btn.dataset.date);
      const index = parseInt(btn.dataset.index, 10);
      if (index === arr.length - 1) {
        await removeSetHandler(btn.dataset.id, btn.dataset.date, index);
        renderModal();
      } else {
        state.modal = { type: 'confirmDeleteSet', exId: btn.dataset.id, date: btn.dataset.date, index };
        renderModal();
      }
      break;
    }
    case 'confirm-delete-set':
      await removeSetHandler(btn.dataset.id, btn.dataset.date, parseInt(btn.dataset.index, 10));
      state.modal = { type: 'logger', exId: btn.dataset.id };
      renderModal();
      break;

    case 'edit-set-save': {
      const input = document.getElementById('edit-set-input');
      const val = parseFloat(input.value);
      await updateSetHandler(btn.dataset.id, btn.dataset.date, parseInt(btn.dataset.index, 10), val);
      break;
    }
    case 'edit-set-cancel':
      if (state.modal) state.modal.editIndex = null;
      renderModal();
      break;

    case 'delete-exercise':
      state.modal = { type: 'confirmDeleteExercise', exId: btn.dataset.id, name: btn.dataset.name };
      renderModal();
      break;
    case 'confirm-delete-exercise':
      await deleteExerciseHandler(btn.dataset.id);
      break;

    case 'save-target-inline': {
      const input = document.getElementById(`plan-target-input-${btn.dataset.id}`);
      await updateTargetHandler(btn.dataset.id, input.value);
      break;
    }
    case 'cancel-target-inline':
      state.editingPlanTarget = null;
      renderView();
      break;

    case 'save-day-target-inline': {
      const input = document.getElementById(`day-target-input-${btn.dataset.id}`);
      await setDayTargetHandler(btn.dataset.id, btn.dataset.date, input.value);
      break;
    }
    case 'cancel-day-target-inline':
      state.editingDayTarget = null;
      renderView();
      break;

    case 'save-today-total-inline': {
      const input = document.getElementById(`today-total-input-${btn.dataset.id}`);
      await setTotalHandler(btn.dataset.id, btn.dataset.date, input.value);
      break;
    }
    case 'cancel-today-total-inline':
      state.editingTodayTotal = null;
      renderView();
      break;

    case 'save-logger-total-inline': {
      if (sealedToday(btn.dataset.id, btn.dataset.date)) break;
      const input = document.getElementById('logger-total-input');
      await setTotalHandler(btn.dataset.id, btn.dataset.date, input.value);
      break;
    }
    case 'cancel-logger-total-inline':
      if (state.modal) state.modal.editingTotal = false;
      renderModal();
      break;

    case 'take-the-win':
      await takeTheWinHandler(btn.dataset.id);
      break;
    case 'keep-going':
      await keepGoingHandler(btn.dataset.id);
      break;
    case 'toggle-panel':
      state.panel = state.panel === btn.dataset.panel ? null : btn.dataset.panel;
      renderPanels();
      break;
    case 'pause-timer':
      await pauseTimerHandler(btn.dataset.id);
      break;
    case 'resume-timer':
      unlockAudio();
      await resumeTimerHandler(btn.dataset.id);
      break;
    case 'giveup-timer':
      state.modal = { type: 'giveup', exId: btn.dataset.id };
      renderModal();
      break;
    case 'confirm-giveup':
      await giveUpTimerHandler(btn.dataset.id);
      break;
    case 'reopen-session':
      await reopenSessionHandler(btn.dataset.id);
      break;
    case 'reset-timer':
      if (confirm('Reset today’s timer back to 0:00? This only clears the clock, not your logged reps.')) {
        await resetTimerHandler(btn.dataset.id);
      }
      break;

    case 'toggle-day-override':
      await toggleDayOverrideHandler(btn.dataset.date);
      break;

    case 'save-profile':
      await saveProfile();
      break;

    case 'google-sign-in':
      await googleSignInHandler();
      break;
    case 'google-sign-out':
      await googleSignOutHandler();
      break;
    case 'google-sync-now':
      await googleSyncNowHandler();
      break;

    case 'more-days': {
      // Grows geometrically: cheap for the common case of a recent
      // correction, but still reaches years back in a handful of taps rather
      // than sixty. The first page stays a week either way.
      const cur = state.dayLimits[btn.dataset.id] || DAY_PAGE;
      state.dayLimits[btn.dataset.id] = cur + Math.max(30, cur);
      renderView();
      break;
    }
    case 'less-days':
      delete state.dayLimits[btn.dataset.id];
      renderView();
      break;
    case 'toggle-ex-history':
          state.openExercise = state.openExercise === btn.dataset.id ? null : btn.dataset.id;
      renderView();
      break;
    case 'toggle-day':
      state.expandedDay = state.expandedDay === btn.dataset.date ? null : btn.dataset.date;
      renderView();
      break;

    case 'open-data': state.modal = { type: 'data' }; renderModal(); break;
    case 'open-profile': state.modal = { type: 'profile' }; renderModal(); break;
    case 'export': await doExport(); if (state.modal) renderModal(); break;
    case 'do-import':
      if (pendingImport) { await doImport(pendingImport, btn.dataset.mode); pendingImport = null; }
      break;
    case 'force-update':
      await forceUpdate();
      break;
    case 'apply-update':
      if (state.applyUpdate) state.applyUpdate();
      else location.reload();
      break;
    case 'check-version': {
      await checkVersion();
      const label = { latest: 'Up to date', stale: 'Update ready', unknown: 'Offline — can\u2019t check' }[state.version.status];
      showToast(`Build ${state.version.local} \u00b7 ${label}`);
      break;
    }
  }
});

document.addEventListener('click', (e) => {
  if (state.panel && !e.target.closest('.rail') && !e.target.closest('[data-action="toggle-panel"]')) {
    state.panel = null;
    renderPanels();
  }
  const badge = e.target.closest('[data-editable-set]');
  if (badge && state.modal && state.modal.type === 'logger') {
    state.modal.editIndex = parseInt(badge.dataset.index, 10);
    renderModal();
    const input = document.getElementById('edit-set-input');
    if (input) { input.focus(); input.select(); }
    return;
  }
  const targetEl = e.target.closest('[data-editable-target]');
  if (targetEl) {
    state.editingPlanTarget = targetEl.dataset.id;
    renderView();
    const input = document.getElementById(`plan-target-input-${targetEl.dataset.id}`);
    if (input) { input.focus(); input.select(); }
    return;
  }
  const dayTotalEl = e.target.closest('[data-editable-day-total]');
  if (dayTotalEl) {
    state.editingDayTotal = `${dayTotalEl.dataset.date}|${dayTotalEl.dataset.id}`;
    renderView();
    const input = document.getElementById(`day-total-input-${dayTotalEl.dataset.id}`);
    if (input) { input.focus(); input.select(); }
    return;
  }
  const dayTargetEl = e.target.closest('[data-editable-day-target]');
  if (dayTargetEl) {
    state.editingDayTarget = `${dayTargetEl.dataset.date}|${dayTargetEl.dataset.id}`;
    renderView();
    const input = document.getElementById(`day-target-input-${dayTargetEl.dataset.id}`);
    if (input) { input.focus(); input.select(); }
    return;
  }
  const todayTotalEl = e.target.closest('[data-editable-today-total]');
  if (todayTotalEl) {
    state.editingTodayTotal = todayTotalEl.dataset.id;
    renderView();
    const input = document.getElementById(`today-total-input-${todayTotalEl.dataset.id}`);
    if (input) { input.focus(); input.select(); }
    return;
  }
  const loggerTotalEl = e.target.closest('[data-editable-logger-total]');
  if (loggerTotalEl && state.modal && state.modal.type === 'logger') {
    state.modal.editingTotal = true;
    renderModal();
    const input = document.getElementById('logger-total-input');
    if (input) { input.focus(); input.select(); }
  }
});

document.addEventListener('keydown', (e) => {
  const setInput = e.target.closest('#edit-set-input');
  if (setInput) {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.querySelector('[data-action="edit-set-save"]')?.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (state.modal) state.modal.editIndex = null;
      renderModal();
    }
    return;
  }
  const dayTargetInput = e.target.closest('[id^="day-target-input-"]');
  if (dayTargetInput) {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.querySelector('[data-action="save-day-target-inline"]')?.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      state.editingDayTarget = null;
      renderView();
    }
    return;
  }
  const targetInput = e.target.closest('.target-edit-input');
  if (targetInput) {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.querySelector('[data-action="save-target-inline"]')?.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      state.editingPlanTarget = null;
      renderView();
    }
    return;
  }
  const todayTotalInput = e.target.closest('#today-total-input-' + (state.editingTodayTotal || '\0'));
  if (todayTotalInput) {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.querySelector('[data-action="save-today-total-inline"]')?.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      state.editingTodayTotal = null;
      renderView();
    }
    return;
  }
  const loggerTotalInput = e.target.closest('#logger-total-input');
  if (loggerTotalInput) {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.querySelector('[data-action="save-logger-total-inline"]')?.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (state.modal) state.modal.editingTotal = false;
      renderModal();
    }
  }
});

/**
 * Nuclear reload: unregister every service worker and drop every cache, then
 * reload. An installed home-screen PWA keeps its own worker and cache, separate
 * from the browser's, and can otherwise stay pinned to an old build no matter
 * how many times it's reopened. Workout data lives in IndexedDB and is
 * deliberately left alone.
 */
async function forceUpdate() {
  try {
    if (navigator.serviceWorker) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {
    // best effort — reload regardless
  }
  location.reload();
}

/* ============================= PWA UPDATE PROMPT ============================= */
const updateSW = registerSW({
  onNeedRefresh() {
    state.updateAvailable = true;
    state.applyUpdate = () => updateSW(true);
    renderBanner();
  },
  onOfflineReady() {
    // App shell is cached and ready to run with no network.
  },
});

/* ============================= INIT ============================= */
async function init() {
  await loadAll();
  db.requestPersistence();
  render();

  tryResumeSync().catch(() => {});
  checkVersion();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    checkVersion();
    if (hasSyncAccount() && isOnline()) syncNow();
  });

  // Coming back onto the network is the moment queued work should leave the
  // device. Without this, a push that failed offline waited for some unrelated
  // later edit to happen to trigger another one.
  window.addEventListener('online', () => {
    if (!hasSyncAccount()) return;
    syncNow();
  });
  window.addEventListener('offline', () => {
    if (!hasSyncAccount()) return;
    endSyncing(state.sync.pending ? 'pending' : state.sync.status);
    renderSyncUI();
  });
}
init();
