"use strict";

/** Official experimental badge tier ladders (Discord 2026). */

const GAME_TIME = [
  { hours: 1, name: "Casual" },
  { hours: 5, name: "Recreational" },
  { hours: 20, name: "Dedicated" },
  { hours: 75, name: "Committed" },
  { hours: 150, name: "Serious" },
  { hours: 300, name: "Devoted" },
  { hours: 500, name: "Seasoned" },
  { hours: 1000, name: "Ironclad" },
  { hours: 2000, name: "Unshakable" },
  { hours: 5000, name: "Eternal" },
];

const STREAM = [
  { hours: 1, name: "Newcomer" },
  { hours: 5, name: "Fledgling" },
  { hours: 20, name: "Breakout" },
  { hours: 75, name: "Standout" },
  { hours: 150, name: "Trendsetter" },
  { hours: 300, name: "Headliner" },
  { hours: 500, name: "Star" },
  { hours: 1000, name: "Sensation" },
  { hours: 2000, name: "Visionary" },
  { hours: 5000, name: "Phenomenon" },
];

const VARIETY = [
  { titles: 2, name: "Sampler" },
  { titles: 5, name: "Dabbler" },
  { titles: 10, name: "Enthusiast" },
  { titles: 15, name: "Ranger" },
  { titles: 20, name: "Explorer" },
  { titles: 30, name: "Adventurer" },
  { titles: 40, name: "Voyager" },
  { titles: 60, name: "Maverick" },
  { titles: 80, name: "Polymath" },
  { titles: 100, name: "Universalist" },
];

function currentTier(ladder, value, key) {
  let cur = null;
  for (const t of ladder) {
    if (value >= t[key]) cur = t;
  }
  return cur;
}

function nextTier(ladder, value, key) {
  for (const t of ladder) {
    if (value < t[key]) return t;
  }
  return null;
}

function gapToNext(ladder, value, key) {
  const n = nextTier(ladder, value, key);
  if (!n) return 0;
  return Math.max(0, n[key] - value);
}

function planToTarget(ladder, current, target, key) {
  const t = ladder.find((x) => x.name.toLowerCase() === String(target).toLowerCase()) ||
    ladder.find((x) => x[key] === Number(target));
  if (!t) return null;
  return { target: t, need: Math.max(0, t[key] - current) };
}

module.exports = {
  GAME_TIME,
  STREAM,
  VARIETY,
  currentTier,
  nextTier,
  gapToNext,
  planToTarget,
};
