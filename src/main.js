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
  scheduleEffectiveOn,
  scheduleLabel,
  convertWeight,
  weightProgression,
  formatWeight,
  isBreakDay,
  setDayOverride,
  migrateOverrides,
  calcTotal,
  progressValue,
  targetUnit,
  proofRequiredOn,
  proofFor,
  recordProof,
  retakesLeft,
  PROOF_MAX_RETAKES,
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
  isTimeMode,
  minutesFromMs,
  bankTimeSession as bankTimeSessionPure,
  stampFinished as stampFinishedPure,
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
  sameSnapshotData,
  storedTokenUsable,
  syncNudge,
  bmiSummary,
  weightTrend,
  weeklyAverages,
  recordWeight,
} from './domain/domain.js';
import {
  HABIT_SLOTS, HABIT_BLOCKS, HABIT_PRESETS,
  slotsFor, habitDay, blockAt, isLive,
  slotAt, hasAnySlot, isOffPlan, logSlot, setOffPlan, setHabitSchedule, archiveHabit,
  setHabitKind, presetAllowsMeals,
  habitDayState, habitStats, newHabit,
} from './domain/habits.js';
import { NOTICES } from './notices.js';
import { GUIDE_SECTIONS, GUIDE_INTRO } from './guide.js';
import { CATEGORIES, categoryOf, categoryLabel, categoryIconUrl } from './categories.js';
import * as gsync from './sync/googleSync.js';
import * as crewApi from './sync/crew.js';
import { allStats, exerciseStats, recentDayStates, workoutDates, streakTier, flameLevel, clusterByCategory, dayHistory, trajectorySeries, formatDuration, formatTotalDuration, formatMinutes, formatCount, buildCrewCard, formatClock, groupBySchedule, comboTimes } from './domain/stats.js';

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
  profile: { username: '', weight: null, height: null, weightLog: [], weighInDay: 6 },
  sync: { status: 'signed-out', email: null, error: null, pending: false },
  streakOverrides: {},
  habits: [],
  habitLog: {},
  noticesSeen: [],
  autoUpdated: false,
  /** The record of what was photographed — small, and synced. */
  proofLog: {},
  /** The pictures themselves — local only, never in a Drive snapshot. */
  proofImages: {},
  autoUpdated2: false,
  deletedExercises: {},
  storageError: false,
  updateAvailable: false,
  applyUpdate: null,
  modal: null,
  expandedDay: null,
  showArchived: false,
  editingPlanTarget: null,
  editingDayTarget: null,
  /**
   * The crew, exactly as the Worker last described it. Never patched locally —
   * every call returns the whole picture and replaces this — so the screen can
   * never drift from what the crew actually is.
   */
  crew: { crews: [], activeId: null, loading: false, error: null, lastSync: 0, pendingCode: null, refreshing: false, refreshedAt: 0 },
  editingTopSet: null,
  editingDayTotal: null,
  openExercise: null,
  openGroups: {},   // { [`${view}:${key}`]: true } — which schedule groups are expanded
  statHelp: {},     // { [`${exId}:${group}`]: true } — which stat groups are explaining themselves
  dayLimits: {},
  repMode: 'add',   // 'add' | 'sub' — the pad lever
  version: { local: typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev', status: 'unknown' },
  panel: null,          // 'stats' — mobile drawer only
};

/**
 * An exercise's picture, drawn from its category. Exercises saved before
 * categories existed have none, and render nothing rather than a placeholder —
 * a blank space says "pick one" far better than a generic dumbbell that looks
 * like a deliberate choice.
 */
function exIconHtml(ex, px) {
  const cat = categoryOf(ex);
  if (!cat) return '';
  return `<img class="ex-icon" src="${categoryIconUrl(cat.key)}" alt="" width="${px}" height="${px}">`;
}

/**
 * A one-off belongs to its day. After that it is hidden everywhere rather than
 * deleted: deletions travel through Drive sync, and this app has been bitten
 * once by a deletion propagating where it shouldn't. Hiding costs a few dozen
 * bytes and cannot corrupt another device.
 */
function isCurrent(ex) {
  return !ex.oneTimeDate || ex.oneTimeDate === todayISO();
}

/** The category, as a quiet tag. Deliberately mono and faint: it labels the
 *  exercise, it is never the number you are chasing. */
function catTagHtml(ex) {
  const label = categoryLabel(ex);
  return label ? `<span class="cat-tag">${escapeHtml(label)}</span>` : '';
}

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
/**
 * Point the database at the dataset belonging to `email`, and load it.
 *
 * The first account to sign in claims the existing unprefixed keys, so someone
 * who has been using the app for months signs in and finds everything exactly
 * where they left it — nothing is copied or migrated. A second, different
 * account gets its own namespace and therefore its own empty app.
 *
 * Returns true when the dataset actually changed, so callers know to re-render.
 */
async function useAccount(email) {
  const claimedBy = (await db.getItem('local-claimed-by').catch(() => null)) || null;
  if (email && !claimedBy) {
    await db.setItem('local-claimed-by', email).catch(() => {});
  }
  const ns = db.namespaceFor(email, claimedBy);
  if (ns === db.getNamespace()) return false;
  db.setNamespace(ns);
  await db.setItem('active-ns', ns).catch(() => {});
  await loadAll();
  return true;
}

/** Restore the dataset that was in use last launch, before anything renders. */
async function restoreNamespace() {
  const ns = (await db.getItem('active-ns').catch(() => '')) || '';
  db.setNamespace(ns);
}

async function loadAll() {
  const [exercises, setsLog, meta, timersLog, profile, streakOverrides, deletedExercises, habits, habitLog, noticesSeen, proofLog, proofImages] = await Promise.all([
    db.getItem('exercises'),
    db.getItem('sets-log'),
    db.getItem('app-meta'),
    db.getItem('timers-log'),
    db.getItem('profile'),
    db.getItem('streak-overrides'),
    db.getItem('deleted-exercises'),
    db.getItem('habits'),
    db.getItem('habit-log'),
    db.getItem('notices-seen'),
    db.getItem('proof-log'),
    db.getItem('proof-images'),
  ]);

  state.exercises = exercises || [];
  state.setsLog = setsLog || {};
  state.meta = meta || { lastExportAt: null };
  state.timersLog = timersLog || {};
  state.profile = profile || { username: '', weight: null, height: null, weightLog: [], weighInDay: 6 };
  state.streakOverrides = migrateOverrides(streakOverrides || {});
  state.deletedExercises = deletedExercises || {};
  // Absent reads as empty. Optional data must never be able to kill a screen.
  state.habits = habits || [];
  state.habitLog = habitLog || {};
  state.proofLog = proofLog || {};
  state.proofImages = proofImages || {};
  // The rule starts the first time this build runs, so everything already
  // finished stays finished. Written once and never moved.
  if (!state.meta.proofSince) {
    state.meta.proofSince = todayISO();
    db.setItem('app-meta', state.meta).catch(() => {});
  }
  // Pictures are the artifact, not the record: two days is long enough to look
  // back at one, and keeping them longer would fill the phone for nothing.
  const proofCutoff = addDays(todayISO(), -2);
  let prunedProof = false;
  for (const d in state.proofImages) {
    if (d < proofCutoff) { delete state.proofImages[d]; prunedProof = true; }
  }
  if (prunedProof) db.setItem('proof-images', state.proofImages).catch(() => {});
  // A genuinely fresh install starts with everything read: greeting a first-time
  // user with a backlog about features they have never not had is noise.
  //
  // An existing phone upgrading INTO the bell is NOT a fresh install, and
  // treating it as one is exactly how the first two notices went undelivered —
  // every device that already had data marked them read before anyone saw them.
  // "No notices-seen key" cannot tell the two apart; having data can.
  if (Array.isArray(noticesSeen)) {
    state.noticesSeen = noticesSeen;
  } else {
    const fresh = !state.exercises.length
      && !state.habits.length
      && !Object.keys(state.setsLog).length
      && !((state.profile && state.profile.weightLog) || []).length;
    state.noticesSeen = fresh ? NOTICES.map((n) => n.id) : [];
    db.setItem('notices-seen', state.noticesSeen).catch(() => {});
  }

  // One-time: start Top set fresh from today for every existing exercise, and
  // drop old manual corrections. Old and stray sets before today stop counting
  // toward Top set (only), so a bad number cannot haunt it. Runs once — an
  // exercise that already has topSetSince is left alone.
  const today = todayISO();
  let migrated = false;
  state.exercises.forEach((e) => {
    if (e.topSetSince === undefined) {
      e.topSetSince = today;
      if (e.topSetOverride !== undefined) delete e.topSetOverride;
      migrated = true;
    }
    // Seed schedule history so past days keep the schedule they had. Anchored at
    // the exercise's start with its current schedule, so this preserves today's
    // computation exactly — no streak shifts on upgrade. The recovery of days a
    // schedule change already hid comes from calcDayStats counting trained days,
    // not from this.
    if (e.scheduleHistory === undefined) {
      e.scheduleHistory = [{ effectiveDate: e.createdDate || today, schedule: e.schedule || 'daily' }];
      migrated = true;
    }
    // Seed weight history from the current weight, so a dumbbell exercise's
    // progression starts from what it already is rather than from nothing.
    if (e.weightHistory === undefined) {
      e.weightHistory = e.weight > 0
        ? [{ effectiveDate: e.createdDate || today, weight: e.weight, unit: e.weightUnit === 'lb' ? 'lb' : 'kg' }]
        : [];
      migrated = true;
    }
  });
  if (migrated) await db.setItem('exercises', state.exercises).catch(() => {});
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
async function persistProof() {
  try {
    await db.setItem('proof-log', state.proofLog);
    // Images are saved beside the record but deliberately kept out of the sync
    // snapshot — see the note on proofLog in domain.js.
    await db.setItem('proof-images', state.proofImages);
    markDirty();
    return true;
  } catch (e) {
    state.storageError = true;
    return false;
  }
}
async function persistHabits() {
  try {
    await db.setItem('habits', state.habits);
    markDirty();
    return true;
  } catch (e) {
    return false;
  }
}
async function persistHabitLog() {
  try {
    await db.setItem('habit-log', state.habitLog);
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
    deletedExercises: state.deletedExercises,
    setsLog: state.setsLog,
    timersLog: state.timersLog,
    profile: state.profile,
    streakOverrides: state.streakOverrides,
    habits: state.habits,
    habitLog: state.habitLog,
    proofLog: state.proofLog,
  };
}

/** Writes an already-merged snapshot down. Never called with a raw remote: what
 *  lands here is always the union of both sides, so nothing local is dropped. */
async function applyMergedSnapshot(merged) {
  applyingRemote = true;
  state.exercises = merged.exercises || [];
  state.deletedExercises = merged.deletedExercises || {};
  state.setsLog = merged.setsLog || {};
  state.timersLog = merged.timersLog || {};
  state.profile = merged.profile || { username: '', weight: null, height: null, weightLog: [], weighInDay: 6 };
  state.streakOverrides = merged.streakOverrides || {};
  state.habits = merged.habits || [];
  state.habitLog = merged.habitLog || {};
  state.proofLog = merged.proofLog || {};
  state.meta.updatedAt = merged.updatedAt || Date.now();
  await Promise.all([
    db.setItem('exercises', state.exercises),
    db.setItem('deleted-exercises', state.deletedExercises),
    db.setItem('sets-log', state.setsLog),
    db.setItem('timers-log', state.timersLog),
    db.setItem('profile', state.profile),
    db.setItem('streak-overrides', state.streakOverrides),
    db.setItem('habits', state.habits),
    db.setItem('habit-log', state.habitLog),
    db.setItem('proof-log', state.proofLog),
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
/**
 * A dead token is not an emergency. Everything is on the phone, and a backup
 * being a few hours old costs nothing — so an expired token queues quietly and
 * retries when the app next comes forward, instead of demanding you sign in
 * again. Only once a backup has not landed for a day is it worth interrupting,
 * because by then something really is stuck.
 */
function noteSyncFailure(err) {
  // Every sync failure is non-actionable here: the work is already safe on the
  // phone, and a backup being a little behind costs nothing. A dead token, a
  // network blip, a slow Drive — all queue quietly and retry when the app next
  // comes forward, rather than flashing a red "couldn't reach Drive" for a
  // hiccup that fixes itself. Genuinely stuck sync is caught by the once-a-week
  // line, which is the one place it's worth interrupting for.
  markSyncPending();
  endSyncing('pending');
}

/**
 * Last-resort guarantee that 'syncing' is never a terminal state. Every path
 * into it is supposed to finish on its own, but a stuck spinner with no way
 * out is the worst possible failure here — the app is local-first and works
 * fine offline, so it should always fall through to something actionable.
 */
let syncWatchdog = null;
/**
 * Longer than the work it guards. One cycle is three Drive requests — find,
 * download, upload — each allowed 15s, so a slow-but-healthy sync can run to
 * ~45s. At 20s this fired routinely on mobile data and reported "Sync paused",
 * which is why sync kept appearing to drop out: the watchdog was faster than
 * the network, and it blamed consent for what was only slowness.
 */
const SYNC_WATCHDOG_MS = 60000;

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
      state.sync.error = null;
    } else {
      // Do not ask for consent over a slow network. Nothing is known to be
      // wrong with the account, so say what is true and keep the work queued.
      markSyncPending();
      state.sync.status = 'pending';
      state.sync.error = null;
    }
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
  renderBanner();
  // Signing in finishes after the view has already drawn, and the crew screen
  // is the one that changes completely when it does.
  if (state.view === 'social') renderView();
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
let syncInFlight = null;
let syncQueued = false;

/**
 * One cycle at a time. Without this, a rep logged mid-sync started a second
 * overlapping cycle that re-armed the watchdog and could report a failure for
 * work the first cycle had already done. A request arriving during a sync is
 * coalesced into a single follow-up run.
 */
async function syncNow() {
  if (syncInFlight) { syncQueued = true; return syncInFlight; }
  syncInFlight = runSyncCycle();
  try {
    await syncInFlight;
  } finally {
    syncInFlight = null;
    if (syncQueued) { syncQueued = false; syncNow(); }
  }
  return undefined;
}

/**
 * One device, so this is a BACKUP, not a sync.
 *
 * The phone is the only place data is edited, which means there is nothing to
 * reconcile: the cycle uploads and never quietly rewrites what is on the phone.
 * That removes the entire class of conflict the merge existed to survive — and
 * with it the reconnect prompts that came from a cycle needing three network
 * round trips before it could finish.
 *
 * Coming the other way is an explicit act (Restore from backup), because
 * replacing what is on the phone should never happen without being asked for.
 */
async function runSyncCycle() {
  if (!hasSyncAccount()) { endSyncing(state.sync.connected ? 'reconnect' : 'signed-out'); renderSyncUI(); return; }
  if (!isOnline()) { markSyncPending(); endSyncing('pending'); renderSyncUI(); return; }
  try {
    beginSyncing(); renderSyncUI();
    const remote = await gsync.downloadBackup();
    const local = buildSyncSnapshot();
    const merged = mergeSyncSnapshots(local, remote);
    // Only rewrite and re-render when the cloud actually brought back something
    // different. Every backup cycle used to rebuild the whole view even when the
    // merge equalled what was already here — a full innerHTML swap mid-use, seen
    // as a flash. On one device the merge almost always matches, so this is
    // silent; a genuine change from another device still applies.
    if (remote && !sameSnapshotData(local, merged)) await applyMergedSnapshot(merged);
    await gsync.uploadBackup(merged);
    await clearSyncPending();
    state.sync.lastBackupAt = Date.now();
    db.setItem('sync-last-backup', state.sync.lastBackupAt).catch(() => {});
    endSyncing('synced');
  } catch (e) {
    // The work is safe on the phone regardless; the backup can wait.
    markSyncPending();
    noteSyncFailure(e);
  }
  renderSyncUI();
}

const pullAndMerge = syncNow;

async function googleSignInHandler() {
  beginSyncing(); state.sync.error = null; renderModal();
  // With the broker deployed, sign in through the code flow so we get a refresh
  // token and never-stale sync. This leaves the page; the returned code is traded
  // for tokens in init() on the way back. Without the broker, the popup flow below
  // is unchanged.
  if (gsync.brokerConfigured()) { gsync.brokerSignIn(state.sync.email || null); return; }
  const ok = await gsync.signIn();
  if (ok) {
    // The email may not have arrived yet (background lookup) — record the
    // connection itself, which is what sync and resume actually depend on.
    state.sync.connected = true;
    await db.setItem('sync-enabled', true).catch(() => {});
    // The address is no longer cosmetic: it decides whose dataset is loaded, so
    // nothing may sync until it lands. Pushing first would send whoever's data
    // happens to be open into the Drive of whoever just signed in.
    const email = await gsync.ensureEmail();
    if (!email) {
      endSyncing('pending');
      showToast("Signed in, but Google didn't confirm which account. Sync will pick it up.");
      renderSyncUI();
      return;
    }
    state.sync.email = email;
    await db.setItem('sync-account', email).catch(() => {});
    if (await useAccount(email)) render();
    await syncNow();
  } else {
    // access_denied means Google ended the flow without granting - usually the
    // person closing the consent screen. Whatever the cause, "try again" is the
    // wrong note to end on for someone who may think the app is broken: the app
    // has never needed an account, and nothing they logged is at risk.
    const denied = gsync.getLastAuthError() === 'access_denied';
    endSyncing(state.sync.email ? 'reconnect' : 'signed-out',
      denied
        ? 'Google ended the sign-in before it finished. Backup is optional — everything you log is saved on this device either way.'
        : state.sync.email ? null : 'Sign-in didn\u2019t go through — try again.');
    renderSyncUI();
  }
}
async function googleSignOutHandler() {
  gsync.signOut();
  clearTimeout(syncWatchdog);
  state.sync = { status: 'signed-out', email: null, error: null, connected: false, pending: false, lastBackupAt: 0 };
  await Promise.all([
    db.setItem('sync-account', null).catch(() => {}),
    db.setItem('sync-enabled', false).catch(() => {}),
    db.setItem('sync-token', null).catch(() => {}),
    db.setItem('sync-last-backup', null).catch(() => {}),
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
  const [savedEmail, enabled, pending, token, lastBackup] = await Promise.all([
    db.getItem('sync-account').catch(() => null),
    db.getItem('sync-enabled').catch(() => null),
    db.getItem('sync-pending').catch(() => null),
    db.getItem('sync-token').catch(() => null),
    db.getItem('sync-last-backup').catch(() => null),
  ]);
  // Resume on either signal: the email may never have been captured (the
  // userinfo lookup can fail while sync itself works fine), so the connection
  // flag is the authoritative one.
  if (!savedEmail && !enabled) return;
  // Queued work survives being closed while offline.
  state.sync.pending = !!pending;
  state.sync.lastBackupAt = lastBackup || 0;

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

  // A token still in date is worth more than a silent re-auth Safari will
  // block: reuse it and sync immediately rather than asking to reconnect.
  const renewed = !!(redirectResult && redirectResult.ok);
  if (renewed) db.setItem('sync-redirect-at', 0).catch(() => {});
  const restored = storedTokenUsable(token, Date.now()) && gsync.restoreSession(token);
  const ok = renewed || restored || await gsync.trySilentSignIn(savedEmail);

  // Last resort before giving up: renew by top-level redirect, the only silent
  // path Safari permits. Guarded hard, because a redirect that never comes back
  // with a token would otherwise loop on every launch — at most one attempt an
  // hour, and never straight after one that just failed.
  if (!ok && gsync.canRedirectRenew() && isOnline()) {
    const lastTry = (await db.getItem('sync-redirect-at').catch(() => 0)) || 0;
    const failedJustNow = redirectResult && !redirectResult.ok;
    if (!failedJustNow && Date.now() - lastTry > 60 * 60 * 1000) {
      await db.setItem('sync-redirect-at', Date.now()).catch(() => {});
      gsync.redirectRenew(savedEmail);
      return;
    }
  }
  if (ok) {
    state.sync.email = gsync.getSignedInEmail() || savedEmail || null;
    if (state.sync.email) db.setItem('sync-account', state.sync.email).catch(() => {});
    // Same rule as an interactive sign-in: settle whose data this is before any
    // of it leaves the device. `savedEmail` normally makes this a no-op.
    if (state.sync.email && await useAccount(state.sync.email)) render();
    await pullAndMerge();
  } else {
    // Google would not renew silently — expected on iOS, where the cookies that
    // flow depends on are blocked. Opening the app must not greet anyone with a
    // demand to sign in again, so the backup simply waits. The account stays
    // visible and reconnecting remains available inside the profile.
    markSyncPending();
    endSyncing('pending');
    renderSyncUI();
  }
}
async function saveProfile() {
  const username = (document.getElementById('f-username').value || '').trim().slice(0, 24);
  const weightRaw = document.getElementById('f-weight').value;
  const heightRaw = document.getElementById('f-height').value;
  const weight = weightRaw === '' ? null : Math.max(0, parseFloat(weightRaw));
  const height = heightRaw === '' ? null : Math.max(0, parseFloat(heightRaw));
  // Spread what is already there: this form does not edit the photo, and
  // rebuilding the object from its fields alone silently deleted it.
  // Editing the profile is not weighing in. Correcting a username or a height
  // must not log a weight, so only the Log weight button writes the daily
  // entry — the number here still moves BMI, it just does not claim a weigh-in.
  state.profile = {
    ...state.profile,
    username,
    weight: isNaN(weight) ? null : weight,
    height: isNaN(height) ? null : height,
  };
  await persistProfile();
  renderTopbar();
  showToast('Profile saved');
}

/* ============================= MUTATIONS ============================= */
async function logSet(exId, value) {
  if (!(value > 0)) return;
  if (sealedToday(exId)) return;
  const d = todayISO();
  const prevArr = getSetsFor(exId, d);
  state.setsLog = addSetPure(state.setsLog, d, exId, value);
  const ex = state.exercises.find((e) => e.id === exId);
  const total = calcTotal(getSetsFor(exId, d));
  const prevScore = progressValue(ex, prevArr);
  const score = progressValue(ex, getSetsFor(exId, d));
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
  const crossed = targetNow && prevScore < targetNow && score >= targetNow;
  if (crossed) {
    state.timersLog = pauseTimerPure(state.timersLog, d, exId, now);
    // The clock stopping is also the day being finished, and that time is what
    // Today, Progress and your crew all show.
    state.timersLog = stampFinishedPure(state.timersLog, d, exId, now);
  }

  await Promise.all([persistSets(), persistTimers(), newPR ? persistExercises() : Promise.resolve()]);

  const unit = ex && ex.unit ? ' ' + ex.unit : '';
  if (crossed) {
    const t = getTimerPure(state.timersLog, d, exId);
    state.modal = { type: 'complete', exId, total, elapsedMs: t ? t.elapsedMs : 0 };
    renderModal();
  } else {
    const base = newPR ? `🏆 New PR! Target raised to ${total}${unit}` : `Logged ${value}${unit}`;
    showToast(base, () => undoLastSetHandler(exId));
  }
  rerender();
}

/** "Take the win" — bank the workout and stop the clock. */
async function takeTheWinHandler(exId) {
  const d = todayISO();
  const ex = state.exercises.find((e) => e.id === exId);
  state.timersLog = finishTimerPure(state.timersLog, d, exId, Date.now(), 'completed');
  await persistTimers();
  await bankTime(exId);
  closeModal();
  rerender();

}

/** "Keep going" — clock resumes, everything keeps counting. */
async function keepGoingHandler(exId) {
  // Record the choice, don't infer it from the clock: the day is past its
  // target now, so without this marker the next pause would seal it.
  state.timersLog = markPushingOn(state.timersLog, todayISO(), exId);
  const now = Date.now();
  state.timersLog = resumeTimerPure(state.timersLog, todayISO(), exId, now);
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
 * number you got wrong, which is what the Progress day list is for — the only
 * place a whole day's total can still be typed. Today has no such field: there,
 * a number you did is a SET, and Exact set is how you enter one.
 */
async function setTotalHandler(exId, dateStr, rawValue) {
  const parsed = rawValue === '' || rawValue == null ? null : parseFloat(rawValue);
  const value = (parsed == null || isNaN(parsed) || parsed <= 0) ? null : Math.round(parsed * 100) / 100;
  state.setsLog = setDayTotalPure(state.setsLog, dateStr, exId, value);
  await persistSets();
  renderView();
  if (state.modal && state.modal.type === 'logger') renderModal();
}

/**
 * One set of exactly what was typed — the fix for a real 28 arriving as 20 + 8.
 * It goes through the same `logSet` as every pad key, so the PR bump, the
 * target crossing and the undo toast all behave identically; the only thing
 * that is new is where the number came from.
 */
async function exactSetHandler(exId, rawValue) {
  const parsed = parseFloat(rawValue);
  if (!(parsed > 0)) { showToast('Type a number first.'); return; }
  const value = Math.round(parsed * 100) / 100;
  if (state.modal) state.modal.exactOpen = false;
  if (state.repMode === 'sub') await decrementHandler(exId, value);
  else await logSet(exId, value);
  if (state.modal && state.modal.type === 'logger') renderModal();
}
/**
 * A time exercise's total IS its clock, so every transition that stops the
 * clock writes the minutes into the day's log — pause included. Stopping for a
 * phone call and never coming back must not lose the work you already did.
 *
 * One entry, overwritten each time (`bankTimeSession` in the domain), because a
 * session is one unbroken effort and the clock only ever grows.
 */
async function bankTime(exId) {
  const ex = state.exercises.find((e) => e.id === exId);
  if (!isTimeMode(ex)) return;
  const d = todayISO();
  const t = getTimerPure(state.timersLog, d, exId);
  state.setsLog = bankTimeSessionPure(state.setsLog, d, exId, minutesFromMs(timerElapsedMs(t, Date.now())));
  await persistSets();
}

/** The one button a time exercise needs: there are no reps to start its clock. */
async function startTimeSessionHandler(exId) {
  if (sealedToday(exId)) return;
  state.timersLog = startTimerPure(state.timersLog, todayISO(), exId, Date.now());
  await persistTimers();
  renderModal();
  renderView();
  ensureGlobalTick();
}

async function pauseTimerHandler(exId) {
  state.timersLog = pauseTimerPure(state.timersLog, todayISO(), exId, Date.now());
  await persistTimers();
  await bankTime(exId);
  renderModal();
  renderView();
}
async function resumeTimerHandler(exId) {
  const now = Date.now();
  state.timersLog = resumeTimerPure(state.timersLog, todayISO(), exId, now);
  await persistTimers();
  renderModal();
  renderView();
}
async function giveUpTimerHandler(exId) {
  state.timersLog = finishTimerPure(state.timersLog, todayISO(), exId, Date.now(), 'gaveup');
  await persistTimers();
  // Ending early still banks what the clock actually did — the minutes are the
  // work; only the *time stat* is forfeited, exactly as it is for reps.
  await bankTime(exId);
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
  return workoutSealed(getTimerPure(state.timersLog, d, exId), progressValue(ex, getSetsFor(exId, d)), getEffectiveTarget(ex, d));
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
  // On a time exercise the clock is the record, so clearing it clears the day.
  await bankTime(exId);
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
  // Tombstone the id so sync cannot resurrect it from the copy still in Drive.
  state.deletedExercises = { ...state.deletedExercises, [id]: Date.now() };
  await Promise.all([persistExercises(), persistSets(), db.setItem('deleted-exercises', state.deletedExercises)]);
  closeModal();
  rerender();
}
async function addExercise(data) {
  const now = todayISO();
  const maxOrder = state.exercises.filter((e) => e.active).reduce((m, e) => Math.max(m, e.order || 0), -1);
  const ex = {
    id: uid('ex'),
    name: data.name.trim(),
    category: data.category || null,
    // Set only for a one-off. Its presence is the whole feature: isScheduledOn
    // reads it, and every view follows from that.
    oneTimeDate: data.oneTimeDate || null,
    unit: (data.unit || 'reps').trim(),
    mode: data.mode === 'time' ? 'time' : 'count',
    active: true,
    archived: false,
    order: maxOrder + 1,
    createdDate: now,
    topSetSince: now,
    schedule: data.schedule || 'daily',
    scheduleHistory: [{ effectiveDate: now, schedule: data.schedule || 'daily' }],
    equipment: data.equipment === 'dumbbell' ? 'dumbbell' : 'bodyweight',
    weight: data.weight != null ? data.weight : null,
    weightUnit: data.weightUnit === 'lb' ? 'lb' : 'kg',
    weightHistory: data.weight > 0 ? [{ effectiveDate: now, weight: data.weight, unit: data.weightUnit === 'lb' ? 'lb' : 'kg' }] : [],
    targetHistory: [{ effectiveDate: now, target: data.target || null }],
    targetMode: data.targetMode === 'sets' ? 'sets' : 'reps',
    // Both numbers are kept. A reps target and a sets target describe different
    // workouts, so switching modes must restore what that mode last held rather
    // than inheriting a number that meant something else.
    targetByMode: { [data.targetMode === 'sets' ? 'sets' : 'reps']: data.target || null },
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

/**
 * A schedule change takes effect today and leaves every past day on the
 * schedule it already had — the same append-don't-overwrite rule as targets,
 * so changing your days can never move a streak or hide a trained day.
 */
function applyScheduleChange(ex, newSchedule) {
  const today = todayISO();
  const sched = newSchedule || 'daily';
  if (!Array.isArray(ex.scheduleHistory)) {
    ex.scheduleHistory = [{ effectiveDate: ex.createdDate || today, schedule: ex.schedule || 'daily' }];
  }
  const sameAsNow = JSON.stringify(scheduleEffectiveOn(ex, today)) === JSON.stringify(sched);
  if (!sameAsNow) {
    const todEntry = ex.scheduleHistory.find((h) => h.effectiveDate === today);
    if (todEntry) todEntry.schedule = sched;
    else ex.scheduleHistory.push({ effectiveDate: today, schedule: sched });
  }
  ex.schedule = sched; // mirror of the current value, for the editor and labels
}
async function updateExercise(id, data) {
  const ex = state.exercises.find((e) => e.id === id);
  if (!ex) return;
  ex.name = data.name.trim();
  if (data.category !== undefined) ex.category = data.category;
  ex.unit = (data.unit || 'reps').trim();
  if (data.mode !== undefined) ex.mode = data.mode === 'time' ? 'time' : 'count';
  // Not dated history like the target itself: the mode is what the number MEANS,
  // and a past day's number was always counted the way it was counted. Rewriting
  // that retroactively is the one thing dated history exists to prevent.
  if (data.targetMode !== undefined) {
    const tmode = data.targetMode === 'sets' ? 'sets' : 'reps';
    ex.targetMode = tmode;
    ex.targetByMode = { ...(ex.targetByMode || {}), [tmode]: data.target || null };
  }
  applyScheduleChange(ex, data.schedule || 'daily');
  if (data.equipment !== undefined) ex.equipment = data.equipment === 'dumbbell' ? 'dumbbell' : 'bodyweight';
  if (data.weightUnit !== undefined) ex.weightUnit = data.weightUnit === 'lb' ? 'lb' : 'kg';
  if (data.weight !== undefined) applyWeightChange(ex, data.weight, ex.weightUnit);
  applyTargetChange(ex, data.target || null);
  await persistExercises();
}
/**
 * Records a dumbbell weight change with today's date, so Progress can show a
 * progression. Weight is display-only and feeds no stat, so history exists just
 * to remember the steps — appended when the number changes, never overwriting.
 */
function applyWeightChange(ex, weight, unit) {
  const w = weight != null && weight > 0 ? weight : null;
  ex.weight = w;
  if (!Array.isArray(ex.weightHistory)) ex.weightHistory = [];
  if (w == null) return; // clearing the weight leaves the history intact
  const today = todayISO();
  const last = ex.weightHistory[ex.weightHistory.length - 1];
  if (last && last.effectiveDate === today) { last.weight = w; last.unit = unit; }
  else if (!last || last.weight !== w || last.unit !== unit) {
    ex.weightHistory.push({ effectiveDate: today, weight: w, unit });
  }
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
 * The app's mark.
 *
 * Drawn art now, not a hand-built SVG: the same picture as the home-screen
 * icon, so the thing in the bar and the thing you tapped to get here are one
 * image. It carries its own two colours rather than taking `currentColor`,
 * which is why it looks identical in both themes — an app icon should.
 */
const LOGO_MARK = `<img class="brand-mark" src="${import.meta.env.BASE_URL}icons/icon-192.png" alt="Sets" width="30" height="30">`;

const ICONS = {
  // A cut-cornered ring rather than a circle: the same faceted shape as the
  // mark, and it still reads as a clock at 22px because the hands carry it.
  // Painted flat in currentColor and roughened by CSS, the way the mark is.
  // The drips are drawn, not filtered: at 22px a filtered drip is a stray pixel
  // that reads as a rendering fault, while a placed one reads as paint. Two per
  // icon, unequal lengths — three starts looking like a pattern.
  today: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.6" stroke="var(--accent)" stroke-width="1.9" fill="none"/><path d="M9.1 21.1h1.05v2.1a.52.52 0 0 1-1.05 0z" fill="var(--accent)"/><path d="M14.2 20.6h1.05v1.35a.52.52 0 0 1-1.05 0z" fill="var(--accent)"/><g transform="translate(12 12) scale(0.56) translate(-12 -12)"><path d="M8.6 3h6.8L21 8.6v6.8L15.4 21H8.6L3 15.4V8.6z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="miter"/><path d="M12 7.4V12l3.3 2.3" stroke="currentColor" stroke-width="2" stroke-linecap="square" stroke-linejoin="miter"/></g></svg>`,
  // Solid blocks, not hairlines — a plan is a stack of things you committed to.
  plan: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.6" stroke="var(--accent)" stroke-width="1.9" fill="none"/><path d="M9.1 21.1h1.05v2.1a.52.52 0 0 1-1.05 0z" fill="var(--accent)"/><path d="M14.2 20.6h1.05v1.35a.52.52 0 0 1-1.05 0z" fill="var(--accent)"/><g transform="translate(12 12) scale(0.56) translate(-12 -12)"><path d="M4 5.6h16v2.7H4zM4 10.65h16v2.7H4zM4 15.7h9.4v2.7H4z" fill="currentColor"/></g></svg>`,
  // The same blocks stood up and climbing, so Plan and Progress stay siblings
  // without being twins.
  progress: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.6" stroke="var(--accent)" stroke-width="1.9" fill="none"/><path d="M9.1 21.1h1.05v2.1a.52.52 0 0 1-1.05 0z" fill="var(--accent)"/><path d="M14.2 20.6h1.05v1.35a.52.52 0 0 1-1.05 0z" fill="var(--accent)"/><g transform="translate(12 12) scale(0.56) translate(-12 -12)"><path d="M3.6 13.4h3.6V20H3.6zM10.2 8.2h3.6V20h-3.6zM16.8 3.8h3.6V20h-3.6z" fill="currentColor"/></g></svg>`,
  flame: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 2c1 3-2 4-2 7a4 4 0 108 0c0-1-.4-2-1-3 2 1 4 3.5 4 6.5A7 7 0 015 12.5C5 8 8 6 12 2z" fill="var(--accent)"/></svg>`,
  close: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  plus: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  bell: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  camera: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 8h3.2l1.4-2h6.8l1.4 2H20v11H4z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="miter"/><circle cx="12" cy="13" r="3.3" stroke="currentColor" stroke-width="1.8"/></svg>`,
  chevron: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  trash: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 12a1 1 0 001 1h6a1 1 0 001-1l1-12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  up: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M6 15l6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  down: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  edit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 20l.8-3.6L16.6 4.6a1.5 1.5 0 012.1 0l.7.7a1.5 1.5 0 010 2.1L7.6 19.2 4 20z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  archive: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M5 7v11a1 1 0 001 1h12a1 1 0 001-1V7M9 11h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  restore: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 8a8 8 0 111.6 6.4M4 4v4h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  check: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="var(--success)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  share: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="M12 3v12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 7l4-4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 13v6.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  // Squared shoulders and mitred joins, so the crew reads as built rather than
  // sketched. The heads stay round — a square-headed person icon stops being one.
  people: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.6" stroke="var(--accent)" stroke-width="1.9" fill="none"/><path d="M9.1 21.1h1.05v2.1a.52.52 0 0 1-1.05 0z" fill="var(--accent)"/><path d="M14.2 20.6h1.05v1.35a.52.52 0 0 1-1.05 0z" fill="var(--accent)"/><g transform="translate(12 12) scale(0.56) translate(-12 -12)"><circle cx="9" cy="7.8" r="3.1" stroke="currentColor" stroke-width="1.9"/><path d="M3.4 19.6v-1.5c0-2.2 2.5-3.5 5.6-3.5s5.6 1.3 5.6 3.5v1.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="square" stroke-linejoin="miter"/><circle cx="17.2" cy="9.2" r="2.4" stroke="currentColor" stroke-width="1.7"/><path d="M16.6 14.9c2.5.2 4 1.3 4 3.2v1.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="square" stroke-linejoin="miter"/></g></svg>`,
  // An open book, squared off. The old glyph read as a bookmark or a bracket
  // depending on the size, which is a bad thing for the tab that explains things.
  book: `<svg width="26" height="26" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9.6" stroke="var(--accent)" stroke-width="1.9" fill="none"/><path d="M9.1 21.1h1.05v2.1a.52.52 0 0 1-1.05 0z" fill="var(--accent)"/><path d="M14.2 20.6h1.05v1.35a.52.52 0 0 1-1.05 0z" fill="var(--accent)"/><g transform="translate(12 12) scale(0.56) translate(-12 -12)"><path d="M12 6.4C10.4 5.1 8.3 4.4 5 4.4v13.2c3.3 0 5.4.7 7 2z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="miter"/><path d="M12 6.4c1.6-1.3 3.7-2 7-2v13.2c-3.3 0-5.4.7-7 2z" stroke="currentColor" stroke-width="1.9" stroke-linejoin="miter"/></g></svg>`,
  bulb: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9.5 18h5M10.2 21h3.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2h5c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
  help: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.7"/><path d="M9.6 9.2a2.5 2.5 0 114.2 1.9c-.9.7-1.3 1.1-1.3 2.1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="12" cy="17" r="1" fill="currentColor"/></svg>`,
  gear: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" stroke-width="1.7"/><path d="M19.4 13.5a1.7 1.7 0 000-3l-1-.2a6.6 6.6 0 00-.7-1.6l.6-.9a1.7 1.7 0 00-2.4-2.4l-.9.6a6.6 6.6 0 00-1.6-.7l-.2-1a1.7 1.7 0 00-3 0l-.2 1a6.6 6.6 0 00-1.6.7l-.9-.6a1.7 1.7 0 00-2.4 2.4l.6.9a6.6 6.6 0 00-.7 1.6l-1 .2a1.7 1.7 0 000 3l1 .2a6.6 6.6 0 00.7 1.6l-.6.9a1.7 1.7 0 002.4 2.4l.9-.6a6.6 6.6 0 001.6.7l.2 1a1.7 1.7 0 003 0l.2-1a6.6 6.6 0 001.6-.7l.9.6a1.7 1.7 0 002.4-2.4l-.6-.9a6.6 6.6 0 00.7-1.6l1-.2z" stroke="currentColor" stroke-width="1.3"/></svg>`,
  play: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M7 5.5v13l11-6.5-11-6.5z" fill="currentColor"/></svg>`,
  pause: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M8 5.5h3v13H8v-13zM13 5.5h3v13h-3v-13z" fill="currentColor"/></svg>`,
  flag: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M6 3v18M6 4h11l-2.5 3.5L17 11H6" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
  trophy: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M7 4h10v4a5 5 0 01-10 0V4z" stroke="currentColor" stroke-width="1.6"/><path d="M7 5H4a3 3 0 003 3M17 5h3a3 3 0 01-3 3M12 13v3m-3 4h6m-3-4v0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  google: `<svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.2-2.2H12v4.2h6.5c-.1 1.1-.9 2.7-2.5 3.8l4 3.1c2.4-2.2 3.5-5.4 3.5-8.9z"/><path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.9-2.8l-4-3.1c-1.1.7-2.5 1.2-3.9 1.2-3 0-5.6-2-6.5-4.8l-4.1 3.2C3.4 21.5 7.4 24 12 24z"/><path fill="#FBBC05" d="M5.5 14.5c-.2-.7-.4-1.4-.4-2.5s.1-1.7.4-2.5L1.4 6.3C.5 8 0 9.9 0 12s.5 4 1.4 5.7l4.1-3.2z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3 .8 3.7 1.4l3.5-3.4C17.4 1 14.8 0 12 0 7.4 0 3.4 2.5 1.4 6.3l4.1 3.2C6.4 6.8 9 4.8 12 4.8z"/></svg>`,
  user: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.6" stroke="currentColor" stroke-width="1.7"/><path d="M4.5 20c1.5-4 4.3-6 7.5-6s6 2 7.5 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  lock: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="10" stroke="currentColor" stroke-width="1.8"/><path d="M8 10.5V7.5a4 4 0 118 0v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
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
  // The app never nags about an expired Google token, because interrupting
  // someone cannot fix one. The cost of that silence is that sync can lapse
  // unnoticed, so this is the one mention it gets — at most once a week, and
  // never at all for anyone who syncs more often than that.
  if (hasSyncAccount() && state.sync.status !== 'syncing') {
    const stale = syncNudge(state.sync.lastBackupAt, Date.now());
    if (stale) {
      const how = stale.days == null ? 'Not synced yet' : `Not synced for ${stale.days} days`;
      banners.push(`<div class="banner"><span>${how}. Your workouts are safe on this phone.</span><button data-action="nudge-sync">Sync</button></div>`);
    }
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
  // Scale to the data, not to the window. Plotting a 12-day history against a
  // fixed 30-day axis pinned every dot to the right third and left two thirds of
  // the chart empty — the shape of the climb was squeezed into a corner for no
  // reason. Spacing stays proportional to real dates, so a gap is still a gap.
  const firstIdx = points[0].dayIndex;
  const lastIdx = points[points.length - 1].dayIndex;
  const idxSpan = Math.max(1, lastIdx - firstIdx);
  const daysShown = lastIdx - firstIdx + 1;
  const x = (i) => padL + ((i - firstIdx) / idxSpan) * (W - padL - padR);
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
  const first = points[0];
  const last = points[points.length - 1];
  const label = (p, anchor) => `<text class="traj-label" x="${x(p.dayIndex).toFixed(1)}" y="${(y(p.total) - 8).toFixed(1)}" text-anchor="${anchor}">${p.total}</text>`;
  // Two labels that land on top of each other are worse than one. The latest
  // value always wins; the best is only named when it is far enough away to read.
  const labelBest = best !== last && Math.abs(x(best.dayIndex) - x(last.dayIndex)) > 34;
  // The starting point, added on top: skipped when it would sit under either
  // label already on the chart, since a clash costs more than the number gives.
  const labelFirst = first !== last && first !== best
    && Math.abs(x(first.dayIndex) - x(last.dayIndex)) > 34
    && (!labelBest || Math.abs(x(first.dayIndex) - x(best.dayIndex)) > 34);

  // Where you started, where you are, and the gap between — the question a line
  // chart is actually asked, and the one the dots alone never answered.
  const delta = last.total - first.total;
  const deltaText = delta > 0 ? `+${formatCount(delta)}` : delta < 0 ? `\u2212${formatCount(-delta)}` : '';
  // "Since you started" only when the first plotted day really is the first day
  // ever logged. This is a 30-day window, so for anyone with a longer history it
  // would otherwise claim a beginning that is just the left edge of the chart.
  const firstEver = workoutDates(ex.id, state.setsLog)[0];
  const deltaNote = `${escapeHtml(ex.unit)} ${firstEver === first.date ? 'since you first started' : `in ${daysShown} days`}`;

  const marks = points.map((p) => `<circle class="traj-dot ${p.hit ? 'hit' : 'short'}" cx="${x(p.dayIndex).toFixed(1)}" cy="${y(p.total).toFixed(1)}" r="4"/>`).join('');

  return `<div class="traj">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily totals over the last 30 days for ${escapeHtml(ex.name)}: ${first.total} on ${escapeHtml(first.date)} rising to ${last.total} on ${escapeHtml(last.date)}, a change of ${delta}, best ${best.total}">
      ${hasTargetLine ? `<path class="traj-target" d="${targetPath.trim()}"/>` : ''}
      <polyline class="traj-line" points="${line}"/>
      ${marks}
      ${label(last, 'end')}
      ${labelBest ? label(best, 'middle') : ''}
      ${labelFirst ? label(first, 'start') : ''}
      ${deltaText ? `<text class="traj-delta ${delta > 0 ? 'up' : 'down'}" x="${padL}" y="10">${deltaText}<tspan class="traj-delta-note" dx="4">${deltaNote}</tspan></text>` : ''}
      <text class="traj-axis" x="${padL}" y="${H - 4}" text-anchor="start">${escapeHtml(formatDisplayDate(points[0].date, { month: 'short', day: 'numeric' }))}</text>
      <text class="traj-axis" x="${W - padR}" y="${H - 4}" text-anchor="end">${escapeHtml(formatDisplayDate(last.date, { month: 'short', day: 'numeric' }))}</text>
      <text class="traj-axis traj-window" x="${W / 2}" y="${H - 4}" text-anchor="middle">${daysShown} days</text>
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
        <span class="ex-stat-icon">${exIconHtml(ex, 38)}</span>
        <h3>${escapeHtml(ex.name)}${weightTag(ex)}${categoryLabel(ex) ? `<span class="ex-stat-cat">${catTagHtml(ex)}</span>` : ''}</h3>
        ${action}
      </button>`
    : `<header class="ex-stat-head static">
        <span class="ex-stat-icon">${exIconHtml(ex, 38)}</span>
        <h3>${escapeHtml(ex.name)}${weightTag(ex)}${categoryLabel(ex) ? `<span class="ex-stat-cat">${catTagHtml(ex)}</span>` : ''}</h3>
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

  // Where you actually began, from the whole log rather than the chart's window.
  // The chart only reaches back 30 days, so its leftmost dot is the edge of the
  // view, not the start of the story — this tile is the one that never moves.
  const firstDate = workoutDates(ex.id, state.setsLog)[0];
  const firstTotal = firstDate ? calcTotal(getSetsFor(ex.id, firstDate)) : null;

  /**
   * Seven numbers in one undifferentiated grid read as a spec sheet. They are
   * really two questions — how much, and how long — so they are shown as two
   * groups, and a stat with nothing in it is not shown at all. Someone who never
   * starts the clock loses the entire second group rather than reading three
   * dashes.
   */
  /**
   * Each group carries one "?" rather than a caption per number. Seven captions
   * would say more than the numbers do; one, folded away until asked, says the
   * same thing and costs nothing while it is shut.
   */
  const group = (tiles, key, help) => {
    const filled = tiles.filter(Boolean);
    if (!filled.length) return '';
    const open = !!state.statHelp[`${ex.id}:${key}`];
    return `<div class="stat-group">
      <button class="stat-help-btn ${open ? 'on' : ''}" data-action="toggle-stat-help"
        data-key="${ex.id}:${key}" aria-expanded="${open}" aria-label="What these numbers mean">${ICONS.bulb}</button>
      <dl class="ex-numbers">${filled.join('')}</dl>
      ${open ? `<div class="stat-help">${help}</div>` : ''}
    </div>`;
  };
  const has = (v) => v != null && v !== '' && v !== '—';

  // A time exercise answers the same four questions in the same order, in its
  // own currency — and drops "fastest session", which is a race's idea of good,
  // not a 30-minute session's.
  const timeMode = isTimeMode(ex);
  const timeExTiles = [
    has(s.topSet) && num('Longest session', formatMinutes(s.topSet)),
    firstTotal != null && num('First day', `${formatMinutes(firstTotal)} <i>${escapeHtml(formatDisplayDate(firstDate, { month: 'short', day: 'numeric' }))}</i>`),
    has(formatDuration(s.avgTime)) && num('Average session', formatDuration(s.avgTime)),
    s.totalReps > 0 && num('Lifetime', `${formatMinutes(s.totalReps)} <b class="life-of">of ${escapeHtml(ex.name.toLowerCase())}</b>${s.since ? ` <i>since ${escapeHtml(s.since)}</i>` : ''}`),
  ];

  const repsTiles = [
    has(s.topSet) && num('Top set', `<button class="mini-num" data-action="edit-top-set" data-id="${ex.id}">${s.topSet}</button>`),
    firstTotal != null && num('First day', `${firstTotal} <i>${escapeHtml(formatDisplayDate(firstDate, { month: 'short', day: 'numeric' }))}</i>`),
    has(s.maxReps) && num('Best day', `${s.maxReps}${s.maxRepsDate ? ` <i>${escapeHtml(formatDisplayDate(s.maxRepsDate, { month: 'short', day: 'numeric' }))}</i>` : ''}`),
    // "2,065" alone made you remember which card you were in. The name earns
    // its place here and nowhere else — every other tile is read in context.
    s.totalReps > 0 && num('Lifetime', `${formatCount(s.totalReps)} <b class="life-of">${escapeHtml(ex.name.toLowerCase())}</b>${s.since ? ` <i>since ${escapeHtml(s.since)}</i>` : ''}`),
    weightTile(ex) || null,
  ];
  const timeTiles = [
    has(formatDuration(s.bestTime)) && num('Best time', formatDuration(s.bestTime)),
    has(formatDuration(s.avgTime)) && num('Average time', formatDuration(s.avgTime)),
    has(formatTotalDuration(s.totalTime)) && num('Total time', formatTotalDuration(s.totalTime)),
  ];

  // One line per number, in the order they appear above, so the explanation is
  // read by scanning down rather than by picking sentences apart. A paragraph
  // made you find the word you wanted inside it; this puts each term where your
  // eye already is.
  //
  // No unit is interpolated: "every reps since" is what you get when a plural
  // label lands in a singular sentence, and units here are free text, so there
  // is no safe way to inflect them.
  const meanings = (rows) => `<dl class="stat-meanings">${rows
    .map(([term, meaning]) => `<div><dt>${term}</dt><dd>${meaning}</dd></div>`).join('')}</dl>`;

  const repsHelp = meanings([
    ['Top set', 'your biggest single set'],
    ['First day', 'where you began'],
    ['Best day', 'your biggest total in one day'],
    ['Lifetime', 'everything you have logged'],
  ]);
  const timeHelp = meanings([
    ['Best time', 'your fastest session'],
    ['Average time', 'how long one usually takes'],
    ['Total time', 'every session added up'],
    ['Not counted', 'sessions you ended early'],
  ]);

  const timeExHelp = meanings([
    ['Longest session', 'your longest unbroken session'],
    ['First day', 'where you began'],
    ['Average session', 'how long one usually lasts'],
    ['Lifetime', 'every minute you have logged'],
    ['Not counted', 'sessions you ended early'],
  ]);

  const numbers = timeMode
    ? group(timeExTiles, 'time-ex', timeExHelp)
    : group(repsTiles, 'reps', repsHelp)
      + (timeTiles.some(Boolean) ? `<div class="ex-numbers-time">${group(timeTiles, 'time', timeHelp)}</div>` : '');

  const chart = trajectoryChartHtml(ex);

  // Reach is unbounded; only the rendered slice grows, and only when asked.
  const limit = state.dayLimits[ex.id] || DAY_PAGE;
  const { rows: history, remaining } = dayHistory(ex, state.setsLog, state.streakOverrides, limit);

  // Editing a day's TOTAL means typing reps, which cannot be split into sets —
  // so a sets-mode row shows its count and is not typed into.
  const setsMode = ex.targetMode === 'sets';
  const rows = history.map((r) => {
    const editing = !setsMode && state.editingDayTotal === `${r.date}|${ex.id}`;
    return `<div class="exday ${r.rest ? 'rest' : r.hit ? 'hit' : 'miss'}">
      <span class="exday-when">${r.isToday ? 'Today' : escapeHtml(formatDisplayDate(r.date, { weekday: 'short', day: 'numeric', month: 'short' }))}${(() => {
        // Only today carries a time. A stamp on every past row would be a
        // column of numbers nobody reads, and older days predate the stamp.
        if (!r.isToday) return '';
        const t = getTimerPure(state.timersLog, r.date, ex.id);
        return t && t.finishedAt ? `<i class="exday-at">${escapeHtml(formatClock(t.finishedAt))}</i>` : '';
      })()}</span>
      ${editing
        ? `<span class="inline-target-edit" data-stop>
            <input type="number" min="0" step="any" id="day-total-input-${ex.id}" class="target-edit-input" value="${r.total || ''}" placeholder="0">
            <button class="mini-btn" data-action="save-day-total" data-id="${ex.id}" data-date="${r.date}" aria-label="Save">${ICONS.check}</button>
            <button class="mini-btn" data-action="cancel-day-total" aria-label="Cancel">${ICONS.close}</button>
          </span>`
        : setsMode
          // Sets against a sets target, with the reps kept alongside — the work
          // is still counted in reps everywhere else, so the row shows both.
          ? `<span class="day-num total">${r.rest ? '🌙' : r.scored}</span>
             <span class="day-sep">/</span>
             <button class="day-num target" data-editable-day-target data-id="${ex.id}" data-date="${r.date}" aria-label="Edit target">${r.target || '—'}</button>
             <span class="exday-unit">sets${r.rest ? '' : ` · ${r.total} ${escapeHtml(u)}`}</span>`
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
  const share = `<button class="share-btn" data-action="share-exercise" data-id="${ex.id}">${ICONS.share}Share image</button>`;
  return `<div class="ex-history">${numbers}${chart}<div class="exday-list">${rows}</div>${more}${share}</div>`;
}


/* ============================= SHARE IMAGE =============================
 * A square card drawn on a canvas, not a screenshot of the screen.
 *
 * html2canvas would have been the quick answer and it is a runtime dependency
 * this app does not otherwise have. Drawing it costs about the same and buys
 * control: a screenshot of a phone would carry the nav bar, half a row of the
 * next exercise, and whatever else happened to be on screen. This carries only
 * what was chosen.
 *
 * Nothing leaves the device. The canvas becomes a blob, the blob goes to the
 * share sheet or straight to the downloads folder. No upload, no server, no
 * account — which is also why it stays free.
 */
/**
 * 1080 x 1920 — an Instagram Story frame, which is where these actually go.
 *
 * A square was the safe default before anyone had shared one; in practice iOS
 * hands the picture to Stories, and a square there floats in a letterboxed band
 * with the app's own furniture crowding it. A 9:16 card fills the screen.
 *
 * SAFE_TOP and SAFE_BOTTOM are the strips Instagram covers with its close
 * button, its caption tools and the reply bar. Nothing that has to be read goes
 * in them — which is why every card starts lower and ends higher than its
 * margins suggest.
 */
const SHARE_W = 1080;
const SHARE_H = 1920;

/**
 * All three cards used to open with a flat black fill. On a phone, in a feed of
 * photographs, a perfectly uniform rectangle reads as an empty slide rather
 * than a designed one — a solid fill is the one surface that always looks
 * unfinished next to everything around it.
 *
 * Drawn, never downloaded: a tiled noise patch and one soft pool of the signal
 * colour, both pure arithmetic. An image asset would mean bytes in the
 * precache, a file in the repo and another thing for slice-icons.py to own, for
 * a texture that is fifteen lines of canvas. The app still carries no runtime
 * dependency and still works offline.
 *
 * The tile is cached, not the pattern: a CanvasPattern belongs to the context
 * that made it, and these three cards each build their own.
 */
let grainTile = null;
function grainTileCanvas() {
  if (grainTile) return grainTile;
  const t = document.createElement('canvas');
  t.width = t.height = 128;
  const tg = t.getContext('2d');
  const img = tg.createImageData(128, 128);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 10;   // barely there: texture should support the mood, not compete with it
  }
  tg.putImageData(img, 0, 0);
  grainTile = t;
  return t;
}

/** Ground for every share card: ink, one light source, then grain over both. */
function paintShareBackdrop(g, ink, accent) {
  g.fillStyle = ink;
  g.fillRect(0, 0, SHARE_W, SHARE_H);
  // A single high pool of the signal green, so the frame has a light source
  // instead of being uniformly dead. Kept under 10% or it starts tinting text.
  const glow = g.createRadialGradient(SHARE_W * 0.5, SHARE_H * 0.24, 0, SHARE_W * 0.5, SHARE_H * 0.24, SHARE_W);
  glow.addColorStop(0, 'rgba(62,224,127,0.09)');
  glow.addColorStop(0.5, 'rgba(62,224,127,0.025)');
  glow.addColorStop(1, 'rgba(62,224,127,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, SHARE_W, SHARE_H);
  const pat = g.createPattern(grainTileCanvas(), 'repeat');
  if (pat) { g.fillStyle = pat; g.fillRect(0, 0, SHARE_W, SHARE_H); }
}
const SAFE_TOP = 300;
const SAFE_BOTTOM = 1680;

/**
 * The foot of every card: where it came from, and — if the profile has a name —
 * who made it. The name is right-aligned against the same baseline rather than
 * given a line of its own, so a card with no username loses nothing but the
 * name, and one with a username gains no height.
 */
/**
 * Which crew a shared image speaks for, and what you are in it.
 *
 * The crew you are looking at when you share, falling back to your first — a
 * card should say one thing, and asking "which crew is this for?" at the moment
 * someone wants to post a picture is a question nobody wants.
 */
function shareCrewStanding() {
  const crew = activeCrew();
  if (!crew) return null;
  const me = (crew.members || []).find((m) => m.isMe);
  if (!me) return null;
  return { name: crew.name, motto: crew.motto || '', role: me.role || '', klass: me.klass || '' };
}

/** Role and class art for the footer. Missing art is simply absent — a card
 *  must never wait on a picture that will not load. */
function shareLoadCrewIcon(kind, key) {
  if (!key) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = crewIconUrl(kind, key);
  });
}

function drawShareFooter(g, S, pad, avatar, standing, roleIcon, classIcon) {
  const name = (state.profile && state.profile.username || '').trim();
  const y = SAFE_BOTTOM;
  const DIM = '#9AA5A0', FAINT = '#6E7975', ACCENT = '#3EE07F', TEXT = '#EEF2EF';

  /**
   * The foot is a small grid, not a stack of lines.
   *
   * Who made it on the left, what they are in their crew on the right, the
   * motto beneath, and the watermark last and smallest. Everything sits on two
   * columns and four baselines, so the eye reads down one side and across once
   * rather than hunting through a pile of centred text. A card with no crew
   * loses the whole block and keeps only the signature.
   */
  const drawWatermark = (baseline) => {
    g.textAlign = 'left';
    g.fillStyle = ACCENT; g.font = "800 30px Manrope, system-ui, sans-serif";
    g.fillText('Sets', pad, baseline);
    g.fillStyle = FAINT; g.font = "500 22px 'JetBrains Mono', ui-monospace, monospace";
    g.fillText('sets-workout.vercel.app', pad + 74, baseline);
  };

  const drawFace = (cx, cy, size) => {
    if (!avatar) return;
    g.save();
    g.beginPath(); g.arc(cx, cy, size / 2, 0, Math.PI * 2); g.clip();
    const scale = Math.max(size / avatar.width, size / avatar.height);
    const w = avatar.width * scale, h = avatar.height * scale;
    g.drawImage(avatar, cx - w / 2, cy - h / 2, w, h);
    g.restore();
    g.strokeStyle = 'rgba(62,224,127,0.5)'; g.lineWidth = 3;
    g.beginPath(); g.arc(cx, cy, size / 2, 0, Math.PI * 2); g.stroke();
  };

  // No crew: one line, and nothing to divide.
  if (!standing) {
    drawWatermark(y);
    if (!name && !avatar) return;
    g.textAlign = 'right';
    let right = S - pad;
    if (avatar) { drawFace(right - 28, y - 18, 56); right -= 72; }
    if (name) {
      g.fillStyle = DIM; g.font = "700 26px Manrope, system-ui, sans-serif";
      g.fillText(name, right, y);
    }
    g.textAlign = 'left';
    return;
  }

  // Four baselines, no rule: the card already divides itself above this, and a
  // second line here was one more edge than the foot of a card can carry.
  const nameY = y - 150;
  if (avatar) drawFace(pad + 26, nameY - 12, 52);
  const textX = avatar ? pad + 68 : pad;
  g.textAlign = 'left';
  g.fillStyle = TEXT; g.font = "700 30px Manrope, system-ui, sans-serif";
  g.fillText(name || 'Sets', textX, nameY);

  g.fillStyle = ACCENT; g.font = "700 24px 'JetBrains Mono', ui-monospace, monospace";
  g.fillText(standing.name.toUpperCase(), pad, nameY + 46);

  if (standing.motto) {
    g.fillStyle = FAINT; g.font = "600 20px 'JetBrains Mono', ui-monospace, monospace";
    g.fillText('CREW MOTTO', pad, nameY + 94);
    g.fillStyle = DIM; g.font = "500 24px Manrope, system-ui, sans-serif";
    let motto = standing.motto;
    while (g.measureText(motto).width > S - pad * 2 - 160 && motto.length > 6) motto = motto.slice(0, -1);
    if (motto !== standing.motto) motto += '…';
    g.fillText(motto, pad + 160, nameY + 94);
  }

  // Right column — role above class, art then word, both right-aligned.
  const badge = (icon, label, baseline) => {
    if (!label) return;
    g.textAlign = 'right';
    g.fillStyle = DIM; g.font = "700 22px 'JetBrains Mono', ui-monospace, monospace";
    g.fillText(label.toUpperCase(), S - pad, baseline);
    const w = g.measureText(label.toUpperCase()).width;
    if (icon) g.drawImage(icon, S - pad - w - 44, baseline - 27, 34, 34);
    g.textAlign = 'left';
  };
  badge(roleIcon, (roleInfo(standing.role) || {}).label, nameY);
  badge(classIcon, (classInfo(standing.klass) || {}).label, nameY + 46);

  drawWatermark(y);
}

/** The profile photo, decoded once per card. Missing or broken is not an error:
 *  the footer simply falls back to the name alone. */
function shareLoadAvatar() {
  const src = state.profile && state.profile.avatar;
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function shareLoadIcon(ex) {
  const cat = categoryOf(ex);
  if (!cat) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);   // a missing icon must not block the share
    img.src = categoryIconUrl(cat.key);
  });
}

async function buildShareImage(ex, s) {
  const S = SHARE_W;
  const c = document.createElement('canvas');
  c.width = SHARE_W; c.height = SHARE_H;
  const g = c.getContext('2d');

  // The app's fonts are loaded by CSS; without waiting, the first share of a
  // session silently falls back to a system face.
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* draw anyway */ } }

  const INK = '#0A0C0B', TEXT = '#EEF2EF', DIM = '#9AA5A0', FAINT = '#6E7975', ACCENT = '#3EE07F';
  const body = "700 44px Manrope, system-ui, sans-serif";
  const mono = "600 26px 'JetBrains Mono', ui-monospace, monospace";
  const num = "700 132px 'Martian Mono', ui-monospace, monospace";

  paintShareBackdrop(g, INK, ACCENT);

  const pad = 76;
  const icon = await shareLoadIcon(ex);
  if (icon) g.drawImage(icon, pad, SAFE_TOP - 78, 118, 118);

  g.fillStyle = TEXT; g.font = "700 52px Manrope, system-ui, sans-serif";
  g.textBaseline = 'alphabetic';
  const nameX = icon ? pad + 146 : pad;
  let name = ex.name;
  while (g.measureText(name).width > S - nameX - pad && name.length > 4) name = name.slice(0, -1);
  if (name !== ex.name) name += '…';
  g.fillText(name, nameX, SAFE_TOP - 20);

  const cat = categoryOf(ex);
  if (cat) {
    g.fillStyle = FAINT; g.font = "600 26px 'JetBrains Mono', ui-monospace, monospace";
    g.fillText(cat.label.toUpperCase(), nameX, SAFE_TOP + 22);
  }

  // The streak is the headline: it is the number people actually want to show.
  g.fillStyle = ACCENT; g.font = "700 168px 'Martian Mono', ui-monospace, monospace";
  g.fillText(String(s.currentStreak), pad, 640);
  const streakW = g.measureText(String(s.currentStreak)).width;
  g.fillStyle = DIM; g.font = "600 40px Manrope, system-ui, sans-serif";
  g.fillText('day streak', pad + streakW + 26, 640);

  // Trajectory, same data as the card's chart.
  const { points, maxY, minY } = trajectorySeries(ex, state.setsLog, 30);
  const cTop = 760, cH = 300, cL = pad, cW = S - pad * 2;
  if (points.length >= 2) {
    const lo = Math.max(0, minY - (maxY - minY) * 0.25 - 1);
    const hi = maxY + (maxY - minY) * 0.1 + 1;
    const i0 = points[0].dayIndex;
    const span = Math.max(1, points[points.length - 1].dayIndex - i0);
    const px = (i) => cL + ((i - i0) / span) * cW;
    const py = (v) => cTop + (1 - (v - lo) / (hi - lo)) * cH;

    g.strokeStyle = '#4A534D'; g.lineWidth = 4; g.beginPath();
    points.forEach((p, i) => (i ? g.lineTo(px(p.dayIndex), py(p.total)) : g.moveTo(px(p.dayIndex), py(p.total))));
    g.stroke();
    points.forEach((p) => {
      g.fillStyle = p.hit ? ACCENT : '#0A0C0B';
      g.strokeStyle = p.hit ? ACCENT : '#4A534D'; g.lineWidth = 4;
      g.beginPath(); g.arc(px(p.dayIndex), py(p.total), 8, 0, Math.PI * 2); g.fill(); g.stroke();
    });

    const first = points[0], last = points[points.length - 1];
    g.font = "700 28px 'Martian Mono', ui-monospace, monospace";
    g.fillStyle = TEXT; g.textAlign = 'left';
    g.fillText(String(first.total), px(first.dayIndex), py(first.total) - 24);
    g.textAlign = 'right';
    g.fillText(String(last.total), px(last.dayIndex), py(last.total) - 24);
    g.textAlign = 'left';

    const delta = last.total - first.total;
    if (delta !== 0) {
      g.fillStyle = delta > 0 ? ACCENT : '#D8DEDA';
      g.font = "700 30px 'Martian Mono', ui-monospace, monospace";
      // Same sentence the card shows, decided the same way: the window only
      // reaches back 30 days, so it claims a beginning only when the first dot
      // really is the first session ever logged.
      const everFirst = workoutDates(ex.id, state.setsLog)[0];
      const days = last.dayIndex - first.dayIndex + 1;
      const note = everFirst === first.date ? 'since you first started' : `in ${days} days`;
      g.fillText(`${delta > 0 ? '+' : '\u2212'}${formatCount(Math.abs(delta))} ${ex.unit} ${note}`, cL, 706);
    }
  }

  /**
   * Every figure the card carries, in the two groups the card already uses —
   * how much, then how long. Empty ones are dropped rather than printed as a
   * dash, so an exercise with no clock simply has a shorter card.
   */
  const drawRow = (tiles, y) => {
    const filled = tiles.filter(([, v]) => v != null && v !== '' && v !== '—');
    if (!filled.length) return false;
    const colW = (S - pad * 2) / filled.length;
    filled.forEach(([label, value], i) => {
      const x = pad + i * colW;
      g.fillStyle = FAINT; g.font = "600 24px 'JetBrains Mono', ui-monospace, monospace";
      g.fillText(label, x, y);
      g.fillStyle = TEXT;
      // Shrink to fit rather than run into the next column.
      let size = 56;
      g.font = `700 ${size}px 'Martian Mono', ui-monospace, monospace`;
      while (g.measureText(value).width > colW - 16 && size > 26) {
        size -= 2;
        g.font = `700 ${size}px 'Martian Mono', ui-monospace, monospace`;
      }
      g.fillText(value, x, y + 68);
    });
    return true;
  };

  const firstDate = workoutDates(ex.id, state.setsLog)[0];
  const firstTotal = firstDate ? calcTotal(getSetsFor(ex.id, firstDate)) : null;

  g.strokeStyle = '#2A312D'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(pad, 1115); g.lineTo(S - pad, 1115); g.stroke();

  // A time exercise's figures are the same four questions in minutes — the same
  // set the Progress card shows, so the picture and the screen agree.
  if (isTimeMode(ex)) {
    drawRow([
      ['LONGEST', s.topSet != null ? formatMinutes(s.topSet) : null],
      ['FIRST DAY', firstTotal != null ? formatMinutes(firstTotal) : null],
      ['AVERAGE', formatDuration(s.avgTime)],
      ['LIFETIME', s.totalReps > 0 ? formatMinutes(s.totalReps) : null],
    ], 1180);
  } else {
    drawRow([
      ['TOP SET', s.topSet != null ? formatCount(s.topSet) : null],
      ['FIRST DAY', firstTotal != null ? formatCount(firstTotal) : null],
      ['BEST DAY', s.maxReps != null ? formatCount(s.maxReps) : null],
      ['LIFETIME', s.totalReps > 0 ? formatCount(s.totalReps) : null],
    ], 1180);

    drawRow([
      ['BEST TIME', formatDuration(s.bestTime)],
      ['AVERAGE TIME', formatDuration(s.avgTime)],
      ['TOTAL TIME', formatTotalDuration(s.totalTime)],
    ], 1340);
  }

  // Watermark. Says where it came from without shouting over the numbers.
  const standing = shareCrewStanding();
  drawShareFooter(g, S, pad, await shareLoadAvatar(), standing,
    await shareLoadCrewIcon('role', standing && standing.role),
    await shareLoadCrewIcon('class', standing && standing.klass));

  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

/**
 * The same card for one day instead of one lifetime.
 *
 * Everything about the frame is shared with the exercise card — same size,
 * same ink, same watermark, same share-sheet route — because two cards that
 * differ only in their numbers should not differ in anything else. What
 * changes is what it is proud of: today's session, while it is still today.
 */
async function buildSessionImage(ex, session) {
  const S = SHARE_W;
  const c = document.createElement('canvas');
  c.width = SHARE_W; c.height = SHARE_H;
  const g = c.getContext('2d');
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* draw anyway */ } }

  const INK = '#0A0C0B', TEXT = '#EEF2EF', DIM = '#9AA5A0', FAINT = '#6E7975', ACCENT = '#3EE07F';
  paintShareBackdrop(g, INK, ACCENT);

  const pad = 76;
  const icon = await shareLoadIcon(ex);
  if (icon) g.drawImage(icon, pad, SAFE_TOP - 78, 118, 118);

  g.textBaseline = 'alphabetic';
  g.fillStyle = TEXT; g.font = "700 52px Manrope, system-ui, sans-serif";
  const nameX = icon ? pad + 146 : pad;
  let name = ex.name;
  while (g.measureText(name).width > S - nameX - pad && name.length > 4) name = name.slice(0, -1);
  if (name !== ex.name) name += '…';
  g.fillText(name, nameX, SAFE_TOP - 20);

  const cat = categoryOf(ex);
  g.fillStyle = FAINT; g.font = "600 26px 'JetBrains Mono', ui-monospace, monospace";
  g.fillText([cat ? cat.label.toUpperCase() : null, session.dateLabel.toUpperCase()].filter(Boolean).join(' · '), nameX, SAFE_TOP + 22);

  // The day's number is the headline here, the way the streak is on the other
  // card — with its target beside it, so the size of the thing is legible.
  // Sized to fill the square: the day's number is the whole point, so it takes
  // the room the lifetime card spends on a chart.
  const big = session.timeMode ? formatMinutes(session.total) : formatCount(session.total);
  const targetStr = session.target ? `/ ${session.timeMode ? formatMinutes(session.target) : session.target}` : '';
  // "1h 30m" is a much wider headline than "30", so the size is fitted rather
  // than fixed — the number and its target have to sit on one line inside the
  // margins whatever the exercise measures.
  g.font = "600 48px Manrope, system-ui, sans-serif";
  const targetW = targetStr ? g.measureText(targetStr).width + 28 : 0;
  let bigSize = 210;
  g.font = `700 ${bigSize}px 'Martian Mono', ui-monospace, monospace`;
  while (g.measureText(big).width + targetW > S - pad * 2 && bigSize > 64) {
    bigSize -= 6;
    g.font = `700 ${bigSize}px 'Martian Mono', ui-monospace, monospace`;
  }
  g.fillStyle = ACCENT;
  g.fillText(big, pad, 860);
  const bigW = g.measureText(big).width;
  if (targetStr) {
    g.fillStyle = DIM; g.font = "600 48px Manrope, system-ui, sans-serif";
    g.fillText(targetStr, pad + bigW + 28, 860);
  }
  g.fillStyle = session.short ? DIM : ACCENT;
  g.font = "700 38px Manrope, system-ui, sans-serif";
  g.fillText(session.headline, pad, 946);

  // The meter: one bar, the same proportion the card on Today was showing.
  const barY = 1010, barW = S - pad * 2, barH = 22;
  g.fillStyle = '#1A201C'; g.fillRect(pad, barY, barW, barH);
  g.fillStyle = session.short ? '#6E7975' : ACCENT;
  g.fillRect(pad, barY, Math.max(6, Math.round(barW * session.pct)), barH);

  g.strokeStyle = '#2A312D'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(pad, 1270); g.lineTo(S - pad, 1270); g.stroke();

  // Today's figures only — the target is already beside the big number, so
  // repeating it here would be the same fact twice.
  const tiles = [
    ['TIME', session.elapsed],
    session.timeMode ? null : ['SETS', session.sets ? String(session.sets) : null],
    ['STREAK', session.streak ? `${session.streak}d` : null],
  ].filter(Boolean).filter(([, v]) => v != null && v !== '' && v !== '—');
  const colW = (S - pad * 2) / (tiles.length || 1);
  tiles.forEach(([label, value], i) => {
    const x = pad + i * colW;
    g.fillStyle = FAINT; g.font = "600 24px 'JetBrains Mono', ui-monospace, monospace";
    g.fillText(label, x, 1340);
    g.fillStyle = TEXT;
    let size = 62;
    g.font = `700 ${size}px 'Martian Mono', ui-monospace, monospace`;
    while (g.measureText(value).width > colW - 16 && size > 26) {
      size -= 2;
      g.font = `700 ${size}px 'Martian Mono', ui-monospace, monospace`;
    }
    g.fillText(value, x, 1414);
  });

  const standing = shareCrewStanding();
  drawShareFooter(g, S, pad, await shareLoadAvatar(), standing,
    await shareLoadCrewIcon('role', standing && standing.role),
    await shareLoadCrewIcon('class', standing && standing.klass));

  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

/**
 * The whole day on one card: what you finished, and what it added up to.
 *
 * It lists rather than headlines, because a day has no single number worth
 * 168px — the list IS the achievement. Long days are cut off with a count
 * rather than shrunk to fit, so the card never becomes a spreadsheet.
 */
const DAY_CARD_ROWS = 7;

async function buildDayImage(day) {
  const S = SHARE_W;
  const c = document.createElement('canvas');
  c.width = SHARE_W; c.height = SHARE_H;
  const g = c.getContext('2d');
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) { /* draw anyway */ } }

  const INK = '#0A0C0B', TEXT = '#EEF2EF', DIM = '#9AA5A0', FAINT = '#6E7975', ACCENT = '#3EE07F';
  paintShareBackdrop(g, INK, ACCENT);
  g.textBaseline = 'alphabetic';

  const pad = 76;
  g.fillStyle = ACCENT; g.font = "800 32px 'JetBrains Mono', ui-monospace, monospace";
  g.fillText(day.headline, pad, SAFE_TOP);
  g.fillStyle = TEXT; g.font = "700 72px Manrope, system-ui, sans-serif";
  g.fillText(day.dateLabel, pad, SAFE_TOP + 88);
  g.fillStyle = FAINT; g.font = "600 26px 'JetBrains Mono', ui-monospace, monospace";
  g.fillText(day.subtitle.toUpperCase(), pad, SAFE_TOP + 136);

  /**
   * One line per exercise, sized to fill.
   *
   * The band between the header and the figures is fixed, so the row height is
   * whatever divides it — and the type, the icon and the rule scale with it.
   * A one-exercise day cannot leave a hole, and a seven-exercise day cannot
   * overflow, without either being laid out by hand.
   *
   * Rows tall enough to afford it carry a second line — sets and time — so the
   * height is spent on something worth reading rather than on air.
   */
  const rows = day.rows.slice(0, DAY_CARD_ROWS);
  const icons = await Promise.all(rows.map((r) => shareLoadIcon(r.ex)));
  const BAND_TOP = SAFE_TOP + 200, BAND_BOTTOM = 1250;
  const rowH = (BAND_BOTTOM - BAND_TOP) / rows.length;
  // Past a certain height a row stops being a line and becomes a block: the
  // number moves onto its own line at headline size and takes a meter with it.
  // That is what stops a one-exercise day from being one sentence adrift in the
  // middle of a tall frame — the same content, spent on the space it has.
  const stacked = rowH >= 240;

  rows.forEach((r, i) => {
    const top = BAND_TOP + rowH * i;
    const mid = top + rowH / 2;
    const icon = icons[i];

    if (stacked) {
      const valueSize = Math.round(Math.max(64, Math.min(200, rowH * 0.30)));
      const nameSize = Math.round(Math.max(38, Math.min(64, rowH * 0.13)));
      const iconSize = Math.round(nameSize * 1.9);
      // Every piece counted, meter included — leave the bar out of this and the
      // whole block centres too high and hangs a gap under itself.
      const blockH = iconSize + 18 + valueSize + (r.detail ? 44 : 0) + 44;
      let y = mid - blockH / 2 + iconSize;

      if (icon) g.drawImage(icon, pad, y - iconSize, iconSize, iconSize);
      g.fillStyle = r.short ? DIM : TEXT;
      g.font = `700 ${nameSize}px Manrope, system-ui, sans-serif`;
      let name = r.ex.name;
      while (g.measureText(name).width > S - pad * 2 - iconSize - 24 && name.length > 4) name = name.slice(0, -1);
      if (name !== r.ex.name) name += '…';
      g.fillText(name, pad + iconSize + 24, y - iconSize * 0.28);

      y += valueSize + 18;
      g.fillStyle = r.short ? DIM : ACCENT;
      let vs = valueSize;
      g.font = `700 ${vs}px 'Martian Mono', ui-monospace, monospace`;
      while (g.measureText(r.value).width > S - pad * 2 && vs > 44) {
        vs -= 4;
        g.font = `700 ${vs}px 'Martian Mono', ui-monospace, monospace`;
      }
      g.fillText(r.value, pad, y);

      if (r.detail) {
        y += 44;
        g.fillStyle = FAINT; g.font = "600 26px 'JetBrains Mono', ui-monospace, monospace";
        g.fillText(r.detail.toUpperCase(), pad, y);
      }
      const barY = y + 28, barW = S - pad * 2;
      g.fillStyle = '#1A201C'; g.fillRect(pad, barY, barW, 16);
      g.fillStyle = r.short ? '#6E7975' : ACCENT;
      g.fillRect(pad, barY, Math.max(6, Math.round(barW * (r.pct || 1))), 16);
    } else {
      const nameSize = Math.round(Math.max(34, Math.min(62, rowH * 0.36)));
      const iconSize = Math.round(Math.max(48, Math.min(110, rowH * 0.54)));
      const withDetail = rowH >= 130;
      const base = mid + nameSize * 0.34;
      if (icon) g.drawImage(icon, pad, mid - iconSize / 2, iconSize, iconSize);
      const textX = pad + iconSize + 20;

      g.textAlign = 'right';
      g.font = `700 ${nameSize}px 'Martian Mono', ui-monospace, monospace`;
      const valueW = g.measureText(r.value).width;
      g.fillStyle = r.short ? DIM : ACCENT;
      g.fillText(r.value, S - pad, base);
      g.textAlign = 'left';

      g.fillStyle = r.short ? DIM : TEXT;
      g.font = `700 ${nameSize}px Manrope, system-ui, sans-serif`;
      let name = r.ex.name;
      const room = S - pad - textX - valueW - 30;
      while (g.measureText(name).width > room && name.length > 4) name = name.slice(0, -1);
      if (name !== r.ex.name) name += '…';
      g.fillText(name, textX, withDetail ? base - 22 : base);

      if (withDetail && r.detail) {
        g.fillStyle = FAINT; g.font = "600 26px 'JetBrains Mono', ui-monospace, monospace";
        g.fillText(r.detail.toUpperCase(), textX, base + 30);
      }
    }

    if (i < rows.length - 1) {
      g.strokeStyle = '#1E2522'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(pad, BAND_TOP + rowH * (i + 1)); g.lineTo(S - pad, BAND_TOP + rowH * (i + 1)); g.stroke();
    }
  });

  if (day.rows.length > DAY_CARD_ROWS) {
    g.fillStyle = FAINT; g.font = "600 24px 'JetBrains Mono', ui-monospace, monospace";
    g.fillText(`+${day.rows.length - DAY_CARD_ROWS} more`, pad, BAND_BOTTOM + 44);
  }

  // "Streak" alone invited the wrong comparison: this is the run of days you
  // finished EVERYTHING, which is a smaller number than any one exercise's own
  // streak and a different claim. The label now says which one it is.
  const tiles = [
    ['EXERCISES', String(day.rows.length)],
    ['TIME', day.totalTime],
    ['DAY STREAK', day.streak ? `${day.streak}d` : null],
  ].filter(([, v]) => v != null && v !== '' && v !== '—');
  g.strokeStyle = '#2A312D'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(pad, 1330); g.lineTo(S - pad, 1330); g.stroke();
  const colW = (S - pad * 2) / (tiles.length || 1);
  tiles.forEach(([label, value], i) => {
    const x = pad + i * colW;
    g.fillStyle = FAINT; g.font = "600 22px 'JetBrains Mono', ui-monospace, monospace";
    g.fillText(label, x, 1400);
    g.fillStyle = TEXT;
    let size = 52;
    g.font = `700 ${size}px 'Martian Mono', ui-monospace, monospace`;
    while (g.measureText(value).width > colW - 16 && size > 28) {
      size -= 2;
      g.font = `700 ${size}px 'Martian Mono', ui-monospace, monospace`;
    }
    g.fillText(value, x, 1466);
  });

  const standing = shareCrewStanding();
  drawShareFooter(g, S, pad, await shareLoadAvatar(), standing,
    await shareLoadCrewIcon('role', standing && standing.role),
    await shareLoadCrewIcon('class', standing && standing.klass));

  return new Promise((resolve) => c.toBlob(resolve, 'image/png'));
}

/** Today's finished work, as one card. Rest days are not on it — there is
 *  nothing to show — but they do not stop the rest of the day being shared. */
async function shareDayImage() {
  const d = todayISO();
  const rows = state.exercises
    .filter((ex) => ex.active && isScheduledOn(ex, d) && !isBreakDay(state.streakOverrides, d, ex.id))
    .sort((a, b) => a.order - b.order)
    .map((ex) => {
      const arr = getSetsFor(ex.id, d);
      const total = calcTotal(arr);
      const target = getEffectiveTarget(ex, d);
      const timer = getTimerPure(state.timersLog, d, ex.id);
      const ms = timerElapsedMs(timer, Date.now());
      return {
        ex, total, ms,
        short: !!(target > 0 && progressValue(ex, arr) < target),
        value: isTimeMode(ex) ? formatMinutes(total) : `${formatCount(total)} ${ex.unit}`,
        pct: target > 0 ? Math.min(1, total / target) : 1,
        // Only used when the rows are tall enough to read it.
        detail: [isTimeMode(ex) ? null : `${arr.length} set${arr.length === 1 ? '' : 's'}`,
          ms > 0 ? formatDuration(ms) : null,
          target > 0 ? `target ${isTimeMode(ex) ? formatMinutes(target) : target}` : null].filter(Boolean).join(' · '),
      };
    })
    .filter((r) => r.total > 0);

  if (!rows.length) { showToast('Nothing logged today yet.'); return; }

  const totalMs = rows.reduce((a, r) => a + r.ms, 0);
  const allMet = rows.every((r) => !r.short);
  showToast('Building image…');
  let blob;
  try {
    blob = await buildDayImage({
      rows,
      headline: allMet ? 'ALL DONE' : 'TRAINED',
      dateLabel: formatDisplayDate(d, { weekday: 'long', day: 'numeric', month: 'long' }),
      // Says what happened, not what would sound best: a day with one session
      // ended early has not met every target, and must not claim it did.
      subtitle: `${rows.length} exercise${rows.length === 1 ? '' : 's'}${allMet ? ' · every target met' : ''}`,
      // The clock as it really read. Rounding 31:45 up to "32m" was the whole
      // complaint — this card is the record, so it keeps the seconds.
      totalTime: formatDuration(totalMs),
      streak: calcStreakInfo(state.exercises, state.setsLog, d, state.streakOverrides).current,
    });
  } catch (e) { blob = null; }
  await offerImage(blob, { name: 'day' }, `-${d}`);
}

/** Canvas → blob → share sheet, with a download fallback. Shared by all three
 *  cards so there is one answer to "where does the picture go". */
async function offerImage(blob, ex, suffix) {
  if (!blob) { showToast("Couldn't build the image."); return; }
  // The file is named for whoever it belongs to, read from the profile at the
  // moment of sharing — rename yourself and Save profile, and the next image
  // saves under the new name. No stored copy to go stale.
  const slug = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const who = slug(state.profile && state.profile.username);
  const parts = ['sets', who, slug(ex.name)].filter(Boolean);
  const file = new File([blob], `${parts.join('-')}${suffix}.png`, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Image saved');
}

/**
 * The proof, collaged onto a Sets card and saved to the phone.
 *
 * Deliberately NOT what the Share buttons send: sharing to a story stays the
 * clean card, because the picture of you mid-set is for the crew and for your
 * own roll, not for a public feed. This is the keepsake version — the shot with
 * the day's numbers under it — and it downloads rather than opening the share
 * sheet, so the two paths can never be confused.
 */
async function saveProofCollage(exId) {
  const ex = state.exercises.find((e) => e.id === exId);
  const today = todayISO();
  const img = (state.proofImages[today] || {})[exId];
  if (!ex || !img) { showToast('No proof saved for this one.'); return; }
  showToast('Building…');
  const bitmap = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = img;
  }).catch(() => null);
  if (!bitmap) { showToast("That photo couldn't be read."); return; }

  const c = document.createElement('canvas');
  c.width = SHARE_W; c.height = SHARE_H;
  const g = c.getContext('2d');
  paintShareBackdrop(g, '#0A0C0B', '#3EE07F');

  // The photo sits in the upper two thirds, cropped to fill rather than
  // squashed — a stretched proof shot looks like a mistake.
  const box = { x: 60, y: 300, w: SHARE_W - 120, h: 1000 };
  const scale = Math.max(box.w / bitmap.width, box.h / bitmap.height);
  const dw = bitmap.width * scale, dh = bitmap.height * scale;
  g.save();
  g.beginPath(); g.rect(box.x, box.y, box.w, box.h); g.clip();
  g.drawImage(bitmap, box.x + (box.w - dw) / 2, box.y + (box.h - dh) / 2, dw, dh);
  g.restore();
  g.strokeStyle = '#D8DEDA'; g.lineWidth = 4;
  g.strokeRect(box.x, box.y, box.w, box.h);

  const arr = getSetsFor(exId, today);
  const target = getEffectiveTarget(ex, today);
  const scored = progressValue(ex, arr);
  g.fillStyle = '#3EE07F';
  g.font = '700 34px "JetBrains Mono", monospace';
  g.fillText('PROOF OF WORKOUT', box.x, 220);
  g.fillStyle = '#EEF2EF';
  g.font = '800 78px Manrope, system-ui, sans-serif';
  g.fillText(ex.name, box.x, 1420);
  g.fillStyle = '#9AA5A0';
  g.font = '500 40px "JetBrains Mono", monospace';
  g.fillText(target > 0 ? `${scored} of ${target} ${targetUnit(ex)}` : `${calcTotal(arr)} ${ex.unit}`, box.x, 1490);
  g.fillText(formatDisplayDate(today, { weekday: 'long', day: 'numeric', month: 'long' }), box.x, 1550);
  g.fillStyle = '#3EE07F';
  g.font = '700 30px "JetBrains Mono", monospace';
  g.fillText('Sets · sets-workout.vercel.app', box.x, 1640);

  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  if (!blob) { showToast("Couldn't build the image."); return; }
  // Straight to the camera roll: no share sheet, so this never reaches a story
  // by accident.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  a.href = url; a.download = `sets-proof-${slug(ex.name)}-${today}.png`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Saved to your phone');
}

/** Today's session, from the finished card it was tapped on. */
async function shareSessionImage(exId) {
  const ex = state.exercises.find((e) => e.id === exId);
  if (!ex) return;
  const d = todayISO();
  const arr = getSetsFor(exId, d);
  const total = calcTotal(arr);
  const target = getEffectiveTarget(ex, d);
  const timer = getTimerPure(state.timersLog, d, exId);
  const s = exerciseStats(ex, state.setsLog, state.timersLog, null, state.streakOverrides);
  const short = timerPhase(timer) === 'gaveup' && target > 0 && total < target;
  showToast('Building image…');
  let blob;
  try {
    blob = await buildSessionImage(ex, {
      total, target,
      timeMode: isTimeMode(ex),
      sets: arr.length,
      streak: s.currentStreak,
      elapsed: formatDuration(timerElapsedMs(timer, Date.now())),
      pct: target > 0 ? Math.min(1, total / target) : 1,
      short,
      dateLabel: formatDisplayDate(d, { weekday: 'short', day: 'numeric', month: 'short' }),
      headline: short ? 'Ended early — it still counts'
        : (target > 0 ? 'Target met' : 'Session complete'),
    });
  } catch (e) { blob = null; }
  await offerImage(blob, ex, '-today');
}

async function shareExerciseImage(exId) {
  const ex = state.exercises.find((e) => e.id === exId);
  if (!ex) return;
  const s = exerciseStats(ex, state.setsLog, state.timersLog, null, state.streakOverrides);
  showToast('Building image…');
  let blob;
  try { blob = await buildShareImage(ex, s); } catch (e) { blob = null; }
  // The share sheet is the better path on a phone: it offers Save Image, and it
  // is the only route that reaches the photo library at all. Download is the
  // fallback for desktop and anywhere the sheet refuses files.
  await offerImage(blob, ex, '');
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
  { view: 'social', label: 'Social', icon: 'people' },
  { view: 'guide', label: 'Guide', icon: 'book' },
];

function renderNav() {
  const el = document.getElementById('bottom-nav');
  if (!el) return;
  const unseen = unseenReactions();
  el.innerHTML = `<div class="nav-inner">${NAV_ITEMS.map((n) => `
    <button class="nav-btn ${state.view === n.view ? 'active' : ''}" data-action="nav" data-view="${n.view}"
      aria-current="${state.view === n.view ? 'page' : 'false'}">${ICONS[n.icon]}${n.view === 'social' && unseen ? `<i class="nav-dot">${unseen > 9 ? '9+' : unseen}</i>` : ''}<span>${n.label}</span></button>`).join('')}</div>`;
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
  // Boot is a render like any other, and it can land on a session that is
  // still running — the clock is derived from timestamps, so it survives a
  // reload even though the interval driving it does not. Without this the
  // clock sat frozen until something else happened to open a modal, and a
  // timed exercise would never notice it had reached its target.
  ensureGlobalTick();
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
/**
 * An installed app that is never closed keeps running the JS it started with,
 * however new the service worker underneath it is — which is why "Force update
 * now" existed at all. checkVersion already runs every time the app is brought
 * back to the foreground, and that is exactly the safe moment to take a new
 * build: nothing is mid-tap, and the screen is about to be redrawn anyway.
 *
 * Never mid-session. A reload during a running clock or an open sheet throws
 * away what someone is in the middle of, and no update is worth that — those
 * cases fall through to the banner, which is what it is for.
 *
 * Once per run, so a deploy that somehow reports a build it cannot serve costs
 * one reload rather than an endless loop.
 */
function maybeAutoUpdate() {
  if (state.version.status !== 'stale' || state.autoUpdated) return;
  if (state.modal || document.visibilityState !== 'visible') return;
  const busy = Object.values(state.timersLog || {}).some((day) =>
    Object.values(day || {}).some((t) => t && t.status === 'running'));
  if (busy) return;
  state.autoUpdated = true;
  // The service worker's own swap is the gentle path and keeps the cache warm;
  // forceUpdate is the sledgehammer for when no worker has reported in.
  if (state.applyUpdate) state.applyUpdate();
  else forceUpdate();
}

async function checkVersion() {
  try {
    // Two belts here, both earned. `cache: no-store` is the correct request,
    // but an installed iOS webview has been known to answer it from its own
    // store anyway, so the URL is unique per call as well. And asking the
    // registration to update() is the only supported way to make the browser
    // go and look for a new service worker — without it, a PWA that is never
    // fully closed can sit on the worker it started with indefinitely, which is
    // exactly the "my updates never arrive" symptom.
    if (navigator.serviceWorker) {
      navigator.serviceWorker.getRegistration()
        .then((r) => r && r.update())
        .catch(() => {});
    }
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { build } = await res.json();
    state.version.status = versionStatus(state.version.local, build);
  } catch (e) {
    state.version.status = 'unknown'; // offline — say nothing rather than guess
  }
  renderTopbar();
  maybeAutoUpdate();
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

function railButtonsHtml() {
  return `<button class="rail-btn" data-action="toggle-panel" data-panel="stats" aria-label="Performance">${ICONS.progress}</button>`;
}

function helpChipHtml() {
  return `<button class="help-chip" data-action="open-guide" aria-label="Guide">${ICONS.help}</button>`;
}

/** Always here, not only when an update is waiting: the whole point of a manual
 *  refresh is to be able to reach for it when you suspect something, which is
 *  precisely when the app believes it is up to date. Tapping always refreshes;
 *  the glyph only reports what the last check found. */
function versionChipHtml() {
  const { local, status } = state.version;
  const label = { latest: 'Up to date', stale: 'Update ready', unknown: 'Version unknown (offline?)' }[status];
  return `<button class="version-chip ${status}" data-action="force-update"
    title="Build ${escapeHtml(local)} · ${label} — tap to refresh" aria-label="${label}. Tap to force update.">${status === 'latest' ? '✓' : status === 'stale' ? '↓' : '↻'}</button>`;
}

function unreadNotices() {
  return NOTICES.filter((n) => !state.noticesSeen.includes(n.id));
}

/**
 * A waiting update earns a bell of its own, and it cannot live in NOTICES:
 * that file ships inside the build, so the new version's announcement of itself
 * is unreachable from the old version that needs to hear it. It is a live
 * condition instead — counted while it is true, gone the moment you update.
 * Nothing marks it read, deliberately: "read" would silence something that is
 * still waiting.
 */
function updatePending() {
  return state.version.status === 'stale';
}

function bellCount() {
  return unreadNotices().length + (updatePending() ? 1 : 0);
}

/** The bell takes the version chip's slot rather than adding a fifth: once
 *  updates apply themselves, "which build am I on" is a question for Backup &
 *  data, not for the top of every screen. */
function bellChipHtml() {
  const n = bellCount();
  return `<button class="bell-chip ${n ? 'has-unread' : ''}" data-action="open-notices" aria-label="${n ? `What's new — ${n} unread` : "What's new"}">
    ${ICONS.bell}${n ? `<span class="bell-count">${n > 9 ? '9+' : n}</span>` : ''}
  </button>`;
}

function avatarChipHtml() {
  const p = state.profile || {};
  const sync = state.sync || { status: 'signed-out' };
  const signedIn = sync.status !== 'signed-out';
  const source = p.username || sync.email;
  const initial = source ? escapeHtml(source[0].toUpperCase()) : '';
  const photo = p.avatar
    ? `<img class="avatar-photo" src="${p.avatar}" alt="">`
    : (initial || ICONS.user);
  return `<button class="avatar-chip ${signedIn ? 'signed-in' : 'signed-out'}${p.avatar ? ' has-photo' : ''}" data-action="open-profile" aria-label="Profile">
    ${photo}
  </button>`;
}

function renderTopbar() {
  const el = document.getElementById('topbar');
  if (!el) return;
  if (state.view === 'today') {
    const perEx = allStats(
      state.exercises.filter((e) => e.active && !e.archived && !e.oneTimeDate),
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
          <div class="streak-pill flame-l${flameLevel(streak)}" title="Longest run currently going">${ICONS.flame}${streak}</div>
          ${helpChipHtml()}
          ${versionChipHtml()}
          ${bellChipHtml()}
          ${avatarChipHtml()}
        </div>
      </div>`;
  } else if (state.view === 'plan') {
    el.innerHTML = `
      <div class="topbar-row">
        <div class="topbar-left">${LOGO_MARK}<div class="screen-title">Plan</div></div>
        <div class="topbar-right">
          <button class="add-btn" data-action="open-add">${ICONS.plus} Add</button>
          ${helpChipHtml()}
          ${versionChipHtml()}
          ${bellChipHtml()}
          ${avatarChipHtml()}
        </div>
      </div>`;
  } else if (state.view === 'social') {
    el.innerHTML = `
      <div class="topbar-row">
        <div class="topbar-left">${LOGO_MARK}<div class="screen-title">Social</div></div>
        <div class="topbar-right">
          <button class="icon-btn crew-refresh ${state.crew.refreshing ? 'spinning' : ''} ${state.crew.refreshedAt ? 'done' : ''}"
            data-action="refresh-crew" aria-label="${state.crew.refreshedAt ? 'Crew up to date' : 'Refresh crew'}"
            ${state.crew.refreshing ? 'disabled' : ''}>${state.crew.refreshedAt ? ICONS.check : ICONS.restore}</button>
          ${helpChipHtml()}
          ${versionChipHtml()}
          ${bellChipHtml()}
          ${avatarChipHtml()}
        </div>
      </div>`;
  } else if (state.view === 'guide') {
    // No "?" here: this screen is what that button is a shortcut to, and a guide
    // to the guide is the kind of thing that makes an app feel padded.
    el.innerHTML = `
      <div class="topbar-row">
        <div class="topbar-left">${LOGO_MARK}<div class="screen-title">Guide</div></div>
        <div class="topbar-right">
          ${versionChipHtml()}
          ${bellChipHtml()}
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
          ${bellChipHtml()}
          ${avatarChipHtml()}
        </div>
      </div>`;
  }
}

/**
 * Which screen the container last drew. The entrance only plays when this
 * actually changes — renderView() is also called after every logged set, every
 * expanded group and every sync, and animating those would strobe the whole
 * screen on each tap. That is the same mistake as the old "TV static" flash,
 * arrived at from the other direction: motion on a re-render that changed
 * nothing the eye cares about.
 */
let lastRenderedView = null;

function renderView() {
  const el = document.getElementById('view-container');
  if (!el) return;
  const arriving = state.view !== lastRenderedView;
  lastRenderedView = state.view;
  el.classList.remove('view-enter');
  if (state.view === 'today') el.innerHTML = viewToday();
  else if (state.view === 'plan') el.innerHTML = viewPlan();
  else if (state.view === 'guide') el.innerHTML = guideBodyHtml();
  else if (state.view === 'social') el.innerHTML = viewSocial();
  else el.innerHTML = viewProgress();
  if (arriving) {
    // Reading offsetWidth restarts the animation: without it the class is
    // removed and re-added inside one frame and the browser sees no change.
    void el.offsetWidth;
    el.classList.add('view-enter');
  }
}

/* ============================= THE GUIDE =============================
 * Every section closed on arrival, so the sheet opens as a short list of
 * questions rather than a wall of answers — the same collapsed-until-asked
 * pattern the Plan and Progress groups already use, and the reason this can
 * be complete without being cluttered.
 *
 * The step number is drawn from the position in the list rather than stored
 * on each section, so reordering the guide renumbers it and there is no second
 * copy of the sequence to fall out of step with the first.
 *
 * It reads GUIDE_SECTIONS and nothing else. No app state, no derived numbers,
 * so it cannot go stale against your data and there is nothing here to break.
 */
function guideBodyHtml() {
  let lastPhase = null;
  const sections = GUIDE_SECTIONS.map((sec, i) => {
    const open = groupOpen('guide', sec.id, GUIDE_SECTIONS.length);
    // The phase label is emitted on change rather than stored as a nesting
    // level, so the step numbers stay one flat run from 1 to 12.
    const label = sec.phase !== lastPhase
      ? `<div class="section-label">${escapeHtml(sec.phase)}</div>` : '';
    lastPhase = sec.phase;
    const head = `<button class="guide-row ${open ? 'open' : ''}" data-action="toggle-group" data-view="guide" data-key="${sec.id}" data-open="${open}" aria-expanded="${open}">
        <span class="guide-step">${i + 1}</span>
        <span class="guide-title">${escapeHtml(sec.title)}</span>
        <span class="group-chev ${open ? 'open' : ''}">${ICONS.chevron}</span>
      </button>`;
    if (!open) return label + head;
    const notes = sec.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('');
    return `${label}${head}<div class="guide-body">
        <p class="guide-lead">${escapeHtml(sec.lead)}</p>
        <ul class="guide-notes">${notes}</ul>
      </div>`;
  }).join('');
  return `<p class="guide-intro">${escapeHtml(GUIDE_INTRO)}</p>${sections}`;
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

  const anyTimed = has.some((e) => isTimeMode(e));

  const byView = {
    today: [
      has.length && ['Log reps', 'Tap the exercise, then a number.'],
      has.length && ['A number the pad hasn’t got', 'Exact set, under the total. Logged as one set.'],
      has.length && ['Take reps off', 'Flip the lever to Subtract.'],
      anyTimed && ['Timed exercises', 'No pad. Tap Start, and the clock is the work.'],
      has.length && ['The clock', 'Starts on your first rep. Pause any time.'],
      anyTarget && ['Hit the target', 'Take the win, or Keep going.'],
      has.length && ['End early', 'Give up keeps your reps and stops the clock.'],
      anyTarget && ['Once it is done', 'Hitting the target locks the card. Train again to reopen it.'],
      anyTarget && ['Rest a day', 'Open the exercise, Take a break. Streak holds.'],
      has.length && ['Share a session', 'Share image on a finished exercise — Instagram, Messages, or save to Photos.'],
      has.length && ['Share the day', 'Once everything is done: Share this day.'],
      !has.length && ['Start', 'Add an exercise.'],
      ['Daily weigh-in', 'A health habit, not an exercise. It never touches a streak, and it disappears once today is logged.'],
    ],
    plan: [
      ['Edit', 'Tap the exercise.'],
      ['Schedule', 'Every day, or pick weekdays. A day off is never a miss.'],
      ['Count or Time', 'Count gives it a keypad. Time gives it a clock and a target in minutes.'],
      ['One-time', 'Add → One-time makes an unscheduled workout: name and a unit, no target. Log into it on Today, then Complete it.'],
      has.length && ['Retire', 'Archive keeps history. Delete removes it.'],
    ],
    progress: [
      ['The strip', 'Filled = hit, 🌙 = rest, hollow = missed, faint = day off.'],
      ['Open a card', 'Its numbers, best day and recent days.'],
      anyHistory && ['Fix a number', 'Tap a total or target inside a card.'],
      ['Top set vs Max', 'Best single set, versus biggest day.'],
      anyTimed && ['Timed exercises', 'Longest and average session, in place of top set.'],
      (state.profile && (state.profile.weightLog || []).length) && ['Weight tracking', 'Log daily. The chart plots each week’s average weight, so you see the trend, not the daily noise.'],
    ],
  };

  byView.social = [
    ['A crew', 'People you train with, each on their own phone and their own Google account.'],
    ['What they see', 'Your name, photo, streaks and totals. Never your individual sets, weight or notes.'],
    ['Invite', 'Send the link or read out the code. Anyone with it can join, so send it to people, not places.'],
    ['Nudge and Good job', 'Open someone: nudge them if they have not trained, say good job if they have.'],
    ['Stories', 'Add photos through the day. Each lasts 24 hours, then deletes itself.'],
    ['Roles and classes', 'The leader assigns both. They show on your profile and beside your name.'],
    ['Rest days', 'A rest you claim shows as 🌙 to the crew, and hides the nudge button on your card.'],
    ['Motto', 'The leader writes one line. It sits under the crew name and on shared images.'],
    ['Who looked', 'Your own card lists who opened it today, and your story lists who watched.'],
    ['Leaving', 'You can leave any time — your card goes with you.'],
  ];

  const title = { today: 'Today', plan: 'Plan', progress: 'Progress', social: 'Social' }[state.view] || 'Today';
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

/* ============================= VIEW: TODAY ============================= */
/**
 * A health habit, not an exercise: no ring, no bar, no target, no "to go".
 * It sits below the exercises and is labelled, so it can never be read as one.
 *
 * Daily now: it asks once a day and disappears the moment today is logged. The
 * week's average is what Progress plots, so the value of logging is consistency,
 * not hitting a particular day.
 */
const SLOT_MARK = { kept: '✓', skip: '–', broke: '✕' };

function slotPillHtml(habit, day, slot) {
  const rec = slotAt(state.habitLog, day, habit.id, slot.key);
  if (rec) {
    // Filled means logged inside its own window; hollow means caught up later.
    // Derived from the clock, so it is the one mark that cannot be tapped into
    // existence after the fact.
    const live = isLive(slot.key, rec.at);
    return `<div class="slot-done ${rec.v} ${live ? 'live' : 'late'}" title="${live ? 'Logged in the moment' : 'Logged later'}">
      <span class="slot-mark">${SLOT_MARK[rec.v]}</span><span class="slot-name">${escapeHtml(slot.label)}</span>
    </div>`;
  }
  const label = slot.block ? slot.label : (habit.rule || slot.label);
  return `<div class="slot-row">
    <span class="slot-name">${escapeHtml(label)}</span>
    <span class="slot-btns">
      <button class="slot-btn kept" data-action="log-slot" data-id="${habit.id}" data-slot="${slot.key}" data-v="kept">Kept</button>
      <button class="slot-btn" data-action="log-slot" data-id="${habit.id}" data-slot="${slot.key}" data-v="skip">Skipped</button>
      <button class="slot-btn broke" data-action="log-slot" data-id="${habit.id}" data-slot="${slot.key}" data-v="broke">Broke</button>
    </span>
  </div>`;
}

function habitCardHtml(habit, day, nowMs) {
  const st = habitDayState(state.habitLog, habit, day);
  const stats = habitStats(state.habitLog, habit, day);
  const off = isOffPlan(state.habitLog, day, habit.id);
  const untouched = !hasAnySlot(state.habitLog, day, habit.id);
  const meals = habit.kind === 'meals';
  // A one-tap habit never collapses: its row IS the action, and hiding that
  // behind a chevron would turn one tap into two. Only the six-slot shape has
  // anything worth tucking away.
  const open = meals ? groupOpen('habit', habit.id, 0) : true;

  const stateLabel = st === 'broken' ? 'Broken today'
    : st === 'clean' ? 'Clean today'
    : st === 'off' ? 'Off plan'
    : 'Nothing logged yet';

  const logged = slotsFor(habit).filter((sl) => slotAt(state.habitLog, day, habit.id, sl.key)).length;
  const summary = off ? 'Off plan' : (meals ? `${logged} of 6 · ${stateLabel}` : stateLabel);

  const head = meals
    ? `<button class="habit-head" data-action="toggle-group" data-view="habit" data-key="${habit.id}" data-open="${open}" aria-expanded="${open}">
        <span class="habit-emoji">${escapeHtml(habit.emoji || '✅')}</span>
        <div class="habit-title"><b>${escapeHtml(habit.name)}</b><span>${escapeHtml(summary)}</span></div>
        <span class="habit-streak">🔥 ${stats.current}</span>
        <span class="group-chev ${open ? 'open' : ''}">${ICONS.chevron}</span>
      </button>`
    : `<div class="habit-head">
        <span class="habit-emoji">${escapeHtml(habit.emoji || '✅')}</span>
        <div class="habit-title"><b>${escapeHtml(habit.name)}</b><span>${escapeHtml(summary)}</span></div>
        <span class="habit-streak">🔥 ${stats.current}</span>
      </div>`;

  if (!open) return `<div class="habit-day-card state-${st} tucked">${head}</div>`;

  let body;
  if (off) {
    body = `<div class="habit-note">🌙 Off plan today — the streak holds.</div>`;
  } else if (meals) {
    body = HABIT_BLOCKS.map((b) => {
      const slots = HABIT_SLOTS.filter((sl) => sl.block === b.key);
      const isNow = b.key === blockAt(nowMs).key;
      const allDone = slots.every((sl) => slotAt(state.habitLog, day, habit.id, sl.key));
      return `<div class="habit-block-row ${isNow ? 'now' : (allDone ? 'done' : 'other')}">
        <div class="habit-block-name"><span>${b.label}</span><span>${b.window}</span></div>
        <div class="habit-slots">${slots.map((sl) => slotPillHtml(habit, day, sl)).join('')}</div>
      </div>`;
    }).join('');
  } else {
    body = `<div class="habit-slots">${slotPillHtml(habit, day, slotsFor(habit)[0])}</div>`;
  }

  // Between midnight and 5 AM the habit day and the calendar day disagree. Say
  // so, or the card looks broken.
  const nightNote = day !== todayISO()
    ? `<div class="habit-note">Still ${escapeHtml(formatDisplayDate(day, { weekday: 'long' }))} night — a habit day runs 5 AM to 5 AM.</div>`
    : '';

  return `<div class="habit-day-card state-${st}">
    ${head}
    ${meals && habit.rule ? `<div class="habit-note">${escapeHtml(habit.rule)}</div>` : ''}
    ${nightNote}
    ${body}
    ${untouched && !off ? `<button class="habit-offbtn" data-action="habit-off-plan" data-id="${habit.id}" data-on="1">Take today off plan</button>` : ''}
    ${off ? `<button class="habit-offbtn" data-action="habit-off-plan" data-id="${habit.id}" data-on="0">Actually, I'm on it</button>` : ''}
  </div>`;
}

function habitsSectionHtml() {
  const nowMs = Date.now();
  const day = habitDay(nowMs);
  const due = state.habits.filter((h) => h.active && isScheduledOn(h, day));
  if (!due.length) return '';
  return `<div class="section-label">Health habits</div>`
    + due.map((h) => habitCardHtml(h, day, nowMs)).join('');
}

function weighInCardHtml() {
  const p = state.profile || {};
  const today = todayISO();
  const todayEntry = (p.weightLog || []).find((e) => e && e.d === today && e.w > 0);
  // Done for the day: a quiet confirmation rather than a vanished card, so it's
  // clear the weigh-in registered. Tapping re-opens it to correct the number.
  if (todayEntry) {
    return `<div class="section-label">Health habit</div>
      <button class="habit-done" data-action="open-weigh-in">
        <span class="habit-done-tick">${ICONS.check}</span>
        <span class="habit-done-text">Weighed in today · <b>${formatWeight(todayEntry.w, 'kg')}</b></span>
        <span class="habit-done-edit">Edit</span>
      </button>`;
  }
  return `<div class="section-label">Health habit</div>
    <div class="habit-card">
      <div class="habit-text"><b>Daily weigh-in</b><span>A few seconds each morning. Your weekly average is on Progress.</span></div>
      <button class="habit-btn" data-action="open-weigh-in">Log weight</button>
    </div>
    ${tipHtml('weigh-in', 'Tracked apart from exercises — weighing in never touches a streak. Log daily; Progress shows the weekly-average trend.')}`;
}

/**
 * The habit's own place on Progress: a line chart of each week's average weight,
 * the progression a daily habit is for. Reuses the trajectory chart's shape.
 */
function weightChartHtml(weeks) {
  if (weeks.length < 2) {
    return `<div class="traj-empty">Two weeks of weigh-ins and this becomes a trend.</div>`;
  }
  const W = 320, H = 120, padL = 8, padR = 8, padT = 10, padB = 18;
  const vals = weeks.map((w) => w.avg);
  const maxY = Math.max(...vals), minY = Math.min(...vals);
  const span = maxY - minY || 1;
  const x = (i) => padL + (i / (weeks.length - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - minY) / span) * (H - padT - padB);
  const pts = weeks.map((w, i) => `${x(i).toFixed(1)},${y(w.avg).toFixed(1)}`).join(' ');
  const dots = weeks.map((w, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(w.avg).toFixed(1)}" r="${w.isCurrent ? 3.5 : 2.5}" class="${w.isCurrent ? 'traj-dot-current' : 'traj-dot'}"><title>Week of ${w.weekStart}: ${w.avg} kg avg</title></circle>`).join('');
  const first = weeks[0], last = weeks[weeks.length - 1];
  return `<svg class="traj-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly average weight from ${first.avg} to ${last.avg} kg">
    <polyline points="${pts}" class="traj-line" fill="none"/>
    ${dots}
    <text class="traj-axis" x="${padL}" y="${H - 4}" text-anchor="start">${escapeHtml(formatDisplayDate(first.weekStart, { month: 'short', day: 'numeric' }))}</text>
    <text class="traj-axis" x="${W - padR}" y="${H - 4}" text-anchor="end">${escapeHtml(formatDisplayDate(last.weekStart, { month: 'short', day: 'numeric' }))}</text>
  </svg>`;
}

function habitProgressHtml() {
  const day = habitDay(Date.now());
  return state.habits.filter((h) => h.active).map((h) => {
    const s = habitStats(state.habitLog, h, day);
    const strip = Array.from({ length: 30 }, (_, i) => {
      const d = addDays(day, -(29 - i));
      return `<span class="hstrip-cell ${habitDayState(state.habitLog, h, d)}" title="${d}"></span>`;
    }).join('');
    const worst = Object.entries(s.breaksBySlot).sort((a, b) => b[1] - a[1])[0];
    const worstSlot = worst ? HABIT_SLOTS.find((x) => x.key === worst[0]) : null;
    // A 30-day strip and three lines of prose per habit is the top half of
    // Progress spent before you reach a single exercise. The streak is the
    // number anyone came for, so it rides on the header and the rest folds.
    // Its own view key, not `habit`: Today's habit card folds independently.
    const head = foldHeaderHtml('hprog', h.id, `${h.emoji || '✅'} ${h.name}`, `🔥 ${s.current} · longest ${s.longest}`);
    if (!groupOpen('hprog', h.id, 0)) return head;
    return head + `<div class="habit-block">
      <div class="hstrip">${strip}</div>
      <div class="bmi-line">🔥 ${s.current} day${s.current === 1 ? '' : 's'} · longest ${s.longest} · ${s.cleanIn30} clean in the last 30</div>
      ${h.kind === 'meals' && s.liveRate != null ? `<div class="bmi-line">Logged in the moment — ${s.liveRate}%</div>` : ''}
      ${worstSlot && worst[1] > 1 ? `<div class="bmi-line">Breaks most at <b>${escapeHtml(worstSlot.label)}</b> — ${worst[1]} times.</div>` : ''}
    </div>`;
  }).join('');
}

function weighInBlockHtml() {
  const p = state.profile || {};
  const weeks = weeklyAverages(p.weightLog, todayISO());
  if (!weeks.length) return '';
  const s = bmiSummary(p);
  const thisWeek = weeks[weeks.length - 1];
  const change = weeks.length >= 2 ? Math.round((thisWeek.avg - weeks[0].avg) * 10) / 10 : null;
  const head = foldHeaderHtml('hprog', 'weight', 'Weekly weight', `${thisWeek.avg} kg${s ? ` · BMI ${s.bmi}` : ''}`);
  if (!groupOpen('hprog', 'weight', 0)) return head;
  return head + `<div class="habit-block">
    ${weightChartHtml(weeks)}
    <div class="bmi-line">This week avg ${thisWeek.avg} kg${thisWeek.isCurrent && thisWeek.count < 7 ? ' (so far)' : ''}${s ? ` · BMI ${s.bmi} · ${BMI_LABEL[s.category]}` : ''}</div>
    ${change != null ? `<div class="bmi-line ${change < 0 ? 'down' : 'up'}">${change < 0 ? '↓' : '↑'} ${Math.abs(change)} kg since ${escapeHtml(formatDisplayDate(weeks[0].weekStart, { month: 'short', day: 'numeric' }))}</div>` : ''}
  </div>`;
}

/**
 * Eight skate tricks is a wall; two push exercises is not. So a category only
 * folds once it has enough members to actually be clutter, and everything else
 * renders exactly as it always did — no header, no extra tap, no change.
 *
 * A folded category shows its own progress on the header, so you can see where
 * you are without opening it. Open it and the tricks are compact rows rather
 * than full cards: inside a category you are picking from a list you already
 * know, not reading each one.
 */
function renderTodoList(rows, cardFn) {
  const clusters = clusterByCategory(rows.map((r) => r.ex), 3);
  if (clusters.every((c) => c.type === 'one')) return rows.map(cardFn).join('');
  const byId = new Map(rows.map((r) => [r.ex.id, r]));
  return clusters.map((c) => {
    if (c.type === 'one') return cardFn(byId.get(c.ex.id));
    const members = c.exercises.map((e) => byId.get(e.id)).filter(Boolean);
    if (!members.length) return '';
    // An exercise can carry a category key this build no longer knows — art gets
    // renamed, and old data outlives it. Fall back to the name rather than
    // rendering a broken image and a raw key.
    const cat = CATEGORIES.find((x) => x.key === c.key);
    const open = groupOpen('cat', c.key, 0);
    const doneCount = members.filter((r) => r.done).length;
    const head = `<button class="cat-head ${open ? 'open' : ''}" data-action="toggle-group" data-view="cat" data-key="${escapeHtml(c.key)}" data-open="${open}" aria-expanded="${open}">
      ${cat ? `<img class="cat-head-icon" src="${categoryIconUrl(c.key)}" alt="" width="26" height="26">` : ''}
      <span class="cat-head-name">${escapeHtml(cat ? cat.label : c.key)}</span>
      <span class="cat-head-meta">${members.length - doneCount} left</span>
      <span class="group-chev ${open ? 'open' : ''}">${ICONS.chevron}</span>
    </button>`;
    if (!open) return head;
    const list = members.map((r) => `<button class="cat-row ${r.done ? 'done' : ''}" data-action="open-logger" data-id="${r.ex.id}">
      <span class="cat-row-name">${escapeHtml(r.ex.name)}</span>
      <span class="cat-row-num">${r.hasTarget ? `${r.shown} / ${r.target}` : `${r.shown}`}</span>
      ${r.done ? `<span class="cat-row-tick">${ICONS.check}</span>` : ''}
    </button>`).join('');
    return head + `<div class="cat-body">${list}</div>`;
  }).join('');
}

function viewToday() {
  const today = todayISO();
  const all = state.exercises.filter((e) => e.active).sort((a, b) => a.order - b.order);
  const scheduled = all.filter((e) => isScheduledOn(e, today));

  if (all.length === 0) {
    // Habits are not exercises, so an empty plan must not hide them — the same
    // reason habitProgressHtml sits outside the groups on Progress.
    return habitsSectionHtml() + `<div class="empty-card">
      <div class="glyph">🗓️</div>
      <h3>No exercises yet</h3>
      <p>Add your first exercise to start logging sets in seconds.</p>
      <button class="primary-btn" data-action="open-add-exercise">Add your first exercise</button>
    </div>`;
  }

  const now = Date.now();
  const read = (ex) => {
    const target = getEffectiveTarget(ex, today);
    const arr = getSetsFor(ex.id, today);
    const total = calcTotal(arr);
    // What the target is measured in: reps for most, sets for a "3 sets to
    // failure" exercise. Everything the row shows and judges reads this.
    const scored = progressValue(ex, arr);
    const setsMode = ex.targetMode === 'sets';
    const hasTarget = !!target && target > 0;
    // A time exercise banks its minutes when the clock stops, so mid-session the
    // log is behind the clock. What is DONE follows the banked number (the same
    // rule as reps); what is SHOWN follows the clock, because a running session
    // reading "0 of 30" would be a lie about the last twelve minutes.
    const timeMode = isTimeMode(ex);
    const t = getTimerPure(state.timersLog, today, ex.id);
    const shown = timeMode ? Math.max(total, minutesFromMs(timerElapsedMs(t, now))) : (setsMode ? scored : total);
    const left = hasTarget ? Math.max(0, target - shown) : 0;
    // A session you deliberately ended is not work still owing. Today answers
    // "what's left"; it should not keep asking for reps you already declined.
    const endedEarly = timerPhase(getTimerPure(state.timersLog, today, ex.id)) === 'gaveup';
    // Hit the number but not yet photographed: the work is done, the day is not.
    const needsProof = proofRequiredOn(today, state.meta.proofSince)
      && !proofFor(state.proofLog, today, ex.id);
    const hitNumber = hasTarget ? scored >= target : total > 0;
    return {
      needsProof: needsProof && hitNumber && !endedEarly && !isBreakDay(state.streakOverrides, today, ex.id),
      hitNumber,
      ex, target, total, shown, timeMode, setsMode, scored, hasTarget, left, endedEarly,
      done: endedEarly || isBreakDay(state.streakOverrides, today, ex.id)
        || (hitNumber && !needsProof),
      leftLabel: setsMode ? (Math.max(0, target - scored) === 1 ? 'set left' : 'sets left') : 'to go',
      rest: isBreakDay(state.streakOverrides, today, ex.id),
      pct: hasTarget ? Math.min(1, shown / target) : (shown > 0 ? 1 : 0),
      timer: t,
    };
  };

  const rows = scheduled.map(read);
  const done = rows.filter((r) => r.done);

  /* What is left to do, largest thing on the row. One tap starts it. */
  const proofCard = (r) => `<div class="ex-card needs-proof">
    <div class="ex-icon-badge">${exIconHtml(r.ex, 34)}</div>
    <div class="ex-body">
      <div class="ex-name">${escapeHtml(r.ex.name)}</div>
      <div class="ex-sub">Done — one photo to finish it.</div>
    </div>
    <div class="proof-actions">
      <button class="secondary-btn proof-btn" data-action="keep-going" data-id="${r.ex.id}">Keep going</button>
      <button class="primary-btn proof-btn" data-action="open-proof" data-id="${r.ex.id}">Add proof</button>
    </div>
  </div>`;

  const todoCard = (r) => {
    const running = r.timer && r.timer.status === 'running';
    return `<button class="today-card" data-action="open-logger" data-id="${r.ex.id}">
      <span class="today-icon">${exIconHtml(r.ex, 46)}</span>
      <span class="today-body">
        <span class="today-name">${escapeHtml(r.ex.name)}${weightTag(r.ex)}</span>
        <span class="today-meter" aria-hidden="true"><i style="width:${Math.round(r.pct * 100)}%"></i></span>
        <span class="today-sub">${r.hasTarget
          ? (r.setsMode
              // Sets count UP — "2 sets" and how many are left — because a
              // fraction reads like a rep score and this is not one. Reps stay
              // beside it so the two are never confused for each other.
              ? `<b>${r.scored} set${r.scored === 1 ? '' : 's'}</b> · ${r.total} ${escapeHtml(r.ex.unit)}`
              : `${r.timeMode ? `<b data-elapsed-min="${r.ex.id}">${r.shown}</b>` : r.shown} of ${r.target} ${escapeHtml(targetUnit(r.ex))}`)
          : `${r.timeMode ? `<b data-elapsed-min="${r.ex.id}">${r.shown}</b>` : r.shown} ${escapeHtml(r.ex.unit)} · no target`}${categoryLabel(r.ex) ? ` · ${catTagHtml(r.ex)}` : ''}${running ? ` · <b data-elapsed="${r.ex.id}">${formatElapsed(timerElapsedMs(r.timer, Date.now()))}</b>` : ''}</span>
      </span>
      <span class="today-left">
        ${r.timeMode && !running && !r.shown ? `<b class="today-go">${ICONS.play}</b><em>start</em>`
          : r.hasTarget
            ? `<b${r.timeMode ? ` data-elapsed-min="${r.ex.id}" data-left-of="${r.target}"` : ''}>${r.left}</b><em>${r.timeMode ? 'min left' : r.leftLabel}</em>`
            : `<b${r.timeMode ? ` data-elapsed-min="${r.ex.id}"` : ''}>${r.shown}</b><em>logged</em>`}
      </span>
    </button>`;
  };

  /* Finished work steps back: one quiet line, no colour blast. */
  const doneRow = (r) => {
    // Ended early is closed out, not won: it keeps the quiet row but takes a
    // flag instead of the tick, and shows the shortfall honestly.
    const short = r.endedEarly && r.hasTarget && r.total < r.target;
    // The row is a container rather than one button, because it now carries two
    // actions — open it, or share it. A rest day has nothing to put on a card,
    // so it keeps the row it always had and no share.
    return `<div class="done-row${short ? ' ended-early' : ''}">
      ${proofFor(state.proofLog, today, r.ex.id) ? `<button class="done-proof" data-action="open-proof" data-id="${r.ex.id}" aria-label="View proof for ${escapeHtml(r.ex.name)}">${ICONS.camera}</button>` : ''}
      <button class="done-open" data-action="open-logger" data-id="${r.ex.id}">
        <span class="done-tick">${r.rest ? '🌙' : (short ? ICONS.flag : ICONS.check)}</span>
        <span class="done-name">${escapeHtml(r.ex.name)}</span>
        <span class="done-num">${r.rest ? 'Rest' : (r.setsMode ? `${r.scored} set${r.scored === 1 ? '' : 's'} · ${r.total} ${escapeHtml(r.ex.unit)}` : (short ? `${r.scored} of ${r.target}` : `${r.total} ${escapeHtml(r.ex.unit)}`))}${r.timer && r.timer.finishedAt ? `<i class="done-at">${escapeHtml(formatClock(r.timer.finishedAt))}</i>` : ''}</span>
      </button>
      ${r.rest ? '' : `<button class="done-share" data-action="share-session" data-id="${r.ex.id}" aria-label="Share ${escapeHtml(r.ex.name)}">${ICONS.share}</button>`}
    </div>`;
  };

  let html = tipHtml('open-ex', 'Tap an exercise to log reps.');

  // Anything waiting on a photo is lifted above the rest: it is the shortest
  // path to finishing the day, and burying it under work you have not started
  // would be the surest way to leave the day unfinished.
  const awaiting = rows.filter((r) => r.needsProof);
  if (awaiting.length) {
    html += `<div class="section-label">Needs proof · ${awaiting.length}</div>`;
    html += awaiting.map(proofCard).join('');
  }
  const todo = rows.filter((r) => !r.done && !r.needsProof);
  if (todo.length) {
    html += `<div class="section-label">To do${todo.length > 1 ? ` · ${todo.length}` : ''}</div>`;
    html += renderTodoList(todo, todoCard);
  } else if (scheduled.length) {
    // The day's own card hangs off the moment the day is declared over, so it
    // needs no row of its own on a screen whose whole job is what is left.
    html += `<div class="all-clear"><b>All done today</b><span>Every target met. Rest up.</span>
      ${done.some((r) => !r.rest) ? `<button class="all-clear-share" data-action="share-day">${ICONS.share}Share this day</button>` : ''}</div>`;
  }

  if (done.length) {
    html += `<div class="section-label">Done</div>` + done.map(doneRow).join('');
  }

  // Nothing due today and nothing logged: a quiet rest day rather than a blank
  // screen. Exercises not scheduled for today are hidden — they belong to their
  // own days, not this one.
  if (scheduled.length === 0 && done.length === 0) {
    html += `<div class="all-clear"><b>Nothing scheduled today</b><span>Enjoy the rest — your streak holds.</span></div>`;
  }

  const onBreak = scheduled.filter((ex) => isBreakDay(state.streakOverrides, today, ex.id));
  if (onBreak.length) {
    html += `<p class="break-nudge resting">🌙 Resting today: ${onBreak.map((e) => escapeHtml(e.name)).join(', ')}</p>`;
  } else if (scheduled.length) {
    html += `<p class="break-nudge">Not training one today? Open it and take a break — the streak holds.</p>`;
  }

  html += habitsSectionHtml();
  html += weighInCardHtml();

  return html;
}

/* ============================= VIEW: SOCIAL =============================
 * A crew is the only screen in Sets that needs the network, so it is also the
 * only one that has to be honest about not having it. Every state — signed
 * out, no crew, a stale roster, a failed call — is a screen someone can read
 * and act on, not a spinner.
 *
 * The roster is whatever the Worker last said, cached in IndexedDB. It renders
 * before any request goes out, so opening the tab on a train shows your crew
 * as it was rather than nothing at all.
 */
function activeCrew() {
  const list = state.crew.crews || [];
  if (!list.length) return null;
  return list.find((c) => c.id === state.crew.activeId) || list[0];
}

/** The Worker marks the caller's own row — it knows the id Google gave it, and
 *  the app does not. Guessing by email here recognised nobody. */
function isMe(member) {
  return !!(member && member.isMe);
}

function memberInitial(m) {
  return ((m.name || '?').trim()[0] || '?').toUpperCase();
}

/**
 * Stories this device has opened.
 *
 * The Worker reports views recorded today, which is the right window for "who
 * looked at your card" and the wrong one for this: a story watched at 23:55
 * would count as unwatched again at midnight and put the badge back. Watching
 * is a fact about this phone, so this phone remembers it — and prunes anything
 * older than a story can live.
 */
let seenStories = {};

function markStorySeen(id) {
  if (!id || seenStories[id]) return;
  seenStories[id] = Date.now();
  const cutoff = Date.now() - 48 * 3600 * 1000;
  Object.keys(seenStories).forEach((k) => { if (seenStories[k] < cutoff) delete seenStories[k]; });
  db.setItem('stories-seen', seenStories).catch(() => {});
}

/**
 * How many of someone's stories you have not watched yet.
 *
 * Your own never count: the Worker does not record you viewing your own story,
 * so they would sit permanently unread and put a badge on your own face.
 */
function unseenStories(m) {
  if (!m || m.isMe) return 0;
  return plainStories(m).filter((st) => st && !st.seenByMe && !seenStories[st.id]).length;
}

/**
 * Someone's face, the ring that says there is a story behind it, and the count
 * of how many are still unwatched.
 *
 * Bright ring until you have seen them, faint once you have — the grammar
 * everyone already knows. The number is only drawn while it is above zero, so a
 * fully-watched crew is a screen with no numbers on it at all.
 */
function memberFaceHtml(m, size, tappable) {
  const unseen = unseenStories(m);
  const hasStory = plainStories(m).length > 0;
  const ring = hasStory ? (unseen ? ' has-story' : ' seen-story') : '';
  const inner = m.photo
    ? `<img src="${escapeHtml(m.photo)}" alt="">`
    : `<span class="face-initial">${escapeHtml(memberInitial(m))}</span>`;
  const cls = `crew-face${m.photo ? '' : ' empty'}${ring}`;
  const style = `width:${size}px;height:${size}px`;
  const badge = unseen ? `<i class="story-count">${unseen}</i>` : '';
  // Only a face with a story is a button — nothing else on the row would do
  // anything, and a control that does nothing is worse than no control.
  return hasStory && tappable
    ? `<button class="${cls}" style="${style}" data-action="open-story" data-id="${m.id}"
        aria-label="${unseen ? `${unseen} unwatched ${unseen === 1 ? 'story' : 'stories'} from` : 'Stories from'} ${escapeHtml(m.name || 'them')}">${inner}${badge}</button>`
    : `<span class="${cls}" style="${style}">${inner}${badge}</span>`;
}

function viewSocial() {
  // `hasSyncAccount`, never `isSignedIn`: the access token is stale for most of
  // any given hour and silently renewable, which is why every other sync path
  // in this app gates on the account instead of the token. Gating on the token
  // here told signed-in people to sign in.
  if (!hasSyncAccount() && !(state.crew.crews || []).length) {
    return `<div class="empty-card">
      <div class="glyph">👥</div>
      <h3>Train together</h3>
      <p>A crew shows you and your friends' streaks side by side. It needs the Google account you already sync with.</p>
      <button class="primary-btn" data-action="google-sign-in">Sign in with Google</button>
    </div>`;
  }

  const crews = state.crew.crews || [];
  const crew = activeCrew();

  const notice = state.crew.error
    ? `<p class="tip crew-stale"><span>${escapeHtml(crewErrorLine())}</span>${state.crew.lastSync ? '<em>Showing your crew as it last was.</em>' : ''}</p>`
    : '';

  if (!crews.length) {
    return `${notice}<div class="empty-card">
      <div class="glyph">👥</div>
      <h3>No crew yet</h3>
      <p>Make one and send the link to whoever you train with. Everyone keeps their own app — you just see each other's streaks.</p>
      <button class="primary-btn" data-action="open-create-crew">Create a crew</button>
      <button class="secondary-btn crew-join-btn" data-action="open-join-crew">Join with a code</button>
    </div>`;
  }

  // More than one crew gets a switcher; one crew does not need naming twice.
  const switcher = crews.length > 1
    ? `<div class="crew-switch">${crews.map((c) => `<button class="crew-chip ${c.id === crew.id ? 'on' : ''}" data-action="pick-crew" data-id="${c.id}">${escapeHtml(c.name)}</button>`).join('')}</div>`
    : '';

  const me = (crew.members || []).find(isMe);
  const iOwn = me && crew.owner === me.id;

  const rows = (crew.members || []).map((m) => {
    const mine = isMe(m);
    return `<div class="crew-row ${m.trainedToday ? 'trained' : ''} ${mine ? 'me' : ''}">
      ${memberFaceHtml(m, 44, true)}
      <button class="crew-open" data-action="open-member" data-id="${m.id}">
      <span class="crew-body">
        <span class="crew-name">${escapeHtml(m.name || 'Someone')}${mine ? '<em>you</em>' : ''}${m.role && m.role !== 'member' ? `<img class="role-mark" src="${crewIconUrl('role', m.role)}" alt="${escapeHtml((roleInfo(m.role) || {}).label || '')}" width="22" height="22">` : ''}</span>
        <span class="crew-sub">${m.restingToday && !m.trainedToday ? 'resting today · ' : ''}${m.streak ? `${m.streak} day streak` : 'no streak yet'}${m.best > m.streak ? ` · best ${m.best}` : ''}</span>
      </span>
      <span class="crew-state">${reactionChipsHtml(m, true)}${m.trainedToday ? ICONS.check
        : (m.restingToday ? '<span class="crew-rest" title="Resting today">🌙</span>' : '<i class="crew-pending"></i>')}</span>
      </button>
    </div>`;
  }).join('');

  const trained = (crew.members || []).filter((m) => m.trainedToday).length;

  return `${notice}
    ${switcher}
    <div class="crew-head">
      ${crew.logo ? `<img class="crew-logo" src="${escapeHtml(crew.logo)}" alt="">` : ''}
      <div class="crew-title">
        <h2>${escapeHtml(crew.name)}</h2>
        ${crew.motto ? `<p class="crew-motto">${escapeHtml(crew.motto)}</p>` : ''}
        <span>${crew.members.length} member${crew.members.length === 1 ? '' : 's'} · ${trained} trained today${crew.createdAt ? ` · since ${escapeHtml(sinceLabel(crew.createdAt))}` : ''}</span>
      </div>
      <button class="icon-btn" data-action="crew-menu" data-id="${crew.id}" aria-label="Crew settings">${ICONS.gear}</button>
    </div>
    ${storyBarHtml(crew)}
    <div class="crew-list">${rows}</div>
    <button class="crew-invite-btn" data-action="open-invite" data-id="${crew.id}">${ICONS.share}Invite someone</button>
    ${iOwn ? '' : ''}
    <p class="crew-foot">Everyone sees streaks and totals. Nobody sees your individual sets, your weight, or your notes.</p>`;
}

/**
 * The row of faces at the top of a crew: yours first with a + to post, then
 * anyone with a live story. It only appears when there is something to show or
 * something you could add — an empty rail of grey circles is furniture.
 */
function storyBarHtml(crew) {
  const me = (crew.members || []).find((m) => m.isMe);
  const others = (crew.members || []).filter((m) => !m.isMe && m.story);
  if (!me && !others.length) return '';
  const tile = (m, label) => `<button class="story-tile" data-action="${plainStories(m).length ? 'open-story' : 'add-story'}" data-id="${m.id}">
      ${memberFaceHtml(m, 56)}
      <span>${escapeHtml(label)}</span>
      ${m.isMe && !m.story ? '<i class="story-plus">+</i>' : ''}
    </button>`;
  return `<div class="story-bar">
    ${me ? tile(me, me.story ? 'Your story' : 'Add story') : ''}
    ${others.map((m) => tile(m, m.name || 'Someone')).join('')}
  </div>`;
}

/**
 * Where you stand in your crew: role, class, and whose crew it is.
 *
 * Read from the roster the Worker last sent rather than kept locally, because
 * the leader assigns both and this phone is not the one that decides. Absent
 * until there is a crew to be in, so a solo profile gains no empty rows.
 */
function crewStandingHtml() {
  const crews = state.crew.crews || [];
  const rows = crews.map((c) => {
    const me = (c.members || []).find((m) => m.isMe);
    if (!me) return '';
    return `<div class="standing">
      <div class="standing-crew">
        ${c.logo ? `<img src="${escapeHtml(c.logo)}" alt="">` : '<i class="standing-dot"></i>'}
        <span>${escapeHtml(c.name)}${c.motto ? `<em>${escapeHtml(c.motto)}</em>` : ''}${me.joinedAt ? `<i>Member since ${escapeHtml(sinceLabel(me.joinedAt))}</i>` : ''}</span>
      </div>
      <div class="standing-tags">${crewTagHtml('role', me.role)}${crewTagHtml('class', me.klass)}</div>
    </div>`;
  }).filter(Boolean).join('');
  if (!rows) return '';
  return `<div class="field">
    <label>Crew</label>
    ${rows}
    <div class="hint">Your crew sees this. The leader sets the role and the class.</div>
  </div>`;
}

/** "Aug 2026" — a month is the right resolution for how long someone has been
 *  around. A day would invite counting; a year would flatten everyone. */
function sinceLabel(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
}

function crewErrorLine() {
  return crewApi.crewErrorText(state.crew.error, state.crew.errorDetail);
}

/**
 * Joining, from wherever the code came from.
 *
 * A link, a typed code and a QR all land here, so the rules — signed in first,
 * then join, then show me the crew I just joined — are written once. Someone
 * following an invite while signed out is the common case, not the edge one:
 * the code is kept, the sign-in prompt opens, and the join completes itself
 * once they are back.
 */
async function joinCrewByCode(raw) {
  const code = String(raw || '').trim();
  if (!code) { showToast('Paste or type the invite code.'); return false; }
  if (!hasSyncAccount()) {
    state.crew.pendingCode = code;
    await db.setItem('crew-pending-code', code).catch(() => {});
    state.modal = { type: 'profile' };
    renderModal();
    showToast('Sign in to join the crew');
    return false;
  }
  showToast('Joining…');
  await primeCrewPhoto();
      const res = await crewApi.joinCrew(code, myCrewCard());
  if (!applyCrewResult(res, { toast: true })) return false;
  state.crew.pendingCode = null;
  await db.setItem('crew-pending-code', null).catch(() => {});
  closeModal();
  state.view = 'social';
  db.prefs.set('view', 'social');
  rerender();
  const crew = activeCrew();
  showToast(crew ? `You're in ${crew.name}` : 'Joined');
  return true;
}

/**
 * Proof rides the story pipe, because it is the only channel that already
 * carries an image, expires in a day and records who looked — and it needs no
 * Worker deploy, which would otherwise put this feature behind a Cloudflare
 * dashboard only Johnny can reach.
 *
 * The caption is what separates the two. A proof shot is captioned
 * `proof:<exercise>`, which is never shown: proof is filtered OUT of the
 * stories row and surfaced on the exercise it belongs to instead, so it reads
 * as evidence attached to a workout rather than as someone posting a story.
 */
const PROOF_TAG = 'proof:';

function isProofStory(story) {
  return !!(story && typeof story.caption === 'string' && story.caption.startsWith(PROOF_TAG));
}

function proofExerciseName(story) {
  return isProofStory(story) ? story.caption.slice(PROOF_TAG.length) : '';
}

/** Someone's proof for one exercise today, or null. */
function proofStoryFor(member, exerciseName) {
  const list = (member && (member.stories || (member.story ? [member.story] : []))) || [];
  return list.find((st) => isProofStory(st) && proofExerciseName(st) === exerciseName) || null;
}

/** The stories row shows stories. Proof is not one. */
function plainStories(member) {
  const list = (member && (member.stories || (member.story ? [member.story] : []))) || [];
  return list.filter((st) => !isProofStory(st));
}

/** One story out of someone's day. Fetching the picture is what records the
 *  view, so stepping to the next one marks that one seen too. */
async function openStoryAt(memberId, index) {
  const crew = activeCrew();
  const m = crew && (crew.members || []).find((x) => x.id === memberId);
  const list = (m && (m.stories || (m.story ? [m.story] : []))) || [];
  const at = Math.max(0, Math.min(index, list.length - 1));
  const story = list[at];
  if (!story) return;
  state.modal = { type: 'story', memberId, index: at, loading: true, image: null, caption: story.caption, error: null };
  renderModal();
  const res = await crewApi.openStory(story.id);
  if (res.ok) {
    // Marked here as well as on the server: the badge should drop as the
    // picture appears, not when the next roster arrives.
    story.seenByMe = true;
    markStorySeen(story.id);
    renderView();
  }
  if (!state.modal || state.modal.type !== 'story') return;
  state.modal.loading = false;
  if (res.ok) { state.modal.image = res.image; state.modal.caption = res.caption || ''; }
  else state.modal.error = res.error;
  renderModal();
  refreshCrews().catch(() => {});
}

/** Opens the Accept sheet for a code, fetching what the invite leads to. */
function openInviteAccept(code) {
  state.view = 'social';
  db.prefs.set('view', 'social');
  state.modal = { type: 'crewAccept', code, loading: true, crew: null, error: null };
  rerender();
  crewApi.peekCrew(code).then((res) => {
    if (!state.modal || state.modal.type !== 'crewAccept') return;
    state.modal.loading = false;
    if (res.ok) state.modal.crew = res.crew;
    else state.modal.error = res.error;
    renderModal();
  });
}

/** An invite link is `#/join/<code>`. Read once at boot, then wiped from the
 *  address bar so a reload cannot re-trigger it. */
function readInviteFromUrl() {
  const m = /^#\/join\/([A-Za-z0-9-]{4,16})$/.exec(location.hash || '');
  if (!m) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return m[1];
}

/* ---- crew data ---- */

/** What this device publishes. Built fresh at the moment of sending, never
 *  stored, so it cannot go stale in a cache the way a snapshot would. */
/**
 * The photo the crew sees: 96px, not the 192px one in the profile.
 *
 * The full avatar is 12-25 KB of data URL, which blew the card budget and was
 * dropped silently — every crew member appeared as a grey initial. Publishing a
 * smaller copy is the fix, and it is cached against the avatar it came from so
 * a sync every few minutes does not redraw a canvas each time.
 */
const CREW_PHOTO_PX = 96;
let crewPhotoCache = { from: null, url: '' };

function crewPhoto() {
  const src = (state.profile && state.profile.avatar) || '';
  if (!src) return '';
  if (crewPhotoCache.from === src) return crewPhotoCache.url;
  try {
    const img = new Image();
    img.src = src;
    // A data URL is already decoded by the time it is assigned in every engine
    // this app runs on; if it is not, we simply publish nothing this round and
    // the next sync catches it.
    if (!img.complete || !img.naturalWidth) return crewPhotoCache.from === src ? crewPhotoCache.url : '';
    const c = document.createElement('canvas');
    c.width = CREW_PHOTO_PX; c.height = CREW_PHOTO_PX;
    c.getContext('2d').drawImage(img, 0, 0, CREW_PHOTO_PX, CREW_PHOTO_PX);
    crewPhotoCache = { from: src, url: c.toDataURL('image/jpeg', 0.7) };
    return crewPhotoCache.url;
  } catch (e) {
    return '';
  }
}

/**
 * Warms the cache, and is awaited rather than fired off.
 *
 * Decoding is asynchronous, so a sync build could only ever publish a photo it
 * had already decoded on some earlier pass — meaning the first card after a
 * launch went out without one, and a phone that syncs once and closes never
 * sent a face at all. Waiting costs a few milliseconds and removes the race.
 */
function primeCrewPhoto() {
  const src = (state.profile && state.profile.avatar) || '';
  if (!src || crewPhotoCache.from === src) return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    const done = () => resolve();
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = CREW_PHOTO_PX; c.height = CREW_PHOTO_PX;
        c.getContext('2d').drawImage(img, 0, 0, CREW_PHOTO_PX, CREW_PHOTO_PX);
        crewPhotoCache = { from: src, url: c.toDataURL('image/jpeg', 0.7) };
      } catch (e) { /* the crew simply sees an initial */ }
      done();
    };
    img.onerror = done;
    img.src = src;
    // Never let a photo hold up a sync.
    setTimeout(done, 3000);
  });
}

function myCrewCard() {
  const today = todayISO();
  const stats = allStats(state.exercises, state.setsLog, state.timersLog, null, state.streakOverrides);
  const todayTotals = {}, dueToday = {}, targets = {};
  state.exercises.forEach((ex) => {
    todayTotals[ex.id] = calcTotal(getSetsFor(ex.id, today));
    dueToday[ex.id] = isScheduledOn(ex, today);
    targets[ex.id] = getEffectiveTarget(ex, today) || 0;
  });
  const strips = {}, doneAt = {}, extra = {}, rests = {};
  state.exercises.forEach((ex) => {
    strips[ex.id] = recentDayStates(ex, state.setsLog, state.streakOverrides, 7);
    const t = getTimerPure(state.timersLog, today, ex.id);
    doneAt[ex.id] = (t && t.finishedAt) || 0;
    rests[ex.id] = isBreakDay(state.streakOverrides, today, ex.id);
    // The same figures their own Progress card shows, so a crew card can be as
    // descriptive as the one it mirrors rather than a summary of it.
    const st = stats[ex.id] || {};
    extra[ex.id] = { top: st.topSet || 0, bestDay: st.maxReps || 0, avgMs: st.avgTime || 0, totalMs: st.totalTime || 0 };
  });
  const dayStreak = calcStreakInfo(state.exercises, state.setsLog, today, state.streakOverrides);
  const card = buildCrewCard(state.profile, state.exercises, stats, todayTotals, dayStreak, dueToday, targets, strips, doneAt, extra, rests);
  return { ...card, photo: crewPhoto() };
}

function applyCrewResult(res, opts) {
  if (res.ok) {
    state.crew.crews = res.crews || [];
    state.crew.error = null;
    state.crew.lastSync = Date.now();
    if (res.joinedId) state.crew.activeId = res.joinedId;
    if (state.crew.activeId && !state.crew.crews.some((c) => c.id === state.crew.activeId)) {
      state.crew.activeId = null;
    }
    db.setItem('crews-cache', { crews: state.crew.crews, at: state.crew.lastSync }).catch(() => {});
  } else {
    state.crew.error = res.error;
    state.crew.errorDetail = res.detail || '';
    if (opts && opts.toast) showToast(crewApi.crewErrorText(res.error, res.detail));
  }
  state.crew.loading = false;
  renderView();
  renderNav();
  return res.ok;
}

/** Holds the tick on the refresh button, then puts the arrow back. */
let crewTickBack = null;

/** Reactions aimed at me that I have not seen yet — the number on the tab. */
function unseenReactions() {
  let n = 0;
  (state.crew.crews || []).forEach((c) => {
    const me = (c.members || []).find((m) => m.isMe);
    if (me) n += (me.received || []).filter((r) => !r.seen && !r.mine).length;
  });
  return n;
}

/** Called on app open and when the tab is entered. Quiet on failure: the tab
 *  keeps whatever it had, with a line saying so. */
async function refreshCrews(opts) {
  // The call itself renews a stale token, so the account is the gate here too.
  if (!hasSyncAccount()) return;
  await primeCrewPhoto();
  if (state.crew.loading) return;
  state.crew.loading = true;
  const res = await crewApi.syncCrews(myCrewCard());
  applyCrewResult(res, opts);
}

/* ============================= VIEW: PLAN ============================= */
function viewPlan() {
  const active = state.exercises.filter((e) => e.active && isCurrent(e)).sort((a, b) => a.order - b.order);
  const archived = state.exercises.filter((e) => e.archived);
  let html = '';
  if (active.length === 0) {
    html += `<div class="empty-card"><div class="glyph">➕</div><h3>Build your plan</h3><p>Add exercises with an optional daily target. Untargeted exercises still track totals, just don't affect your streak.</p><button class="primary-btn" data-action="open-add-exercise">Add an exercise</button></div>`;
  } else {
    // Grouped by the days they share, so a plan with several schedules reads as
    // a few short lists instead of one long one. Groups are derived each render,
    // so changing an exercise's days moves it to its new group at once.
    const groups = groupBySchedule(active, todayISO(), scheduleEffectiveOn);
    groups.forEach((g) => {
      const n = g.exercises.length;
      html += groupHeaderHtml('plan', g, groups.length, `${n} exercise${n > 1 ? 's' : ''}`);
      if (!groupOpen('plan', g.key, groups.length)) return;
      g.exercises.forEach((ex, i) => {
        const target = getEffectiveTarget(ex, todayISO());
        // Four 44px buttons sit to the right of this text, leaving it about a
        // third of the row. The name gets the one guaranteed line; everything
        // else — category, target, weight — shares the line below and may wrap,
        // because a wrapped target still reads and a truncated one does not.
        const catBit = categoryLabel(ex) ? `${catTagHtml(ex)} · ` : '';
        const wBit = formatWeight(ex.weight, ex.weightUnit) && ex.equipment === 'dumbbell'
          ? ` · ${escapeHtml(formatWeight(ex.weight, ex.weightUnit))}` : '';
        // The target's own unit, not the exercise's: "4 sets/day" is what was
        // set, and printing "4 reps/day" describes a different workout.
        const targetSub = catBit + (target ? `${target} ${escapeHtml(targetUnit(ex))}/day` : `no target · ${escapeHtml(ex.unit)}`) + wBit;
        html += `<div class="plan-row">
          <button class="plan-row-open" data-action="open-edit-exercise" data-id="${ex.id}" aria-label="Edit ${escapeHtml(ex.name)}">
          <div class="ex-icon-badge">${exIconHtml(ex, 34)}</div>
          <div class="plan-row-body">
            <div class="plan-row-name">${escapeHtml(ex.name)}</div>
            <div class="plan-row-sub">${targetSub}</div>
          </div>
          </button>
          <div class="plan-row-actions">
            <button class="mini-btn" data-action="reorder" data-dir="-1" data-id="${ex.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${ICONS.up}</button>
            <button class="mini-btn" data-action="reorder" data-dir="1" data-id="${ex.id}" ${i === g.exercises.length - 1 ? 'disabled' : ''} aria-label="Move down">${ICONS.down}</button>
            <button class="mini-btn" data-action="archive" data-id="${ex.id}" aria-label="Archive">${ICONS.archive}</button>
            <button class="mini-btn danger" data-action="delete-exercise" data-id="${ex.id}" data-name="${escapeHtml(ex.name)}" aria-label="Delete permanently">${ICONS.trash}</button>
          </div>
        </div>`;
      });
    });
    html += tipHtml('plan-groups', 'Exercises on the same days are grouped. Change an exercise’s days and it moves to its new group.');
  }
  const habits = state.habits.filter((h) => h.active);
  if (habits.length) {
    html += `<div class="section-label">Health habits</div>`;
    habits.forEach((h) => {
      html += `<div class="plan-row">
        <button class="plan-row-open" data-action="open-edit-habit" data-id="${h.id}" aria-label="Edit ${escapeHtml(h.name)}">
        <div class="ex-icon-badge habit-badge">${escapeHtml(h.emoji || '✅')}</div>
        <div class="plan-row-body">
          <div class="plan-row-name">${escapeHtml(h.name)}</div>
          <div class="plan-row-sub">${escapeHtml(scheduleLabel(h))} · ${h.kind === 'meals' ? 'by every meal' : 'by day'}</div>
        </div>
        </button>
        <div class="plan-row-actions">
          <button class="mini-btn danger" data-action="ask-delete-habit" data-id="${h.id}" data-name="${escapeHtml(h.name)}" aria-label="Delete ${escapeHtml(h.name)}">${ICONS.trash}</button>
        </div>
      </div>`;
    });
    html += tipHtml('plan-habits', 'No target and no reps — a habit day is clean unless something breaks it. Tap one to rename it, change its days, or delete it.');
  }
  if (archived.length > 0) {
    html += `<button class="archived-toggle" data-action="toggle-archived">${state.showArchived ? ICONS.down : ICONS.chevron} Archived (${archived.length})</button>`;
    if (state.showArchived) {
      archived.forEach((ex) => {
        html += `<div class="plan-row archived">
          <div class="ex-icon-badge">${exIconHtml(ex, 34)}</div>
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

/** The combo-time line on a Progress group header, or '' before the first full day. */
function comboLineHtml(groupExercises) {
  if (groupExercises.length < 2) return ''; // a single exercise already shows its own Total time
  const c = comboTimes(groupExercises, state.timersLog);
  if (!c.days) return '';
  return `<div class="combo-line">Combo · total ${formatTotalDuration(c.total)} · avg ${formatDuration(c.avg)} · best ${formatDuration(c.best)}</div>`;
}

function viewProgress() {
  // Habits are not exercises, so an empty plan must not hide them — the same
  // reason the weigh-in block sits outside the groups.
  const habit = habitProgressHtml() + weighInBlockHtml();
  const activeEx = state.exercises.filter((e) => e.active && !e.archived && isCurrent(e)).sort((a, b) => a.order - b.order);
  // The habit is not an exercise, so an empty plan must not hide it.
  if (!activeEx.length) return habit || `<p class="rail-empty">Add an exercise to start a streak.</p>`;
  const stats = allStats(activeEx, state.setsLog, state.timersLog, null, state.streakOverrides);
  // Grouped by shared days, same as Plan, so Progress is segregated per combo
  // and a card moves group the moment its schedule changes.
  const groups = groupBySchedule(activeEx, todayISO(), scheduleEffectiveOn);
  let html = habit;
  groups.forEach((g) => {
    const n = g.exercises.length;
    // While tucked in, the header carries the combo total (or the count) so a
    // collapsed group still tells you something at a glance.
    const combo = n > 1 ? comboTimes(g.exercises, state.timersLog) : null;
    const summary = combo && combo.days ? `${formatTotalDuration(combo.total)} total` : `${n} exercise${n > 1 ? 's' : ''}`;
    html += groupHeaderHtml('progress', g, groups.length, summary);
    if (!groupOpen('progress', g.key, groups.length)) return;
    html += comboLineHtml(g.exercises);
    html += g.exercises.map((ex) => exerciseCard(ex, stats[ex.id], { expandable: true })).join('');
  });
  html += tipHtml('progress-open', 'Tap a group to open it.');
  return html;
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
    // A time exercise's totals are minutes off the same clock, so they move
    // every second too. Updating the text in place is what keeps a running
    // session off the full re-render that used to flash the whole screen.
    document.querySelectorAll('[data-elapsed-min]').forEach((el) => {
      const id = el.dataset.elapsedMin;
      const t = getTimerPure(state.timersLog, todayISO(), id);
      const mins = Math.max(calcTotal(getSetsFor(id, todayISO())), minutesFromMs(timerElapsedMs(t, now)));
      const left = el.dataset.leftOf;
      el.textContent = left ? String(Math.max(0, Math.round((parseFloat(left) - mins) * 10) / 10)) : String(mins);
    });
    checkTimeTargets(now);
  }, 1000);
}

/**
 * A time exercise reaching its target, handled the same way a rep exercise
 * crossing its target is handled: pause the clock, bank what was done, and ask
 * — Take the win, or Keep going.
 *
 * Nothing auto-completes. A phone in a pocket keeps its clock running (elapsed
 * is derived from timestamps, so the seconds are real either way), and this
 * fires on the tick that follows you opening the app again — which is when the
 * question can actually be answered.
 *
 * `pushingOn` is what stops it asking twice, the same flag Keep going already
 * sets for reps.
 */
function checkTimeTargets(now) {
  if (state.modal && state.modal.type !== 'logger') return;
  const d = todayISO();
  const day = state.timersLog[d] || {};
  const hit = state.exercises.find((ex) => {
    if (!isTimeMode(ex) || !ex.active) return false;
    const t = day[ex.id];
    if (!t || t.status !== 'running' || t.pushingOn) return false;
    const target = getEffectiveTarget(ex, d);
    // Against the raw clock, not the rounded minutes it is displayed as —
    // 30 minutes has to mean 30 minutes, not the tenth that rounds up to it.
    return target > 0 && timerElapsedMs(t, now) >= target * 60000;
  });
  if (!hit) return;
  (async () => {
    state.timersLog = pauseTimerPure(state.timersLog, d, hit.id, Date.now());
    await persistTimers();
    await bankTime(hit.id);
    const t = getTimerPure(state.timersLog, d, hit.id);
    state.modal = { type: 'complete', exId: hit.id, total: calcTotal(getSetsFor(hit.id, d)), elapsedMs: t ? t.elapsedMs : 0 };
    renderModal();
    rerender();
  })();
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

function timerBlockHtml(exId, timer, sealed, hasTarget, timeMode) {
  const phase = timerPhase(timer);
  let [statusLabel, note] = (sealed && TIMER_COPY_SEALED[phase]) || TIMER_COPY[phase];
  // On a time exercise the clock IS the work, so the idle line cannot promise
  // that a rep will start it — there are no reps.
  if (timeMode && phase === 'idle' && !sealed) note = 'Tap Start when you begin.';
  // "Target hit" is a lie on an exercise that never had one. Same banked time,
  // honest word for it.
  if (phase === 'completed' && !hasTarget) statusLabel = 'Workout complete';
  const elapsed = formatElapsed(timerElapsedMs(timer, Date.now()));
  const finishedClock = timer ? formatClock(timer.finishedAt) : null;
  // A day sealed by its target can still be sitting on a merely-paused clock,
  // which must not keep offering Resume and Give up.
  const live = !sealed && (phase === 'running' || phase === 'paused');

  // Nothing to pause, end or reset before the first rep; nothing to touch at
  // all once the day is sealed. Only a live session carries controls — except
  // on a time exercise, where the dormant clock needs the one button that gets
  // it moving.
  const startBtn = (timeMode && !sealed && phase === 'idle')
    ? `<div class="timer-controls"><button class="timer-btn start" data-action="start-time-session" data-id="${exId}">${ICONS.play}Start</button></div>`
    : '';
  const controls = live ? `<div class="timer-controls">
      ${phase === 'running'
        ? `<button class="timer-btn" data-action="pause-timer" data-id="${exId}">${ICONS.pause}Pause</button>`
        : `<button class="timer-btn" data-action="resume-timer" data-id="${exId}">${ICONS.play}Resume</button>`}
      ${hasTarget ? '' : `<button class="timer-btn finish" data-action="take-the-win" data-id="${exId}">${ICONS.check}Complete</button>`}
      <button class="timer-btn giveup" data-action="giveup-timer" data-id="${exId}">${ICONS.flag}Give up</button>
      <button class="timer-btn reset" data-action="reset-timer" data-id="${exId}">${ICONS.restore}Reset</button>
    </div>` : '';

  return `<div class="timer-block status-${phase}">
    <div class="timer-top">
      <span class="timer-clock" id="timer-display" data-elapsed="${exId}" data-status="${phase}">${elapsed}</span>
      <span class="timer-status">${phase === 'completed' ? ICONS.trophy : ''}${statusLabel}${finishedClock ? ` · ${escapeHtml(finishedClock)}` : ''}</span>
    </div>
    ${startBtn}${controls}
    <p class="timer-note">${escapeHtml(note)}</p>
  </div>`;
}

/** Target reached: bank it, or push past it. Timer is already paused. */
function modalComplete() {
  const m = state.modal;
  const ex = state.exercises.find((e) => e.id === m.exId);
  if (!ex) return '';
  return `<div class="modal-backdrop">
    <div class="modal-sheet center celebrate" data-stop>
      <div class="celebrate-glyph">${exIconHtml(ex, 76)}</div>
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
  const target = getEffectiveTarget(ex, today);
  const timer = getTimerPure(state.timersLog, today, m.exId);
  // A timed session banks when its clock stops, so mid-session the log is
  // behind the clock — and this sheet is asked BEFORE it stops. Read the clock,
  // or it offers to end a session it says you have not started.
  const total = isTimeMode(ex)
    ? Math.max(calcTotal(getSetsFor(m.exId, today)), minutesFromMs(timerElapsedMs(timer, Date.now())))
    : calcTotal(getSetsFor(m.exId, today));
  const done = target ? `${total} of ${target} ${escapeHtml(ex.unit)}` : `${total} ${escapeHtml(ex.unit)}`;
  return `<div class="modal-backdrop">
    <div class="modal-sheet center celebrate" data-stop>
      <div class="celebrate-glyph">${exIconHtml(ex, 76)}</div>
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
  else if (m.type === 'weighin') root.innerHTML = modalWeighIn();
  else if (m.type === 'logger') root.innerHTML = modalLogger(m.exId);
  else if (m.type === 'exerciseForm') root.innerHTML = modalExerciseForm(m.exId);
  else if (m.type === 'proof') root.innerHTML = modalProof();
  else if (m.type === 'notices') root.innerHTML = modalNotices();
  else if (m.type === 'confirmDeleteHabit') root.innerHTML = modalConfirmDeleteHabit(m);
  else if (m.type === 'addChoice') root.innerHTML = modalAddChoice();
  else if (m.type === 'habitForm') root.innerHTML = modalHabitForm();
  else if (m.type === 'confirmDeleteSet') root.innerHTML = modalConfirm(m);
  else if (m.type === 'confirmDeleteExercise') root.innerHTML = modalConfirmDeleteExercise(m);
  else if (m.type === 'data') root.innerHTML = modalData();
  else if (m.type === 'profile') root.innerHTML = modalProfile();
  else if (m.type === 'screenGuide') root.innerHTML = modalGuide();
  else if (m.type === 'crewCreate') root.innerHTML = modalCrewCreate();
  else if (m.type === 'crewJoin') root.innerHTML = modalCrewJoin();
  else if (m.type === 'crewInvite') root.innerHTML = modalCrewInvite();
  else if (m.type === 'crewAccept') root.innerHTML = modalCrewInviteAccept();
  else if (m.type === 'story') root.innerHTML = modalStory();
  else if (m.type === 'storyCompose') root.innerHTML = modalStoryCompose();
  else if (m.type === 'crewMember') root.innerHTML = modalCrewMember();
  else if (m.type === 'crewSettings') root.innerHTML = modalCrewSettings();
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
  const sealed = workoutSealed(getTimerPure(state.timersLog, today, exId), progressValue(ex, arr), target);
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
  // The total is a readout, not a field. Typing into it used to be the only way
  // to enter a number the pad does not carry, and a typed day total is split
  // into chunks on purpose — which is exactly how a genuine set of 28 came back
  // as 20 and 8. Exact set, below, is the honest route now.
  const totalDisplay = `<div class="logger-total">${total}</div>`;

  const timer = getTimerPure(state.timersLog, today, exId);
  const timeMode = isTimeMode(ex);
  const shownTotal = timeMode ? Math.max(total, minutesFromMs(timerElapsedMs(timer, Date.now()))) : total;
  const timerHtml = timerBlockHtml(exId, timer, sealed, hasTarget, timeMode);

  /**
   * The way in for a number the pad does not carry, parked directly under the
   * total because that is where you are looking when the number you did isn't
   * on a key. Its own line says what it does, so it reads in a glance and the
   * note under it only confirms.
   *
   * It is deliberately a SET, not a total: one tap adds one set of exactly what
   * you typed, which is the thing Top Set can honestly read.
   */
  const sub = state.repMode === 'sub';
  const exactOpen = !!(state.modal && state.modal.exactOpen) && !sealed;
  const exactHtml = sealed ? '' : (exactOpen
    ? `<div class="exact-set open" data-stop>
        <input type="number" min="0" step="any" inputmode="decimal" id="exact-set-input"
          placeholder="${sub ? 'Take off…' : 'e.g. 28'}" autofocus>
        <button class="exact-go" data-action="save-exact-set" data-id="${exId}">${sub ? 'Subtract' : 'Add set'}</button>
        <button class="mini-btn" data-action="cancel-exact-set" aria-label="Cancel">${ICONS.close}</button>
        <em>${sub ? 'Comes off your latest sets.' : `Goes in as ONE set, on top of today's ${total}.`}</em>
      </div>`
    : `<button class="exact-set" data-action="open-exact-set" data-id="${exId}">
        <span>${sub ? '−' : '+'} Exact ${sub ? 'amount' : 'set'}</span>
        <em>${sub ? 'Take off a number the pad has not got.' : 'Did 28? Type any number the pad has not got.'}</em>
      </button>`);

  const padBlock = timeMode ? '' : `
      ${sealed
        ? ''
        : (sub
          ? tipHtml('sub-rep', 'Tap any number to subtract it straight away.')
          : tipHtml('log-rep', 'Tap any number to add it straight away.'))}
      <div class="rep-lever" role="group" aria-label="Add or subtract reps">
        <button class="lever-opt ${!sub ? 'on' : ''}" data-action="rep-mode" data-mode="add" ${sealed ? 'disabled' : ''}>Add</button>
        <button class="lever-opt sub ${sub ? 'on' : ''}" data-action="rep-mode" data-mode="sub" ${sealed ? 'disabled' : ''}>Subtract</button>
      </div>
      <div class="rep-pad ${sub ? 'subtracting' : ''}">
        ${REP_PAD.map((n) => `<button class="rep-key" data-action="rep-tap" data-id="${exId}" data-val="${n}" ${sealed || (sub && !arr.length) ? 'disabled' : ''}>${sub ? '−' : '+'}${n}</button>`).join('')}
      </div>`;

  // A time exercise has one entry a day — its own clock reading — so a set
  // history of one line, and a tally rail of one mark, would be furniture.
  const setListBlock = timeMode ? '' : `
      <div class="set-list">
        <div class="set-list-head"><span>Set history</span><span>${arr.length} set${arr.length === 1 ? '' : 's'}</span></div>
        ${arr.length ? listItems : '<div class="empty-sets">No sets logged yet today.</div>'}
      </div>`;

  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <h2>${exIconHtml(ex, 34)}${escapeHtml(ex.name)}</h2>
        ${sealed ? `<button class="sheet-share" data-action="share-session" data-id="${exId}" aria-label="Share this session">${ICONS.share}</button>` : ''}
        <button class="sheet-close" data-action="close-modal">${ICONS.close}</button>
      </div>
      <div class="logger-total-row">
        <div class="logger-total"${timeMode ? ` data-elapsed-min="${exId}"` : ''}>${timeMode ? shownTotal : total}</div>
        ${hasTarget ? `<div class="logger-target">/ ${target}</div>` : ''}
      </div>
      <div class="logger-unit">${timeMode ? 'minutes' : escapeHtml(ex.unit)} ${timeMode ? 'on the clock today' : 'logged today'}</div>
      ${timeMode ? '' : exactHtml}
      ${timerHtml}
      ${timeMode ? '' : `<div class="tally-rail logger-tally">${tallyMarks(arr.length)}</div>`}
      ${sealed ? sealedNoteHtml(exId, timerPhase(timer)) : ''}
      ${padBlock}

      ${(() => {
        const resting = isBreakDay(state.streakOverrides, today, exId);
        return `<button class="logger-rest ${resting ? 'on' : ''}" data-action="toggle-break" data-id="${exId}" aria-pressed="${resting}" ${sealed ? 'disabled' : ''}>
          <span>${resting ? '🌙 Resting today' : 'Rest today'}</span>
          <em>${sealed ? 'Today is already closed.' : (resting ? 'Your streak is safe. Tap to undo.' : 'Counts as rest — your streak keeps going.')}</em>
        </button>`;
      })()}
      ${setListBlock}
    </div>
  </div>`;
}

/**
 * Snapshots whatever is typed in the exercise form.
 *
 * Every toggle in this form re-renders it, and a re-render rebuilds the inputs
 * from the saved exercise — so typing a name and then changing the schedule
 * threw the name away. That was true of the schedule toggles long before the
 * Timer field existed; adding a third toggle just made it easier to hit.
 */
function modalConfirmDeleteHabit(m) {
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet center" data-stop>
      <h2 style="font-size:16px;margin:0 0 8px">Delete “${escapeHtml(m.name || '')}”?</h2>
      <p style="font-size:13.5px;color:var(--text-dim);margin:0 0 18px;line-height:1.5">It disappears from Today, Plan and Progress. Nothing else on your phone changes.</p>
      <div class="form-actions">
        <button class="secondary-btn" data-action="close-modal">Cancel</button>
        <button class="primary-btn" style="background:var(--danger);color:#fff" data-action="delete-habit" data-id="${escapeHtml(m.habitId || '')}">Delete</button>
      </div>
    </div>
  </div>`;
}

/**
 * The proof sheet. It explains itself the first time and never again — a rule
 * nobody was told about reads as the app being broken, and a rule explained
 * every single day reads as nagging.
 */
function modalProof() {
  const m = state.modal || {};
  const ex = state.exercises.find((e) => e.id === m.exId);
  if (!ex) return '';
  const today = todayISO();
  const rec = proofFor(state.proofLog, today, ex.id);
  const img = (state.proofImages[today] || {})[ex.id] || null;
  const left = retakesLeft(state.proofLog, today, ex.id);
  const explained = !!state.meta.proofExplained;

  const shot = m.image || img;
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <h2>${rec ? 'Your proof' : 'Proof of workout'}</h2>
        <button class="sheet-close" data-action="close-modal">${ICONS.close}</button>
      </div>
      ${!explained && !rec ? `<div class="proof-rule">
        <b>New: finish it with a photo.</b>
        <p>From now on an exercise counts as done once you have shown it. Take a picture, and your crew sees it for the day — that is the whole point of it.</p>
        <p>You get ${PROOF_MAX_RETAKES} retakes if the shot is bad. Days you finished before today are untouched.</p>
      </div>` : ''}
      ${shot ? `<div class="proof-shot"><img src="${shot}" alt="Proof of ${escapeHtml(ex.name)}"></div>` : ''}
      <div class="field">
        <label>${escapeHtml(ex.name)}</label>
        <div class="hint">${rec
          ? (left > 0 ? `${left} retake${left === 1 ? '' : 's'} left.` : 'No retakes left — this one stands.')
          : 'A photo of the work, or of you having done it. It stays on your phone; your crew sees it for the day.'}</div>
      </div>
      <input type="file" id="proof-file" accept="image/*" capture="environment" style="display:none">
      <input type="file" id="proof-file-lib" accept="image/*" style="display:none">
      ${(!rec || left > 0) ? `
        <button class="primary-btn wide" data-action="pick-proof">${rec ? 'Retake' : 'Take the photo'}</button>
        <button class="secondary-btn wide" data-action="pick-proof-lib">Upload a photo</button>` : ''}
      ${m.image ? `<button class="secondary-btn wide" data-action="save-proof" data-id="${ex.id}">Use this photo</button>` : ''}
      ${rec && img ? `<button class="secondary-btn wide" data-action="save-proof-image" data-id="${ex.id}">Save to phone</button>` : ''}
    </div>
  </div>`;
}

function modalNotices() {
  const status = { latest: 'Up to date', stale: 'Update ready', unknown: 'Offline — can’t check' }[state.version.status];
  const pending = updatePending()
    ? `<div class="notice update">
        <div class="notice-date">Waiting</div>
        <h3>A new version is ready</h3>
        <p>Sets takes it on its own next time you come back to the app. Tap below if you would rather have it now.</p>
        <button class="primary-btn wide" data-action="force-update">Update now</button>
      </div>`
    : '';
  const list = NOTICES.length
    ? NOTICES.map((n) => `<div class="notice">
        <div class="notice-date">${escapeHtml(formatDisplayDate(n.date, { month: 'short', day: 'numeric', year: 'numeric' }))}</div>
        <h3>${escapeHtml(n.title)}</h3>
        ${n.body.map((para) => `<p>${escapeHtml(para)}</p>`).join('')}
      </div>`).join('')
    : `<p class="notice-empty">Nothing new yet. When something is added to Sets, the note about it lands here.</p>`;
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <h2>What’s new</h2>
        <button class="sheet-close" data-action="close-modal">${ICONS.close}</button>
      </div>
      ${pending}
      ${list}
      <div class="notice-foot">Build ${escapeHtml(state.version.local)} · ${status}. Updates apply themselves next time you come back to the app.</div>
    </div>
  </div>`;
}

function modalAddChoice() {
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <h2>Add</h2>
        <button class="sheet-close" data-action="close-modal">${ICONS.close}</button>
      </div>
      <button class="add-kind" data-action="add-kind" data-kind="exercise">
        <b>Exercise</b><span>Reps or time, with a target and a streak.</span>
      </button>
      <button class="add-kind" data-action="add-kind" data-kind="habit">
        <b>Health habit</b><span>Every day, no target. Keep it clean, keep the streak.</span>
      </button>
    </div>
  </div>`;
}

/** Reads the habit form's text inputs into modal state, so the re-renders the
 *  chips cause do not wipe what has been typed. Same reason captureExerciseDraft
 *  exists. */
function captureHabitDraft() {
  if (!state.modal) return;
  const n = document.getElementById('f-habit-name');
  const e = document.getElementById('f-habit-emoji');
  if (n) state.modal.name = n.value;
  if (e) state.modal.emoji = e.value;
}

function modalHabitForm() {
  const m = state.modal || {};
  const editing = state.habits.find((h) => h.id === m.habitId) || null;
  const preset = HABIT_PRESETS.find((x) => x.key === m.preset) || null;
  const name = m.name !== undefined ? m.name : (editing ? editing.name : (preset ? preset.name : ''));
  const emoji = m.emoji !== undefined ? m.emoji : (editing ? editing.emoji : (preset ? preset.emoji : '✅'));
  // Offered wherever food is involved — keto, a custom habit, or anything
  // already tracked that way. Switching is safe on history: a past day is judged
  // by the slot values it holds, whatever shape the habit is now.
  const mealsOk = editing ? (editing.meal || editing.kind === 'meals') : presetAllowsMeals(m.preset);
  const kind = m.kind !== undefined ? m.kind : (editing ? editing.kind : (preset ? preset.kind : 'plain'));
  const daily = !Array.isArray(m.days);
  const days = Array.isArray(m.days) ? m.days : [];
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <h2>${editing ? 'Edit habit' : 'Add health habit'}</h2>
        <button class="sheet-close" data-action="close-modal">${ICONS.close}</button>
      </div>
      ${editing ? '' : `<div class="field">
        <label>Start from</label>
        <div class="cat-grid">
          ${HABIT_PRESETS.map((x) => `<button type="button" class="cat-chip ${x.key === m.preset ? 'on' : ''}" data-action="pick-habit-preset" data-preset="${x.key}" aria-pressed="${x.key === m.preset}">
            <span class="preset-emoji">${x.emoji}</span><span>${escapeHtml(x.name)}</span>
          </button>`).join('')}
          <button type="button" class="cat-chip ${m.preset ? '' : 'on'}" data-action="pick-habit-preset" data-preset="" aria-pressed="${!m.preset}">
            <span class="preset-emoji">✏️</span><span>Custom</span>
          </button>
        </div>
      </div>`}
      <div class="field">
        <label>Name</label>
        <input id="f-habit-name" type="text" placeholder="e.g. Keto" value="${escapeHtml(name)}" autocomplete="off">
      </div>
      <div class="field">
        <label>Emoji</label>
        <input id="f-habit-emoji" type="text" maxlength="4" value="${escapeHtml(emoji)}" autocomplete="off">
      </div>
      <div class="field">
        <label>Schedule</label>
        <div class="sched-modes">
          <button type="button" class="sched-mode ${daily ? 'on' : ''}" data-action="habit-sched-mode" data-mode="daily">Every day</button>
          <button type="button" class="sched-mode ${daily ? '' : 'on'}" data-action="habit-sched-mode" data-mode="days">Chosen days</button>
        </div>
        <div class="sched-days ${daily ? 'disabled' : ''}">
          ${['S','M','T','W','T','F','S'].map((d, i) => `<button type="button" class="sched-day ${(!daily && days.includes(i)) ? 'on' : ''}" data-action="habit-day" data-day="${i}" aria-label="${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i]}" aria-pressed="${!daily && days.includes(i)}">${d}</button>`).join('')}
        </div>
        <div class="hint">A day it isn't scheduled for is neutral — never a break. Changing this never rewrites a day you already logged.</div>
      </div>
      ${mealsOk ? `<div class="field">
        <label>How you track it</label>
        <div class="sched-modes">
          <button type="button" class="sched-mode ${kind === 'plain' ? 'on' : ''}" data-action="habit-kind" data-kind="plain">By day</button>
          <button type="button" class="sched-mode ${kind === 'meals' ? 'on' : ''}" data-action="habit-kind" data-kind="meals">By every meal</button>
        </div>
      </div>` : ''}
      <div class="field">
        <div class="hint">${kind === 'meals'
          ? 'Six slots — breakfast, lunch, dinner and the snacks between them. Any break, and the day is broken.'
          : 'One tap a day. A day is clean unless something breaks it.'} Once you tap a slot it's final.</div>
      </div>
      <button class="primary-btn wide" data-action="save-habit">${editing ? 'Save' : 'Add habit'}</button>
      ${editing ? (m.confirmDelete
        ? `<button class="secondary-btn wide danger-btn" data-action="delete-habit" data-id="${editing.id}">Really delete ${escapeHtml(editing.name)}?</button>
           <div class="hint">It disappears from Today, Plan and Progress. Nothing else changes.</div>`
        : `<button class="secondary-btn wide" data-action="confirm-delete-habit">Delete habit</button>`) : ''}
    </div>
  </div>`;
}

function captureExerciseDraft() {
  if (!state.modal) return;
  const val = (id) => { const el = document.getElementById(id); return el ? el.value : undefined; };
  const d = state.modal.draft || {};
  const set = (k, v) => { if (v !== undefined) d[k] = v; };
  set('name', val('f-name'));
  set('unit', val('f-unit'));
  set('target', val('f-target'));
  const wv = val('f-weight-val');
  if (wv !== undefined) state.modal.weight = wv;
  state.modal.draft = d;
}

function modalExerciseForm(exId) {
  const editing = !!exId;
  const ex = editing ? state.exercises.find((e) => e.id === exId) : null;
  const target = ex ? getEffectiveTarget(ex, todayISO()) : null;
  const draft = (state.modal && state.modal.draft) || {};
  // Category is a draft like the rest, so picking one re-renders the chosen
  // state without committing anything until Save.
  if (state.modal && state.modal.cat === undefined) {
    state.modal.cat = (ex && ex.category) || null;
  }
  const chosenCat = state.modal ? state.modal.cat : null;
  // Draft lives in modal state so toggling days re-renders without saving.
  if (state.modal && state.modal.sched === undefined) {
    state.modal.sched = ex && Array.isArray(ex.schedule) ? ex.schedule.slice() : 'daily';
  }
  const draftSched = state.modal ? state.modal.sched : 'daily';
  const schedIsDaily = draftSched === 'daily';
  const schedDays = Array.isArray(draftSched) ? draftSched : [];
  // Equipment + weight are drafts too, so switching to dumbbell reveals the
  // weight fields and flipping kg/lb converts the number, all without saving.
  if (state.modal && state.modal.equip === undefined) {
    state.modal.equip = (ex && ex.equipment === 'dumbbell') ? 'dumbbell' : 'bodyweight';
  }
  if (state.modal && state.modal.wunit === undefined) {
    state.modal.wunit = (ex && ex.weightUnit === 'lb') ? 'lb' : 'kg';
  }
  // Measuring by clock or by count is a draft like every other toggle, so
  // flipping it re-renders the form without committing anything until Save.
  if (state.modal && state.modal.measure === undefined) {
    state.modal.measure = isTimeMode(ex) ? 'time' : 'count';
  }
  const timeMode = state.modal ? state.modal.measure === 'time' : false;
  // Minutes are what get stored; hours are only how the number is typed. 90
  // stored shows as 1.5 hr, so switching units never changes the target.
  if (state.modal && state.modal.tunit === undefined) {
    state.modal.tunit = (isTimeMode(ex) && target && target >= 60 && target % 60 === 0) ? 'hr' : 'min';
  }
  const tUnit = state.modal ? state.modal.tunit : 'min';
  const targetShown = target ? (tUnit === 'hr' ? Math.round((target / 60) * 100) / 100 : target) : null;
  const isDumbbell = state.modal ? state.modal.equip === 'dumbbell' : false;
  const setsMode = state.modal && state.modal.tmode !== undefined
    ? state.modal.tmode === 'sets'
    : !!(ex && ex.targetMode === 'sets');
  if (state.modal && state.modal.targetBy === undefined) {
    state.modal.targetBy = { ...((ex && ex.targetByMode) || {}) };
  }
  const wUnit = state.modal ? state.modal.wunit : 'kg';
  const wVal = (state.modal && state.modal.weight !== undefined)
    ? state.modal.weight
    : (ex && ex.weight != null ? ex.weight : '');
  // A one-time entry is create-only, so the type toggle shows only when adding.
  const isOneTime = !editing && state.modal && state.modal.ptype === 'onetime';
  const typeToggle = editing ? '' : `<div class="field">
        <div class="sched-modes">
          <button type="button" class="sched-mode ${isOneTime ? '' : 'on'}" data-action="plan-type" data-type="scheduled">Scheduled</button>
          <button type="button" class="sched-mode ${isOneTime ? 'on' : ''}" data-action="plan-type" data-type="onetime">One-time</button>
        </div>
      </div>`;


  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <h2>${editing ? 'Edit exercise' : (isOneTime ? 'One-off workout' : 'Add exercise')}</h2>
        <button class="sheet-close" data-action="close-modal">${ICONS.close}</button>
      </div>
      ${typeToggle}
      <div class="field">
        <label>Name</label>
        <input id="f-name" type="text" placeholder="e.g. Push-ups" value="${escapeHtml(draft.name !== undefined ? draft.name : (ex ? ex.name : ''))}" autocomplete="off">
      </div>
      <div class="field">
        <label>Category</label>
        <div class="cat-grid">
          ${CATEGORIES.map((c) => `<button type="button" class="cat-chip ${c.key === chosenCat ? 'on' : ''}" data-action="pick-category" data-cat="${c.key}" aria-pressed="${c.key === chosenCat}">
            <img src="${categoryIconUrl(c.key)}" alt="" width="44" height="44">
            <span>${escapeHtml(c.label)}</span>
          </button>`).join('')}
        </div>
        <div class="hint">The category picks the icon, and shows on the card.</div>
      </div>
      <div class="field">
        <label>How you measure it</label>
        <div class="sched-modes">
          <button type="button" class="sched-mode ${timeMode ? '' : 'on'}" data-action="measure-mode" data-mode="count">Count</button>
          <button type="button" class="sched-mode ${timeMode ? 'on' : ''}" data-action="measure-mode" data-mode="time">Time</button>
        </div>
        ${timeMode ? `<div class="hint">A clock instead of a keypad. Start it, and it counts your minutes.</div>`
          : `<input id="f-unit" type="text" list="unit-options" placeholder="reps" value="${escapeHtml(draft.unit !== undefined ? draft.unit : (ex ? ex.unit : 'reps'))}" autocomplete="off" style="margin-top:8px">
        <datalist id="unit-options"><option value="reps"><option value="kg"><option value="lb"><option value="sec"><option value="min"><option value="km"><option value="mi"></datalist>
        <div class="hint">Whatever you count — reps, km, laps.</div>`}
      </div>
      <div class="field">
        <label>Equipment</label>
        <div class="sched-modes">
          <button type="button" class="sched-mode ${isDumbbell ? '' : 'on'}" data-action="equip-mode" data-equip="bodyweight">Bodyweight</button>
          <button type="button" class="sched-mode ${isDumbbell ? 'on' : ''}" data-action="equip-mode" data-equip="dumbbell">Dumbbell</button>
        </div>
        <div class="weight-fields ${isDumbbell ? '' : 'disabled'}">
          <input id="f-weight-val" type="number" min="0" step="any" inputmode="decimal" placeholder="Weight" value="${escapeHtml(wVal)}">
          <div class="wunit-toggle">
            <button type="button" class="wunit ${wUnit === 'kg' ? 'on' : ''}" data-action="wunit" data-unit="kg">kg</button>
            <button type="button" class="wunit ${wUnit === 'lb' ? 'on' : ''}" data-action="wunit" data-unit="lb">lb</button>
          </div>
        </div>
        <div class="hint">A label for this exercise. It never changes your reps, targets or streak.</div>
      </div>
      <div class="field">
        <label>${isOneTime ? 'When' : 'Schedule'}</label>
        ${isOneTime ? `<div class="onetime-when">Today only</div>
        <div class="hint">It sits on Today like any other exercise — same clock, same keypad, same target. Tomorrow it's gone, and it never counts against a streak.</div>` : `<div class="sched-modes">
          <button type="button" class="sched-mode ${schedIsDaily ? 'on' : ''}" data-action="sched-daily">Every day</button>
          <button type="button" class="sched-mode ${schedIsDaily ? '' : 'on'}" data-action="sched-custom">Chosen days</button>
        </div>
        <div class="sched-days ${schedIsDaily ? 'disabled' : ''}">
          ${['S','M','T','W','T','F','S'].map((d, i) => `<button type="button" class="sched-day ${(!schedIsDaily && schedDays.includes(i)) ? 'on' : ''}" data-action="sched-toggle" data-day="${i}" aria-label="${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i]}" aria-pressed="${!schedIsDaily && schedDays.includes(i)}">${d}</button>`).join('')}
        </div>
        <div class="hint">Days you don't train aren't counted as missed, so a rest day never breaks a streak.</div>`}
      </div>
      <div class="field">
        <label>Daily target${timeMode ? '' : ' (optional)'}</label>
        ${timeMode ? '' : `<div class="sched-modes">
          <button type="button" class="sched-mode ${setsMode ? '' : 'on'}" data-action="target-mode" data-mode="reps">Reps</button>
          <button type="button" class="sched-mode ${setsMode ? 'on' : ''}" data-action="target-mode" data-mode="sets">Sets</button>
        </div>`}
        ${timeMode ? `<div class="time-target">
          <input id="f-target" type="number" min="0" step="any" inputmode="decimal" placeholder="30" value="${draft.target !== undefined ? escapeHtml(draft.target) : (targetShown != null ? targetShown : '')}">
          <div class="wunit-toggle">
            <button type="button" class="wunit ${tUnit === 'min' ? 'on' : ''}" data-action="tunit" data-unit="min">min</button>
            <button type="button" class="wunit ${tUnit === 'hr' ? 'on' : ''}" data-action="tunit" data-unit="hr">hr</button>
          </div>
        </div>` : `<input id="f-target" type="number" min="0" step="any" placeholder="${setsMode ? 'How many sets' : 'Leave blank for no target'}" value="${draft.target !== undefined ? escapeHtml(draft.target == null ? '' : draft.target) : (setsMode === !!(ex && ex.targetMode === 'sets') && target ? target : '')}">`}
        <div class="hint">${timeMode ? 'How long a session should last. Reach it and you get the same choice as any target: take the win, or keep going.'
          : setsMode ? 'The day is done when you finish this many sets, whatever the reps are. 8, 8 and 15 finishes a target of 3.'
          : (editing ? 'Changing this only affects today onward — past days keep their original target.' : 'Untargeted exercises still track totals but don’t count toward your streak.')}</div>
      </div>
      <div class="form-actions">
        <button class="secondary-btn" data-action="close-modal">Cancel</button>
        <button class="primary-btn" data-action="save-exercise" data-id="${exId || ''}">Save</button>
      </div>
    </div>
  </div>`;
}

/* ---- crew sheets ----
 * Four small sheets rather than one screen with modes: each does one thing, and
 * the one that matters most — the invite — is the only one that has to be
 * understood by someone who has never seen the app.
 */
function modalCrewCreate() {
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head"><h2>New crew</h2><button class="sheet-close" data-action="close-modal">${ICONS.close}</button></div>
      <div class="field">
        <label>Crew name</label>
        <input id="crew-name" type="text" maxlength="40" placeholder="e.g. Morning crew" autocomplete="off">
        <div class="hint">Anyone you invite sees this name, your profile name and your streaks.</div>
      </div>
      <div class="form-actions">
        <button class="secondary-btn" data-action="close-modal">Cancel</button>
        <button class="primary-btn" data-action="create-crew">Create</button>
      </div>
    </div>
  </div>`;
}

function modalCrewJoin() {
  const code = (state.modal && state.modal.code) || '';
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head"><h2>Join a crew</h2><button class="sheet-close" data-action="close-modal">${ICONS.close}</button></div>
      <div class="field">
        <label>Invite code</label>
        <input id="crew-code" type="text" maxlength="12" placeholder="ABCD2345" value="${escapeHtml(code)}" autocomplete="off" autocapitalize="characters" spellcheck="false">
        <div class="hint">The eight characters at the end of the invite link. Case does not matter.</div>
      </div>
      <div class="form-actions">
        <button class="secondary-btn" data-action="close-modal">Cancel</button>
        <button class="primary-btn" data-action="join-crew">Join</button>
      </div>
    </div>
  </div>`;
}

function inviteLinkFor(crew) {
  return `${location.origin}${location.pathname}#/join/${crew.code}`;
}

function modalCrewInvite() {
  const crew = activeCrew();
  if (!crew) return '';
  const link = inviteLinkFor(crew);
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head"><h2>Invite to ${escapeHtml(crew.name)}</h2><button class="sheet-close" data-action="close-modal">${ICONS.close}</button></div>
      <div class="invite-code">${escapeHtml(crew.code)}</div>
      <div class="invite-hint">Send them the link, or read them the code.</div>
      <div class="invite-link">${escapeHtml(link)}</div>
      <button class="primary-btn" data-action="copy-invite" data-link="${escapeHtml(link)}">Copy link</button>
      <button class="secondary-btn" data-action="share-invite" data-link="${escapeHtml(link)}">Send…</button>
      <p class="hint">Anyone with this link can join and see the crew's streaks, so send it to people, not places. You can remove someone later.</p>
    </div>
  </div>`;
}

/**
 * What a tapped invite lands on.
 *
 * Joining used to happen the instant the link opened, which is the wrong shape
 * for something that publishes your streaks to strangers-of-a-friend: you
 * should see whose crew it is, and how many people are in it, before you are
 * in it. Signing in, if needed, happens after Accept rather than before —
 * being asked to sign in to find out what you are signing into is backwards.
 */
function modalCrewInviteAccept() {
  const m = state.modal;
  const crew = m.crew;
  const name = crew ? crew.name : null;
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet center celebrate" data-stop>
      <div class="celebrate-glyph">👥</div>
      ${m.loading
        ? '<h2>Checking the invite…</h2>'
        : m.error
          ? `<h2>That invite didn't work</h2><div class="celebrate-line">${escapeHtml(crewApi.crewErrorText(m.error))}</div>`
          : `<h2>Join ${escapeHtml(name || 'this crew')}?</h2>
             <div class="celebrate-line">${crew && crew.members ? `${crew.members} member${crew.members === 1 ? '' : 's'} already in` : 'A crew on Sets'}</div>
             <div class="hint invite-what">They will see your name, photo, streaks and totals. Never your individual sets, your weight or your notes. You can leave any time.</div>`}
      <div class="celebrate-actions">
        ${m.loading || m.error ? '' : `<button class="primary-btn" data-action="accept-invite" data-code="${escapeHtml(m.code)}">Accept and join</button>`}
        <button class="secondary-btn" data-action="decline-invite">${m.error ? 'Close' : 'Not now'}</button>
      </div>
    </div>
  </div>`;
}

/* ---- reactions ----
 * Two named ones and a small set of emoji. Nudge is only offered for someone
 * who has not trained, Respect only for someone who has — a reaction that
 * contradicts the day is noise, and hiding the wrong one is cheaper to read
 * than explaining it.
 */
// No 🔥 here: it is the face of Good job, and two identical-looking lines in
// the "who sent what" list is the one thing that list must never do.
/**
 * Roles and classes, each with drawn art.
 *
 * A closed list rather than a text field: every one has an icon, so an invented
 * value would render as a hole. The descriptions stay understated on purpose —
 * these are a bit of colour beside a name, not a character sheet.
 */
const CREW_ROLES = [
  { key: 'leader', label: 'Leader', note: 'Runs the crew' },
  { key: 'vice', label: 'Vice Leader', note: 'Second in line' },
  { key: 'member', label: 'Member', note: 'One of the crew' },
];
const CREW_CLASSES = [
  { key: 'fighter', label: 'Fighter', note: 'Gets stuck in' },
  { key: 'artist', label: 'Artist', note: 'Does it their own way' },
  { key: 'tank', label: 'Tank', note: 'Always there' },
  { key: 'tech', label: 'Tech', note: 'Knows the numbers' },
  { key: 'tycoon', label: 'Tycoon', note: 'Brings the resources' },
];
const roleInfo = (k) => CREW_ROLES.find((r) => r.key === k) || null;
const classInfo = (k) => CREW_CLASSES.find((c) => c.key === k) || null;
const crewIconUrl = (kind, key) => `${import.meta.env.BASE_URL}icons/crew/${kind}-${key}.png`;

/** A role or class as a chip: art first, word second, nothing else. */
function crewTagHtml(kind, key, size) {
  const info = kind === 'role' ? roleInfo(key) : classInfo(key);
  if (!info) return '';
  return `<span class="crew-tag"><img src="${crewIconUrl(kind, key)}" alt="" width="${size || 26}" height="${size || 26}">${escapeHtml(info.label)}</span>`;
}

const CREW_EMOJI = ['💪', '👏', '🐐', '😤', '🙌', '⚡'];
const REACTION_FACE = { nudge: '👊', respect: '🔥', emoji: '' };
const REACTION_WORD = { nudge: 'nudged them', respect: 'said good job', emoji: 'sent this' };

/** Today's reactions for one member, folded into counts with the emoji kept. */
function reactionCounts(member) {
  const today = todayISO();
  const out = new Map();
  (member.received || []).filter((r) => r.day === today).forEach((r) => {
    const key = r.kind === 'emoji' ? r.emoji : r.kind;
    const face = r.kind === 'emoji' ? r.emoji : REACTION_FACE[r.kind] || '•';
    const cur = out.get(key) || { face, n: 0, mine: false };
    cur.n += 1;
    cur.mine = cur.mine || !!r.mine;
    out.set(key, cur);
  });
  return [...out.values()];
}

function reactionChipsHtml(member, small) {
  const counts = reactionCounts(member);
  if (!counts.length) return '';
  return `<span class="react-chips ${small ? 'small' : ''}">${counts
    .map((c) => `<span class="react-chip ${c.mine ? 'mine' : ''}">${c.face}${c.n > 1 ? `<b>${c.n}</b>` : ''}</span>`)
    .join('')}</span>`;
}

/** Their week, drawn from the seven characters the card carries — the same dots
 *  as a Progress card, and read-only by construction: there is nothing here to
 *  tap, because it is somebody else's record. */
const DAY_STATE = { h: 'hit', b: 'break', m: 'miss', r: 'rest', n: 'none' };
function memberStripHtml(days) {
  if (!days) return '';
  return `<span class="mini-strip" aria-label="Their last seven days">${Array.from(days)
    .map((c) => `<i class="dot ${DAY_STATE[c] || 'none'}"></i>`).join('')}</span>`;
}

/** Who sent what, today — the Instagram-like list rather than a bare count. */
function reactionDetailHtml(member, crew) {
  const today = todayISO();
  const mine = (member.received || []).filter((r) => r.day === today);
  if (!mine.length) return '';
  const nameOf = (id) => {
    const m = (crew.members || []).find((x) => x.id === id);
    if (!m) return 'Someone';
    return m.isMe ? 'You' : (m.name || 'Someone');
  };
  const groups = new Map();
  mine.forEach((r) => {
    const key = r.kind === 'emoji' ? r.emoji : r.kind;
    const g = groups.get(key) || { face: r.kind === 'emoji' ? r.emoji : REACTION_FACE[r.kind], label: REACTION_WORD[r.kind] || '', who: [] };
    g.who.push(nameOf(r.from));
    groups.set(key, g);
  });
  return `<div class="react-list">${[...groups.values()].map((g) => `
    <div class="react-line">
      <span class="react-face">${g.face}</span>
      <span class="react-who"><b>${g.who.length}</b> ${escapeHtml(g.label)} · ${escapeHtml(g.who.join(', '))}</span>
    </div>`).join('')}</div>`;
}

function modalCrewMember() {
  const crew = activeCrew();
  const m = crew && (crew.members || []).find((x) => x.id === state.modal.memberId);
  if (!m) return '';
  const mine = isMe(m);
  const iOwn = (crew.members || []).some((x) => x.isMe && x.id === crew.owner);
  const emojiOpen = !!(state.modal && state.modal.emojiOpen);

  const ex = m.exercises || [];
  /**
   * Everything they are down to do today.
   *
   * `due` comes from their phone, so an older client that never sent it would
   * leave this empty — which is exactly how "workout of the day isn't
   * reflecting" happens. When nothing is marked due, anything with a target or
   * any work logged stands in, so the section is never blank when there is
   * something to show.
   */
  const marked = ex.filter((e) => e.due);
  const due = marked.length ? marked.filter((e) => true) : ex.filter((e) => e.target > 0 || e.today > 0);
  const dayRow = (e) => {
    if (e.rest) {
      return `<div class="crew-day resting">
        <span class="crew-day-name">${escapeHtml(e.name)}<i class="crew-day-at">resting today — streak holds</i></span>
        <span class="crew-day-num">🌙</span>
        <span class="crew-day-tick"></span>
      </div>`;
    }
    const met = e.target > 0 ? e.today >= e.target : e.today > 0;
    const shown = e.unit === 'min' ? formatMinutes(e.today) : `${formatCount(e.today)} ${escapeHtml(e.unit || '')}`;
    const goal = e.target > 0 ? (e.unit === 'min' ? formatMinutes(e.target) : `${formatCount(e.target)}`) : null;
    const proof = proofStoryFor(m, e.name);
    return `<div class="crew-day ${met ? 'met' : ''}">
      <span class="crew-day-name">${escapeHtml(e.name)}${e.doneAt ? `<i class="crew-day-at">finished ${escapeHtml(formatClock(e.doneAt))}</i>` : ''}</span>
      <span class="crew-day-num">${e.today > 0 ? shown : '—'}${goal ? `<i>/ ${goal}</i>` : ''}</span>
      ${proof ? `<button class="proof-view" data-action="open-proof-story" data-id="${m.id}" data-story="${escapeHtml(proof.id)}" aria-label="View proof for ${escapeHtml(e.name)}">${ICONS.camera}</button>` : ''}
      <span class="crew-day-tick">${met ? ICONS.check : '<i class="crew-pending"></i>'}</span>
    </div>`;
  };

  // Their progress card, as a reader sees it: the week, the streak and the
  // total, all on the exercise they belong to. Nothing is tappable.
  const allTime = ex.slice().sort((a, b) => (b.streak - a.streak) || (b.total - a.total));
  const progressRow = (e) => {
    const timed = e.unit === 'min';
    const fig = (label, value) => (value ? `<div><dt>${label}</dt><dd>${value}</dd></div>` : '');
    return `<div class="crew-prog">
      <div class="crew-prog-top">
        <span class="crew-prog-name">${escapeHtml(e.name)}</span>
        <span class="crew-prog-streak">${e.streak ? `${e.streak}d` : '—'}</span>
      </div>
      ${memberStripHtml(e.days)}
      <dl class="crew-prog-figs">
        ${fig(timed ? 'Longest' : 'Top set', timed ? formatMinutes(e.top) : (e.top ? formatCount(e.top) : ''))}
        ${fig('Best day', timed ? formatMinutes(e.bestDay) : (e.bestDay ? formatCount(e.bestDay) : ''))}
        ${fig('Average', e.avgMs ? formatDuration(e.avgMs) : '')}
        ${fig('Lifetime', timed ? formatMinutes(e.total) : (e.total ? `${formatCount(e.total)} ${escapeHtml(e.unit || '')}` : ''))}
        ${fig('Total time', e.totalMs ? formatTotalDuration(e.totalMs) : '')}
      </dl>
    </div>`;
  };

  // Nudging someone who has claimed a rest day is telling them off for a
  // decision the app itself endorses, so the button is simply not offered.
  const reactRow = mine ? '' : `
    <div class="react-bar">
      ${m.trainedToday || m.restingToday
        ? `<button class="react-btn respect" data-action="react" data-id="${m.id}" data-kind="respect">🔥 Good job</button>`
        : `<button class="react-btn nudge" data-action="react" data-id="${m.id}" data-kind="nudge">👊 Nudge</button>`}
      <button class="react-btn emoji" data-action="toggle-emoji" aria-expanded="${emojiOpen}">😀</button>
    </div>
    ${emojiOpen ? `<div class="emoji-row">${CREW_EMOJI.map((e) => `<button class="emoji-pick" data-action="react" data-id="${m.id}" data-kind="emoji" data-emoji="${e}">${e}</button>`).join('')}</div>` : ''}
    <p class="hint react-hint">${m.trainedToday ? 'They trained today — say so.'
      : m.restingToday ? 'They are resting today. Their streak holds, so there is nothing to nudge.'
      : 'They have not trained yet. A nudge shows on their card.'} Everyone in the crew sees it.</p>`;

  // Their whole history — a strip and five figures per exercise — is the wall
  // that made this card unreadable. Today is why you opened it, so Today stays;
  // the rest is one line until asked for. Keyed by member so opening one
  // person's history does not open everyone's.
  const bestStreak = allTime.reduce((n, e) => Math.max(n, e.streak || 0), 0);
  const progFold = foldHeaderHtml('member', `${m.id}:prog`, 'Their progress',
    `${allTime.length} exercise${allTime.length === 1 ? '' : 's'}${bestStreak ? ` · best ${bestStreak}d` : ''}`)
    + (groupOpen('member', `${m.id}:prog`, 0)
      ? `<div class="crew-progs">${allTime.map(progressRow).join('')}</div>` : '');

  // Twenty icon buttons only the leader can press, and only rarely. Folded,
  // with the two titles that are actually set shown on the header.
  const rankSummary = [(roleInfo(m.role) || {}).label, (classInfo(m.klass) || {}).label].filter(Boolean).join(' · ') || 'not set';
  const rankOpen = groupOpen('member', `${m.id}:rank`, 0);

  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head member-head">
        <h2>${escapeHtml(m.name || 'Someone')}</h2>
        <button class="sheet-close" data-action="close-modal">${ICONS.close}</button>
      </div>

      <div class="member-hero">
        ${memberFaceHtml(m, 84)}
        <div class="member-hero-nums">
          <div class="member-streak"><b>${m.streak}</b><span>day streak${m.best > m.streak ? ` · best ${m.best}` : ''}</span></div>
          <div class="member-today ${m.trainedToday ? 'yes' : m.restingToday ? 'rest' : 'no'}">${m.trainedToday ? 'trained today' : m.restingToday ? '🌙 resting today' : 'not yet today'}</div>
          <div class="crew-tags">${crewTagHtml('role', m.role)}${crewTagHtml('class', m.klass)}</div>
          ${m.joinedAt ? `<div class="member-since">In the crew since ${escapeHtml(sinceLabel(m.joinedAt))}</div>` : ''}
        </div>
      </div>

      <div class="section-label">Today</div>
      ${due.length
        ? `<div class="crew-days">${due.map(dayRow).join('')}</div>`
        : '<p class="hint">Nothing scheduled for them today.</p>'}

      ${allTime.length ? progFold : '<p class="hint">Nothing published yet — they have not opened Sets since joining.</p>'}

      ${mine && (m.profileViewers || []).length ? `<div class="react-list">
        <div class="react-line">
          <span class="react-face">👀</span>
          <span class="react-who"><b>${m.profileViewers.length}</b> looked at your card today · ${escapeHtml(m.profileViewers.map((id) => {
            const x = (crew.members || []).find((y) => y.id === id);
            return x ? (x.name || 'Someone') : 'Someone';
          }).join(', '))}</span>
        </div>
      </div>` : ''}
      ${reactionDetailHtml(m, crew)}
      ${reactRow}
      ${iOwn ? foldHeaderHtml('member', `${m.id}:rank`, 'Role & class', rankSummary) : ''}
      ${iOwn && rankOpen ? `<div class="rank-set">
        <div class="section-label">Role</div>
        <div class="rank-picks">
          ${CREW_ROLES.map((r) => `<button class="rank-pick ${m.role === r.key ? 'on' : ''}" data-action="set-role" data-id="${m.id}" data-role="${r.key}">
            <img src="${crewIconUrl('role', r.key)}" alt="" width="30" height="30">${escapeHtml(r.label)}</button>`).join('')}
        </div>
        <div class="section-label">Class</div>
        <div class="rank-picks">
          ${CREW_CLASSES.map((c) => `<button class="rank-pick ${m.klass === c.key ? 'on' : ''}" data-action="set-class" data-id="${m.id}" data-class="${c.key}" title="${escapeHtml(c.note)}">
            <img src="${crewIconUrl('class', c.key)}" alt="" width="30" height="30">${escapeHtml(c.label)}</button>`).join('')}
          ${m.klass ? `<button class="rank-pick clear" data-action="set-class" data-id="${m.id}" data-class="">Clear</button>` : ''}
        </div>
        <p class="hint">Titles, not permissions — only you can invite, rename or remove, whatever anyone is called.</p>
      </div>` : ''}
      ${iOwn && !mine ? `<button class="danger-btn" data-action="remove-member" data-id="${m.id}">Remove from crew</button>` : ''}
    </div>
  </div>`;
}

/**
 * A story, full width, for as long as it lasts.
 *
 * The picture is fetched on open rather than carried in the roster, so this
 * sheet has a loading state — and opening it is what records the view, because
 * a separate "mark seen" for a thing you are looking at is a lie waiting to
 * happen.
 */
function modalStory() {
  const m = state.modal;
  const crew = activeCrew();
  const author = crew && (crew.members || []).find((x) => x.id === m.memberId);
  if (!author) return '';
  // Which one of theirs is on screen: a day can hold several now.
  const list = author.stories || (author.story ? [author.story] : []);
  const story = list[m.index || 0] || author.story;
  const left = story ? Math.max(0, story.expiresAt - Date.now()) : 0;
  const hours = Math.floor(left / 3600000);
  const mins = Math.floor((left % 3600000) / 60000);
  const nameOf = (id) => {
    const x = (crew.members || []).find((y) => y.id === id);
    return x ? (x.isMe ? 'You' : x.name || 'Someone') : 'Someone';
  };
  const viewers = (story && story.mine && story.viewers) || [];

  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet story-sheet" data-stop>
      <div class="sheet-head">
        <h2>${memberFaceHtml(author, 30)}${escapeHtml(author.name || 'Someone')}</h2>
        <button class="sheet-close" data-action="close-modal">${ICONS.close}</button>
      </div>
      ${m.loading ? '<div class="story-frame loading">Loading…</div>'
        : m.error ? `<div class="story-frame loading">${escapeHtml(crewApi.crewErrorText(m.error))}</div>`
        : `<div class="story-frame"><img src="${escapeHtml(m.image || '')}" alt=""></div>`}
      ${m.caption ? `<p class="story-caption">${escapeHtml(m.caption)}</p>` : ''}
      ${list.length > 1 ? `<div class="story-steps">
        <button class="story-step" data-action="story-step" data-index="${(m.index || 0) - 1}" ${(m.index || 0) === 0 ? 'disabled' : ''} aria-label="Previous">‹</button>
        <span class="story-dots">${list.map((_, i) => `<i class="${i === (m.index || 0) ? 'on' : ''}"></i>`).join('')}</span>
        <button class="story-step" data-action="story-step" data-index="${(m.index || 0) + 1}" ${(m.index || 0) >= list.length - 1 ? 'disabled' : ''} aria-label="Next">›</button>
      </div>` : ''}
      <div class="story-meta">${story ? `${hours ? `${hours}h ` : ''}${mins}m left` : ''}</div>
      ${story && story.mine ? `<div class="story-views">
        <div class="section-label">Seen by ${viewers.length}</div>
        ${viewers.length ? `<p class="hint">${escapeHtml(viewers.map(nameOf).join(', '))}</p>` : '<p class="hint">Nobody yet.</p>'}
        <button class="secondary-btn wide" data-action="add-story" data-id="${author.id}">Replace it</button>
      </div>` : ''}
    </div>
  </div>`;
}

/** Pick a picture, write a line, post it. Deliberately one screen. */
function modalStoryCompose() {
  const m = state.modal;
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head"><h2>Add to your story</h2><button class="sheet-close" data-action="close-modal">${ICONS.close}</button></div>
      ${m.image
        ? `<div class="story-frame"><img src="${escapeHtml(m.image)}" alt=""></div>`
        : `<label class="story-pick">
             <input type="file" id="story-file" accept="image/*" style="display:none">
             <span>Choose a photo</span>
           </label>`}
      <div class="field">
        <label>Caption (optional)</label>
        <input id="story-caption" type="text" maxlength="140" placeholder="Leg day" value="${escapeHtml(m.caption || '')}" autocomplete="off">
      </div>
      <p class="hint">Your crew can see it for 24 hours, then it deletes itself. You will see who watched.</p>
      <div class="form-actions">
        <button class="secondary-btn" data-action="close-modal">Cancel</button>
        <button class="primary-btn" data-action="publish-story" ${m.image ? '' : 'disabled'}>Post</button>
      </div>
    </div>
  </div>`;
}

function modalCrewSettings() {
  const crew = activeCrew();
  if (!crew) return '';
  const iOwn = crew.members.some((x) => isMe(x) && x.id === crew.owner);
  const renaming = !!(state.modal && state.modal.renaming);
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head"><h2>${escapeHtml(crew.name)}</h2><button class="sheet-close" data-action="close-modal">${ICONS.close}</button></div>
      ${iOwn ? (renaming
        ? `<div class="field">
            <label>Crew name</label>
            <input id="crew-rename" type="text" maxlength="40" value="${escapeHtml(crew.name)}" autocomplete="off">
            <label style="margin-top:12px">Motto</label>
            <input id="crew-motto" type="text" maxlength="60" placeholder="Every day, or nearly" value="${escapeHtml(crew.motto || '')}" autocomplete="off">
            <div class="hint">Shows under the crew's name, on everyone's profile, and on the images they share.</div>
            <div class="form-actions">
              <button class="secondary-btn" data-action="cancel-rename-crew">Cancel</button>
              <button class="primary-btn" data-action="rename-crew" data-id="${crew.id}">Save</button>
            </div>
          </div>`
        : `<button class="secondary-btn wide" data-action="start-rename-crew">Name and motto</button>`) : ''}
      <button class="secondary-btn wide" data-action="open-invite" data-id="${crew.id}">Invite someone</button>
      <button class="secondary-btn wide" data-action="open-create-crew">Create another crew</button>
      <button class="secondary-btn wide" data-action="open-join-crew">Join another crew</button>
      <button class="danger-btn" data-action="leave-crew" data-id="${crew.id}">Leave this crew</button>
      <p class="hint">${iOwn ? 'You made this crew. If you leave, it passes to whoever joined first — and the last person out closes it.' : 'Leaving removes your card from this crew straight away.'}</p>
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

/**
 * Whether a schedule group is expanded. A lone group is open by default — there
 * is nothing to tuck away — otherwise groups start collapsed and open on tap.
 */
function groupOpen(view, key, groupCount) {
  const k = `${view}:${key}`;
  return k in state.openGroups ? state.openGroups[k] : groupCount === 1;
}

/** Collapsible group header: label, a summary while tucked in, and a chevron. */
function groupHeaderHtml(view, g, groupCount, summary) {
  const open = groupOpen(view, g.key, groupCount);
  const label = scheduleLabel({ schedule: g.days });
  return `<button class="group-head" data-action="toggle-group" data-view="${view}" data-key="${escapeHtml(g.key)}" data-open="${open}" aria-expanded="${open}">
      <span class="group-head-label">${escapeHtml(label)}</span>
      <span class="group-head-meta">${open ? '' : escapeHtml(summary)}</span>
      <span class="group-chev ${open ? 'open' : ''}">${ICONS.chevron}</span>
    </button>`;
}

/**
 * The same `.group-head` fold for things that are not schedule groups — a
 * plain label instead of a day combo. Shut by default (groupCount 0 is never
 * 1), which is the whole point: the summary is on the header, so nothing is
 * lost while it is closed.
 */
function foldHeaderHtml(view, key, label, summary) {
  const open = groupOpen(view, key, 0);
  return `<button class="group-head" data-action="toggle-group" data-view="${view}" data-key="${escapeHtml(key)}" data-open="${open}" aria-expanded="${open}">
      <span class="group-head-label">${escapeHtml(label)}</span>
      <span class="group-head-meta">${open ? '' : escapeHtml(summary)}</span>
      <span class="group-chev ${open ? 'open' : ''}">${ICONS.chevron}</span>
    </button>`;
}

/** Quiet dumbbell-weight suffix after an exercise name; nothing for bodyweight. */
function weightTag(ex) {
  if (!ex || ex.equipment !== 'dumbbell') return '';
  const w = formatWeight(ex.weight, ex.weightUnit);
  return w ? ` <span class="weight-tag">· ${escapeHtml(w)}</span>` : '';
}

/** A "Weight" stat tile showing progression: "12 → 14 kg" once it has changed. */
function weightTile(ex) {
  const p = weightProgression(ex);
  if (!p) return '';
  const val = p.changed
    ? `${formatWeight(p.start, p.unit)} → ${formatWeight(p.current, p.unit)}`
    : formatWeight(p.current, p.unit);
  return `<div><dt>Weight</dt><dd>${escapeHtml(val)}</dd></div>`;
}

const BMI_LABEL = { underweight: 'Underweight', normal: 'Normal', overweight: 'Overweight', obese: 'Obese' };
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The weight change line, shared by the profile sheet and Progress. */
function weightTrendHtml(weightLog) {
  const t = weightTrend(weightLog);
  if (!t) return '';
  const when = formatDisplayDate(t.since, { month: 'short', day: 'numeric' });
  return `<div class="bmi-line ${t.delta < 0 ? 'down' : 'up'}">${t.delta < 0 ? '↓' : '↑'} ${Math.abs(t.delta)} kg since ${escapeHtml(when)}</div>`;
}

/**
 * BMI is shown wherever weight is, and nowhere else. Derived on every render,
 * so a new weight updates it with no cache to invalidate.
 */
function bmiBlockHtml(profile) {
  const s = bmiSummary(profile);
  if (!s) return '';
  return `<div class="bmi-block ${s.category}">
    <div class="bmi-head"><span class="bmi-num">${s.bmi}</span><span class="bmi-badge">${BMI_LABEL[s.category]}</span></div>
    <div class="bmi-line">Healthy range at ${profile.height} cm: ${s.healthyMin} – ${s.healthyMax} kg</div>
    ${s.toHealthy > 0 ? `<div class="bmi-line">About ${s.toHealthy} kg to the healthy range.</div>` : ''}
    ${weightTrendHtml(profile.weightLog)}
    <div class="hint">Weight alone can't tell muscle from fat.</div>
  </div>`;
}

function modalWeighIn() {
  const p = state.profile || {};
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head"><h2>Weekly weigh-in</h2><button class="sheet-close" data-action="close-modal">${ICONS.close}</button></div>
      <div class="field">
        <label>Weight (kg)</label>
        <input id="f-weighin" type="number" min="0" step="any" inputmode="decimal" placeholder="—" value="${p.weight != null ? p.weight : ''}">
        <div class="hint">Saved to your profile and this week's habit. It is never counted as reps.</div>
      </div>
      <button class="primary-btn" style="width:100%" data-action="save-weigh-in">Save weight</button>
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
        <div class="hint">Syncs your workouts to a private, hidden spot in your own Google Drive — free, and readable only by this app. Optional — the app works fully without it.</div>`;
    }
    // Offline is not an error and needs no action — the work is already safe
    // here and will go up on its own. Saying "waiting" instead of "couldn't
    // reach Drive" is the difference between information and a false alarm.
    if (sync.status === 'pending') {
      return `<div class="sync-status pending">Sync waiting${sync.email ? ` · ${escapeHtml(sync.email)}` : ''}</div>
        <div class="sync-actions">
          <button class="secondary-btn" data-action="google-sync-now">Try now</button>
          <button class="secondary-btn" data-action="google-sign-out">Sign out</button>
        </div>
        <div class="hint">Everything you log is saved on this phone. Sync catches up by itself — nothing for you to do.</div>`;
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
          <button class="secondary-btn" data-action="google-sign-in">Reconnect</button>
          <button class="secondary-btn" data-action="google-sign-out">Sign out</button>
        </div>
        <div class="hint">Your workouts are all here and safe on this phone. Google just needs you to confirm it's you again before syncing resumes.</div>`;
    }
    const statusLine = sync.status === 'error'
      ? `<div class="sync-status error">${escapeHtml(sync.error || 'Sync error')}</div>`
      : `<div class="sync-status ok">${ICONS.check} Synced${sync.email ? ` · ${escapeHtml(sync.email)}` : ''}</div>`;
    const when = sync.lastBackupAt ? new Date(sync.lastBackupAt).toLocaleString() : null;
    return `${statusLine}
      <div class="sync-actions">
        <button class="secondary-btn" data-action="google-sync-now">Sync now</button>
        <button class="secondary-btn" data-action="google-sign-out">Sign out</button>
      </div>
      <div class="hint">${when ? `Last synced: ${escapeHtml(when)}. ` : ''}Your workouts live on this phone and sync to a private folder in your own Drive.</div>`;
  })();
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head"><h2>Profile</h2><button class="sheet-close" data-action="close-modal">${ICONS.close}</button></div>

      <div class="profile-photo-block">
        <div class="profile-avatar-big${p.avatar ? ' has-photo' : ''}">${p.avatar ? `<img src="${p.avatar}" alt="">` : initial}</div>
        <div class="profile-photo-actions">
          <label class="secondary-btn photo-btn">
            ${p.avatar ? 'Change photo' : 'Add photo'}
            <input type="file" id="profile-photo" accept="image/*" style="display:none">
          </label>
          ${p.avatar ? '<button class="secondary-btn photo-btn" data-action="remove-avatar">Remove</button>' : ''}
        </div>
        <div class="hint">Kept on this phone and synced to your own Drive. It is shrunk to a small square first, so it never bloats a sync.</div>
      </div>

      ${crewStandingHtml()}

      <div class="field">
        <label>Google Drive sync</label>
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
      ${bmiBlockHtml(p)}
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

/**
 * Turns a chosen photo into a small square data URL, entirely in the browser.
 *
 * It is downscaled hard on purpose. The picture is stored inside the profile,
 * and the profile rides in the Drive sync snapshot, so a full-size phone photo
 * would bloat every future sync by megabytes. 192px square at JPEG quality 0.82
 * lands around 15KB, which is invisible next to the workout log and still sharp
 * on a 34px chip at 3x.
 *
 * Centre-cropped rather than squashed, because a squashed face is worse than a
 * cropped one. Nothing is uploaded anywhere: the file never leaves the device.
 */
const AVATAR_PX = 192;
function fileToAvatarDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith('image/')) { reject(new Error('not-an-image')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = AVATAR_PX;
        canvas.height = AVATAR_PX;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode-failed')); };
    img.src = url;
  });
}

/** A crew logo is a small square, like an avatar rather than a photo. */
const CREW_LOGO_PX = 192;
function fileToCrewLogoDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith('image/')) { reject(new Error('not-an-image')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = CREW_LOGO_PX; canvas.height = CREW_LOGO_PX;
        canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2,
          side, side, 0, 0, CREW_LOGO_PX, CREW_LOGO_PX);
        resolve(canvas.toDataURL('image/jpeg', 0.78));
      } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode-failed')); };
    img.src = url;
  });
}

const STORY_PX = 720;
function fileToStoryDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith('image/')) { reject(new Error('not-an-image')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, STORY_PX / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.68));
      } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode-failed')); };
    img.src = url;
  });
}

async function setAvatarHandler(file) {
  try {
    const dataUrl = await fileToAvatarDataUrl(file);
    state.profile = { ...state.profile, avatar: dataUrl };
    await persistProfile();
    renderModal();
    renderTopbar();
    showToast('Photo updated');
  } catch (e) {
    showToast(e && e.message === 'not-an-image' ? 'That file is not an image.' : "That photo couldn't be read.");
  }
}

async function removeAvatarHandler() {
  state.profile = { ...state.profile, avatar: null };
  await persistProfile();
  renderModal();
  renderTopbar();
  showToast('Photo removed');
}

/* ============================= EVENTS ============================= */
function bindModalEvents() {
  const photoInput = document.getElementById('profile-photo');
  if (photoInput) {
    photoInput.onchange = (e) => {
      const file = e.target.files[0];
      if (file) setAvatarHandler(file);
      e.target.value = '';
    };
  }
  const logoFile = document.getElementById('crew-logo-file');
  if (logoFile) {
    logoFile.onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      const crew = activeCrew();
      if (!file || !crew) return;
      try {
        const image = await fileToCrewLogoDataUrl(file);
        showToast('Saving…');
        const res = await crewApi.setCrewLogo(crew.id, image);
        if (applyCrewResult(res, { toast: true })) { renderModal(); showToast('Crew logo set'); }
      } catch (err) {
        showToast("That photo couldn't be read.");
      }
    };
  }
  const onProofPicked = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        // Same 800px shrink stories use — a phone photo is a megabyte and a
        // proof shot does not need to be.
        state.modal.image = await fileToStoryDataUrl(file);
        renderModal();
      } catch (err) {
        showToast("That photo couldn't be read.");
      }
  };
  const proofFile = document.getElementById('proof-file');
  if (proofFile) proofFile.onchange = onProofPicked;
  const proofLib = document.getElementById('proof-file-lib');
  if (proofLib) proofLib.onchange = onProofPicked;
  const storyFile = document.getElementById('story-file');
  if (storyFile) {
    storyFile.onchange = async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        // 800px is the size at which a phone photo stops being a megabyte and
        // starts being a story. The Worker's cap is the backstop, not the plan.
        state.modal.image = await fileToStoryDataUrl(file);
        renderModal();
      } catch (err) {
        showToast("That photo couldn't be read.");
      }
    };
  }
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
      if (btn.dataset.view === 'social') {
        setTimeout(() => refreshCrews().catch(() => {}), 0);
        // Opening the tab IS reading them — no separate "mark as read".
        if (unseenReactions()) {
          const c = activeCrew();
          if (c) crewApi.markSeen(c.id).then((r) => applyCrewResult(r)).catch(() => {});
        }
      }
      state.view = btn.dataset.view;
      db.prefs.set('view', state.view);
      state.expandedDay = null;
      renderNav(); renderTopbar(); renderView(); renderBanner();
      break;

    case 'open-proof-story': {
      const crew = activeCrew();
      const m = crew && (crew.members || []).find((x) => x.id === btn.dataset.id);
      const list = (m && (m.stories || (m.story ? [m.story] : []))) || [];
      const idx = list.findIndex((st) => st.id === btn.dataset.story);
      if (idx >= 0) await openStoryAt(m.id, idx);
      break;
    }
    case 'open-proof':
      state.modal = { type: 'proof', exId: btn.dataset.id, image: null };
      renderModal();
      break;
    case 'save-proof-image':
      await saveProofCollage(btn.dataset.id);
      break;
    case 'pick-proof': {
      const el = document.getElementById('proof-file');
      if (el) el.click();
      break;
    }
    case 'pick-proof-lib': {
      const el = document.getElementById('proof-file-lib');
      if (el) el.click();
      break;
    }
    case 'save-proof': {
      const exId = btn.dataset.id;
      const today = todayISO();
      const img = state.modal && state.modal.image;
      if (!img) break;
      const before = state.proofLog;
      state.proofLog = recordProof(before, today, exId, Date.now());
      if (state.proofLog === before) { showToast('No retakes left.'); break; }
      state.proofImages = { ...state.proofImages, [today]: { ...(state.proofImages[today] || {}), [exId]: img } };
      // Explained once, on the first one ever taken.
      if (!state.meta.proofExplained) { state.meta.proofExplained = true; }
      await persistProof();
      await persistMeta();
      closeModal();
      rerender();
      showToast('Proof saved — that one is finished.');
      // The crew half is best effort by design: the day is already complete
      // locally, so a train tunnel cannot un-finish a workout you did.
      postProofToCrew(exId, img).catch(() => {});
      break;
    }
      state.modal = { type: 'notices' };
      // Opening is reading. The badge clears now rather than on close, so
      // dismissing the sheet cannot leave a count for something already seen.
      state.noticesSeen = NOTICES.map((n) => n.id);
      db.setItem('notices-seen', state.noticesSeen).catch(() => {});
      renderModal();
      renderTopbar();
      break;
    case 'open-add': state.modal = { type: 'addChoice' }; renderModal(); break;
    case 'add-kind':
      state.modal = btn.dataset.kind === 'habit'
        ? { type: 'habitForm', preset: 'keto', kind: 'meals' }
        : { type: 'exerciseForm', exId: null };
      renderModal();
      break;
    case 'pick-habit-preset': {
      // Picking a preset refills the form. It is a starting form, not a link.
      const key = btn.dataset.preset || null;
      const preset = HABIT_PRESETS.find((x) => x.key === key) || null;
      state.modal = {
        type: 'habitForm', preset: key, days: state.modal.days,
        kind: preset ? preset.kind : 'plain',
        name: preset ? preset.name : '',
        emoji: preset ? preset.emoji : '✅',
      };
      renderModal();
      break;
    }
    case 'habit-sched-mode':
      captureHabitDraft();
      state.modal.days = btn.dataset.mode === 'daily' ? undefined : [];
      renderModal();
      break;
    case 'habit-day': {
      captureHabitDraft();
      const d = Number(btn.dataset.day);
      const cur = Array.isArray(state.modal.days) ? state.modal.days : [];
      state.modal.days = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d];
      renderModal();
      break;
    }
    case 'open-edit-habit': {
      const h = state.habits.find((x) => x.id === btn.dataset.id);
      if (!h) break;
      state.modal = { type: 'habitForm', habitId: h.id, days: Array.isArray(h.schedule) ? h.schedule.slice() : undefined };
      renderModal();
      break;
    }
    case 'habit-kind':
      captureHabitDraft();
      state.modal.kind = btn.dataset.kind === 'meals' ? 'meals' : 'plain';
      renderModal();
      break;
    case 'confirm-delete-habit':
      captureHabitDraft();
      state.modal.confirmDelete = true;
      renderModal();
      break;
    case 'ask-delete-habit':
      state.modal = { type: 'confirmDeleteHabit', habitId: btn.dataset.id, name: btn.dataset.name };
      renderModal();
      break;
    case 'delete-habit':
      // Archived, not purged: habits carry no tombstone key, and a hard delete
      // without one is how a deleted exercise came back from Drive.
      state.habits = archiveHabit(state.habits, btn.dataset.id);
      await persistHabits();
      closeModal();
      renderView();
      break;
    case 'save-habit': {
      captureHabitDraft();
      const m = state.modal;
      const name = (m.name || '').trim();
      if (!name) return;
      const chosen = Array.isArray(m.days) ? m.days.slice().sort((a, b) => a - b) : null;
      const schedule = chosen && chosen.length ? chosen : 'daily';
      const editing = state.habits.find((h) => h.id === m.habitId) || null;
      const emoji = (m.emoji || '').trim() || '✅';
      if (editing) {
        const canMeals = editing.meal || editing.kind === 'meals';
        const kind = (canMeals && m.kind !== undefined) ? m.kind : editing.kind;
        state.habits = state.habits.map((h) => (h.id === editing.id
          ? { ...setHabitKind(setHabitSchedule(h, schedule, todayISO()), kind), name, emoji }
          : h));
      } else {
        const preset = HABIT_PRESETS.find((x) => x.key === m.preset) || null;
        const canMeals = presetAllowsMeals(m.preset);
        state.habits = [...state.habits, newHabit({
          name,
          emoji,
          meal: canMeals,
          kind: canMeals && m.kind !== undefined ? m.kind : (preset ? preset.kind : 'plain'),
          // The rule is the preset's own words, kept only while it is still the
          // preset. Rename it and it is your habit, with your own terms.
          rule: preset && preset.name === name ? preset.rule : '',
          schedule,
        }, todayISO())];
      }
      await persistHabits();
      closeModal();
      renderView();
      break;
    }
    case 'log-slot': {
      const nowMs = Date.now();
      const before = state.habitLog;
      state.habitLog = logSlot(before, habitDay(nowMs), btn.dataset.id, btn.dataset.slot, btn.dataset.v, nowMs);
      // A refused write returns the same object, so there is nothing to save
      // and nothing to redraw.
      if (state.habitLog === before) break;
      await persistHabitLog();
      renderView();
      break;
    }
    case 'habit-off-plan': {
      const nowMs = Date.now();
      const before = state.habitLog;
      state.habitLog = setOffPlan(before, habitDay(nowMs), btn.dataset.id, btn.dataset.on === '1', nowMs);
      if (state.habitLog === before) break;
      await persistHabitLog();
      renderView();
      break;
    }
    case 'open-add-exercise': state.modal = { type: 'exerciseForm', exId: null }; renderModal(); break;
    case 'open-edit-exercise': state.modal = { type: 'exerciseForm', exId: btn.dataset.id }; renderModal(); break;
    case 'close-modal': closeModal(); break;

    case 'pick-category':
      // Held in modal state, not read back off the DOM at save time, so it
      // survives the re-renders the rest of this form does.
      captureExerciseDraft();
      if (state.modal) { state.modal.cat = btn.dataset.cat; renderModal(); }
      break;
    case 'save-exercise': {
      const name = document.getElementById('f-name').value.trim();
      if (!name) { showToast('Name is required.'); return; }
      const timeMode = !!(state.modal && state.modal.measure === 'time');
      const unitEl = document.getElementById('f-unit');
      // A time exercise counts minutes, full stop. Storing one unit means every
      // total, chart and share card downstream needs no idea which mode it is.
      const unit = timeMode ? 'min' : ((unitEl && unitEl.value.trim()) || 'reps');
      const targetRaw = document.getElementById('f-target').value;
      const targetTyped = targetRaw === '' ? null : Math.max(0, parseFloat(targetRaw));
      const target = (timeMode && targetTyped != null && state.modal && state.modal.tunit === 'hr')
        ? Math.round(targetTyped * 60 * 100) / 100
        : targetTyped;
      const category = (state.modal && state.modal.cat) || null;
      const id = btn.dataset.id;
      const schedule = state.modal && state.modal.sched ? state.modal.sched : 'daily';
      // A one-off is an ordinary exercise pinned to a single date. Nothing else
      // about it is special, which is why it needs no code of its own.
      const oneTime = !id && state.modal && state.modal.ptype === 'onetime';
      const equipment = state.modal && state.modal.equip === 'dumbbell' ? 'dumbbell' : 'bodyweight';
      const weightUnit = state.modal && state.modal.wunit === 'lb' ? 'lb' : 'kg';
      const wRaw = document.getElementById('f-weight-val');
      const wParsed = wRaw && wRaw.value !== '' ? Math.max(0, parseFloat(wRaw.value)) : null;
      const weight = equipment === 'dumbbell' && wParsed > 0 ? Math.round(wParsed * 10) / 10 : null;
      const equip = { equipment, weight, weightUnit };
      const mode = timeMode ? 'time' : 'count';
      // A timed exercise counts minutes, so counting sets would be meaningless.
      const targetMode = (!timeMode && state.modal && state.modal.tmode === 'sets') ? 'sets' : 'reps';
      if (id) await updateExercise(id, { name, unit, target, category, schedule, mode, targetMode, ...equip });
      else await addExercise({ name, unit, target, category, schedule, mode, targetMode, ...equip,
        oneTimeDate: oneTime ? todayISO() : null });
      closeModal(); rerender();
      break;
    }

    case 'archive': await setArchived(btn.dataset.id, true); rerender(); break;
    case 'restore': await setArchived(btn.dataset.id, false); rerender(); break;
    case 'reorder': await reorder(btn.dataset.id, parseInt(btn.dataset.dir, 10)); rerender(); break;
    case 'toggle-archived': state.showArchived = !state.showArchived; renderView(); break;
    case 'share-exercise':
      await shareExerciseImage(btn.dataset.id);
      break;
    case 'share-session':
      await shareSessionImage(btn.dataset.id);
      break;
    case 'share-day':
      await shareDayImage();
      break;

    /* ---- crew ---- */
    case 'pick-crew':
      state.crew.activeId = btn.dataset.id;
      renderView();
      break;
    case 'open-create-crew':
      state.modal = { type: 'crewCreate' };
      renderModal();
      { const i = document.getElementById('crew-name'); if (i) i.focus(); }
      break;
    case 'open-join-crew':
      state.modal = { type: 'crewJoin' };
      renderModal();
      { const i = document.getElementById('crew-code'); if (i) i.focus(); }
      break;
    case 'create-crew': {
      const el = document.getElementById('crew-name');
      const name = el ? el.value.trim() : '';
      if (!name) { showToast('Give the crew a name.'); break; }
      showToast('Creating…');
      await primeCrewPhoto();
      const res = await crewApi.createCrew(name, myCrewCard());
      if (applyCrewResult(res, { toast: true })) { closeModal(); showToast(`${name} is ready — invite someone`); }
      break;
    }
    case 'join-crew': {
      const el = document.getElementById('crew-code');
      const typed = (el ? el.value : '').trim();
      if (!typed) { showToast('Type the invite code.'); break; }
      openInviteAccept(typed);
      break;
    }
    case 'open-story': {
      const crew = activeCrew();
      const m = crew && (crew.members || []).find((x) => x.id === btn.dataset.id);
      if (!m) break;
      const list = m.stories || (m.story ? [m.story] : []);
      // Your own face with no story is the way in to posting one.
      if (!list.length) { state.modal = { type: 'storyCompose', image: null, caption: '' }; renderModal(); break; }
      // Start at the first one you have not seen, or the newest if you have.
      const firstUnseen = list.findIndex((st) => !st.seenByMe);
      await openStoryAt(m.id, firstUnseen >= 0 ? firstUnseen : list.length - 1);
      break;
    }
    case 'add-story':
      state.modal = { type: 'storyCompose', image: null, caption: '' };
      renderModal();
      break;
    case 'publish-story': {
      const crew = activeCrew();
      const capEl = document.getElementById('story-caption');
      if (!crew || !state.modal || !state.modal.image) break;
      showToast('Posting…');
      const res = await crewApi.postStory(crew.id, state.modal.image, capEl ? capEl.value : '');
      if (applyCrewResult(res, { toast: true })) { closeModal(); showToast('Posted — 24 hours'); }
      break;
    }
    case 'set-role': {
      const crew = activeCrew();
      if (!crew) break;
      const res = await crewApi.setRole(crew.id, btn.dataset.id, { role: btn.dataset.role });
      if (applyCrewResult(res, { toast: true })) { renderModal(); showToast(`Role: ${(roleInfo(btn.dataset.role) || {}).label || 'set'}`); }
      break;
    }
    case 'set-class': {
      const crew = activeCrew();
      if (!crew) break;
      const res = await crewApi.setRole(crew.id, btn.dataset.id, { klass: btn.dataset.class || '' });
      if (applyCrewResult(res, { toast: true })) { renderModal(); showToast(btn.dataset.class ? `Class: ${(classInfo(btn.dataset.class) || {}).label}` : 'Class cleared'); }
      break;
    }
    case 'pick-crew-logo': {
      const input = document.getElementById('crew-logo-file');
      if (input) input.click();
      break;
    }
    case 'story-step': {
      // Several stories in a day means stepping through them, oldest first.
      if (!state.modal || state.modal.type !== 'story') break;
      await openStoryAt(state.modal.memberId, parseInt(btn.dataset.index, 10));
      break;
    }
    case 'react': {
      const crew = activeCrew();
      if (!crew) break;
      const res = await crewApi.react(crew.id, btn.dataset.id, btn.dataset.kind, btn.dataset.emoji || '');
      if (state.modal) state.modal.emojiOpen = false;
      if (applyCrewResult(res, { toast: true })) {
        renderModal();
        showToast(btn.dataset.kind === 'nudge' ? 'Nudged' : 'Sent');
      }
      break;
    }
    case 'toggle-emoji':
      if (state.modal) state.modal.emojiOpen = !state.modal.emojiOpen;
      renderModal();
      break;
    case 'accept-invite':
      await joinCrewByCode(btn.dataset.code);
      break;
    case 'decline-invite':
      state.crew.pendingCode = null;
      await db.setItem('crew-pending-code', null).catch(() => {});
      closeModal();
      break;
    case 'open-invite':
      state.crew.activeId = btn.dataset.id;
      state.modal = { type: 'crewInvite' };
      renderModal();
      break;
    case 'copy-invite':
      try {
        await navigator.clipboard.writeText(btn.dataset.link);
        showToast('Link copied');
      } catch (e) { showToast('Copy failed — long-press the link instead'); }
      break;
    case 'share-invite': {
      const crew = activeCrew();
      // `url` as its own field, not buried in the text: Messenger, WhatsApp and
      // Instagram all build their link preview from that field, and a URL that
      // is only inside a sentence often arrives unlinked.
      const payload = {
        title: `Join ${crew ? crew.name : 'my crew'} on Sets`,
        text: `Training with me on Sets — join ${crew ? crew.name : 'my crew'}:`,
        url: btn.dataset.link,
      };
      if (navigator.share) {
        try { await navigator.share(payload); } catch (e) { /* dismissed, or no target chosen */ }
      } else {
        try {
          await navigator.clipboard.writeText(`${payload.text} ${payload.url}`);
          showToast('Invite copied');
        } catch (e) { showToast('Copy the link above instead'); }
      }
      break;
    }
    case 'crew-menu':
      state.crew.activeId = btn.dataset.id;
      state.modal = { type: 'crewSettings' };
      renderModal();
      break;
    case 'open-member': {
      state.modal = { type: 'crewMember', memberId: btn.dataset.id };
      renderModal();
      // Looking at someone is the view. Fire and forget: a failed record must
      // never stop the card opening.
      const crew = activeCrew();
      if (crew) crewApi.recordView(crew.id, btn.dataset.id).then((r) => { if (r.ok) applyCrewResult(r); }).catch(() => {});
      break;
    }
    case 'start-rename-crew':
      if (state.modal) state.modal.renaming = true;
      renderModal();
      { const i = document.getElementById('crew-rename'); if (i) { i.focus(); i.select(); } }
      break;
    case 'cancel-rename-crew':
      if (state.modal) state.modal.renaming = false;
      renderModal();
      break;
    case 'rename-crew': {
      const el = document.getElementById('crew-rename');
      const mo = document.getElementById('crew-motto');
      const name = el ? el.value.trim() : '';
      if (!name) { showToast('Give the crew a name.'); break; }
      const res = await crewApi.renameCrew(btn.dataset.id, { name, motto: mo ? mo.value : '' });
      if (applyCrewResult(res, { toast: true })) { closeModal(); showToast('Crew saved'); }
      break;
    }
    case 'leave-crew': {
      const crew = activeCrew();
      if (!confirm(`Leave ${crew ? crew.name : 'this crew'}? Your card is removed from it straight away.`)) break;
      const res = await crewApi.leaveCrew(btn.dataset.id);
      if (applyCrewResult(res, { toast: true })) { closeModal(); showToast('You left the crew'); }
      break;
    }
    case 'remove-member': {
      const crew = activeCrew();
      if (!crew) break;
      const m = (crew.members || []).find((x) => x.id === btn.dataset.id);
      if (!confirm(`Remove ${m ? m.name : 'this person'} from ${crew.name}?`)) break;
      const res = await crewApi.removeMember(crew.id, btn.dataset.id);
      if (applyCrewResult(res, { toast: true })) { closeModal(); showToast('Removed'); }
      break;
    }
    case 'refresh-crew': {
      // A button that does its work invisibly reads as a button that does
      // nothing: it turns while it works, then holds a tick long enough to be
      // seen before going back to being a refresh button.
      if (state.crew.refreshing) break;
      state.crew.refreshing = true;
      state.crew.refreshedAt = 0;
      renderTopbar();
      await refreshCrews({ toast: true });
      state.crew.refreshing = false;
      if (!state.crew.error) {
        state.crew.refreshedAt = Date.now();
        renderTopbar();
        showToast('Crew up to date');
        clearTimeout(crewTickBack);
        crewTickBack = setTimeout(() => { state.crew.refreshedAt = 0; renderTopbar(); }, 2200);
      } else {
        renderTopbar();
      }
      break;
    }
    case 'toggle-stat-help':
      state.statHelp[btn.dataset.key] = !state.statHelp[btn.dataset.key];
      renderView();
      break;
    case 'open-guide':
      state.modal = { type: 'screenGuide' };
      renderModal();
      break;
    case 'toggle-group': {
      // Flip whatever is actually on screen — the rendered state carries the
      // default (a lone group starts open), so the first tap never no-ops.
      const k = `${btn.dataset.view}:${btn.dataset.key}`;
      const opening = btn.dataset.open !== 'true';
      // One step at a time in the guide. Left free to stack, twelve open
      // sections rebuild the exact wall of text this screen exists to avoid,
      // and you lose your place scrolling back for the next number. Plan and
      // Progress keep stacking — there you are comparing groups, not reading.
      if (btn.dataset.view === 'guide' && opening) {
        GUIDE_SECTIONS.forEach((s) => { state.openGroups[`guide:${s.id}`] = false; });
      }
      state.openGroups[k] = opening;
      // A fold can live inside a sheet (the crew member card), and the sheet is
      // rendered by its own pass — so the view alone would leave the tap dead.
      if (state.modal) renderModal();
      renderView();
      break;
    }

    case 'open-logger': state.modal = { type: 'logger', exId: btn.dataset.id }; renderModal(); break;
    case 'plan-type':
      captureExerciseDraft();
      if (state.modal) { state.modal.ptype = btn.dataset.type; renderModal(); }
      break;
    case 'equip-mode':
      captureExerciseDraft();
      if (state.modal) { state.modal.equip = btn.dataset.equip; renderModal(); }
      break;
    case 'target-mode': {
      captureExerciseDraft();
      if (!state.modal) break;
      // tmode is only set once a mode button has been pressed, so on first open
      // it is undefined and the exercise's own mode is the truth. Reading it as
      // "reps" made the first tap on Reps a no-op for a sets exercise.
      const exNow = state.exercises.find((e) => e.id === state.modal.exId);
      const from = state.modal.tmode !== undefined
        ? state.modal.tmode
        : ((exNow && exNow.targetMode === 'sets') ? 'sets' : 'reps');
      const to = btn.dataset.mode === 'sets' ? 'sets' : 'reps';
      if (from === to) break;
      // Park the number under the mode it belongs to and bring back whatever
      // that other mode last held, so toggling never carries a value across.
      const draft = state.modal.draft || {};
      state.modal.targetBy = { ...(state.modal.targetBy || {}), [from]: draft.target };
      state.modal.tmode = to;
      state.modal.draft = { ...draft, target: (state.modal.targetBy || {})[to] };
      renderModal();
      break;
    }
    case 'measure-mode':
      captureExerciseDraft();
      if (state.modal) { state.modal.measure = btn.dataset.mode; renderModal(); }
      break;
    case 'tunit': {
      captureExerciseDraft();
      if (!state.modal) break;
      const to = btn.dataset.unit;
      const from = state.modal.tunit || 'min';
      // Same rule as kg/lb: switching the unit converts what is typed, so the
      // target itself never moves under you.
      const d = state.modal.draft || {};
      if (to !== from && d.target !== '' && d.target != null && !isNaN(parseFloat(d.target))) {
        const mins = from === 'hr' ? parseFloat(d.target) * 60 : parseFloat(d.target);
        d.target = String(to === 'hr' ? Math.round((mins / 60) * 100) / 100 : Math.round(mins * 100) / 100);
        state.modal.draft = d;
      }
      state.modal.tunit = to;
      renderModal();
      break;
    }
    case 'wunit': {
      captureExerciseDraft();
      if (!state.modal) break;
      const to = btn.dataset.unit;
      const from = state.modal.wunit || 'kg';
      if (to !== from && state.modal.weight !== '' && state.modal.weight != null) {
        state.modal.weight = convertWeight(state.modal.weight, from, to);
      }
      state.modal.wunit = to;
      renderModal();
      break;
    }
    case 'sched-daily':
      captureExerciseDraft();
      if (state.modal) { state.modal.sched = 'daily'; renderModal(); }
      break;
    case 'sched-custom':
      captureExerciseDraft();
      if (state.modal && state.modal.sched === 'daily') {
        state.modal.sched = [new Date().getDay()]; // seed with today
        renderModal();
      }
      break;
    case 'sched-toggle': {
      captureExerciseDraft();
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
    case 'open-weigh-in':
      state.modal = { type: 'weighin' };
      renderModal();
      break;
    case 'save-weigh-in': {
      const raw = document.getElementById('f-weighin').value;
      const w = raw === '' ? null : Math.max(0, parseFloat(raw));
      if (!(w > 0)) { showToast('Enter a weight first'); break; }
      state.profile = { ...state.profile, weight: w, weightLog: recordWeight(state.profile.weightLog, todayISO(), w) };
      await persistProfile();
      state.modal = null;
      renderModal();
      render();
      showToast('Weight logged');
      break;
    }
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

    case 'open-exact-set':
      if (sealedToday(btn.dataset.id)) break;
      if (state.modal) state.modal.exactOpen = true;
      renderModal();
      { const i = document.getElementById('exact-set-input'); if (i) i.focus(); }
      break;
    case 'save-exact-set': {
      const input = document.getElementById('exact-set-input');
      await exactSetHandler(btn.dataset.id, input ? input.value : '');
      break;
    }
    case 'cancel-exact-set':
      if (state.modal) state.modal.exactOpen = false;
      renderModal();
      break;
    case 'start-time-session':
      await startTimeSessionHandler(btn.dataset.id);
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
    case 'reset-timer': {
      // On a timed exercise the clock IS the record, so "it only clears the
      // clock" would be a lie — resetting one really does clear today.
      const rEx = state.exercises.find((e) => e.id === btn.dataset.id);
      if (confirm(isTimeMode(rEx)
        ? 'Reset today’s clock back to 0:00? The clock is this exercise’s record, so today’s minutes go with it.'
        : 'Reset today’s timer back to 0:00? This only clears the clock, not your logged reps.')) {
        await resetTimerHandler(btn.dataset.id);
      }
      break;
    }

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
    case 'remove-avatar':
      await removeAvatarHandler();
      break;
    case 'nudge-sync':
      // A dead token needs the real sign-in; a live one just syncs.
      if (gsync.isSignedIn()) await syncNow();
      else await googleSignInHandler();
      renderBanner();
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
  const exactInput = e.target.closest('#exact-set-input');
  if (exactInput) {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.querySelector('[data-action="save-exact-set"]')?.click();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (state.modal) state.modal.exactOpen = false;
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

/**
 * Proof reaches the crew as a story: an image with a caption that expires in a
 * day and records who looked. That is precisely what was asked for, and it
 * needs no new endpoint, no new table and no Worker deploy — the one part of
 * this app that cannot be shipped without Johnny at a Cloudflare dashboard.
 *
 * Failure is silent on purpose. The workout is already finished locally; a
 * crew that is offline, or a crew you are not in, must never be able to take
 * that away.
 */
async function postProofToCrew(exId, image) {
  const crew = activeCrew();
  if (!crew || !hasSyncAccount() || !isOnline()) return;
  const ex = state.exercises.find((e) => e.id === exId);
  try {
    await crewApi.postStory(crew.id, image, PROOF_TAG + (ex ? ex.name : 'Workout'));
  } catch (e) {
    // best effort, by design
  }
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
let redirectResult = null;
async function init() {
  // Before anything renders: a token handed back by the renewal redirect.
  try { redirectResult = gsync.consumeRedirectResult(); } catch (e) { redirectResult = null; }
  // Set the token listener FIRST — the broker exchange below stores the refresh
  // token through it, and if it isn't wired yet that token is silently lost.
  gsync.setTokenListener((record) => {
    db.setItem('sync-token', record).catch(() => {});
  });
  // The broker code flow returns a ?code=… on launch. Trade it for tokens and
  // mark this device signed in (account + enabled), so tryResumeSync adopts the
  // session, shows it as signed in, and syncs. Failure stays silent — the app
  // just runs on local data, exactly as when signed out.
  if (redirectResult && redirectResult.pendingCode) {
    try {
      if (await gsync.brokerExchange(redirectResult.pendingCode)) {
        const email = gsync.getSignedInEmail() || await gsync.ensureEmail();
        await db.setItem('sync-enabled', true).catch(() => {});
        if (email) await db.setItem('sync-account', email).catch(() => {});
      }
    } catch (e) { /* stays signed out; the app still works locally */ }
  }
  // Whose data this is has to be settled before a single key is read.
  await restoreNamespace();
  await loadAll();
  db.requestPersistence();

  // The crew, as it last was, before a single request goes out — so the tab is
  // never empty on a slow connection.
  try {
    const cached = await db.getItem('crews-cache');
    if (cached && Array.isArray(cached.crews)) {
      state.crew.crews = cached.crews;
      state.crew.lastSync = cached.at || 0;
    }
    state.crew.pendingCode = (await db.getItem('crew-pending-code')) || null;
    seenStories = (await db.getItem('stories-seen')) || {};
  } catch (e) { /* an empty crew tab is not a broken app */ }

  const invite = readInviteFromUrl();
  if (invite) state.crew.pendingCode = invite;

  render();

  // Following an invite is the one thing that should interrupt.
  if (state.crew.pendingCode) openInviteAccept(state.crew.pendingCode);
  refreshCrews().catch(() => {});

  // A link tapped while Sets is already open changes the hash without reloading
  // — the common case when the app is installed, and the one a boot-time read
  // alone would miss entirely.
  window.addEventListener('hashchange', () => {
    const code = readInviteFromUrl();
    if (code) openInviteAccept(code);
  });

  tryResumeSync().catch(() => {});
  document.documentElement.classList.toggle('idle', document.hidden);
  checkVersion();
  document.addEventListener('visibilitychange', () => {
    // Pauses the flame and the dragon rather than letting them tick on in the
    // background. CSS does the pausing; this only flips the flag.
    document.documentElement.classList.toggle('idle', document.hidden);
    if (document.visibilityState !== 'visible') return;
    // A backgrounded phone stops the interval but not the clock. Coming back is
    // the moment to restart it — and, for a timed exercise, the moment its
    // finished session can finally ask the question.
    ensureGlobalTick();
    document.documentElement.classList.remove('idle');
    checkVersion();
    if (hasSyncAccount() && isOnline()) retryBackupQuietly();
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
