// main.js — Single-page entry point combining Studio, Timeline, and Quick Export.
import { roll, rollState } from './animation.js';
import { applyTheme, BUILT_IN_THEMES, loadUserThemes, renderUserThemes, saveUserTheme } from './themes.js';
import { CONFIG, DIE_TYPES } from './config.js';
import { buildDie, rebuildTextures, activeDieState } from './geometry.js';
import { setModifiers, modifierAnim, getModifiers, removeModifier } from './modifiers.js';
import { renderModifierCards, initUI, applyModCardStyles } from './ui.js';
import { loadTimelines, saveTimeline, deleteTimeline } from './timeline.js';
import {
  exportTimelineItems,
  generateAllWebMs,
  exportNumbers,
  initExportCancelBtn,
} from './export.js';
import { renderer, camera } from './scene.js';

// ── Built-in theme display names ──────────────────────────────────────────────
const BUILT_IN_THEME_LABELS = {
  bg3:       '⚔ BG3',
  classic:   'Classic',
  bloodmoon: '🩸 Blood Moon',
  arcane:    '🔮 Arcane',
  emerald:   '🌿 Emerald',
  undead:    '💀 Undead',
  forge:     '⚒ Forge',
};

// ── Utilities ─────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getThemeByKey(key) {
  if (!key) return null;
  if (BUILT_IN_THEMES[key]) return BUILT_IN_THEMES[key];
  const name = key.startsWith('user:') ? key.slice(5) : key;
  return loadUserThemes().find(t => t.name === name) || null;
}

function getThemeOptions() {
  const builtIn = Object.keys(BUILT_IN_THEMES).map(k => ({
    value: k, label: BUILT_IN_THEME_LABELS[k] || k,
  }));
  const user = loadUserThemes().map(t => ({ value: `user:${t.name}`, label: t.name }));
  return [...builtIn, ...user];
}

function populateThemeSelect(selectEl, selectedKey) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  getThemeOptions().forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (value === selectedKey) opt.selected = true;
    selectEl.appendChild(opt);
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
let lastRolledNumber      = null;
let savedStudioMods       = [];    // snapshot when leaving Studio tab
let studioThemeDirty      = false; // true when user has manually tweaked styling
let currentTab            = 'studio';
let pendingRandomHighlight = null;

// ── Number grid ───────────────────────────────────────────────────────────────
function buildNumberGrid() {
  const grid = document.getElementById('number-grid');
  if (!grid) return;
  const labels = activeDieState.labels;
  const max    = labels.includes(0) ? 10 : labels.length;
  const cols   = Math.ceil(max / 2);
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.innerHTML = '';
  for (let i = 1; i <= max; i++) {
    const btn = document.createElement('button');
    btn.className = 'num-btn' + (i === lastRolledNumber ? ' last-rolled' : '');
    btn.textContent = i;
    btn.addEventListener('click', () => {
      lastRolledNumber = i;
      grid.querySelectorAll('.num-btn').forEach(b => b.classList.remove('last-rolled'));
      btn.classList.add('last-rolled');
      roll(i);
    });
    grid.appendChild(btn);
  }
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
    addBtn.textContent = '+ Add to Timeline';
    if (nameInput) nameInput.value = '';
  }
}

function loadItemIntoStudio(itemId) {
  const item = timelineItems.find(i => i.id === itemId);
  if (!item) return;
  studioEditingItemId   = itemId;
  currentStudioThemeKey = item.themeName || 'bg3';
  studioThemeDirty = false;
  lastRolledNumber = item.number || 1;

  CONFIG.dieType = item.dieType;
  buildDie(item.dieType);
  rebuildTextures();

  const theme = getThemeByKey(item.themeName);
  if (theme) applyTheme(theme);

  CONFIG.modCardScale   = item.cardScale   ?? 1.0;
  CONFIG.modCardsBottom = item.cardsBottom ?? 132;
  applyModCardStyles();

  setModifiers(item.modifiers || []);
  renderModifierCards();
  renderStudioMods();
  rollState.current = 'idle';

  const dieTypeEl = document.getElementById('c-dieType');
  if (dieTypeEl) dieTypeEl.value = item.dieType;

  const nameInput = document.getElementById('studio-entry-name');
  if (nameInput) nameInput.value = item.label || '';

  buildNumberGrid();
  updateStudioContext();
  renderTimeline();
}

// Called when "Add to Timeline" (draft) or "Update Entry" (editing).
function handleStudioAddToTimeline() {
  const dieType     = CONFIG.dieType || 'd20';
  const mods        = getModifiers().map(m => ({ label: m.label, value: m.value }));
  const cardScale   = CONFIG.modCardScale   ?? 1.0;
  const cardsBottom = CONFIG.modCardsBottom ?? 132;
  const themeName   = ensureThemeSaved();
  const nameInput   = document.getElementById('studio-entry-name');
  const label       = nameInput ? nameInput.value.trim() : '';
  const number      = lastRolledNumber || 1;

  if (studioEditingItemId !== null) {
    const item = timelineItems.find(i => i.id === studioEditingItemId);
    if (item) {
      item.dieType     = dieType;
      item.themeName   = themeName;
      item.number      = number;
      item.modifiers   = mods;
      item.cardScale   = cardScale;
      item.cardsBottom = cardsBottom;
      item.label       = label || `${dieType.toUpperCase()} Roll`;
    }
    persistWorkingTimeline();
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
      cardScale,
      cardsBottom,
    };
    timelineItems.push(newItem);
    persistWorkingTimeline();
    renderTimeline();
    showToast('Added to timeline');
  }
}

// ── Panel tab switching ───────────────────────────────────────────────────────
function switchPanelTab(tab) {
  currentTab = tab;
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
  try { localStorage.setItem(WORKING_TL_KEY, JSON.stringify(timelineItems)); } catch {}
}

function loadWorkingTimeline() {
  try { return JSON.parse(localStorage.getItem(WORKING_TL_KEY) || '[]'); } catch { return []; }
}

let timelineItems = loadWorkingTimeline();
let nextItemId    = timelineItems.length
  ? Math.max(...timelineItems.map(i => i.id || 0)) + 1
  : 1;
let editingItemId  = null;
let selectedItemId = null;
let formMods       = [];

// ── Timeline rendering ────────────────────────────────────────────────────────
function renderTimeline() {
  const container = document.getElementById('tl-items');
  if (!container) return;
  container.innerHTML = '';

  if (timelineItems.length === 0) {
    const empty = document.createElement('p');
    empty.className   = 'tl-empty';
    empty.textContent = 'No entries yet \u2014 click \u201c+ Add to Timeline\u201d in the Studio tab to start.';
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

    const themeDisplay = item.themeName
      ? (item.themeName.startsWith('user:')
          ? item.themeName.slice(5)
          : (BUILT_IN_THEME_LABELS[item.themeName] || item.themeName))
      : 'Default';

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
  // switchPanelTab('studio');
  showToast('Loaded to Studio');
}

async function rollSingleItem(id) {
  selectTimelineItem(id);
  await new Promise(r => setTimeout(r, 350));
  const item = timelineItems.find(i => i.id === id);
  if (item) roll(item.number);
}

function deleteItem(id) {
  timelineItems = timelineItems.filter(i => i.id !== id);
  if (editingItemId === id) closeEditForm();
  if (studioEditingItemId === id) { studioEditingItemId = null; updateStudioContext(); }
  persistWorkingTimeline();
  renderTimeline();
}

// ── Edit / add form ───────────────────────────────────────────────────────────
function openNewEntryForm() {
  editingItemId = null;
  formMods      = [];
  document.getElementById('tl-form-title').textContent = 'New Entry';
  document.getElementById('tl-form-label').value       = '';
  document.getElementById('tl-form-die').value         = 'd20';
  buildTlFormFacePicker('d20', 1);
  populateThemeSelect(document.getElementById('tl-form-theme'), 'bg3');
  renderFormMods();
  syncFormCardSliders(1.0, 132);
  CONFIG.dieType = 'd20';
  buildDie('d20');
  rebuildTextures();
  const theme = getThemeByKey('bg3');
  if (theme) applyTheme(theme);
  applyModCardStyles();
  setModifiers([]);
  renderModifierCards();
  rollState.current = 'idle';

  const form = document.getElementById('tl-item-form');
  form.style.display = '';
  document.getElementById('tl-add-entry-btn').style.display = 'none';
  document.getElementById('tl-items').classList.add('tl-items-locked');
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function openEditForm(id) {
  const item = timelineItems.find(i => i.id === id);
  if (!item) return;
  editingItemId = id;
  formMods      = item.modifiers.map(m => ({ ...m }));

  document.getElementById('tl-form-title').textContent = 'Edit Entry';
  document.getElementById('tl-form-label').value       = item.label || '';
  document.getElementById('tl-form-die').value         = item.dieType;

  buildTlFormFacePicker(item.dieType, item.number);
  populateThemeSelect(document.getElementById('tl-form-theme'), item.themeName);
  renderFormMods();
  syncFormCardSliders(item.cardScale ?? 1.0, item.cardsBottom ?? 132);

  const theme = getThemeByKey(item.themeName);
  if (theme) applyTheme(theme);
  applyModCardStyles();
  CONFIG.dieType = item.dieType;
  buildDie(item.dieType);
  rebuildTextures();
  setModifiers(formMods);
  renderModifierCards();
  rollState.current = 'idle';

  const form = document.getElementById('tl-item-form');
  form.style.display = '';
  document.getElementById('tl-add-entry-btn').style.display = 'none';
  document.getElementById('tl-items').classList.add('tl-items-locked');
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeEditForm() {
  const form = document.getElementById('tl-item-form');
  if (form) form.style.display = 'none';
  document.getElementById('tl-items').classList.remove('tl-items-locked');
  editingItemId = null;
  formMods      = [];
}

function renderFormMods() {
  const list = document.getElementById('tl-form-mods-list');
  if (!list) return;
  list.innerHTML = '';
  if (!formMods.length) {
    const empty = document.createElement('p');
    empty.className   = 'tl-empty';
    empty.textContent = 'No modifiers';
    empty.style.padding = '4px 0';
    list.appendChild(empty);
    return;
  }
  formMods.forEach((mod, idx) => {
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
      formMods.splice(idx, 1);
      setModifiers(formMods);
      renderModifierCards();
      renderFormMods();
    });
    list.appendChild(row);
  });
}

function submitItemForm() {
  const label       = document.getElementById('tl-form-label').value.trim();
  const dieType     = document.getElementById('tl-form-die').value;
  const themeName   = document.getElementById('tl-form-theme').value;
  const number      = tlFormSelectedNumber;
  const cardScale   = parseFloat(document.getElementById('tl-form-cardScale').value);
  const cardsBottom = parseInt(document.getElementById('tl-form-cardsBottom').value, 10);

  if (number < 1) return;

  if (editingItemId === null) {
    const newItem = {
      id:        nextItemId++,
      label:     label || `${dieType.toUpperCase()} Roll`,
      dieType, themeName, number,
      modifiers: formMods.map(m => ({ ...m })),
      cardScale, cardsBottom,
    };
    timelineItems.push(newItem);
    selectedItemId = newItem.id;
  } else {
    const item = timelineItems.find(i => i.id === editingItemId);
    if (item) {
      item.label       = label;
      item.dieType     = dieType;
      item.themeName   = themeName;
      item.number      = number;
      item.modifiers   = formMods.map(m => ({ ...m }));
      item.cardScale   = cardScale;
      item.cardsBottom = cardsBottom;
    }
  }
  closeEditForm();
  persistWorkingTimeline();
  renderTimeline();
}

function syncFormCardSliders(cardScale, cardsBottom) {
  const se = document.getElementById('tl-form-cardScale');
  const be = document.getElementById('tl-form-cardsBottom');
  const sv = document.getElementById('v-tl-form-cardScale');
  const bv = document.getElementById('v-tl-form-cardsBottom');
  const scale  = cardScale   ?? CONFIG.modCardScale  ?? 1.0;
  const bottom = cardsBottom ?? CONFIG.modCardsBottom ?? 132;
  if (se) se.value = scale;
  if (be) be.value = bottom;
  if (sv) sv.textContent = parseFloat(scale).toFixed(2);
  if (bv) bv.textContent = bottom + 'px';
  CONFIG.modCardScale   = parseFloat(scale);
  CONFIG.modCardsBottom = parseInt(bottom, 10);
}

// ── Face-number pickers ───────────────────────────────────────────────────────
let tlFormSelectedNumber = 1;

function buildTlFormFacePicker(dieType, selected) {
  const picker = document.getElementById('tl-form-face-picker');
  if (!picker) return;
  picker.innerHTML = '';
  const maxN = dieType === 'd10' ? 10 : (DIE_TYPES[dieType]?.faces || 20);
  tlFormSelectedNumber = Math.min(Math.max(selected || 1, 1), maxN);
  const cols = Math.ceil(maxN / 2);
  picker.style.display = 'grid';
  picker.style.gap = '4px';
  picker.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  picker.style.marginBottom = '8px';
  for (let i = 1; i <= maxN; i++) {
    const btn = document.createElement('button');
    btn.className = 'face-btn' + (i === tlFormSelectedNumber ? ' selected' : '');
    btn.textContent = i;
    btn.addEventListener('click', () => {
      tlFormSelectedNumber = i;
      picker.querySelectorAll('.face-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
    picker.appendChild(btn);
  }
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

    CONFIG.modCardScale   = item.cardScale   ?? 1.0;
    CONFIG.modCardsBottom = item.cardsBottom ?? 132;
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

async function waitForRollDone(timeoutMs = 25000) {
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
      timelineItems = t.items.map(item => ({ ...item }));
      nextItemId    = Math.max(0, ...timelineItems.map(i => i.id || 0)) + 1;
      persistWorkingTimeline();
      closeEditForm();
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

buildNumberGrid();
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
      && id !== 'c-dieType' && id !== 'c-modCardScale' && id !== 'c-modCardsBottom') {
    studioThemeDirty = true;
  }
});
document.getElementById('tab-studio').addEventListener('change', e => {
  const id = e.target.id;
  if (id && (id === 'c-font' || id === 'c-bold')) {
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
  btn.addEventListener('click', () => switchPanelTab(btn.dataset.tab));
});

// ── Die type (Studio) ─────────────────────────────────────────────────────────
document.getElementById('c-dieType').addEventListener('change', e => {
  const type = e.target.value;
  CONFIG.dieType = type;
  buildDie(type);
  rebuildTextures();
  rollState.current = 'idle';
  buildNumberGrid();
});

// ── Random button ─────────────────────────────────────────────────────────────
document.getElementById('randomBtn').addEventListener('click', () => {
  const labels = activeDieState.labels;
  const max    = labels.includes(0) ? 10 : labels.length;
  const n      = Math.ceil(Math.random() * max);
  pendingRandomHighlight = n;
  lastRolledNumber = null;
  buildNumberGrid();
  roll(n);
});

document.addEventListener('rollcomplete', e => {
  if (pendingRandomHighlight === null) return;
  if (e.detail?.result !== pendingRandomHighlight) return;
  lastRolledNumber = pendingRandomHighlight;
  pendingRandomHighlight = null;
  buildNumberGrid();
});

// ── Studio context ────────────────────────────────────────────────────────────
document.getElementById('studio-ctx-cancel').addEventListener('click', () => {
  studioEditingItemId = null;
  updateStudioContext();
  renderTimeline();
});
document.getElementById('studio-add-tl-btn').addEventListener('click', handleStudioAddToTimeline);

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
  saveTimeline(name, timelineItems);
  nameEl.value = '';
  renderSavedTimelines();
});
document.getElementById('tl-clear-btn').addEventListener('click', () => {
  if (timelineItems.length === 0) return;
  if (!confirm('Clear all timeline items?')) return;
  timelineItems = [];
  nextItemId    = 1;
  closeEditForm();
  if (studioEditingItemId !== null) { studioEditingItemId = null; updateStudioContext(); }
  persistWorkingTimeline();
  renderTimeline();
});
document.getElementById('tl-export-json').addEventListener('click', () => {
  if (!timelineItems.length) { alert('No items to export.'); return; }
  const blob = new Blob([JSON.stringify({ name: 'timeline', items: timelineItems }, null, 2)], { type: 'application/json' });
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
    const items = Array.isArray(data) ? data : (data.items || []);
    if (!items.length) { alert('No items found in file.'); return; }
    timelineItems = items.map(item => ({ ...item, id: nextItemId++ }));
    persistWorkingTimeline();
    closeEditForm();
    renderTimeline();
    switchPanelTab('timeline');
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
