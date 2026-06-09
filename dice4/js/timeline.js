// timeline.js — Timeline data persistence.
//
// A saved timeline: { name: string, items: TimelineItem[] }
//
// TimelineItem: {
//   id:        number,
//   label:     string,          // user display name
//   dieType:   'd4'|'d6'|'d8'|'d10'|'d12'|'d20',
//   themeName: string,          // BUILT_IN_THEMES key or 'user:Name'
//   modifiers: [{ label, value }],
//   number:    number,          // which face value to land on
// }

const STORAGE_KEY = 'd20-timelines';

export function loadTimelines() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}

export function saveTimeline(name, items) {
  const timelines = loadTimelines();
  const idx = timelines.findIndex(t => t.name === name);
  const entry = { name, items };
  if (idx >= 0) timelines[idx] = entry;
  else timelines.push(entry);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(timelines));
}

export function deleteTimeline(name) {
  const stored = loadTimelines().filter(t => t.name !== name);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
}
