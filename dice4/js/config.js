// All configurable values in one place. Import CONFIG wherever live values are needed.
export const DEFAULTS = {
  faceColorTop:    '#1e1e46',
  faceColorBottom: '#0c0c24',
  borderColor:     '#c8a84a',
  bgColor:         '#0d0d1a',
  numberColor:     '#f5e8c0',
  glowColor:       '#c8a84a',
  fontFamily:      'Georgia, serif',
  fontBold:        true,
  dieScale:        0.45,
  shininess:       70,
  faceGap:         0.022, // fraction of face texture used as border gap (single source of truth)
  tumbleDur:       1.9,
  settleDur:       1.95,
  spinMin:         3.5,
  chaosMag:        0.05,
  decayRate:       3.8,

  // Die type: 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20'
  dieType:         'd20',

  // Modifier animation colors
  modifierPositiveColor: '#f0c040',  // gold — text for positive modifiers
  modifierNegativeColor: '#e05050',  // red  — text for negative modifiers
  modifierParticleColor: '#f0c040',  // gold — pixie dust particles
  modifierImpactColor:   '#ffffff',  // white flash on die impact

  // Modifier card appearance
  modCardBg1:         '#1a1830',
  modCardBg2:         '#0c0c1e',
  modCardBorder:      '#c8a84a',
  modCardLabelColor:  '#c8a84a',
  modCardScale:       1.0,   // card size multiplier
  modCardsBottom:     132,   // distance from bottom of viewport (px)
};

export const CONFIG = { ...DEFAULTS };

// ── User Presets ──────────────────────────────────────────────────────────────
// Each preset: { name: string, dieType: string }
// Stored in localStorage under 'd20-user-presets'

export function loadUserPresets() {
  try { return JSON.parse(localStorage.getItem('d20-user-presets') || '[]'); }
  catch { return []; }
}

export function saveUserPreset(name, dieType) {
  const presets = loadUserPresets();
  const existing = presets.findIndex(p => p.name === name);
  const entry = { name, dieType };
  if (existing >= 0) presets[existing] = entry;
  else presets.push(entry);
  localStorage.setItem('d20-user-presets', JSON.stringify(presets));
}

export function deleteUserPreset(name) {
  const presets = loadUserPresets().filter(p => p.name !== name);
  localStorage.setItem('d20-user-presets', JSON.stringify(presets));
}

// Supported die types and their face counts
export const DIE_TYPES = {
  d4:  { faces: 4,  label: 'D4'  },
  d6:  { faces: 6,  label: 'D6'  },
  d8:  { faces: 8,  label: 'D8'  },
  d10: { faces: 10, label: 'D10' },
  d12: { faces: 12, label: 'D12' },
  d20: { faces: 20, label: 'D20' },
};
