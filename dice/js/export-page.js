// export-page.js — Entry point for export.html.
// Current Setup is the shared staging area; "Add" snapshots it into the timeline.

import { roll, rollState } from './animation.js';
import { applyTheme, BUILT_IN_THEMES, loadUserThemes } from './themes.js';
import { CONFIG, DIE_TYPES } from './config.js';
import { buildDie, rebuildTextures, activeDieState } from './geometry.js';
import { setModifiers } from './modifiers.js';
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
let currentMods = [];

function renderCurrentMods() {
  const container = document.getElementById('cs-mods');
  container.innerHTML = '';
  if (!currentMods.length) {
    const empty = document.createElement('p');
    empty.className   = 'tl-empty';
    empty.textContent = 'No modifiers';
    empty.style.padding = '6px 0';
    container.appendChild(empty);
    return;
  }
  currentMods.forEach((mod, idx) => {
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
      currentMods.splice(idx, 1);
      setModifiers(currentMods);
      renderCurrentMods();
    });
    container.appendChild(row);
  });
}

function syncCsCardSliders() {
  const se = document.getElementById('cs-cardScale');
  const be = document.getElementById('cs-cardsBottom');
  const sv = document.getElementById('v-cs-cardScale');
  const bv = document.getElementById('v-cs-cardsBottom');
  if (se) se.value = CONFIG.modCardScale  ?? 1.0;
  if (be) be.value = CONFIG.modCardsBottom ?? 108;
  if (sv) sv.textContent = (CONFIG.modCardScale  ?? 1.0).toFixed(2);
  if (bv) bv.textContent = (CONFIG.modCardsBottom ?? 108) + 'px';
}

function addCurrentSetupToTimeline() {
  const label  = document.getElementById('cs-entry-label').value.trim();
  const number = parseInt(document.getElementById('cs-entry-number').value, 10);
  if (isNaN(number) || number < 1) { alert('Enter a valid roll number.'); return; }
  const dieType   = document.getElementById('ep-dieType').value;
  const themeName = document.getElementById('ep-theme').value;
  timelineItems.push({
    id:             nextItemId++,
    label:          label || `${dieType.toUpperCase()} Roll`,
    dieType,
    themeName,
    modifiers:      currentMods.map(m => ({ ...m })),
    number,
    modCardScale:   CONFIG.modCardScale   ?? 1.0,
    modCardsBottom: CONFIG.modCardsBottom ?? 108,
  });
  document.getElementById('cs-entry-label').value  = '';
  document.getElementById('cs-entry-number').value = '1';
  renderTimeline();
  if (document.getElementById('exp-panel-timeline').style.display === 'none') switchMode('timeline');
}

// ── Mode tabs ─────────────────────────────────────────────────────────────────
function switchMode(mode) {
  document.querySelectorAll('.mode-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });
  document.getElementById('exp-panel-timeline').style.display = mode === 'timeline' ? '' : 'none';
  document.getElementById('exp-panel-quick').style.display    = mode === 'quick'    ? '' : 'none';
}

// ── Timeline state (in-memory) ────────────────────────────────────────────────
let timelineItems = [];
let nextItemId    = 1;
let editingItemId = null;
let formMods      = [];

// ── Timeline rendering ────────────────────────────────────────────────────────
function renderTimeline() {
  const container = document.getElementById('tl-items');
  const form      = document.getElementById('tl-item-form');
  container.innerHTML = '';

  if (timelineItems.length === 0) {
    const empty = document.createElement('p');
    empty.className   = 'tl-empty';
    empty.textContent = 'No items yet — configure Current Setup and click "+ Add".';
    container.appendChild(empty);
    container.appendChild(form);
    return;
  }

  timelineItems.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className  = 'tl-item-row';
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
        <button class="tl-btn tl-btn-up"   title="Move up"   ${idx === 0 ? 'disabled' : ''}>&#9650;</button>
        <button class="tl-btn tl-btn-down" title="Move down" ${idx === timelineItems.length - 1 ? 'disabled' : ''}>&#9660;</button>
        <button class="tl-btn tl-btn-edit" title="Edit">&#9998;</button>
        <button class="tl-btn tl-btn-del"  title="Remove">&#10005;</button>
      </div>
    `;

    row.querySelector('.tl-btn-up').addEventListener('click',   () => moveItem(item.id, -1));
    row.querySelector('.tl-btn-down').addEventListener('click', () => moveItem(item.id,  1));
    row.querySelector('.tl-btn-edit').addEventListener('click', () => openEditForm(item.id));
    row.querySelector('.tl-btn-del').addEventListener('click',  () => deleteItem(item.id));

    container.appendChild(row);
  });

  container.appendChild(form);
}

function moveItem(id, dir) {
  const idx = timelineItems.findIndex(i => i.id === id);
  if (idx < 0) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= timelineItems.length) return;
  [timelineItems[idx], timelineItems[newIdx]] = [timelineItems[newIdx], timelineItems[idx]];
  renderTimeline();
}

function deleteItem(id) {
  timelineItems = timelineItems.filter(i => i.id !== id);
  if (editingItemId === id) closeEditForm();
  renderTimeline();
}

// ── Edit form ─────────────────────────────────────────────────────────────────

function openEditForm(id) {
  const item = timelineItems.find(i => i.id === id);
  if (!item) return;
  editingItemId = id;
  formMods      = item.modifiers.map(m => ({ ...m }));

  document.getElementById('tl-form-title').textContent = 'Edit Item';
  document.getElementById('tl-form-label').value       = item.label || '';
  document.getElementById('tl-form-die').value         = item.dieType;

  const maxN  = item.dieType === 'd10' ? 10 : (DIE_TYPES[item.dieType]?.faces || 20);
  const numEl = document.getElementById('tl-form-number');
  numEl.max   = String(maxN);
  numEl.value = String(item.number);

  const cardScale   = item.modCardScale   ?? (CONFIG.modCardScale   ?? 1.0);
  const cardsBottom = item.modCardsBottom ?? (CONFIG.modCardsBottom ?? 108);
  const scaleEl  = document.getElementById('tl-form-cardScale');
  const bottomEl = document.getElementById('tl-form-cardsBottom');
  scaleEl.value  = cardScale;
  bottomEl.value = cardsBottom;
  document.getElementById('v-tl-cardScale').textContent   = cardScale.toFixed(2);
  document.getElementById('v-tl-cardsBottom').textContent = cardsBottom + 'px';

  populateThemeSelect(document.getElementById('tl-form-theme'), item.themeName);
  renderFormMods();

  const form = document.getElementById('tl-item-form');
  form.style.display = '';
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeEditForm() {
  document.getElementById('tl-item-form').style.display = 'none';
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
      renderFormMods();
    });
    list.appendChild(row);
  });
}

function submitItemForm() {
  const label          = document.getElementById('tl-form-label').value.trim();
  const dieType        = document.getElementById('tl-form-die').value;
  const themeName      = document.getElementById('tl-form-theme').value;
  const number         = parseInt(document.getElementById('tl-form-number').value, 10);
  const modCardScale   = parseFloat(document.getElementById('tl-form-cardScale').value);
  const modCardsBottom = parseInt(document.getElementById('tl-form-cardsBottom').value, 10);

  if (isNaN(number) || number < 1) { alert('Enter a valid roll number.'); return; }

  const item = timelineItems.find(i => i.id === editingItemId);
  if (item) {
    item.label          = label;
    item.dieType        = dieType;
    item.themeName      = themeName;
    item.number         = number;
    item.modifiers      = formMods.map(m => ({ ...m }));
    item.modCardScale   = modCardScale;
    item.modCardsBottom = modCardsBottom;
  }

  closeEditForm();
  renderTimeline();
}

// ── Preview playback ──────────────────────────────────────────────────────────
let previewCancelled = false;

async function previewTimeline() {
  if (timelineItems.length === 0) { alert('Add at least one item to preview.'); return; }

  previewCancelled = false;
  const btn = document.getElementById('tl-preview-btn');
  btn.textContent = '⏹ Stop';
  btn.onclick     = stopPreview;

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

    // Apply card overrides (after theme sets defaults)
    if (item.modCardScale   !== undefined) CONFIG.modCardScale   = item.modCardScale;
    if (item.modCardsBottom !== undefined) CONFIG.modCardsBottom = item.modCardsBottom;
    applyModCardStyles();

    // Apply die type
    CONFIG.dieType = item.dieType;
    buildDie(item.dieType);
    rebuildTextures();

    // Apply modifiers
    setModifiers(item.modifiers || []);

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
  btn.textContent = '▶ Preview';
  btn.onclick     = previewTimeline;
}

function stopPreview() {
  previewCancelled = true;
  const btn = document.getElementById('tl-preview-btn');
  btn.textContent = '▶ Preview';
  btn.onclick     = previewTimeline;
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

    const label = document.createElement('span');
    label.className   = 'pill-label';
    label.textContent = t.name;
    label.addEventListener('click', () => {
      timelineItems = t.items.map(item => ({ ...item }));
      nextItemId    = Math.max(0, ...timelineItems.map(i => i.id)) + 1;
      renderTimeline();
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
  syncCsCardSliders();
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

// Current Setup: die type
document.getElementById('ep-dieType').addEventListener('change', e => {
  const type = e.target.value;
  CONFIG.dieType = type;
  buildDie(type);
  rebuildTextures();
  rollState.current = 'idle';
  buildFacePicker();
  const maxN  = type === 'd10' ? 10 : (DIE_TYPES[type]?.faces || 20);
  const numEl = document.getElementById('cs-entry-number');
  numEl.max   = String(maxN);
  if (parseInt(numEl.value, 10) > maxN) numEl.value = '1';
});

// Current Setup: theme
document.getElementById('ep-theme').addEventListener('change', e => {
  const theme = getThemeByKey(e.target.value);
  if (theme) applyTheme(theme);
});

// Current Setup: add modifier
document.getElementById('cs-mod-add').addEventListener('click', () => {
  const labelEl = document.getElementById('cs-mod-label');
  const valueEl = document.getElementById('cs-mod-value');
  const label   = labelEl.value.trim() || 'Modifier';
  const value   = parseInt(valueEl.value, 10);
  if (isNaN(value)) return;
  currentMods.push({ label, value });
  setModifiers(currentMods);
  renderCurrentMods();
  labelEl.value = '';
  valueEl.value = '';
  labelEl.focus();
});
document.getElementById('cs-mod-value').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('cs-mod-add').click();
});

// Current Setup: card sliders
document.getElementById('cs-cardScale').addEventListener('input', e => {
  CONFIG.modCardScale = parseFloat(e.target.value);
  document.getElementById('v-cs-cardScale').textContent = parseFloat(e.target.value).toFixed(2);
  applyModCardStyles();
});
document.getElementById('cs-cardsBottom').addEventListener('input', e => {
  CONFIG.modCardsBottom = parseInt(e.target.value, 10);
  document.getElementById('v-cs-cardsBottom').textContent = e.target.value + 'px';
  applyModCardStyles();
});

// Current Setup: add to timeline
document.getElementById('cs-add-to-tl').addEventListener('click', addCurrentSetupToTimeline);
document.getElementById('cs-entry-number').addEventListener('keydown', e => {
  if (e.key === 'Enter') addCurrentSetupToTimeline();
});

// Edit form: die type change → update number max
document.getElementById('tl-form-die').addEventListener('change', e => {
  const dt    = e.target.value;
  const maxN  = dt === 'd10' ? 10 : (DIE_TYPES[dt]?.faces || 20);
  const numEl = document.getElementById('tl-form-number');
  numEl.max   = String(maxN);
  if (parseInt(numEl.value, 10) > maxN) numEl.value = '1';
});

// Edit form: card sliders
document.getElementById('tl-form-cardScale').addEventListener('input', e => {
  document.getElementById('v-tl-cardScale').textContent = parseFloat(e.target.value).toFixed(2);
});
document.getElementById('tl-form-cardsBottom').addEventListener('input', e => {
  document.getElementById('v-tl-cardsBottom').textContent = e.target.value + 'px';
});

// Edit form: add modifier
document.getElementById('tl-form-mod-add').addEventListener('click', () => {
  const labelEl = document.getElementById('tl-form-mod-label');
  const valueEl = document.getElementById('tl-form-mod-value');
  const label   = labelEl.value.trim() || 'Modifier';
  const value   = parseInt(valueEl.value, 10);
  if (isNaN(value)) return;
  formMods.push({ label, value });
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

// Timeline: preview & export
document.getElementById('tl-preview-btn').addEventListener('click', previewTimeline);
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
    renderTimeline();
    e.target.value = '';
  };
  reader.readAsText(file);
});

// Quick export: picker controls
document.getElementById('pickAll').addEventListener('click', () => {
  const labels = activeDieState.labels;
  const max    = labels.includes(0) ? 10 : labels.length;
  for (let i = 1; i <= max; i++) exportNumbers.add(i);
  document.querySelectorAll('.face-btn').forEach(b => b.classList.add('selected'));
  updateExportBtnLabel();
});
document.getElementById('pickNone').addEventListener('click', () => {
  exportNumbers.clear();
  document.querySelectorAll('.face-btn').forEach(b => b.classList.remove('selected'));
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

// Initial renders
renderTimeline();
renderSavedTimelines();
buildFacePicker();
