// Fruit trees (#190; Michael, 2026-10-18: apples "come from certain trees and be pickable in some fashion and this makes it part of
// production, which needs to be upkept"). A sprite definition with a `pick` block is a tree that can be picked:
//   "pick": { "item": "apple", "count": [3, 5], "days": 3, "seconds": 2, "bare": "tree_apple_bare" }
// Picking gives the item (the count rolled in the range), turns the tree into its `bare` kind, and sets the day it bears again on the
// prop (`regrowAt`, in the clock's seconds, so it is saved with the prop and rides the chunk to a guest). The bare kind's definition
// says what it grows back to (`"ripens": "tree_apple"`). Chopping is any tree's (logs, the fruit lost). All numbers are data.

import * as verbs from "./verbs.js";
import * as map from "./map.js";
import * as clock from "./clock.js";
import * as rng from "./rng.js";
import * as items from "./items.js";
import * as inventory from "./inventory.js";
import { getDef } from "./assets.js";
import { showMessage } from "./ui/prompt.js";
import { world as W } from "./tuning.js";

// The pick block of a prop's sprite, or null (a bare tree, a rock, a house).
export function pickOf(prop) {
  const p = prop && getDef(prop.sprite).pick;
  return p || null;
}

// Fruit still to come: the day a bare tree bears again, or null.
export function ripeAt(prop) {
  return prop && Number.isFinite(prop.regrowAt) ? prop.regrowAt : null;
}

verbs.define("pick", {
  validate(world, player, target) {
    const prop = map.propById(target.prop);
    if (!prop) return "There is nothing there.";
    if (!pickOf(prop)) return ripeAt(prop) !== null ? "It is bare; the fruit will come back." : "There is nothing to pick.";
    if (Math.hypot(player.gx - prop.tile[0], player.gy - prop.tile[1]) > W.pickReach) return "Too far away.";
    return true;
  },
  perform(world, player, target) {
    const prop = map.propById(target.prop);
    const p = prop && pickOf(prop);
    if (!p) return false; // two pickers: the second finds it bare
    const [lo, hi] = p.count;
    const n = lo + rng.int(hi - lo + 1);
    const placed = Math.min(n, inventory.addItem(inventory.bagOf(player), p.item, n));
    if (placed < n) map.dropItem(Math.round(player.gx), Math.round(player.gy), items.makeEntry(p.item, n - placed));
    map.restage(prop, p.bare, clock.getElapsed() + p.days * clock.DAY_LENGTH);
    const name = items.getItem(p.item).name.toLowerCase();
    showMessage(`You pick ${n} ${name}${n > 1 ? "s" : ""}.`);
    return { picked: n };
  },
});

// Bare trees bear again. Checked once a `fruitCheckSeconds` of the clock, on the boundary of its multiples, and a tree ripens at the first
// boundary at or after its day: a world restored from a save ripens the same trees at the same boundary as one that ran on (`reset`).
let bucket = -1;
export function reset() {
  bucket = -1;
}

export function step() {
  const now = clock.getElapsed();
  const b = Math.floor(now / W.fruitCheckSeconds);
  if (b === bucket) return;
  bucket = b;
  const at = b * W.fruitCheckSeconds;
  for (const prop of map.allProps()) {
    const day = ripeAt(prop);
    if (day === null || day > at) continue;
    const ripe = getDef(prop.sprite).ripens;
    if (ripe) map.restage(prop, ripe, null);
  }
}
