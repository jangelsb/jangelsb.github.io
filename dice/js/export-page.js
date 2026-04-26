// export-page.js — Entry point for export.html.
// Current Setup is the shared staging area; "Add" snapshots it into the timeline.

import { roll, rollState } from './animation.js';
import { applyTheme, BUILT_IN_THEMES, loadUserThemes } from './themes.js';
import { CONFIG, DIE_TYPES } from './config.js';
import { buildDie, rebuildTextures, activeDieState } from './geometry.js';
import { setModifiers, modifierAnim } from './modifiers.js';
import { renderModifierCards } from './ui.js';
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Theme helpers ─────────────────────────────────────────────────────────────

function getThemeOptions() {
  const builtIn = Object.keys(BUILT_IN_THEMES).map(k => ({
    value: k, label: BUILT_IN_THEME_LABELS[k] || k,
  }));
  const user = loadUserThemes().map(t => ({ value: `user:${t.name}`, label: t.name }));
  return [...builtIn, ...user];
}

function getThemeByKey(key) {
  if (!key) return null;
  if (BUILT_IN_THEMES[key]) return BUILT_IN_THEMES[key];
  const name = key.startsWith('user:') ? key.slice(5) : key;
  return loadUserThemes().find(t => t.name === name) || null;
}

function populateThemeSelect(selectEl, selectedKey) {
  selectEl.innerHTML = '';
  getThemeOptions().forEach(({ value, label }) => {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    if (value === selectedKey) opt.selected = true;
    selectEl.appendChild(opt);
  });
}

// ── CSS custom-property helpers ───────────────────────────────────────────────
function hexWithAlpha(hex, alpha) {
  return hex + Math.round(alpha * 255).toString(16).padStart(2, '0');
}

function applyModCardStyles() {
  const r  = document.documentElement.style;
  const bd = CONFIG.modCardBorder          || '#c8a84a';
  const lb = CONFIG.modCardLabelColor      || '#c8a84a';
  const po = CONFIG.modifierPositiveColor  || '#f0c040';
  const ne = CONFIG.modifierNegativeColor  || '#e05050';
  r.setProperty('--mod-bg1',        (CONFIG.modCardBg1 || '#1a1830') + 'ee');
  r.setProperty('--mod-bg2',        (CONFIG.modCardBg2 || '#0c0c1e') + 'ee');
  r.setProperty('--mod-border',     bd);
  r.setProperty('--mod-bd-dim',     hexWithAlpha(bd, 0.133));
  r.setProperty('--mod-bd-mid',     hexWithAlpha(bd, 0.267));
  r.setProperty('--mod-bd-soft',    hexWithAlpha(bd, 0.400));
  r.setProperty('--mod-bd-shimmer', hexWithAlpha(bd, 0.533));
  r.setProperty('--mod-bd-glow',    hexWithAlpha(bd, 0.600));
  r.setProperty('--mod-label',      lb);
  r.setProperty('--mod-label-dim',  hexWithAlpha(lb, 0.667));
  r.setProperty('--mod-positive',   po);
  r.setProperty('--mod-pos-g1',     hexWithAlpha(po, 0.533));
  r.setProperty('--mod-pos-g2',     hexWithAlpha(po, 0.267));
  r.setProperty('--mod-negative',   ne);
  r.setProperty('--mod-neg-g1',     hexWithAlpha(ne, 0.533));
  r.setProperty('--mod-neg-g2',     hexWithAlpha(ne, 0.267));
  r.setProperty('--cards-bottom',   (CONFIG.modCardsBottom ?? 108) + 'px');
  r.setProperty('--card-scale',      CONFIG.modCardScale ?? 1.0);
}

// ── Current Setup state ───────────────────────────────────────────────────────
let qeMods = [];

function renderQeMods() {
  const container = document.getElementById('cs-mods');
  container.innerHTML = '';
  if (!qeMods.length) {
    const empty = document.createElement('p');
    empty.className   = 'tl-empty';
    empty.textContent = 'No modifiers';
    empty.style.padding = '6px 0';
    container.appendChild(empty);
    return;
  }
  qeMods.forEach((mod, idx) => {
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
      qeMods.splice(idx, 1);
      setModifiers(qeMods);
      renderModifierCards();
      renderQeMods();
    });
    container.appendChild(row);
  });
}

function syncFormCardSliders(cardScale, cardsBottom) {
  const se = document.getElementById('tl-form-cardScale');
  const be = document.getElementById('tl-form-cardsBottom');
  const sv = document.getElementById('v-tl-form-cardScale');
  const bv = document.getElementById('v-tl-form-cardsBottom');
  const scale  = cardScale  ?? CONFIG.modCardScale  ?? 1.0;
  const bottom = cardsBottom ?? CONFIG.modCardsBottom ?? 108;
  if (se) se.value = scale;
  if (be) be.value = bottom;
  if (sv) sv.textContent = parseFloat(scale).toFixed(2);
  if (bv) bv.textContent = bottom + 'px';
  CONFIG.modCardScale  = parseFloat(scale);
  CONFIG.modCardsBottom = parseInt(bottom, 10);
}

// ── Face number pickers (single-select) ────────────────────────────────────────────
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

// ── Timeline entry actions ────────────────────────────────────────────

function qeApplyToCanvas() {
  const type     = document.getElementById('ep-dieType').value;
  const themeKey = document.getElementById('ep-theme').value;
  CONFIG.dieType = type;
  buildDie(type);
  rebuildTextures();
  const theme = getThemeByKey(themeKey);
  if (theme) applyTheme(theme);
  applyModCardStyles();
  setModifiers(qeMods);
  renderModifierCards();
  rollState.current = 'idle';
  buildFacePicker();
}

function selectTimelineItem(id) {
  selectedItemId = id;
  document.querySelectorAll('.tl-item-row').forEach(r => {
    r.classList.toggle('tl-selected', r.dataset.id === String(id));
  });
  const item = timelineItems.find(i => i.id === id);
  if (!item) return;
  const theme = getThemeByKey(item.themeName);
  if (theme) applyTheme(theme);
  CONFIG.modCardScale   = item.cardScale  ?? 1.0;
  CONFIG.modCardsBottom = item.cardsBottom ?? 108;
  applyModCardStyles();
  CONFIG.dieType = item.dieType;
  buildDie(item.dieType);
  rebuildTextures();
  setModifiers(item.modifiers || []);
  renderModifierCards();
  rollState.current = 'idle';
}

async function rollSingleItem(id) {
  selectTimelineItem(id);
  await new Promise(r => setTimeout(r, 350));
  const item = timelineItems.find(i => i.id === id);
  if (item) roll(item.number);
}

function openNewEntryForm() {
  editingItemId = null;
  formMods      = [];
  document.getElementById('tl-form-title').textContent = 'New Entry';
  document.getElementById('tl-form-label').value       = '';
  document.getElementById('tl-form-die').value         = 'd20';
  buildTlFormFacePicker('d20', 1);
  populateThemeSelect(document.getElementById('tl-form-theme'), 'bg3');
  renderFormMods();
  syncFormCardSliders(1.0, 108);
  // Apply defaults to canvas
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
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ── Mode tabs ─────────────────────────────────────────────────────────────────
function switchMode(mode) {
  document.querySelectorAll('.mode-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  document.getElementById('exp-panel-timeline').style.display = mode === 'timeline' ? '' : 'none';
  document.getElementById('exp-panel-quick').style.display    = mode === 'quick'    ? '' : 'none';
  if (mode === 'quick') {
    qeApplyToCanvas();
  } else if (selectedItemId !== null) {
    selectTimelineItem(selectedItemId);
  }
}

// ── Timeline state (in-memory + auto-saved) ──────────────────────────────────
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
  container.innerHTML = '';

  if (timelineItems.length === 0) {
    const empty = document.createElement('p');
    empty.className   = 'tl-empty';
    empty.textContent = 'No entries yet — click "+ Add Entry" to start.';
    container.appendChild(empty);
    return;
  }

  timelineItems.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className  = 'tl-item-row' + (item.id === selectedItemId ? ' tl-selected' : '');
    row.dataset.id = item.id;

    const modsSummary = item.modifiers.length > 0
      ? item.modifiers.map(m => `${m.label} ${m.value >= 0 ? '+' : ''}${m.value}`).join(', ')
      : '—';

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
        <button class="tl-btn tl-btn-play" title="Roll">&#9654;</button>
        <button class="tl-btn tl-btn-up"   title="Move up"   ${idx === 0 ? 'disabled' : ''}>&#9650;</button>
        <button class="tl-btn tl-btn-down" title="Move down" ${idx === timelineItems.length - 1 ? 'disabled' : ''}>&#9660;</button>
        <button class="tl-btn tl-btn-edit" title="Edit">&#9998;</button>
        <button class="tl-btn tl-btn-del"  title="Remove">&#10005;</button>
      </div>
    `;

    row.querySelector('.tl-item-num').addEventListener('click',  () => selectTimelineItem(item.id));
    row.querySelector('.tl-item-info').addEventListener('click', () => selectTimelineItem(item.id));
    row.querySelector('.tl-btn-play').addEventListener('click',  () => rollSingleItem(item.id));
    row.querySelector('.tl-btn-up').addEventListener('click',    () => moveItem(item.id, -1));
    row.querySelector('.tl-btn-down').addEventListener('click',  () => moveItem(item.id,  1));
    row.querySelector('.tl-btn-edit').addEventListener('click',  () => openEditForm(item.id));
    row.querySelector('.tl-btn-del').addEventListener('click',   () => deleteItem(item.id));

    container.appendChild(row);
  });
}

function moveItem(id, dir) {
  const idx = timelineItems.findIndex(i => i.id === id);
  if (idx < 0) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= timelineItems.length) return;
  [timelineItems[idx], timelineItems[newIdx]] = [timelineItems[newIdx], timelineItems[idx]];
  persistWorkingTimeline();
  renderTimeline();
}

function deleteItem(id) {
  timelineItems = timelineItems.filter(i => i.id !== id);
  if (editingItemId === id) closeEditForm();
  persistWorkingTimeline();
  renderTimeline();
}

// ── Edit form ─────────────────────────────────────────────────────────────────

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
  syncFormCardSliders(item.cardScale ?? 1.0, item.cardsBottom ?? 108);

  // Apply item to canvas live
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
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeEditForm() {
  document.getElementById('tl-item-form').style.display = 'none';
  document.getElementById('tl-add-entry-btn').style.display = '';
  editingItemId = null;
  formMods      = [];
}

function renderFormMods() {
  const list = document.getElementById('tl-form-mods-list');
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
  const label      = document.getElementById('tl-form-label').value.trim();
  const dieType    = document.getElementById('tl-form-die').value;
  const themeName  = document.getElementById('tl-form-theme').value;
  const number     = tlFormSelectedNumber;
  const cardScale  = parseFloat(document.getElementById('tl-form-cardScale').value);
  const cardsBottom = parseInt(document.getElementById('tl-form-cardsBottom').value, 10);

  if (number < 1) return;

  if (editingItemId === null) {
    const newItem = {
      id:        nextItemId++,
      label:     label || `${dieType.toUpperCase()} Roll`,
      dieType,
      themeName,
      number,
      modifiers: formMods.map(m => ({ ...m })),
      cardScale,
      cardsBottom,
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

// ── Preview playback ──────────────────────────────────────────────────────────
let previewCancelled = false;
let previewRunning   = false;

async function previewTimeline() {
  if (previewRunning) { stopPreview(); return; }
  if (timelineItems.length === 0) { alert('Add at least one item to preview.'); return; }

  previewCancelled = false;
  previewRunning   = true;
  const btn = document.getElementById('tl-preview-btn');
  btn.textContent = '⏹ Stop';

  for (let i = 0; i < timelineItems.length; i++) {
    if (previewCancelled) break;
    const item = timelineItems[i];

    // Highlight active item
    document.querySelectorAll('.tl-item-row').forEach(r => r.classList.remove('tl-active'));
    const activeRow = document.querySelector(`.tl-item-row[data-id="${item.id}"]`);
    if (activeRow) {
      activeRow.classList.add('tl-active');
      activeRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Apply theme
    const theme = getThemeByKey(item.themeName);
    if (theme) applyTheme(theme);

    CONFIG.modCardScale   = item.cardScale  ?? 1.0;
    CONFIG.modCardsBottom = item.cardsBottom ?? 108;
    applyModCardStyles();

    // Apply die type
    CONFIG.dieType = item.dieType;
    buildDie(item.dieType);
    rebuildTextures();

    // Apply modifiers
    setModifiers(item.modifiers || []);
    renderModifierCards();

    // Allow die to settle before rolling
    rollState.current = 'idle';
    await new Promise(r => setTimeout(r, 350));
    if (previewCancelled) break;

    // Roll
    roll(item.number);

    // Two-phase wait: first for roll to start, then for it to finish
    await waitForRollDone();
    if (previewCancelled) break;

    // Hold before next item
    const holdMs = Math.round(parseFloat(document.getElementById('exp-hold').value || '0.6') * 1000);
    await new Promise(r => setTimeout(r, holdMs + 300));
  }

  document.querySelectorAll('.tl-item-row').forEach(r => r.classList.remove('tl-active'));
  previewRunning   = false;
  btn.textContent = '▶ Preview';
}

function stopPreview() {
  previewCancelled = true;
  document.getElementById('tl-preview-btn').textContent = 'Stopping\u2026';
}

async function waitForRollDone(timeoutMs = 25000) {
  // Phase 1: wait for roll to START (state leaves 'idle')
  await new Promise(resolve => {
    const deadline = Date.now() + 1000;
    (function waitStart() {
      if (rollState.current !== 'idle' || previewCancelled || Date.now() > deadline) return resolve();
      requestAnimationFrame(waitStart);
    })();
  });
  // Phase 2: wait for roll to FINISH (reach 'done')
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
      switchMode('timeline');
    });

    const del = document.createElement('span');
    del.className   = 'pill-del';
    del.textContent = '✕';
    del.addEventListener('click', () => {
      deleteTimeline(t.name);
      renderSavedTimelines();
    });

    pill.appendChild(label);
    pill.appendChild(del);
    container.appendChild(pill);
  });
}

// ── Quick export — face picker ────────────────────────────────────────────────
function buildFacePicker() {
  const picker = document.getElementById('facePicker');
  picker.innerHTML = '';
  const labels = activeDieState.labels;
  const max    = labels.includes(0) ? 10 : labels.length;
  const cols   = Math.ceil(max / 2);
  picker.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;

  // Reset exportNumbers to match current die
  exportNumbers.clear();
  for (let i = 1; i <= max; i++) exportNumbers.add(i);

  for (let i = 1; i <= max; i++) {
    const btn     = document.createElement('button');
    btn.className = 'face-btn selected';
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
  const n = exportNumbers.size;
  document.getElementById('exportBtn').textContent =
    n === 0   ? '⬇ Export (select numbers)' :
    n === max  ? `⬇ Export All ${max} Videos` :
                 `⬇ Export ${n} Video${n > 1 ? 's' : ''}`;
}

// ── Export settings parser ────────────────────────────────────────────────────
function getExportSettings() {
  const resMul   = parseInt(document.getElementById('exp-res').value, 10);
  const bgKey    = document.getElementById('exp-bg').value;
  const bitrate  = parseInt(document.getElementById('exp-bitrate').value, 10);
  const leadInMs = Math.round(parseFloat(document.getElementById('exp-leadin').value) * 1000);
  const holdMs   = Math.round(parseFloat(document.getElementById('exp-hold').value) * 1000);
  const bgColor  = { chroma: '#00FF00', magenta: '#FF00FF', black: '#000000', current: CONFIG.bgColor }[bgKey];
  return { resMul, bgColor, bitrate, leadInMs, holdMs };
}

// ── Init ──────────────────────────────────────────────────────────────────────
applyTheme(BUILT_IN_THEMES.bg3);
applyModCardStyles();

populateThemeSelect(document.getElementById('ep-theme'),      'bg3');
populateThemeSelect(document.getElementById('tl-form-theme'), 'bg3');

// Re-apply card styles when a theme is applied
document.addEventListener('themeapplied', () => {
  applyModCardStyles();
});

// Panel toggle
const toggle = document.getElementById('settingsToggle');
const panel  = document.getElementById('settingsPanel');
toggle.addEventListener('click', () => {
  toggle.classList.toggle('open');
  panel.classList.toggle('open');
});

// Mode tabs
document.querySelectorAll('.mode-tab').forEach(btn => {
  btn.addEventListener('click', () => switchMode(btn.dataset.mode));
});

// Quick Export: die type
document.getElementById('ep-dieType').addEventListener('change', e => {
  const type = e.target.value;
  CONFIG.dieType = type;
  buildDie(type);
  rebuildTextures();
  rollState.current = 'idle';
  buildFacePicker();
});

// Quick Export: theme
document.getElementById('ep-theme').addEventListener('change', e => {
  const theme = getThemeByKey(e.target.value);
  if (theme) applyTheme(theme);
});

// Quick Export: add modifier
document.getElementById('cs-mod-add').addEventListener('click', () => {
  const labelEl = document.getElementById('cs-mod-label');
  const valueEl = document.getElementById('cs-mod-value');
  const label   = labelEl.value.trim() || 'MOD';
  const value   = parseInt(valueEl.value, 10);
  if (isNaN(value)) return;
  qeMods.push({ label, value });
  setModifiers(qeMods);
  renderModifierCards();
  renderQeMods();
  labelEl.value = '';
  valueEl.value = '';
  labelEl.focus();
});
document.getElementById('cs-mod-value').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('cs-mod-add').click();
});

// Entry form: card sliders → live preview
document.getElementById('tl-form-cardScale').addEventListener('input', e => {
  CONFIG.modCardScale = parseFloat(e.target.value);
  document.getElementById('v-tl-form-cardScale').textContent = parseFloat(e.target.value).toFixed(2);
  applyModCardStyles();
});
document.getElementById('tl-form-cardsBottom').addEventListener('input', e => {
  CONFIG.modCardsBottom = parseInt(e.target.value, 10);
  document.getElementById('v-tl-form-cardsBottom').textContent = e.target.value + 'px';
  applyModCardStyles();
});

// Edit/Add form: die type change → rebuild face picker + live canvas
document.getElementById('tl-form-die').addEventListener('change', e => {
  const type = e.target.value;
  buildTlFormFacePicker(type, tlFormSelectedNumber);
  CONFIG.dieType = type;
  buildDie(type);
  rebuildTextures();
  rollState.current = 'idle';
});

// Edit/Add form: theme change → live canvas
document.getElementById('tl-form-theme').addEventListener('change', e => {
  const theme = getThemeByKey(e.target.value);
  if (theme) applyTheme(theme);
});

// Edit form: add modifier
document.getElementById('tl-form-mod-add').addEventListener('click', () => {
  const labelEl = document.getElementById('tl-form-mod-label');
  const valueEl = document.getElementById('tl-form-mod-value');
  const label   = labelEl.value.trim() || 'MOD';
  const value   = parseInt(valueEl.value, 10);
  if (isNaN(value)) return;
  formMods.push({ label, value });
  setModifiers(formMods);
  renderModifierCards();
  renderFormMods();
  labelEl.value = '';
  valueEl.value = '';
  labelEl.focus();
});
document.getElementById('tl-form-mod-value').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('tl-form-mod-add').click();
});

// Edit form: save / cancel
document.getElementById('tl-form-save').addEventListener('click', submitItemForm);
document.getElementById('tl-form-cancel').addEventListener('click', () => {
  closeEditForm();
  renderTimeline();
});

// Timeline: add new entry
document.getElementById('tl-add-entry-btn').addEventListener('click', openNewEntryForm);

// Timeline: preview & export
document.getElementById('tl-preview-btn').onclick = previewTimeline;
document.getElementById('tl-export-btn').addEventListener('click', async () => {
  if (timelineItems.length === 0) { alert('Add at least one item to export.'); return; }
  await exportTimelineItems(timelineItems, getExportSettings());
});


// Saved timelines
document.getElementById('tl-save-btn').addEventListener('click', () => {
  const nameEl = document.getElementById('tl-save-name');
  const name   = nameEl.value.trim();
  if (!name) return;
  if (!timelineItems.length) { alert('Add at least one item before saving.'); return; }
  saveTimeline(name, timelineItems);
  nameEl.value = '';
  renderSavedTimelines();
});

// Clear timeline
document.getElementById('tl-clear-btn').addEventListener('click', () => {
  if (timelineItems.length === 0) return;
  if (!confirm('Clear all timeline items?')) return;
  timelineItems = [];
  nextItemId = 1;
  closeEditForm();
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
    switchMode('timeline');
    e.target.value = '';
  };
  reader.readAsText(file);
});

// Quick export: picker controls
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
document.getElementById('exportBtn').addEventListener('click', generateAllWebMs);

// Export cancel
initExportCancelBtn();

// Export settings: lead-in / hold slider labels
['leadin', 'hold'].forEach(id => {
  const slider = document.getElementById(`exp-${id}`);
  const label  = document.getElementById(`exp-${id}-val`);
  slider.addEventListener('input', () => {
    label.textContent = parseFloat(slider.value).toFixed(1) + 's';
  });
});

// Resize handler
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  const ov = document.getElementById('mod-overlay-canvas');
  if (ov) { ov.width = window.innerWidth; ov.height = window.innerHeight; }
});

// Wire "Visible in export" checkboxes as live preview controls
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

// Initial renders
renderTimeline();
renderSavedTimelines();
buildFacePicker();
renderQeMods();
