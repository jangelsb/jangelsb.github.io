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
  tumbleDur:       1.9,
  settleDur:       1.95,
  spinMin:         3.5,
  chaosMag:        0.05,
  decayRate:       3.8,

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
  modCardsBottom:     108,   // distance from bottom of viewport (px)
};

export const CONFIG = { ...DEFAULTS };
