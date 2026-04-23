import { CONFIG, DEFAULTS } from './config.js';
import { dice, rebuildTextures } from './geometry.js';

// Shared modifier color defaults for each theme accent
const modColors = accent => ({
  modifierPositiveColor: accent,
  modifierNegativeColor: '#ff5555',
  modifierParticleColor: '#f0c040',  // sparkles are always gold
  modifierImpactColor:   '#ffffff',
});

export const BUILT_IN_THEMES = {
  bg3: {
    faceColorTop:    '#252535',
    faceColorBottom: '#0f0f1c',
    borderColor:     '#9aabcc',
    bgColor:         '#06060f',
    numberColor:     '#e0ecff',
    glowColor:       '#3355aa',
    fontFamily:      'Cinzel, Georgia, serif',
    fontBold:        true,
    dieScale:        0.45,
    shininess:       150,
    tumbleDur:       1.9,
    settleDur:       1.95,
    spinMin:         3.5,
    chaosMag:        0.05,
    decayRate:       3.8,
    ...modColors('#9aabcc'),
    modifierNegativeColor: '#9aabcc',
    modCardBg1:      '#141e30',
    modCardBg2:      '#080f20',
    modCardBorder:   '#9aabcc',
    modCardLabelColor: '#9aabcc',
    modCardScale:    1.0,
    modCardsBottom:  108,
  },
  classic: { ...DEFAULTS },
  bloodmoon: {
    faceColorTop:    '#3a0c0c',
    faceColorBottom: '#1a0404',
    borderColor:     '#cc2020',
    bgColor:         '#0f0303',
    numberColor:     '#ffd0d0',
    glowColor:       '#dd3333',
    fontFamily:      'Georgia, serif',
    fontBold:        true,
    dieScale:        0.45,
    shininess:       120,
    tumbleDur:       1.9,
    settleDur:       1.95,
    spinMin:         3.5,
    chaosMag:        0.05,
    decayRate:       3.8,
    modifierPositiveColor: '#ffd0d0',
    modifierNegativeColor: '#ff3333',
    modifierParticleColor: '#f0c040',
    modifierImpactColor:   '#ffaaaa',
    modCardBg1:      '#2a0c0c',
    modCardBg2:      '#140404',
    modCardBorder:   '#cc2020',
    modCardLabelColor: '#ffd0d0',
    modCardScale:    1.0,
    modCardsBottom:  108,
  },
  arcane: {
    faceColorTop:    '#2a1545',
    faceColorBottom: '#130922',
    borderColor:     '#a855f7',
    bgColor:         '#090511',
    numberColor:     '#ead4ff',
    glowColor:       '#9b33f0',
    fontFamily:      'Cinzel, Georgia, serif',
    fontBold:        true,
    dieScale:        0.45,
    shininess:       160,
    tumbleDur:       1.9,
    settleDur:       1.95,
    spinMin:         3.5,
    chaosMag:        0.05,
    decayRate:       3.8,
    modifierPositiveColor: '#d4a7ff',
    modifierNegativeColor: '#ff5555',
    modifierParticleColor: '#f0c040',
    modifierImpactColor:   '#e8ccff',
    modCardBg1:      '#1e0f30',
    modCardBg2:      '#0d0618',
    modCardBorder:   '#a855f7',
    modCardLabelColor: '#d4a7ff',
    modCardScale:    1.0,
    modCardsBottom:  108,
  },
  emerald: {
    faceColorTop:    '#0d2b1a',
    faceColorBottom: '#061409',
    borderColor:     '#4a9a6a',
    bgColor:         '#030e06',
    numberColor:     '#c4f0c8',
    glowColor:       '#2d8a50',
    fontFamily:      'Georgia, serif',
    fontBold:        true,
    dieScale:        0.45,
    shininess:       80,
    tumbleDur:       1.9,
    settleDur:       1.95,
    spinMin:         3.5,
    chaosMag:        0.05,
    decayRate:       3.8,
    modifierPositiveColor: '#88ffaa',
    modifierNegativeColor: '#ff5555',
    modifierParticleColor: '#f0c040',
    modifierImpactColor:   '#aaffcc',
    modCardBg1:      '#0c2018',
    modCardBg2:      '#060e0a',
    modCardBorder:   '#4a9a6a',
    modCardLabelColor: '#c4f0c8',
    modCardScale:    1.0,
    modCardsBottom:  108,
  },
  undead: {
    faceColorTop:    '#1a1a1a',
    faceColorBottom: '#0a0a0a',
    borderColor:     '#44bb66',
    bgColor:         '#050505',
    numberColor:     '#aaffbb',
    glowColor:       '#33aa55',
    fontFamily:      'Cinzel, Georgia, serif',
    fontBold:        false,
    dieScale:        0.45,
    shininess:       30,
    tumbleDur:       1.9,
    settleDur:       1.95,
    spinMin:         3.5,
    chaosMag:        0.05,
    decayRate:       3.8,
    modifierPositiveColor: '#aaffbb',
    modifierNegativeColor: '#ff5555',
    modifierParticleColor: '#f0c040',
    modifierImpactColor:   '#ccffdd',
    modCardBg1:      '#111111',
    modCardBg2:      '#080808',
    modCardBorder:   '#44bb66',
    modCardLabelColor: '#aaffbb',
    modCardScale:    1.0,
    modCardsBottom:  108,
  },
  forge: {
    faceColorTop:    '#2a1a08',
    faceColorBottom: '#150d04',
    borderColor:     '#e07820',
    bgColor:         '#0a0704',
    numberColor:     '#ffe0a0',
    glowColor:       '#dd7722',
    fontFamily:      'Georgia, serif',
    fontBold:        true,
    dieScale:        0.45,
    shininess:       200,
    tumbleDur:       1.9,
    settleDur:       1.95,
    spinMin:         3.5,
    chaosMag:        0.05,
    decayRate:       3.8,
    modifierPositiveColor: '#ffe0a0',
    modifierNegativeColor: '#ff5555',
    modifierParticleColor: '#f0c040',
    modifierImpactColor:   '#fff0c0',
    modCardBg1:      '#201408',
    modCardBg2:      '#100a04',
    modCardBorder:   '#e07820',
    modCardLabelColor: '#ffe0a0',
    modCardScale:    1.0,
    modCardsBottom:  108,
  },
};

// Applies a theme object to CONFIG, rebuilds visuals, and notifies ui.js via event.
export function applyTheme(themeObj) {
  Object.assign(CONFIG, themeObj);
  delete CONFIG.name; // prevent a saved theme's name from polluting CONFIG
  rebuildTextures();  // handles background color + die scale
  document.dispatchEvent(new CustomEvent('themeapplied'));
}

// ── User theme persistence (localStorage) ─────────────────────────────────────

export function loadUserThemes() {
  try { return JSON.parse(localStorage.getItem('d20-themes') || '[]'); }
  catch { return []; }
}

export function saveUserTheme(name) {
  const themes   = loadUserThemes();
  const existing = themes.findIndex(t => t.name === name);
  const entry    = { ...CONFIG, name }; // name last so it always wins over CONFIG.name
  if (existing >= 0) themes[existing] = entry;
  else themes.push(entry);
  localStorage.setItem('d20-themes', JSON.stringify(themes));
  renderUserThemes();
}

export function deleteUserTheme(name) {
  const themes = loadUserThemes().filter(t => t.name !== name);
  localStorage.setItem('d20-themes', JSON.stringify(themes));
  renderUserThemes();
}

export function renderUserThemes() {
  const container = document.getElementById('saved-themes');
  container.innerHTML = '';
  loadUserThemes().forEach(t => {
    const pill  = document.createElement('div');
    pill.className = 'theme-pill';

    const label = document.createElement('span');
    label.className   = 'pill-label';
    label.textContent = t.name;
    label.addEventListener('click', () => applyTheme(t));

    const del = document.createElement('span');
    del.className   = 'pill-del';
    del.textContent = '✕';
    del.addEventListener('click', () => deleteUserTheme(t.name));

    pill.appendChild(label);
    pill.appendChild(del);
    container.appendChild(pill);
  });
}
