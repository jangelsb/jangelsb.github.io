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
  dieScale:        0.7,
  shininess:       70,
  tumbleDur:       1.9,
  settleDur:       1.95,
  spinMin:         3.5,
  chaosMag:        0.05,
  decayRate:       3.8,
};

export const CONFIG = { ...DEFAULTS };
