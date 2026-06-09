// main.js — Single-page entry point combining Studio, Timeline, and Quick Export.
import { getEstimatedRollDurationMs, roll, rollState } from './animation.js';
import {
  applyTheme,
  BUILT_IN_THEMES,
  getThemeByKey,
  getThemeDisplayName,
  loadUserThemes,
  normalizeThemeName,
  renderUserThemes,
  saveUserTheme,
  upsertUserThemes,
} from './themes.js';
import { CONFIG, DIE_TYPES } from './config.js';
import { buildDie, rebuildTextures, activeDieState } from './geometry.js';
import { setModifiers, modifierAnim, getModifiers, removeModifier } from './modifiers.js';
import { renderModifierCards, initUI, applyModCardStyles, syncInputsFromConfig } from './ui.js';
import { loadTimelines, saveTimeline, deleteTimeline } from './timeline.js';
import {
  exportTimelineItems,
  generateAllWebMs,
  exportNumbers,
  initExportCancelBtn,
} from './export.js';
import { renderer, camera } from './scene.js';

// ── Utilities ─────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const CARD_SETTING_KEYS = ['cardScale', 'cardsBottom'];
const MOTION_SETTING_KEYS = [
  'tumbleDur',
  'settleDur',
  'spinMin',
  'chaosMag',
  'decayRate',
  'wallBounceEnabled',
  'wallAreaScale',
  'wallExtraDur',
];
const GLOBAL_SETTING_CONTROL_IDS = new Set([
  'c-modCardScale',
  'c-modCardsBottom',
  'c-tumble',
  'c-settle',
  'c-spinMin',
  'c-chaos',
  'c-decay',
  'c-wallBounce',
  'c-wallArea',
  'c-wallExtra',
]);

function numberSetting(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function booleanSetting(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function getTimelineCards(data, legacyItem) {
  const root = data && !Array.isArray(data) ? data : {};
  const cards = root.cards || {};
  return {
    scale: numberSetting(cards.scale ?? root.cardScale ?? legacyItem.cardScale, CONFIG.modCardScale ?? 1.0),
    bottom: numberSetting(cards.bottom ?? root.cardsBottom ?? legacyItem.cardsBottom, CONFIG.modCardsBottom ?? 132),
  };
}

function getTimelineMotion(data, legacyItem, legacyTheme) {
  const root = data && !Array.isArray(data) ? data : {};
  const motion = root.motion || {};
  return {
    tumbleDur: numberSetting(motion.tumbleDur ?? root.tumbleDur ?? legacyItem.tumbleDur ?? legacyTheme?.tumbleDur, CONFIG.tumbleDur ?? 1.9),
    settleDur: numberSetting(motion.settleDur ?? root.settleDur ?? legacyItem.settleDur ?? legacyTheme?.settleDur, CONFIG.settleDur ?? 1.95),
    spinMin: numberSetting(motion.spinMin ?? root.spinMin ?? legacyItem.spinMin ?? legacyTheme?.spinMin, CONFIG.spinMin ?? 3.5),
    chaosMag: numberSetting(motion.chaosMag ?? root.chaosMag ?? legacyItem.chaosMag ?? legacyTheme?.chaosMag, CONFIG.chaosMag ?? 0.05),
    decayRate: numberSetting(motion.decayRate ?? root.decayRate ?? legacyItem.decayRate ?? legacyTheme?.decayRate, CONFIG.decayRate ?? 3.8),
    wallBounceEnabled: booleanSetting(motion.wallBounceEnabled ?? root.wallBounceEnabled ?? legacyItem.wallBounceEnabled ?? legacyTheme?.wallBounceEnabled, Boolean(CONFIG.wallBounceEnabled)),
    wallAreaScale: numberSetting(motion.wallAreaScale ?? root.wallAreaScale ?? legacyItem.wallAreaScale ?? legacyTheme?.wallAreaScale, CONFIG.wallAreaScale ?? 0.9),
    wallExtraDur: numberSetting(motion.wallExtraDur ?? root.wallExtraDur ?? legacyItem.wallExtraDur ?? legacyTheme?.wallExtraDur, CONFIG.wallExtraDur ?? 1.6),
  };
}

function normalizeTimelineItem(item) {
  const normalized = { ...(item || {}) };
  for (const key of CARD_SETTING_KEYS.concat(MOTION_SETTING_KEYS)) delete normalized[key];
  return {
    ...normalized,
    themeName: normalizeThemeName(normalized.themeName) || 'bg3',
    modifiers: Array.isArray(normalized.modifiers) ? normalized.modifiers : [],
  };
}

function getTimelineSettings(data, items) {
  const root       = data && !Array.isArray(data) ? data : {};
  const legacyItem = items[0] || {};
  const legacyThemeName = String(normalizeThemeName(legacyItem.themeName) || '')
    .replace(/^user:/, '')
    .toLowerCase();
  const legacyThemeSnapshot = Array.isArray(root.themes)
    ? root.themes.find(theme => String(theme?.name || '').toLowerCase() === legacyThemeName)
    : null;
  const legacyTheme = legacyThemeSnapshot || getThemeByKey(legacyItem.themeName);
  return {
    cards: getTimelineCards(root, legacyItem),
    motion: getTimelineMotion(root, legacyItem, legacyTheme),
  };
}

function applyTimelineSettings(data, items) {
  const settings = getTimelineSettings(data, items);
  CONFIG.modCardScale   = settings.cards.scale;
  CONFIG.modCardsBottom = settings.cards.bottom;
  Object.assign(CONFIG, settings.motion);
  applyModCardStyles();
  syncInputsFromConfig();
}

function makeTimelineDocument(name, items) {
  return {
    name,
    cards: {
      scale: CONFIG.modCardScale ?? 1.0,
      bottom: CONFIG.modCardsBottom ?? 132,
    },
    motion: {
      tumbleDur: CONFIG.tumbleDur ?? 1.9,
      settleDur: CONFIG.settleDur ?? 1.95,
      spinMin: CONFIG.spinMin ?? 3.5,
      chaosMag: CONFIG.chaosMag ?? 0.05,
      decayRate: CONFIG.decayRate ?? 3.8,
      wallBounceEnabled: Boolean(CONFIG.wallBounceEnabled),
      wallAreaScale: CONFIG.wallAreaScale ?? 0.9,
      wallExtraDur: CONFIG.wallExtraDur ?? 1.6,
    },
    themes: getIncludedTimelineThemes(items),
    items: items.map(normalizeTimelineItem),
  };
}

function getIncludedTimelineThemes(items) {
  const userThemes = loadUserThemes();
  const included = new Map();

  for (const item of items) {
    const normalized = normalizeThemeName(item?.themeName);
    if (!normalized) continue;

    const name = String(normalized).startsWith('user:')
      ? String(normalized).slice(5)
      : String(normalized);
    const builtIn = BUILT_IN_THEMES[normalized];
    const userTheme = userThemes.find(candidate => candidate.name === name)
      || userThemes.find(candidate => candidate.name.toLowerCase() === name.toLowerCase());
    const theme = builtIn ? { ...builtIn, name } : userTheme;
    if (theme) {
      const themeSnapshot = { ...theme };
      for (const key of CARD_SETTING_KEYS.concat(MOTION_SETTING_KEYS)) delete themeSnapshot[key];
      included.set(name.toLowerCase(), themeSnapshot);
    }
  }

  return [...included.values()].map(theme => ({ ...theme }));
}

function remapItemsToIncludedThemes(items, themes) {
  const included = new Map();
  for (const theme of themes || []) {
    if (!theme || typeof theme.name !== 'string' || !theme.name.trim()) continue;
    const name = theme.name.trim();
    const userReference = `user:${name}`;
    included.set(name.toLowerCase(), userReference);
    included.set(userReference.toLowerCase(), userReference);

    const normalized = normalizeThemeName(name);
    if (BUILT_IN_THEMES[normalized]) included.set(normalized.toLowerCase(), userReference);
  }

  return items.map(item => {
    const normalized = normalizeTimelineItem(item);
    const reference = included.get(String(normalized.themeName || '').toLowerCase());
    return reference ? { ...normalized, themeName: reference } : normalized;
  });
}

// ── Toast notification ────────────────────────────────────────────────────────
function showToast(message) {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2000);
}

// ── Studio context state ──────────────────────────────────────────────────────
let studioEditingItemId   = null;  // null = draft mode
let currentStudioThemeKey = 'bg3';
let studioRollNumber      = 1;
let studioThemeDirty      = false; // true when user has manually tweaked styling

// ── Studio roll result ────────────────────────────────────────────────────────
function getDieMax(dieType = CONFIG.dieType || 'd20') {
  return DIE_TYPES[dieType]?.faces || 20;
}

function syncStudioRollInput({ select = false } = {}) {
  const input = document.getElementById('studio-roll-number');
  const range = document.getElementById('studio-roll-range');
  const grid  = document.getElementById('studio-roll-grid');
  const max   = getDieMax();
  studioRollNumber = Math.min(Math.max(Number(studioRollNumber) || 1, 1), max);
  if (input) {
    input.min = '1';
    input.max = String(max);
    input.value = String(studioRollNumber);
    if (select) {
      requestAnimationFrame(() => {
        input.focus();
        input.select();
      });
    }
  }
  if (range) range.textContent = `1-${max}`;
  if (grid) {
    grid.querySelectorAll('.studio-roll-btn').forEach(btn => {
      btn.classList.toggle('selected', Number(btn.dataset.n) === studioRollNumber);
    });
  }
}

function readStudioRollInput() {
  const input = document.getElementById('studio-roll-number');
  studioRollNumber = Number(input?.value);
  syncStudioRollInput();
  return studioRollNumber;
}

function previewStudioRoll() {
  roll(readStudioRollInput());
}

function buildStudioRollGrid() {
  const grid = document.getElementById('studio-roll-grid');
  if (!grid) return;
  const max = getDieMax();
  grid.innerHTML = '';
  grid.style.gridTemplateColumns = `repeat(${Math.ceil(max / 2)}, 1fr)`;
  for (let i = 1; i <= max; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'studio-roll-btn face-btn';
    btn.textContent = i;
    btn.dataset.n = String(i);
    btn.addEventListener('click', () => {
      studioRollNumber = i;
      syncStudioRollInput({ select: true });
    });
    grid.appendChild(btn);
  }
  syncStudioRollInput();
}

// ── Studio modifier list ──────────────────────────────────────────────────────
function renderStudioMods() {
  const list = document.getElementById('studio-mods-list');
  if (!list) return;
  list.innerHTML = '';
  const mods = getModifiers();
  if (!mods.length) {
    const empty = document.createElement('p');
    empty.className   = 'tl-empty';
    empty.textContent = 'No modifiers';
    empty.style.padding = '4px 0';
    list.appendChild(empty);
    return;
  }
  mods.forEach(mod => {
    const row = document.createElement('div');
    row.className = 'tl-form-mod-row';
    const valStr     = (mod.value >= 0 ? '+' : '') + mod.value;
    const colorClass = mod.value >= 0 ? 'positive' : 'negative';
    row.innerHTML = `
      <span class="tl-form-mod-name">${escapeHtml(mod.label)}</span>
      <span class="tl-form-mod-val mod-value ${colorClass}">${valStr}</span>
      <button class="tl-form-mod-del" title="Remove">&#10005;</button>
    `;
    row.querySelector('.tl-form-mod-del').addEventListener('click', () => {
      removeModifier(mod.id);
      renderModifierCards();
      renderStudioMods();
    });
    list.appendChild(row);
  });
}

// ── Auto-save dirty theme before adding to timeline ─────────────────────────
function ensureThemeSaved() {
  if (!studioThemeDirty) return currentStudioThemeKey || 'bg3';
  const existingNames = loadUserThemes().map(t => t.name);
  let n = 1, name;
  do { name = `Custom ${n++}`; } while (existingNames.includes(name));
  saveUserTheme(name);
  currentStudioThemeKey = `user:${name}`;
  studioThemeDirty = false;
  showToast(`Theme auto-saved as "${name}"`);
  return currentStudioThemeKey;
}

// ── Studio context UI ─────────────────────────────────────────────────────────
function updateStudioContext() {
  const cancelBtn = document.getElementById('studio-ctx-cancel');
  const addBtn    = document.getElementById('studio-add-tl-btn');
  const nameInput = document.getElementById('studio-entry-name');
  if (!cancelBtn || !addBtn) return;
  if (studioEditingItemId !== null) {
    cancelBtn.style.display = '';
    addBtn.textContent = 'Update Entry';
  } else {
    cancelBtn.style.display = 'none';
    addBtn.textContent = '+ Add Roll';
    if (nameInput) nameInput.value = '';
  }
}

function loadItemIntoStudio(itemId) {
  const item = timelineItems.find(i => i.id === itemId);
  if (!item) return;
  studioEditingItemId   = itemId;
  currentStudioThemeKey = item.themeName || 'bg3';
  studioThemeDirty = false;
  studioRollNumber = item.number || 1;

  CONFIG.dieType = item.dieType;
  buildDie(item.dieType);
  rebuildTextures();

  const theme = getThemeByKey(item.themeName);
  if (theme) applyTheme(theme);

  applyModCardStyles();

  setModifiers(item.modifiers || []);
  renderModifierCards();
  renderStudioMods();
  rollState.current = 'idle';

  const dieTypeEl = document.getElementById('c-dieType');
  if (dieTypeEl) dieTypeEl.value = item.dieType;

  const nameInput = document.getElementById('studio-entry-name');
  if (nameInput) nameInput.value = item.label || '';

  buildStudioRollGrid();
  updateStudioContext();
  renderTimeline();
}

// Save the current Studio roll as a new entry or update the entry being edited.
function handleStudioSaveRoll() {
  const dieType     = CONFIG.dieType || 'd20';
  const mods        = getModifiers().map(m => ({ label: m.label, value: m.value }));
  const themeName   = ensureThemeSaved();
  const nameInput   = document.getElementById('studio-entry-name');
  const label       = nameInput ? nameInput.value.trim() : '';
  const number      = readStudioRollInput();

  if (studioEditingItemId !== null) {
    const editingId = studioEditingItemId;
    const item = timelineItems.find(i => i.id === editingId);
    if (item) {
      item.dieType     = dieType;
      item.themeName   = themeName;
      item.number      = number;
      item.modifiers   = mods;
      item.label       = label || `${dieType.toUpperCase()} Roll`;
    }
    persistWorkingTimeline();
    selectedItemId = item ? editingId : selectedItemId;
    studioEditingItemId = null;
    updateStudioContext();
    renderTimeline();
    showToast('Entry updated');
  } else {
    const newItem = {
      id: nextItemId++,
      label: label || `${dieType.toUpperCase()} Roll`,
      dieType,
      themeName,
      number,
      modifiers: mods,
    };
    timelineItems.push(newItem);
    selectedItemId = newItem.id;
    persistWorkingTimeline();
    renderTimeline();
    showToast('Added to timeline');
  }
  if (nameInput) nameInput.value = '';
  syncStudioRollInput({ select: true });
}

// ── Panel tab switching ───────────────────────────────────────────────────────
function switchPanelTab(tab) {
  document.querySelectorAll('.panel-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab)
  );
  document.getElementById('tab-studio').style.display   = tab === 'studio'   ? '' : 'none';
  document.getElementById('tab-timeline').style.display = tab === 'timeline' ? '' : 'none';
  document.getElementById('tab-quick').style.display    = tab === 'quick'    ? '' : 'none';
  if (tab === 'quick') qeApplyToCanvas();
}

// ── Quick Export ──────────────────────────────────────────────────────────────
function qeApplyToCanvas() {
  buildFacePicker();
}

// ── Timeline state ────────────────────────────────────────────────────────────
const WORKING_TL_KEY = 'd20-timeline-working';

function persistWorkingTimeline() {
  try { localStorage.setItem(WORKING_TL_KEY, JSON.stringify(makeTimelineDocument('working', timelineItems))); } catch {}
}

function loadWorkingTimeline() {
  try {
    const data  = JSON.parse(localStorage.getItem(WORKING_TL_KEY) || '[]');
    const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
    const settings = getTimelineSettings(data, items);
    CONFIG.modCardScale   = settings.cards.scale;
    CONFIG.modCardsBottom = settings.cards.bottom;
    Object.assign(CONFIG, settings.motion);
    return items.map(normalizeTimelineItem);
  } catch {
    return [];
  }
}

let timelineItems = loadWorkingTimeline();
let nextItemId    = timelineItems.length
  ? Math.max(...timelineItems.map(i => i.id || 0)) + 1
  : 1;
let selectedItemId = null;

// ── Timeline rendering ────────────────────────────────────────────────────────
function renderTimeline() {
  const container = document.getElementById('tl-items');
  if (!container) return;
  container.innerHTML = '';

  if (timelineItems.length === 0) {
    const empty = document.createElement('p');
    empty.className   = 'tl-empty';
    empty.textContent = 'No entries yet. Enter a roll result in Studio and press Enter to start.';
    container.appendChild(empty);
    return;
  }

  timelineItems.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'tl-item-row'
      + (item.id === selectedItemId      ? ' tl-selected'       : '')
      + (item.id === studioEditingItemId ? ' tl-studio-editing' : '');
    row.dataset.id = item.id;

    const modsSummary = item.modifiers.length > 0
      ? item.modifiers.map(m => `${m.label} ${m.value >= 0 ? '+' : ''}${m.value}`).join(', ')
      : '\u2014';

    const themeDisplay = getThemeDisplayName(item.themeName);

    row.innerHTML = `
      <div class="tl-item-num">${idx + 1}</div>
      <div class="tl-item-info">
        <span class="tl-item-label">${escapeHtml(item.label || `Item ${idx + 1}`)}</span>
        <span class="tl-item-meta">${item.dieType.toUpperCase()} &bull; ${escapeHtml(themeDisplay)} &bull; Roll\u00a0${item.number}</span>
        <span class="tl-item-meta">${escapeHtml(modsSummary)}</span>
      </div>
      <div class="tl-item-btns">
        <button class="tl-btn tl-btn-play"   title="Roll">&#9654;</button>
        <button class="tl-btn tl-btn-export" title="Export">&#11015;</button>
        <button class="tl-btn tl-btn-del"    title="Remove">&#10005;</button>
      </div>
    `;

    row.querySelector('.tl-item-num').addEventListener('click',   () => selectTimelineItem(item.id));
    row.querySelector('.tl-item-info').addEventListener('click',  () => selectTimelineItem(item.id));
    row.querySelector('.tl-btn-play').addEventListener('click',   () => rollSingleItem(item.id));
    row.querySelector('.tl-btn-export').addEventListener('click', () => exportTimelineItems([item], getExportSettings()));
    row.querySelector('.tl-btn-del').addEventListener('click',    () => deleteItem(item.id));

    container.appendChild(row);
  });
}

function selectTimelineItem(id) {
  selectedItemId = id;
  document.querySelectorAll('.tl-item-row').forEach(r => {
    r.classList.toggle('tl-selected', r.dataset.id === String(id));
  });
  loadItemIntoStudio(id);
  switchPanelTab('studio');
  syncStudioRollInput({ select: true });
  showToast('Loaded to Studio');
}

async function rollSingleItem(id) {
  selectedItemId = id;
  loadItemIntoStudio(id);
  await new Promise(r => setTimeout(r, 350));
  const item = timelineItems.find(i => i.id === id);
  if (item) roll(item.number);
}

function deleteItem(id) {
  timelineItems = timelineItems.filter(i => i.id !== id);
  if (studioEditingItemId === id) { studioEditingItemId = null; updateStudioContext(); }
  persistWorkingTimeline();
  renderTimeline();
}

// ── Preview playback ──────────────────────────────────────────────────────────
let previewCancelled = false;
let previewRunning   = false;

async function previewTimeline() {
  if (previewRunning) { stopPreview(); return; }
  if (timelineItems.length === 0) { alert('Add at least one item to preview.'); return; }

  previewCancelled = false;
  previewRunning   = true;
  const btn = document.getElementById('tl-preview-btn');
  btn.textContent = '\u23f9 Stop';

  for (let i = 0; i < timelineItems.length; i++) {
    if (previewCancelled) break;
    const item = timelineItems[i];

    document.querySelectorAll('.tl-item-row').forEach(r => r.classList.remove('tl-active'));
    const activeRow = document.querySelector(`.tl-item-row[data-id="${item.id}"]`);
    if (activeRow) {
      activeRow.classList.add('tl-active');
      activeRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    const theme = getThemeByKey(item.themeName);
    if (theme) applyTheme(theme);

    applyModCardStyles();

    CONFIG.dieType = item.dieType;
    buildDie(item.dieType);
    rebuildTextures();

    setModifiers(item.modifiers || []);
    renderModifierCards();

    rollState.current = 'idle';
    await new Promise(r => setTimeout(r, 350));
    if (previewCancelled) break;

    roll(item.number);
    await waitForRollDone();
    if (previewCancelled) break;

    const holdMs = Math.round(parseFloat(document.getElementById('exp-hold').value || '0.6') * 1000);
    await new Promise(r => setTimeout(r, holdMs + 300));
  }

  document.querySelectorAll('.tl-item-row').forEach(r => r.classList.remove('tl-active'));
  previewRunning   = false;
  btn.textContent = '\u25b6 Preview';
}

function stopPreview() {
  previewCancelled = true;
  document.getElementById('tl-preview-btn').textContent = 'Stopping\u2026';
}

async function waitForRollDone(timeoutMs = getEstimatedRollDurationMs()) {
  await new Promise(resolve => {
    const deadline = Date.now() + 1000;
    (function waitStart() {
      if (rollState.current !== 'idle' || previewCancelled || Date.now() > deadline) return resolve();
      requestAnimationFrame(waitStart);
    })();
  });
  return new Promise(resolve => {
    const deadline = Date.now() + timeoutMs;
    (function waitDone() {
      if (rollState.current === 'done' || previewCancelled || Date.now() > deadline) return resolve();
      requestAnimationFrame(waitDone);
    })();
  });
}

// ── Saved timelines ───────────────────────────────────────────────────────────
function renderSavedTimelines() {
  const container = document.getElementById('tl-saved-list');
  if (!container) return;
  container.innerHTML = '';
  loadTimelines().forEach(t => {
    const pill  = document.createElement('div');
    pill.className = 'theme-pill';
    pill.style.cursor = 'pointer';
    const label = document.createElement('span');
    label.className   = 'pill-label';
    label.textContent = t.name;
    pill.addEventListener('click', e => {
      if (e.target.closest('.pill-del')) return;
      const items = Array.isArray(t.items) ? t.items : [];
      applyTimelineSettings(t, items);
      timelineItems = items.map(normalizeTimelineItem);
      nextItemId    = Math.max(0, ...timelineItems.map(i => i.id || 0)) + 1;
      persistWorkingTimeline();
      renderTimeline();
      switchPanelTab('timeline');
    });
    const del = document.createElement('span');
    del.className   = 'pill-del';
    del.textContent = '\u2715';
    del.addEventListener('click', () => { deleteTimeline(t.name); renderSavedTimelines(); });
    pill.appendChild(label);
    pill.appendChild(del);
    container.appendChild(pill);
  });
}

// ── Quick export — face picker ────────────────────────────────────────────────
function buildFacePicker() {
  const picker = document.getElementById('facePicker');
  if (!picker) return;
  picker.innerHTML = '';
  const labels = activeDieState.labels;
  const max    = labels.includes(0) ? 10 : labels.length;
  const cols   = Math.ceil(max / 2);
  picker.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

  exportNumbers.clear();

  for (let i = 1; i <= max; i++) {
    const btn     = document.createElement('button');
    btn.className = 'face-btn';
    btn.textContent = i;
    btn.dataset.n   = i;
    btn.addEventListener('click', () => {
      if (exportNumbers.has(i)) { exportNumbers.delete(i); btn.classList.remove('selected'); }
      else                      { exportNumbers.add(i);    btn.classList.add('selected'); }
      updateExportBtnLabel();
    });
    picker.appendChild(btn);
  }
  updateExportBtnLabel();
}

function updateExportBtnLabel() {
  const labels = activeDieState.labels;
  const max    = labels.includes(0) ? 10 : labels.length;
  const n      = exportNumbers.size;
  const btn    = document.getElementById('exportBtn');
  if (!btn) return;
  btn.disabled = n === 0;
  btn.textContent =
    n === 0   ? '\u2b07 Export (select numbers)' :
    n === max  ? `\u2b07 Export All ${max} Videos` :
                 `\u2b07 Export ${n} Video${n > 1 ? 's' : ''}`;
}

// ── Export settings ───────────────────────────────────────────────────────────
function getExportSettings() {
  const resMul   = parseInt(document.getElementById('exp-res').value, 10);
  const bgKey    = document.getElementById('exp-bg').value;
  const bitrate  = parseInt(document.getElementById('exp-bitrate').value, 10);
  const leadInMs = Math.round(parseFloat(document.getElementById('exp-leadin').value) * 1000);
  const holdMs   = Math.round(parseFloat(document.getElementById('exp-hold').value) * 1000);
  const bgColor  = { chroma: '#00FF00', magenta: '#FF00FF', black: '#000000', current: CONFIG.bgColor }[bgKey];
  return { resMul, bgColor, bitrate, leadInMs, holdMs };
}

// ── Initialisation ────────────────────────────────────────────────────────────
getThemeByKey('bg3'); // warm-up (ensure BUILT_IN_THEMES loaded)
applyTheme(BUILT_IN_THEMES.bg3);
applyModCardStyles();

// initUI wires all Studio color/slider/theme controls
initUI();

buildStudioRollGrid();
renderUserThemes();
renderTimeline();
renderSavedTimelines();
buildFacePicker();
renderStudioMods();
updateStudioContext();

document.addEventListener('themeapplied', () => {
  applyModCardStyles();
  studioThemeDirty = false;
});
document.addEventListener('studioReset', e => {
  currentStudioThemeKey = e.detail?.themeKey || 'bg3';
  studioThemeDirty = false;
});
document.addEventListener('modifierschanged', renderStudioMods);

// Dirty-track theme customizations made via Studio inputs
document.getElementById('tab-studio').addEventListener('input',  e => {
  const id = e.target.id;
  if (id && (id.startsWith('c-') || id.startsWith('c-mod'))
      && id !== 'c-dieType' && !GLOBAL_SETTING_CONTROL_IDS.has(id)) {
    studioThemeDirty = true;
  }
});
document.getElementById('tab-studio').addEventListener('change', e => {
  const id = e.target.id;
  if (id && (id === 'c-font' || id === 'c-bold') && !GLOBAL_SETTING_CONTROL_IDS.has(id)) {
    studioThemeDirty = true;
  }
});

// ── Settings panel toggle ─────────────────────────────────────────────────────
document.getElementById('settingsToggle').addEventListener('click', () => {
  document.getElementById('settingsToggle').classList.toggle('open');
  document.getElementById('settingsPanel').classList.toggle('open');
});

// ── Panel tabs ────────────────────────────────────────────────────────────────
document.querySelectorAll('.panel-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    switchPanelTab(btn.dataset.tab);
    if (btn.dataset.tab === 'studio') syncStudioRollInput({ select: true });
  });
});

// From the canvas, R opens Studio and starts a keyboard-first roll-entry session.
document.addEventListener('keydown', e => {
  if (e.key.toLowerCase() !== 'r' || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.target.closest('input, textarea, select, button, [contenteditable="true"]')) return;
  e.preventDefault();
  document.getElementById('settingsToggle').classList.add('open');
  document.getElementById('settingsPanel').classList.add('open');
  switchPanelTab('studio');
  syncStudioRollInput({ select: true });
});

// ── Die type (Studio) ─────────────────────────────────────────────────────────
document.getElementById('c-dieType').addEventListener('change', e => {
  const type = e.target.value;
  CONFIG.dieType = type;
  buildDie(type);
  rebuildTextures();
  rollState.current = 'idle';
  buildStudioRollGrid();
});

// ── Random button ─────────────────────────────────────────────────────────────
document.getElementById('randomBtn').addEventListener('click', () => {
  const labels = activeDieState.labels;
  const max    = labels.includes(0) ? 10 : labels.length;
  const n      = Math.ceil(Math.random() * max);
  roll(n);
});

// ── Studio context ────────────────────────────────────────────────────────────
document.getElementById('studio-ctx-cancel').addEventListener('click', () => {
  studioEditingItemId = null;
  updateStudioContext();
  renderTimeline();
  syncStudioRollInput({ select: true });
});
document.getElementById('studio-add-tl-btn').addEventListener('click', handleStudioSaveRoll);
document.getElementById('studio-preview-roll-btn').addEventListener('click', previewStudioRoll);
document.getElementById('studio-roll-number').addEventListener('change', readStudioRollInput);
document.getElementById('studio-roll-number').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (e.shiftKey) previewStudioRoll();
  else handleStudioSaveRoll();
});
GLOBAL_SETTING_CONTROL_IDS.forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener('input', persistWorkingTimeline);
  el.addEventListener('change', persistWorkingTimeline);
});

// Track theme key from built-in theme buttons
document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => { currentStudioThemeKey = btn.dataset.theme; });
});
// Track theme key from user themes (event delegation on the pills container)
document.getElementById('saved-themes').addEventListener('click', e => {
  const pill = e.target.closest('.pill-label');
  if (pill) currentStudioThemeKey = 'user:' + pill.textContent.trim();
});

// Second listener on mod-add-btn to keep studio-mods-list in sync after ui.js adds
document.getElementById('mod-add-btn').addEventListener('click', () => {
  setTimeout(renderStudioMods, 0);
});
document.getElementById('mod-value-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') setTimeout(renderStudioMods, 0);
});

// ── Timeline controls ─────────────────────────────────────────────────────────
document.getElementById('tl-preview-btn').onclick = previewTimeline;
document.getElementById('tl-export-btn').addEventListener('click', async () => {
  if (timelineItems.length === 0) { alert('Add at least one item to export.'); return; }
  await exportTimelineItems(timelineItems, getExportSettings());
});
document.getElementById('tl-save-btn').addEventListener('click', () => {
  const nameEl = document.getElementById('tl-save-name');
  const name   = nameEl.value.trim();
  if (!name) return;
  if (!timelineItems.length) { alert('Add at least one item before saving.'); return; }
  saveTimeline(name, makeTimelineDocument(name, timelineItems));
  nameEl.value = '';
  renderSavedTimelines();
});
document.getElementById('tl-clear-btn').addEventListener('click', () => {
  if (timelineItems.length === 0) return;
  if (!confirm('Clear all timeline items?')) return;
  timelineItems = [];
  nextItemId    = 1;
  if (studioEditingItemId !== null) { studioEditingItemId = null; updateStudioContext(); }
  persistWorkingTimeline();
  renderTimeline();
});
document.getElementById('tl-export-json').addEventListener('click', () => {
  if (!timelineItems.length) { alert('No items to export.'); return; }
  const blob = new Blob([JSON.stringify(makeTimelineDocument('timeline', timelineItems), null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: 'timeline.json' });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
document.getElementById('tl-import-json-btn').addEventListener('click', () => {
  document.getElementById('tl-import-file').click();
});
document.getElementById('tl-import-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = evt => {
    let data;
    try { data = JSON.parse(evt.target.result); }
    catch { alert('Invalid JSON file.'); return; }
    const items = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : []);
    if (!items.length) { alert('No items found in file.'); return; }
    const includedThemes = Array.isArray(data?.themes) ? data.themes : [];
    const importedThemeCount = upsertUserThemes(includedThemes);
    applyTimelineSettings(data, items);
    timelineItems = remapItemsToIncludedThemes(items, includedThemes)
      .map(item => ({ ...item, id: nextItemId++ }));
    persistWorkingTimeline();
    renderTimeline();
    switchPanelTab('timeline');
    if (importedThemeCount > 0) {
      showToast(`Imported timeline and ${importedThemeCount} included theme${importedThemeCount === 1 ? '' : 's'}`);
    }
    e.target.value = '';
  };
  reader.readAsText(file);
});

// ── Quick export: face picker controls ───────────────────────────────────────
document.getElementById('pickAll').addEventListener('click', () => {
  const labels = activeDieState.labels;
  const max    = labels.includes(0) ? 10 : labels.length;
  for (let i = 1; i <= max; i++) exportNumbers.add(i);
  document.getElementById('facePicker').querySelectorAll('.face-btn').forEach(b => b.classList.add('selected'));
  updateExportBtnLabel();
});
document.getElementById('pickNone').addEventListener('click', () => {
  exportNumbers.clear();
  document.getElementById('facePicker').querySelectorAll('.face-btn').forEach(b => b.classList.remove('selected'));
  updateExportBtnLabel();
});
document.getElementById('exportBtn').addEventListener('click', () => {
  if (exportNumbers.size === 0) return;
  generateAllWebMs();
});
initExportCancelBtn();

// ── Export settings sliders ───────────────────────────────────────────────────
['leadin', 'hold'].forEach(id => {
  const slider = document.getElementById(`exp-${id}`);
  const label  = document.getElementById(`exp-${id}-val`);
  if (slider && label) {
    slider.addEventListener('input', () => {
      label.textContent = parseFloat(slider.value).toFixed(1) + 's';
    });
  }
});

// ── Export visibility checkboxes (also control live preview) ──────────────────
function syncPreviewVisibility() {
  const showCards  = document.getElementById('exp-show-cards').checked;
  const showResult = document.getElementById('exp-show-result').checked;
  const showModFx  = document.getElementById('exp-show-modfx').checked;
  document.body.classList.toggle('export-no-cards',  !showCards);
  document.body.classList.toggle('export-no-result', !showResult);
  modifierAnim.skip = !showModFx;
}
document.getElementById('exp-show-cards').addEventListener('change',  syncPreviewVisibility);
document.getElementById('exp-show-modfx').addEventListener('change',  syncPreviewVisibility);
document.getElementById('exp-show-result').addEventListener('change', syncPreviewVisibility);
syncPreviewVisibility();

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  const ov = document.getElementById('mod-overlay-canvas');
  if (ov) { ov.width = window.innerWidth; ov.height = window.innerHeight; }
});

// ── URL param: ?roll=N ────────────────────────────────────────────────────────
const urlRoll = new URLSearchParams(location.search).get('roll');
if (urlRoll) setTimeout(() => roll(parseInt(urlRoll, 10)), 700);
