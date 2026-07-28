import './style.css';
import { registerSW } from 'virtual:pwa-register';
import * as db from './db/db.js';
import {
  todayISO,
  addDays,
  formatDisplayDate,
  uid,
  getEffectiveTarget,
  calcTotal,
  calcDayStats,
  calcStreakInfo,
  calcWeeklyCompletion,
  bestDayForExercise,
  addSet as addSetPure,
  removeSetAt as removeSetAtPure,
  undoLastSet as undoLastSetPure,
  updateSetAt as updateSetAtPure,
  decrementLast as decrementLastPure,
  removeExercise as removeExercisePure,
  purgeExerciseSets as purgeExerciseSetsPure,
  setDayTotal as setDayTotalPure,
  getTimer as getTimerPure,
  timerElapsedMs,
  startTimer as startTimerPure,
  pauseTimer as pauseTimerPure,
  resumeTimer as resumeTimerPure,
  finishTimer as finishTimerPure,
  resetTimer as resetTimerPure,
  bumpTargetIfPR as bumpTargetIfPRPure,
  setTargetForDay as setTargetForDayPure,
  buildBackup,
  validateBackup,
  mergeBackup,
} from './domain/domain.js';
import * as gsync from './sync/googleSync.js';

const DEFAULT_CHIPS = [5, 10, 12];

/* ============================= STATE ============================= */
const state = {
  view: db.prefs.get('view', 'today'),
  exercises: [],
  setsLog: {},
  timersLog: {},
  meta: { lastExportAt: null },
  profile: { username: '', weight: null, height: null },
  sync: { status: 'signed-out', email: null, error: null },
  streakOverrides: {},
  storageError: false,
  updateAvailable: false,
  applyUpdate: null,
  modal: null,
  loggerDraft: '',
  expandedDay: null,
  showArchived: false,
  editingPlanTarget: null,
  editingTodayTotal: null,
  editingDayTarget: null,
};

const EMOJI_PRESETS = ['💪', '🏃', '🦵', '🧘', '🚴', '🏊', '🤸', '🏋️', '⛹️', '🤾', '🧗', '🥊', '🤺', '🚶', '🧎', '⚽'];

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
  state.streakOverrides = streakOverrides || {};
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

async function applyRemoteSnapshot(remote) {
  applyingRemote = true;
  state.exercises = remote.exercises || [];
  state.setsLog = remote.setsLog || {};
  state.timersLog = remote.timersLog || {};
  state.profile = remote.profile || { username: '', weight: null, height: null };
  state.streakOverrides = remote.streakOverrides || {};
  state.meta.updatedAt = remote.updatedAt || Date.now();
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
  return !!(state.sync.email && state.sync.status !== 'signed-out');
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
    state.sync.status = state.sync.email ? 'reconnect' : 'signed-out';
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

function scheduleSyncPush() {
  if (applyingRemote || !hasSyncAccount()) return;
  clearTimeout(syncPushTimer);
  syncPushTimer = setTimeout(() => { pushToDrive(); }, 2500);
}

function renderSyncUI() {
  if (state.modal && state.modal.type === 'profile') renderModal();
  renderTopbar();
}

async function pushToDrive() {
  if (!hasSyncAccount()) return;
  try {
    beginSyncing(); renderSyncUI();
    await gsync.uploadBackup(buildSyncSnapshot());
    endSyncing('synced');
  } catch (e) {
    noteSyncFailure(e);
  }
  renderSyncUI();
}

async function pullAndMerge() {
  if (!hasSyncAccount()) return;
  try {
    beginSyncing(); renderSyncUI();
    const remote = await gsync.downloadBackup();
    if (!remote) {
      await pushToDrive(); // nothing synced yet from any device — seed the cloud copy
      return;
    }
    if ((remote.updatedAt || 0) > (state.meta.updatedAt || 0)) {
      await applyRemoteSnapshot(remote);
    } else if ((remote.updatedAt || 0) < (state.meta.updatedAt || 0)) {
      await pushToDrive();
      return;
    }
    endSyncing('synced');
  } catch (e) {
    noteSyncFailure(e);
  }
  renderSyncUI();
}

async function googleSignInHandler() {
  beginSyncing(); state.sync.error = null; renderModal();
  const ok = await gsync.signIn();
  if (ok) {
    // getSignedInEmail() can be null if the userinfo lookup failed; keep the
    // remembered address in that case rather than dropping the account.
    state.sync.email = gsync.getSignedInEmail() || state.sync.email;
    await db.setItem('sync-account', state.sync.email).catch(() => {});
    await pullAndMerge();
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
  state.sync = { status: 'signed-out', email: null, error: null };
  await db.setItem('sync-account', null).catch(() => {});
  renderModal();
  renderTopbar();
}
async function googleSyncNowHandler() {
  await pullAndMerge();
}
/** Attempted once on app load — reconnects silently (no popup) if this browser
 * signed in before and still has an active Google session. */
async function tryResumeSync() {
  const savedEmail = await db.getItem('sync-account').catch(() => null);
  if (!savedEmail) return;

  // Show the account immediately, before the handshake — the person never
  // signed out, so the app shouldn't flash a signed-out avatar on every load.
  state.sync.email = savedEmail;
  beginSyncing();
  renderSyncUI();

  const ok = await gsync.trySilentSignIn(savedEmail);
  if (ok) {
    state.sync.email = gsync.getSignedInEmail() || savedEmail;
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
  const d = todayISO();
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
  if (targetNow && total >= targetNow) {
    state.timersLog = finishTimerPure(state.timersLog, d, exId, now, 'completed');
  }

  await Promise.all([persistSets(), persistTimers(), newPR ? persistExercises() : Promise.resolve()]);

  const unit = ex && ex.unit ? ' ' + ex.unit : '';
  const msg = newPR ? `🏆 New PR! Target raised to ${total}${unit}` : `Logged ${value}${unit}`;
  showToast(msg, () => undoLastSetHandler(exId));
  rerender();
}
async function undoLastSetHandler(exId) {
  const d = todayISO();
  state.setsLog = undoLastSetPure(state.setsLog, d, exId);
  await persistSets();
  rerender();
}
async function removeSetHandler(exId, dateStr, index) {
  state.setsLog = removeSetAtPure(state.setsLog, dateStr, exId, index);
  await persistSets();
  rerender();
}
async function updateSetHandler(exId, dateStr, index, value) {
  state.setsLog = updateSetAtPure(state.setsLog, dateStr, exId, index, value);
  await persistSets();
  if (state.modal && state.modal.type === 'logger') state.modal.editIndex = null;
  renderModal();
  renderView();
}
async function decrementHandler(exId, amount) {
  const d = todayISO();
  state.setsLog = decrementLastPure(state.setsLog, d, exId, amount);
  await persistSets();
  rerender();
}
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
  renderModal();
  renderView();
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
    chips: data.chips && data.chips.length === 3 ? data.chips : DEFAULT_CHIPS.slice(),
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
  ex.chips = data.chips && data.chips.length === 3 ? data.chips : (ex.chips || DEFAULT_CHIPS.slice());
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
const ICONS = {
  today: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 8v4l2.5 2.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/></svg>`,
  plan: `<svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M5 12h14M5 17h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  progress: `<svg viewBox="0 0 24 24" fill="none"><path d="M5 19V10M12 19V5M19 19v-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  flame: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 2c1 3-2 4-2 7a4 4 0 108 0c0-1-.4-2-1-3 2 1 4 3.5 4 6.5A7 7 0 015 12.5C5 8 8 6 12 2z" fill="var(--accent)"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  plus: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`,
  chevron: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  trash: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2m-9 0l1 12a1 1 0 001 1h6a1 1 0 001-1l1-12" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  up: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M6 15l6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  down: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  edit: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 20l.8-3.6L16.6 4.6a1.5 1.5 0 012.1 0l.7.7a1.5 1.5 0 010 2.1L7.6 19.2 4 20z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  archive: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M5 7v11a1 1 0 001 1h12a1 1 0 001-1V7M9 11h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  restore: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M4 8a8 8 0 111.6 6.4M4 4v4h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  check: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="var(--success)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  gear: `<svg viewBox="0 0 24 24" fill="none"><path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" stroke-width="1.7"/><path d="M19.4 13.5a1.7 1.7 0 000-3l-1-.2a6.6 6.6 0 00-.7-1.6l.6-.9a1.7 1.7 0 00-2.4-2.4l-.9.6a6.6 6.6 0 00-1.6-.7l-.2-1a1.7 1.7 0 00-3 0l-.2 1a6.6 6.6 0 00-1.6.7l-.9-.6a1.7 1.7 0 00-2.4 2.4l.6.9a6.6 6.6 0 00-.7 1.6l-1 .2a1.7 1.7 0 000 3l1 .2a6.6 6.6 0 00.7 1.6l-.6.9a1.7 1.7 0 002.4 2.4l.9-.6a6.6 6.6 0 001.6.7l.2 1a1.7 1.7 0 003 0l.2-1a6.6 6.6 0 001.6-.7l.9.6a1.7 1.7 0 002.4-2.4l-.6-.9a6.6 6.6 0 00.7-1.6l1-.2z" stroke="currentColor" stroke-width="1.3"/></svg>`,
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
  if (state.storageError) {
    banners.push(`<div class="banner"><span>Couldn't save your last change. Export a backup so nothing's lost.</span><button data-action="export">Export</button></div>`);
  } else {
    const hasData = state.exercises.length > 0;
    const last = state.meta.lastExportAt;
    const daysSince = last ? (Date.now() - new Date(last).getTime()) / 86400000 : Infinity;
    if (hasData && daysSince > 7) {
      banners.push(`<div class="banner warn"><span>${last ? 'It’s been over a week since your last backup.' : 'You haven’t backed up yet.'}</span><button data-action="export">Export</button></div>`);
    }
  }
  el.innerHTML = banners.join('');
}

/* ============================= RENDER: SHELL ============================= */
function render() {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div id="banner-area"></div>
    <header id="topbar"></header>
    <main id="view-container"></main>
    <nav id="bottom-nav">
      <div class="nav-inner">
        <button class="nav-btn ${state.view === 'today' ? 'active' : ''}" data-action="nav" data-view="today">${ICONS.today}<span>Today</span></button>
        <button class="nav-btn ${state.view === 'plan' ? 'active' : ''}" data-action="nav" data-view="plan">${ICONS.plan}<span>Plan</span></button>
        <button class="nav-btn ${state.view === 'progress' ? 'active' : ''}" data-action="nav" data-view="progress">${ICONS.progress}<span>Progress</span></button>
      </div>
    </nav>
  `;
  renderTopbar();
  renderBanner();
  renderView();
}
function rerender() {
  renderTopbar();
  renderBanner();
  renderView();
  renderModal();
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
    const streak = calcStreakInfo(state.exercises, state.setsLog, null, state.streakOverrides).current;
    const uname = state.profile && state.profile.username;
    el.innerHTML = `
      <div class="topbar-row">
        <div>
          <div class="app-title">${uname ? `Hey, ${escapeHtml(uname)}` : 'Sets'}</div>
          <div class="date-heading">${formatDisplayDate(todayISO())}</div>
        </div>
        <div class="topbar-right">
          <div class="streak-pill">${ICONS.flame}${streak}</div>
          ${avatarChipHtml()}
        </div>
      </div>`;
  } else if (state.view === 'plan') {
    el.innerHTML = `
      <div class="plan-title-row">
        <div class="screen-title">Plan</div>
        <div class="topbar-right">
          <button class="add-btn" data-action="open-add-exercise">${ICONS.plus} Add</button>
          ${avatarChipHtml()}
        </div>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="plan-title-row">
        <div class="screen-title">Progress</div>
        <div class="topbar-right">
          <button class="icon-btn" data-action="open-data">${ICONS.gear}</button>
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
  const active = state.exercises.filter((e) => e.active).sort((a, b) => a.order - b.order);
  if (active.length === 0) {
    return `<div class="empty-card">
      <div class="glyph">🗓️</div>
      <h3>No exercises yet</h3>
      <p>Add your first exercise to start logging sets in seconds.</p>
      <button class="primary-btn" data-action="open-add-exercise">Add your first exercise</button>
    </div>`;
  }
  const today = todayISO();
  const rows = active.map((ex) => {
    const target = getEffectiveTarget(ex, today);
    const arr = getSetsFor(ex.id, today);
    const total = calcTotal(arr);
    const hasTarget = !!target && target > 0;
    const pct = hasTarget ? total / target : (total > 0 ? 1 : 0);
    const complete = hasTarget && total >= target;
    const isEditingTotal = state.editingTodayTotal === ex.id;
    const totalDisplay = isEditingTotal
      ? `<span class="inline-total-edit" data-stop>
           <input type="number" min="0" step="any" id="today-total-input-${ex.id}" class="total-edit-input" value="${total || ''}" placeholder="0">
           <button class="mini-btn" data-action="save-today-total-inline" data-id="${ex.id}" data-date="${today}" aria-label="Save">${ICONS.check}</button>
           <button class="mini-btn" data-action="cancel-today-total-inline" aria-label="Cancel">${ICONS.close}</button>
         </span>`
      : `<span class="ex-total-num editable-target" data-editable-today-total data-id="${ex.id}" title="Tap to edit total">${total}</span>`;
    const timer = getTimerPure(state.timersLog, today, ex.id);
    const timeBadge = timer
      ? `<div class="ex-time-badge status-${timer.status}">${timer.status === 'running' ? ICONS.play : timer.status === 'paused' ? ICONS.pause : timer.status === 'completed' ? ICONS.trophy : ICONS.flag}${formatElapsed(timerElapsedMs(timer, Date.now()))}</div>`
      : '';
    return `<div class="ex-card ${complete ? 'complete' : ''}">
      <button class="ex-card-main" data-action="open-logger" data-id="${ex.id}">
        ${ring(hasTarget ? pct : (total > 0 ? 1 : 0), 52, 4, complete, escapeHtml(ex.icon))}
        <div class="ex-body">
          <div class="ex-name">${escapeHtml(ex.name)}</div>
          ${hasTarget ? `<div class="ex-bar-track"><div class="ex-bar-fill ${complete ? 'complete' : ''}" style="width:${Math.min(pct, 1) * 100}%"></div></div>` : `<div class="ex-untargeted">No daily target</div>`}
        </div>
      </button>
      <div class="ex-totals" data-stop>
        ${totalDisplay}
        ${hasTarget ? `<div class="ex-total-target">/ ${target} ${escapeHtml(ex.unit)}</div>` : `<div class="ex-total-target">${escapeHtml(ex.unit)}</div>`}
        ${timeBadge}
      </div>
      <button class="chevron-btn" data-action="open-logger" data-id="${ex.id}" aria-label="Open logger">${ICONS.chevron}</button>
    </div>`;
  }).join('');
  return `<div>${rows}</div>`;
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
      const isEditingTarget = state.editingPlanTarget === ex.id;
      const targetSub = isEditingTarget
        ? `<span class="inline-target-edit" data-stop>
             <input type="number" min="0" step="any" id="plan-target-input-${ex.id}" class="target-edit-input" value="${target || ''}" placeholder="none">
             <span class="target-edit-unit">${escapeHtml(ex.unit)}/day</span>
             <button class="mini-btn" data-action="save-target-inline" data-id="${ex.id}" aria-label="Save">${ICONS.check}</button>
             <button class="mini-btn" data-action="cancel-target-inline" aria-label="Cancel">${ICONS.close}</button>
           </span>`
        : `<span class="editable-target" data-editable-target data-id="${ex.id}" title="Tap to edit target">${target ? `${target} ${escapeHtml(ex.unit)}/day` : `no target · ${escapeHtml(ex.unit)}`}</span>`;
      html += `<div class="plan-row">
        <div class="ex-icon-badge">${escapeHtml(ex.icon)}</div>
        <div class="plan-row-body">
          <div class="plan-row-name">${escapeHtml(ex.name)}</div>
          <div class="plan-row-sub">${targetSub}</div>
        </div>
        <div class="plan-row-actions">
          <button class="mini-btn" data-action="reorder" data-dir="-1" data-id="${ex.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">${ICONS.up}</button>
          <button class="mini-btn" data-action="reorder" data-dir="1" data-id="${ex.id}" ${i === active.length - 1 ? 'disabled' : ''} aria-label="Move down">${ICONS.down}</button>
          <button class="mini-btn" data-action="open-edit-exercise" data-id="${ex.id}" aria-label="Edit">${ICONS.edit}</button>
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
  if (isToday) return dt.hasTarget ? ` / ${dt.target}` : '';
  if (state.editingDayTarget === `${dateStr}|${dt.ex.id}`) {
    return ` / <span class="inline-target-edit" data-stop>
      <input type="number" min="0" step="any" id="day-target-input-${dt.ex.id}" class="target-edit-input" value="${dt.hasTarget ? dt.target : ''}" placeholder="none">
      <button class="mini-btn" data-action="save-day-target-inline" data-id="${dt.ex.id}" data-date="${dateStr}" aria-label="Save">${ICONS.check}</button>
      <button class="mini-btn" data-action="cancel-day-target-inline" aria-label="Cancel">${ICONS.close}</button>
    </span>`;
  }
  return ` / <span class="editable-target" data-editable-day-target data-id="${dt.ex.id}" data-date="${dateStr}" title="Tap to edit this day’s target">${dt.hasTarget ? dt.target : '—'}</span>`;
}

function viewProgress() {
  const { current, longest } = calcStreakInfo(state.exercises, state.setsLog, null, state.streakOverrides);
  const weekly = calcWeeklyCompletion(state.exercises, state.setsLog, null, state.streakOverrides);
  let html = `<div class="stat-grid three">
    <div class="stat-card"><div class="stat-num">${current}</div><div class="stat-label">Current streak</div></div>
    <div class="stat-card"><div class="stat-num">${longest}</div><div class="stat-label">Longest streak</div></div>
    <div class="stat-card"><div class="stat-num">${weekly === null ? '—' : weekly + '%'}</div><div class="stat-label">This week</div></div>
  </div>`;

  const withHistory = state.exercises.filter((ex) => bestDayForExercise(ex, state.setsLog));
  if (withHistory.length) {
    html += `<div class="section-label">Best day</div>`;
    withHistory.forEach((ex) => {
      const best = bestDayForExercise(ex, state.setsLog);
      html += `<div class="best-row">
        <div class="best-left"><span>${escapeHtml(ex.icon)}</span><span>${escapeHtml(ex.name)}</span></div>
        <div style="text-align:right"><div class="best-num">${best.total} ${escapeHtml(ex.unit)}</div><div class="best-date">${formatDisplayDate(best.date, { month: 'short', day: 'numeric' })}</div></div>
      </div>`;
    });
  }

  html += `<div class="section-label">Recent days</div>`;
  const today = todayISO();
  for (let i = 0; i < 14; i++) {
    const d = addDays(today, -i);
    const stats = calcDayStats(state.exercises, state.setsLog, d, state.streakOverrides);
    const dotClass = stats.targetedCount === 0 && !stats.overridden ? 'none' : (stats.allComplete ? 'complete' : 'incomplete');
    const expanded = state.expandedDay === d;
    html += `<div class="day-row">
      <div class="day-row-head">
        <button class="day-dot-btn" data-action="toggle-day-override" data-date="${d}" aria-label="Toggle streak day" title="Tap to mark this day as counting (or not) toward your streak">
          <span class="day-dot ${dotClass} ${stats.overridden ? 'overridden' : ''}"></span>
        </button>
        <button class="day-row-main" data-action="toggle-day" data-date="${d}">
          <span class="day-label">${i === 0 ? 'Today' : formatDisplayDate(d)}</span>
          <span class="day-frac">${stats.targetedCount > 0 ? `${stats.completedCount}/${stats.targetedCount}` : '—'}</span>
        </button>
      </div>
      ${expanded ? `<div class="day-detail">${
        stats.details.length === 0 ? '<div>No exercises logged.</div>' :
        stats.details.map((dt) => {
          const t = getTimerPure(state.timersLog, d, dt.ex.id);
          const timeStr = t ? ` · ${formatElapsed(timerElapsedMs(t, Date.now()))}` : '';
          return `<div><span>${escapeHtml(dt.ex.icon)} ${escapeHtml(dt.ex.name)}</span><span>${dt.total}${renderDayTargetPart(dt, d, i === 0)} ${escapeHtml(dt.ex.unit)}${timeStr}</span></div>`;
        }).join('')
      }</div>` : ''}
    </div>`;
  }
  return html;
}

/* ============================= MODALS ============================= */
let timerTickHandle = null;
function ensureTimerTick() {
  if (timerTickHandle) { clearInterval(timerTickHandle); timerTickHandle = null; }
  if (!state.modal || state.modal.type !== 'logger') return;
  const exId = state.modal.exId;
  const timer = getTimerPure(state.timersLog, todayISO(), exId);
  if (!timer || timer.status !== 'running') return;
  timerTickHandle = setInterval(() => {
    const el = document.getElementById('timer-display');
    if (!el || !state.modal || state.modal.type !== 'logger' || state.modal.exId !== exId) {
      clearInterval(timerTickHandle);
      timerTickHandle = null;
      return;
    }
    const t = getTimerPure(state.timersLog, todayISO(), exId);
    if (!t || t.status !== 'running') {
      clearInterval(timerTickHandle);
      timerTickHandle = null;
      return;
    }
    el.textContent = formatElapsed(timerElapsedMs(t, Date.now()));
  }, 1000);
}

function closeModal() { state.modal = null; renderModal(); }
function renderModal() {
  const root = document.getElementById('modal-root');
  if (!root) return;
  if (!state.modal) { root.innerHTML = ''; ensureTimerTick(); return; }
  const m = state.modal;
  if (m.type === 'logger') root.innerHTML = modalLogger(m.exId);
  else if (m.type === 'exerciseForm') root.innerHTML = modalExerciseForm(m.exId);
  else if (m.type === 'confirmDeleteSet') root.innerHTML = modalConfirm(m);
  else if (m.type === 'confirmDeleteExercise') root.innerHTML = modalConfirmDeleteExercise(m);
  else if (m.type === 'data') root.innerHTML = modalData();
  else if (m.type === 'profile') root.innerHTML = modalProfile();
  else if (m.type === 'importChoice') root.innerHTML = modalImportChoice();
  bindModalEvents();
  ensureTimerTick();
}

function modalLogger(exId) {
  const ex = state.exercises.find((e) => e.id === exId);
  if (!ex) return '';
  const today = todayISO();
  const target = getEffectiveTarget(ex, today);
  const hasTarget = !!target && target > 0;
  const arr = getSetsFor(exId, today);
  const total = calcTotal(arr);
  const draft = state.loggerDraft;
  const chips = (ex.chips && ex.chips.length === 3) ? ex.chips : DEFAULT_CHIPS;
  const editIndex = state.modal && state.modal.editIndex != null ? state.modal.editIndex : null;
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
      <div class="set-row-left"><span class="set-badge" data-editable-set data-index="${i}" title="Tap to edit">${v}</span>${isLatest ? '<span class="set-latest-tag">Latest</span>' : ''}</div>
      <button class="set-del" data-action="delete-set" data-id="${exId}" data-date="${today}" data-index="${i}" aria-label="Remove set">${ICONS.trash}</button>
    </div>`;
  }).join('');
  const editingTotal = !!(state.modal && state.modal.editingTotal);
  const totalDisplay = editingTotal
    ? `<span class="inline-total-edit" data-stop>
         <input type="number" min="0" step="any" id="logger-total-input" class="total-edit-input large" value="${total || ''}" placeholder="0" autofocus>
         <button class="mini-btn" data-action="save-logger-total-inline" data-id="${exId}" data-date="${today}" aria-label="Save">${ICONS.check}</button>
         <button class="mini-btn" data-action="cancel-logger-total-inline" aria-label="Cancel">${ICONS.close}</button>
       </span>`
    : `<div class="logger-total editable-target" data-editable-logger-total data-id="${exId}" title="Tap to edit total">${total}</div>`;

  const timer = getTimerPure(state.timersLog, today, exId);
  const timerHtml = timer ? (() => {
    const elapsed = formatElapsed(timerElapsedMs(timer, Date.now()));
    const statusLabel = { running: 'In progress', paused: 'Paused', completed: 'Target hit', gaveup: 'Ended early' }[timer.status];
    const activeControls = (timer.status === 'running' || timer.status === 'paused')
      ? `${timer.status === 'running'
           ? `<button class="timer-btn" data-action="pause-timer" data-id="${exId}">${ICONS.pause}Pause</button>`
           : `<button class="timer-btn" data-action="resume-timer" data-id="${exId}">${ICONS.play}Resume</button>`}
         <button class="timer-btn giveup" data-action="giveup-timer" data-id="${exId}">${ICONS.flag}Give up</button>`
      : '';
    return `<div class="timer-block status-${timer.status}">
      <div class="timer-top">
        <span class="timer-clock" id="timer-display" data-status="${timer.status}">${elapsed}</span>
        <span class="timer-status">${timer.status === 'completed' ? ICONS.trophy : ''}${statusLabel}</span>
      </div>
      <div class="timer-controls">
        ${activeControls}
        <button class="timer-btn reset" data-action="reset-timer" data-id="${exId}">${ICONS.restore}Reset</button>
      </div>
    </div>`;
  })() : '';

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
      <div class="logger-tally">${tallyMarks(arr.length)}</div>

      <div class="chip-row">
        ${chips.map((c) => `<button class="chip" data-action="chip-log" data-id="${exId}" data-val="${c}">+${c}</button>`).join('')}
      </div>
      <div class="chip-row minus-row">
        ${chips.map((c) => `<button class="chip chip-minus" data-action="chip-minus" data-id="${exId}" data-val="${c}" ${arr.length ? '' : 'disabled'}>−${c}</button>`).join('')}
      </div>

      <div class="keypad-display ${draft ? '' : 'placeholder'}">${draft || '0'}</div>
      <div class="keypad">
        ${['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'].map((k) => `<button class="key" data-action="key" data-key="${k}">${k}</button>`).join('')}
      </div>
      <button class="log-btn" data-action="log-draft" data-id="${exId}" ${(parseFloat(draft) > 0) ? '' : 'disabled'}>Log set</button>

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
  const chips = (ex && ex.chips && ex.chips.length === 3) ? ex.chips : DEFAULT_CHIPS;
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
        <label>Quick-add buttons</label>
        <div class="chip-input-row">
          <input id="f-chip1" type="number" min="0" step="any" value="${chips[0]}">
          <input id="f-chip2" type="number" min="0" step="any" value="${chips[1]}">
          <input id="f-chip3" type="number" min="0" step="any" value="${chips[2]}">
        </div>
        <div class="hint">These become the +/− quick buttons when logging a set.</div>
      </div>
      <div class="field">
        <label>Daily target (optional)</label>
        <input id="f-target" type="number" min="0" step="any" placeholder="Leave blank for no target" value="${target ? target : ''}">
        <div class="hint">${editing ? 'Changing this only affects today onward — past days keep their original target.' : 'Untargeted exercises still track totals but don’t count toward your streak.'}</div>
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
      renderTopbar(); renderView(); renderBanner();
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
      const chipVals = ['f-chip1', 'f-chip2', 'f-chip3'].map((fid) => {
        const raw = parseFloat(document.getElementById(fid).value);
        return raw > 0 ? Math.round(raw * 100) / 100 : null;
      });
      const chips = chipVals.every((c) => c != null) ? chipVals : null;
      const id = btn.dataset.id;
      if (id) await updateExercise(id, { name, unit, target, chips });
      else await addExercise({ name, unit, target, icon, chips });
      closeModal(); rerender();
      break;
    }

    case 'archive': await setArchived(btn.dataset.id, true); rerender(); break;
    case 'restore': await setArchived(btn.dataset.id, false); rerender(); break;
    case 'reorder': await reorder(btn.dataset.id, parseInt(btn.dataset.dir, 10)); rerender(); break;
    case 'toggle-archived': state.showArchived = !state.showArchived; renderView(); break;

    case 'open-logger': state.loggerDraft = ''; state.modal = { type: 'logger', exId: btn.dataset.id }; renderModal(); break;
    case 'chip-log':
      await logSet(btn.dataset.id, parseFloat(btn.dataset.val));
      if (state.modal && state.modal.type === 'logger') renderModal();
      break;
    case 'chip-minus':
      await decrementHandler(btn.dataset.id, parseFloat(btn.dataset.val));
      if (state.modal && state.modal.type === 'logger') renderModal();
      break;
    case 'key': {
      const k = btn.dataset.key;
      if (k === '⌫') state.loggerDraft = state.loggerDraft.slice(0, -1);
      else if (k === '.') { if (!state.loggerDraft.includes('.')) state.loggerDraft += (state.loggerDraft ? '.' : '0.'); }
      else { if (state.loggerDraft.length < 6) state.loggerDraft += k; }
      renderModal();
      break;
    }
    case 'log-draft': {
      const val = parseFloat(state.loggerDraft);
      if (val > 0) { await logSet(btn.dataset.id, val); state.loggerDraft = ''; renderModal(); }
      break;
    }
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
      const input = document.getElementById('logger-total-input');
      await setTotalHandler(btn.dataset.id, btn.dataset.date, input.value);
      break;
    }
    case 'cancel-logger-total-inline':
      if (state.modal) state.modal.editingTotal = false;
      renderModal();
      break;

    case 'pause-timer':
      await pauseTimerHandler(btn.dataset.id);
      break;
    case 'resume-timer':
      await resumeTimerHandler(btn.dataset.id);
      break;
    case 'giveup-timer':
      if (confirm('Give up on today’s target for this exercise? The timer will stop and today won’t count as complete.')) {
        await giveUpTimerHandler(btn.dataset.id);
      }
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
    case 'apply-update':
      if (state.applyUpdate) state.applyUpdate();
      break;
  }
});

document.addEventListener('click', (e) => {
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
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && hasSyncAccount()) pullAndMerge();
  });
}
init();
