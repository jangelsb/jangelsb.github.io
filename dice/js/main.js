// Entry point — wires everything together.
// Import order matters: animation.js starts the render loop on import,
// so scene/geometry must be fully initialized first (they are, via their own imports).
import { roll } from './animation.js';
import { applyTheme, BUILT_IN_THEMES, renderUserThemes } from './themes.js';
import { initUI } from './ui.js';

initUI();
renderUserThemes();
applyTheme(BUILT_IN_THEMES.bg3); // dispatches 'themeapplied' → syncInputsFromConfig

// URL param support: ?roll=14 auto-rolls on load
const urlRoll = new URLSearchParams(location.search).get('roll');
if (urlRoll) setTimeout(() => roll(parseInt(urlRoll, 10)), 700);
