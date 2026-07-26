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
  buildBackup,
  validateBackup,
  mergeBackup,
} from './domain/domain.js';

const DEFAULT_CHIPS = [5, 10, 12];

/* ============================= STATE ============================= */
const state = {
  view: db.prefs.get('view', 'today'),
  exercises: [],
  setsLog: {},
  meta: { lastExportAt: null },
  storageError: false,
  updateAvailable: false,
  applyUpdate: null,
  modal: null,
  loggerDraft: '',
  expandedDay: null,
  showArchived: false,
};

const EMOJI_PRESETS = ['💪', '🏃', '🦵', '🧘', '🚴', '🏊', '🤸', '🏋️', '⛹️', '🤾', '🧗', '🥊', '🤺', '🚶', '🧎', '⚽'];

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function getSetsFor(exId, dateStr) {
  return (state.setsLog[dateStr] && state.setsLog[dateStr][exId]) || [];
}

/* ============================= STORAGE ============================= */
async function loadAll() {
  const [exercises, setsLog, meta] = await Promise.all([
    db.getItem('exercises'),
    db.getItem('sets-log'),
    db.getItem('app-meta'),
  ]);
  state.exercises = exercises || [];
  state.setsLog = setsLog || {};
  state.meta = meta || { lastExportAt: null };
}
async function persistExercises() {
  try {
    await db.setItem('exercises', state.exercises);
    if (state.storageError) { state.storageError = false; renderBanner(); }
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

/* ============================= MUTATIONS ============================= */
async function logSet(exId, value) {
  if (!(value > 0)) return;
  const d = todayISO();
  state.setsLog = addSetPure(state.setsLog, d, exId, value);
  await persistSets();
  const ex = state.exercises.find((e) => e.id === exId);
  showToast(`Logged ${value}${ex && ex.unit ? ' ' + ex.unit : ''}`, () => undoLastSetHandler(exId));
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
async function updateExercise(id, data) {
  const ex = state.exercises.find((e) => e.id === id);
  if (!ex) return;
  ex.name = data.name.trim();
  ex.icon = data.icon || ex.icon;
  ex.unit = (data.unit || 'reps').trim();
  ex.chips = data.chips && data.chips.length === 3 ? data.chips : (ex.chips || DEFAULT_CHIPS.slice());
  const today = todayISO();
  const currentTarget = getEffectiveTarget(ex, today);
  const newTarget = data.target || null;
  if (newTarget !== currentTarget) {
    const todEntry = ex.targetHistory.find((h) => h.effectiveDate === today);
    if (todEntry) todEntry.target = newTarget;
    else ex.targetHistory.push({ effectiveDate: today, target: newTarget });
  }
  await persistExercises();
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

function renderTopbar() {
  const el = document.getElementById('topbar');
  if (!el) return;
  if (state.view === 'today') {
    const streak = calcStreakInfo(state.exercises, state.setsLog).current;
    el.innerHTML = `
      <div class="topbar-row">
        <div>
          <div class="app-title">Sets</div>
          <div class="date-heading">${formatDisplayDate(todayISO())}</div>
        </div>
        <div class="streak-pill">${ICONS.flame}${streak}</div>
      </div>`;
  } else if (state.view === 'plan') {
    el.innerHTML = `
      <div class="plan-title-row">
        <div class="screen-title">Plan</div>
        <button class="add-btn" data-action="open-add-exercise">${ICONS.plus} Add</button>
      </div>`;
  } else {
    el.innerHTML = `
      <div class="plan-title-row">
        <div class="screen-title">Progress</div>
        <button class="icon-btn" data-action="open-data">${ICONS.gear}</button>
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
    return `<button class="ex-card ${complete ? 'complete' : ''}" data-action="open-logger" data-id="${ex.id}">
      ${ring(hasTarget ? pct : (total > 0 ? 1 : 0), 52, 4, complete, escapeHtml(ex.icon))}
      <div class="ex-body">
        <div class="ex-name">${escapeHtml(ex.name)}</div>
        ${hasTarget ? `<div class="ex-bar-track"><div class="ex-bar-fill ${complete ? 'complete' : ''}" style="width:${Math.min(pct, 1) * 100}%"></div></div>` : `<div class="ex-untargeted">No daily target</div>`}
      </div>
      <div class="ex-totals">
        <div class="ex-total-num">${total}</div>
        ${hasTarget ? `<div class="ex-total-target">/ ${target} ${escapeHtml(ex.unit)}</div>` : `<div class="ex-total-target">${escapeHtml(ex.unit)}</div>`}
      </div>
      <div class="chevron">${ICONS.chevron}</div>
    </button>`;
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
      html += `<div class="plan-row">
        <div class="ex-icon-badge">${escapeHtml(ex.icon)}</div>
        <div class="plan-row-body">
          <div class="plan-row-name">${escapeHtml(ex.name)}</div>
          <div class="plan-row-sub">${target ? `${target} ${escapeHtml(ex.unit)}/day` : `no target · ${escapeHtml(ex.unit)}`}</div>
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
function viewProgress() {
  const { current, longest } = calcStreakInfo(state.exercises, state.setsLog);
  const weekly = calcWeeklyCompletion(state.exercises, state.setsLog);
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
    const stats = calcDayStats(state.exercises, state.setsLog, d);
    const dotClass = stats.targetedCount === 0 ? 'none' : (stats.allComplete ? 'complete' : 'incomplete');
    const expanded = state.expandedDay === d;
    html += `<div class="day-row">
      <button class="day-row-head" data-action="toggle-day" data-date="${d}">
        <span class="day-dot ${dotClass}"></span>
        <span class="day-label">${i === 0 ? 'Today' : formatDisplayDate(d)}</span>
        <span class="day-frac">${stats.targetedCount > 0 ? `${stats.completedCount}/${stats.targetedCount}` : '—'}</span>
      </button>
      ${expanded ? `<div class="day-detail">${
        stats.details.length === 0 ? '<div>No exercises logged.</div>' :
        stats.details.map((dt) => `<div><span>${escapeHtml(dt.ex.icon)} ${escapeHtml(dt.ex.name)}</span><span>${dt.total}${dt.hasTarget ? ` / ${dt.target}` : ''} ${escapeHtml(dt.ex.unit)}</span></div>`).join('')
      }</div>` : ''}
    </div>`;
  }
  return html;
}

/* ============================= MODALS ============================= */
function closeModal() { state.modal = null; renderModal(); }
function renderModal() {
  const root = document.getElementById('modal-root');
  if (!root) return;
  if (!state.modal) { root.innerHTML = ''; return; }
  const m = state.modal;
  if (m.type === 'logger') root.innerHTML = modalLogger(m.exId);
  else if (m.type === 'exerciseForm') root.innerHTML = modalExerciseForm(m.exId);
  else if (m.type === 'confirmDeleteSet') root.innerHTML = modalConfirm(m);
  else if (m.type === 'confirmDeleteExercise') root.innerHTML = modalConfirmDeleteExercise(m);
  else if (m.type === 'data') root.innerHTML = modalData();
  else if (m.type === 'importChoice') root.innerHTML = modalImportChoice();
  bindModalEvents();
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
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <h2>${escapeHtml(ex.icon)} ${escapeHtml(ex.name)}</h2>
        <button class="sheet-close" data-action="close-modal">${ICONS.close}</button>
      </div>
      <div class="logger-total-row">
        <div class="logger-total">${total}</div>
        ${hasTarget ? `<div class="logger-target">/ ${target}</div>` : ''}
      </div>
      <div class="logger-unit">${escapeHtml(ex.unit)} logged today</div>
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

function modalData() {
  const last = state.meta.lastExportAt;
  return `<div class="modal-backdrop" data-action="backdrop">
    <div class="modal-sheet" data-stop>
      <div class="sheet-handle"></div>
      <div class="sheet-head"><h2>Backup & data</h2><button class="sheet-close" data-action="close-modal">${ICONS.close}</button></div>
      <p style="font-size:13.5px;color:var(--text-dim);line-height:1.5;margin-top:0">Your data lives in this browser's storage and stays on this device. Export a JSON backup any time — it's the only way to move data to another device, and iOS Safari can clear site data if you don't open the app for about a week.</p>
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

    case 'toggle-day':
      state.expandedDay = state.expandedDay === btn.dataset.date ? null : btn.dataset.date;
      renderView();
      break;

    case 'open-data': state.modal = { type: 'data' }; renderModal(); break;
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
  if (!badge) return;
  if (!state.modal || state.modal.type !== 'logger') return;
  state.modal.editIndex = parseInt(badge.dataset.index, 10);
  renderModal();
  const input = document.getElementById('edit-set-input');
  if (input) { input.focus(); input.select(); }
});

document.addEventListener('keydown', (e) => {
  const input = e.target.closest('#edit-set-input');
  if (!input) return;
  if (e.key === 'Enter') {
    e.preventDefault();
    document.querySelector('[data-action="edit-set-save"]')?.click();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    if (state.modal) state.modal.editIndex = null;
    renderModal();
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
}
init();
