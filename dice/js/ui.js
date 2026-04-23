import { CONFIG, DEFAULTS } from './config.js';
import { renderer, camera } from './scene.js';
import { dice, rebuildTextures } from './geometry.js';
import { roll } from './animation.js';
import { BUILT_IN_THEMES, applyTheme, loadUserThemes, saveUserTheme, renderUserThemes } from './themes.js';
import { generateAllWebMs, exportNumbers, initExportCancelBtn } from './export.js';
import { addModifier, removeModifier, getModifiers } from './modifiers.js';

// ── CSS custom-property helpers ───────────────────────────────────────────────
function hexWithAlpha(hex, alpha) {
  return hex + Math.round(alpha * 255).toString(16).padStart(2, '0');
}

function applyModCardStyles() {
  const r   = document.documentElement.style;
  const bd  = CONFIG.modCardBorder;
  const lb  = CONFIG.modCardLabelColor;
  const pos = CONFIG.modifierPositiveColor;
  const neg = CONFIG.modifierNegativeColor;
  r.setProperty('--mod-bg1',        CONFIG.modCardBg1 + 'ee');
  r.setProperty('--mod-bg2',        CONFIG.modCardBg2 + 'ee');
  r.setProperty('--mod-border',     bd);
  r.setProperty('--mod-bd-dim',     hexWithAlpha(bd, 0.133));
  r.setProperty('--mod-bd-mid',     hexWithAlpha(bd, 0.267));
  r.setProperty('--mod-bd-soft',    hexWithAlpha(bd, 0.400));
  r.setProperty('--mod-bd-shimmer', hexWithAlpha(bd, 0.533));
  r.setProperty('--mod-bd-glow',    hexWithAlpha(bd, 0.600));
  r.setProperty('--mod-label',      lb);
  r.setProperty('--mod-label-dim',  hexWithAlpha(lb, 0.667));
  r.setProperty('--mod-positive',   pos);
  r.setProperty('--mod-pos-g1',     hexWithAlpha(pos, 0.533));
  r.setProperty('--mod-pos-g2',     hexWithAlpha(pos, 0.267));
  r.setProperty('--mod-negative',   neg);
  r.setProperty('--mod-neg-g1',     hexWithAlpha(neg, 0.533));
  r.setProperty('--mod-neg-g2',     hexWithAlpha(neg, 0.267));
  r.setProperty('--cards-bottom',   (CONFIG.modCardsBottom ?? 108) + 'px');
  r.setProperty('--card-scale',      (CONFIG.modCardScale  ?? 1.0));
}

// ── Sync all settings panel inputs from the current CONFIG values ─────────────
function syncInputsFromConfig() {
  document.getElementById('c-faceTop').value  = CONFIG.faceColorTop;
  document.getElementById('c-faceBot').value  = CONFIG.faceColorBottom;
  document.getElementById('c-border').value   = CONFIG.borderColor;
  document.getElementById('c-bg').value       = CONFIG.bgColor;
  document.getElementById('c-numColor').value = CONFIG.numberColor;
  document.getElementById('c-numGlow').value  = CONFIG.glowColor;
  document.getElementById('c-font').value     = CONFIG.fontFamily;
  document.getElementById('c-bold').checked   = CONFIG.fontBold;
  document.getElementById('c-size').value     = CONFIG.dieScale;
  document.getElementById('c-shine').value    = CONFIG.shininess;
  document.getElementById('c-tumble').value   = CONFIG.tumbleDur;
  document.getElementById('c-settle').value   = CONFIG.settleDur;
  document.getElementById('c-spinMin').value  = CONFIG.spinMin;
  document.getElementById('c-chaos').value    = CONFIG.chaosMag;
  document.getElementById('c-decay').value    = CONFIG.decayRate;

  document.getElementById('v-size').textContent    = CONFIG.dieScale.toFixed(2);
  document.getElementById('v-shine').textContent   = CONFIG.shininess;
  document.getElementById('v-tumble').textContent  = CONFIG.tumbleDur.toFixed(1) + 's';
  document.getElementById('v-settle').textContent  = CONFIG.settleDur.toFixed(2) + 's';
  document.getElementById('v-spinMin').textContent = CONFIG.spinMin.toFixed(1);
  document.getElementById('v-chaos').textContent   = Math.round(CONFIG.chaosMag * 100) + '%';
  document.getElementById('v-decay').textContent   = CONFIG.decayRate.toFixed(1);

  document.getElementById('c-modPos').value      = CONFIG.modifierPositiveColor;
  document.getElementById('c-modNeg').value      = CONFIG.modifierNegativeColor;
  document.getElementById('c-modParticle').value = CONFIG.modifierParticleColor;
  document.getElementById('c-modImpact').value   = CONFIG.modifierImpactColor;
  document.getElementById('c-modCardBg1').value    = CONFIG.modCardBg1;
  document.getElementById('c-modCardBg2').value    = CONFIG.modCardBg2;
  document.getElementById('c-modCardBorder').value = CONFIG.modCardBorder;
  document.getElementById('c-modCardLabel').value  = CONFIG.modCardLabelColor;
  document.getElementById('c-modCardScale').value  = CONFIG.modCardScale  ?? 1.0;
  document.getElementById('v-modCardScale').textContent = (CONFIG.modCardScale ?? 1.0).toFixed(2);
  document.getElementById('c-modCardsBottom').value = CONFIG.modCardsBottom ?? 108;
  document.getElementById('v-modCardsBottom').textContent = (CONFIG.modCardsBottom ?? 108) + 'px';
  applyModCardStyles();
}

// Binds a settings input to a CONFIG key, with optional transform and side-effect.
function bind(id, configKey, transform, callback) {
  document.getElementById(id).addEventListener('input', e => {
    CONFIG[configKey] = transform ? transform(e.target.value) : e.target.value;
    if (callback) callback(e.target.value);
    rebuildTextures();
  });
}

// Keeps a value-display span in sync with its range slider.
function bindVal(sliderId, valId, suffix = '') {
  const slider = document.getElementById(sliderId);
  const disp   = document.getElementById(valId);
  slider.addEventListener('input', () => {
    const dp = suffix === 's' ? 2 : sliderId === 'c-size' ? 2 : 1;
    disp.textContent = parseFloat(slider.value).toFixed(dp) + suffix;
  });
}

function updateExportBtnLabel() {
  const n = exportNumbers.size;
  document.getElementById('exportBtn').textContent =
    n === 0  ? '\u2b07 Export (select numbers)' :
    n === 20 ? '\u2b07 Export All 20 Videos' :
               `\u2b07 Export ${n} Video${n > 1 ? 's' : ''}`;
}

// ── Modifier card rendering ───────────────────────────────────────────────────
export function renderModifierCards() {
  const container = document.getElementById('mod-cards');
  if (!container) return;
  container.innerHTML = '';
  getModifiers().forEach(mod => {
    const card = document.createElement('div');
    card.className = 'mod-card';
    card.dataset.id = mod.id;

    const isPos = mod.value >= 0;
    const valueStr = (isPos ? '+' : '') + mod.value;
    const colorClass = isPos ? 'positive' : 'negative';

    card.innerHTML = `
      <span class="mod-label">${escapeHtml(mod.label)}</span>
      <span class="mod-value ${colorClass}">${valueStr}</span>
      <button class="mod-remove" title="Remove">✕</button>
    `;
    card.querySelector('.mod-remove').addEventListener('click', () => {
      removeModifier(mod.id);
      renderModifierCards();
    });
    container.appendChild(card);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function addModifierFromInputs() {
  const labelEl = document.getElementById('mod-label-input');
  const valueEl = document.getElementById('mod-value-input');
  const label   = labelEl.value.trim() || 'Modifier';
  const value   = parseInt(valueEl.value, 10);
  if (isNaN(value)) return;
  addModifier(label, value);
  renderModifierCards();
  labelEl.value = '';
  valueEl.value = '';
}

// ── initUI — call once from main.js ───────────────────────────────────────────
export function initUI() {

  // Roll buttons
  document.getElementById('rollBtn').addEventListener('click', () => {
    roll(parseInt(document.getElementById('rollInput').value, 10));
  });
  document.getElementById('randomBtn').addEventListener('click', () => {
    const n = Math.ceil(Math.random() * 20);
    document.getElementById('rollInput').value = n;
    roll(n);
  });
  document.getElementById('rollInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') roll(parseInt(e.target.value, 10));
  });

  // Settings panel toggle
  const toggle = document.getElementById('settingsToggle');
  const panel  = document.getElementById('settingsPanel');
  toggle.addEventListener('click', () => {
    toggle.classList.toggle('open');
    panel.classList.toggle('open');
  });

  // Color pickers
  bind('c-faceTop',  'faceColorTop');
  bind('c-faceBot',  'faceColorBottom');
  bind('c-border',   'borderColor');
  bind('c-bg',       'bgColor', null, v => { document.body.style.background = v; });
  bind('c-numColor', 'numberColor');
  bind('c-numGlow',  'glowColor');

  // Font
  bind('c-font', 'fontFamily');
  document.getElementById('c-bold').addEventListener('change', e => {
    CONFIG.fontBold = e.target.checked;
    rebuildTextures();
  });

  // Die size + shininess
  bind('c-size',  'dieScale',  v => { dice.scale.setScalar(parseFloat(v)); return parseFloat(v); });
  bind('c-shine', 'shininess', v => parseFloat(v));
  bindVal('c-size',  'v-size');
  bindVal('c-shine', 'v-shine');

  // Animation sliders (direct CONFIG writes, no rebuildTextures needed)
  document.getElementById('c-tumble').addEventListener('input', e => {
    CONFIG.tumbleDur = parseFloat(e.target.value);
    document.getElementById('v-tumble').textContent = CONFIG.tumbleDur.toFixed(1) + 's';
  });
  document.getElementById('c-settle').addEventListener('input', e => {
    CONFIG.settleDur = parseFloat(e.target.value);
    document.getElementById('v-settle').textContent = CONFIG.settleDur.toFixed(2) + 's';
  });
  document.getElementById('c-spinMin').addEventListener('input', e => {
    CONFIG.spinMin = parseFloat(e.target.value);
    document.getElementById('v-spinMin').textContent = CONFIG.spinMin.toFixed(1);
  });
  document.getElementById('c-chaos').addEventListener('input', e => {
    CONFIG.chaosMag = parseFloat(e.target.value);
    document.getElementById('v-chaos').textContent = Math.round(CONFIG.chaosMag * 100) + '%';
  });
  document.getElementById('c-decay').addEventListener('input', e => {
    CONFIG.decayRate = parseFloat(e.target.value);
    document.getElementById('v-decay').textContent = CONFIG.decayRate.toFixed(1);
  });

  // Sync inputs whenever a theme is applied (themes.js dispatches 'themeapplied')
  document.addEventListener('themeapplied', syncInputsFromConfig);

  // Built-in theme preset buttons
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = BUILT_IN_THEMES[btn.dataset.theme];
      if (theme) applyTheme(theme);
    });
  });

  // Save user theme
  document.getElementById('saveThemeBtn').addEventListener('click', () => {
    const nameEl = document.getElementById('theme-name-input');
    const name   = nameEl.value.trim();
    if (!name) return;
    saveUserTheme(name);
    nameEl.value = '';
  });

  // Export user themes as JSON
  document.getElementById('exportThemesBtn').addEventListener('click', () => {
    const themes = loadUserThemes();
    if (!themes.length) { alert('No saved themes to export. Save at least one theme first.'); return; }
    const blob = new Blob([JSON.stringify(themes, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'd20-themes.json' });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  });

  // Import user themes from JSON
  document.getElementById('importThemesBtn').addEventListener('click', () => {
    document.getElementById('importThemesFile').click();
  });
  document.getElementById('importThemesFile').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      let imported;
      try { imported = JSON.parse(evt.target.result); }
      catch { alert('Invalid JSON file.'); return; }
      if (!Array.isArray(imported)) { alert('Expected a JSON array of themes.'); return; }
      const valid = imported.filter(t => t && typeof t.name === 'string' && t.name.trim());
      if (!valid.length) { alert('No valid themes found in file.'); return; }
      const existing = loadUserThemes();
      valid.forEach(imp => {
        const idx = existing.findIndex(t => t.name === imp.name);
        if (idx >= 0) existing[idx] = imp; else existing.push(imp);
      });
      localStorage.setItem('d20-themes', JSON.stringify(existing));
      renderUserThemes();
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  // Reset to defaults
  document.getElementById('resetBtn').addEventListener('click', () => applyTheme(DEFAULTS));

  // Video export
  document.getElementById('exportBtn').addEventListener('click', generateAllWebMs);
  initExportCancelBtn();

  // Face number picker (for export selection)
  const pickerContainer = document.getElementById('facePicker');
  for (let i = 1; i <= 20; i++) {
    const btn = document.createElement('button');
    btn.className   = 'face-btn selected';
    btn.textContent = i;
    btn.dataset.n   = i;
    btn.addEventListener('click', () => {
      if (exportNumbers.has(i)) { exportNumbers.delete(i); btn.classList.remove('selected'); }
      else { exportNumbers.add(i); btn.classList.add('selected'); }
      updateExportBtnLabel();
    });
    pickerContainer.appendChild(btn);
  }
  document.getElementById('pickAll').addEventListener('click', () => {
    for (let i = 1; i <= 20; i++) exportNumbers.add(i);
    document.querySelectorAll('.face-btn').forEach(b => b.classList.add('selected'));
    updateExportBtnLabel();
  });
  document.getElementById('pickNone').addEventListener('click', () => {
    exportNumbers.clear();
    document.querySelectorAll('.face-btn').forEach(b => b.classList.remove('selected'));
    updateExportBtnLabel();
  });

  // Video format picker (populated dynamically via MediaRecorder.isTypeSupported)
  const formats = [
    { label: 'MP4 \u2014 H.264 (QuickTime / Final Cut / Resolve)', mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
    { label: 'WebM \u2014 VP9 (Chrome / DaVinci Resolve)',         mime: 'video/webm;codecs=vp9', ext: 'webm' },
    { label: 'WebM \u2014 VP8 (broad browser support)',            mime: 'video/webm;codecs=vp8', ext: 'webm' },
  ];
  const sel = document.getElementById('exp-format');
  let firstSelected = false;
  formats.forEach(({ label, mime, ext }) => {
    const supported = window.MediaRecorder && MediaRecorder.isTypeSupported(mime);
    const opt = document.createElement('option');
    opt.value       = JSON.stringify({ mime, ext });
    opt.textContent = supported ? label : label + ' \u2014 unsupported';
    opt.disabled    = !supported;
    if (supported && !firstSelected) { opt.selected = true; firstSelected = true; }
    sel.appendChild(opt);
  });
  if (!firstSelected && sel.options.length) {
    sel.options[0].disabled = false;
    sel.options[0].selected = true;
  }

  // Lead-in / hold slider labels
  ['leadin', 'hold'].forEach(id => {
    const slider = document.getElementById(`exp-${id}`);
    const label  = document.getElementById(`exp-${id}-val`);
    slider.addEventListener('input', () => { label.textContent = parseFloat(slider.value).toFixed(1) + 's'; });
  });

  // Resize handler
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    const ov = document.getElementById('mod-overlay-canvas');
    if (ov) { ov.width = window.innerWidth; ov.height = window.innerHeight; }
  });

  // ── Modifier color pickers ─────────────────────────────────────────────────
  document.getElementById('c-modPos').addEventListener('input', e => {
    CONFIG.modifierPositiveColor = e.target.value;
    applyModCardStyles();
    renderModifierCards();
  });
  document.getElementById('c-modNeg').addEventListener('input', e => {
    CONFIG.modifierNegativeColor = e.target.value;
    applyModCardStyles();
    renderModifierCards();
  });
  document.getElementById('c-modParticle').addEventListener('input', e => {
    CONFIG.modifierParticleColor = e.target.value;
  });
  document.getElementById('c-modImpact').addEventListener('input', e => {
    CONFIG.modifierImpactColor = e.target.value;
  });

  // ── Modifier card appearance pickers ──────────────────────────────────────
  document.getElementById('c-modCardBg1').addEventListener('input', e => {
    CONFIG.modCardBg1 = e.target.value; applyModCardStyles();
  });
  document.getElementById('c-modCardBg2').addEventListener('input', e => {
    CONFIG.modCardBg2 = e.target.value; applyModCardStyles();
  });
  document.getElementById('c-modCardBorder').addEventListener('input', e => {
    CONFIG.modCardBorder = e.target.value; applyModCardStyles();
  });
  document.getElementById('c-modCardLabel').addEventListener('input', e => {
    CONFIG.modCardLabelColor = e.target.value; applyModCardStyles();
  });
  document.getElementById('c-modCardScale').addEventListener('input', e => {
    CONFIG.modCardScale = parseFloat(e.target.value);
    document.getElementById('v-modCardScale').textContent = parseFloat(e.target.value).toFixed(2);
    applyModCardStyles();
  });
  document.getElementById('c-modCardsBottom').addEventListener('input', e => {
    CONFIG.modCardsBottom = parseInt(e.target.value, 10);
    document.getElementById('v-modCardsBottom').textContent = e.target.value + 'px';
    applyModCardStyles();
  });

  // ── Modifier card management ───────────────────────────────────────────────
  document.getElementById('mod-add-btn').addEventListener('click', addModifierFromInputs);
  document.getElementById('mod-value-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addModifierFromInputs();
  });
  document.getElementById('mod-label-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('mod-value-input').focus();
  });

  renderModifierCards();
  applyModCardStyles();
}
