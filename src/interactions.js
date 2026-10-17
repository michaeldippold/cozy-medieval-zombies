// Interactions (docs/30, law 2; Michael's OSRS rule, 2026-10-12): anything can
// be used on anything, and the default is "Nothing interesting happens." A real
// interaction is a row in data/interactions.json; this module finds the row for
// a thing used on a target, or nothing. Running a row's action is the big
// pass's step 3; until then a row can carry a `message`, which is printed.
//
// A row: { "use": <item id or tag>, "on": <what>, "verb": "Chop", "message": "...", ... }
// `on` is an item id or tag (an item in a bag or slot), a prop's sprite id, "fire" (any prop
// whose fire burns; #14), "bracket" (a wall bracket and what hangs in it, #170), one of "character" | "zombie" | "villager", a floor sprite id, or
// "tile". The first matching row wins: a row for one fire in particular goes above "fire".
// A target: { kind: "item", entry } | { kind: "prop", prop } | { kind: "bracket", bracket } | { kind: "character", ch } | { kind: "tile", x, y, floor }.

import { getItem } from "./items.js";

let rows = [];
export const NOTHING = "Nothing interesting happens.";

export function load(json) {
  rows = (json && (json.rows || json)) || [];
  if (!Array.isArray(rows)) rows = [];
}

export function all() {
  return rows;
}

function itemMatches(what, entry) {
  if (!entry) return false;
  if (what === entry.id) return true;
  const def = getItem(entry.id);
  return !!(def && def.tags && def.tags.includes(what));
}

function targetMatches(what, target) {
  switch (target.kind) {
    case "item": return itemMatches(what, target.entry);
    case "prop": return what === target.prop.sprite || (what === "fire" && !!(target.prop.fire && target.prop.fire.burns)); // "fire": any that burns (#14)
    case "bracket": return what === "bracket"; // a torch in a wall bracket (#170): the light verb's rows
    case "character": return what === "character" || what === target.ch.kind;
    case "tile": return what === "tile" || what === target.floor;
    default: return false;
  }
}

// The first row for `entry` used on `target`, or null.
export function resolve(entry, target) {
  if (!entry || !target) return null;
  for (const r of rows) if (itemMatches(r.use, entry) && targetMatches(r.on, target)) return r;
  return null;
}

// A name for a target, for "Use X -> Y".
export function nameOfTarget(target) {
  if (!target) return "";
  switch (target.kind) {
    case "item": { const d = getItem(target.entry.id); return d ? d.name : target.entry.id; }
    case "prop": return target.prop.sprite.replace(/_\d+$/, "").replace(/_/g, " ");
    case "bracket": { const b = target.bracket.wall.bracket; return b.lantern ? "the lantern" : b.torch ? "the torch in the bracket" : "the empty bracket"; } // what is there (#177)
    case "character": return target.ch.name || (target.ch.kind === "zombie" ? "one of the dead" : target.ch.kind);
    case "tile": return (target.floor || "the ground").replace(/^floor_/, "").replace(/_/g, " ");
    default: return "";
  }
}
