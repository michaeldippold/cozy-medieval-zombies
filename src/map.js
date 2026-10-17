// The map: one continuous tile grid stored block by block. See docs/03-world-model.md.
//
// Walls sit on tile edges, Zomboid style: every tile has a slot for a wall on its
// north edge (`n`) and its west edge (`w`). A building's south wall is the north
// wall of the tiles just south of it, and its east wall is the west wall of the
// tiles just east. A door or a window is a wall with a different kind and state.
//
// Chunks are created on demand, so the ground goes on forever and the camera
// never shows the void. Inside the authored bounds an unauthored tile is plain
// floor; beyond them a chunk is wild, grown from the map's `wild` rule.

import { getDef } from "./assets.js";
import { douse } from "./items.js";
import { nextId } from "./world.js";
import { emit } from "./events.js";
import { world as W } from "./tuning.js";

export const CHUNK = 16;
// Every prop by its id (docs/31/08, habit 1): anything kept across a step
// refers to a prop by id and looks it up here when the step runs.
const propsById = new Map();
export function propById(id) {
  return propsById.get(id) || null;
}
const ROOM_MAX = 300; // a region bigger than this is outdoors, not a room
const ROUND_BODY_RADIUS = 0.2; // a body's radius against round props; 0.3 against walls

const chunks = new Map(); // "cx,cy" -> { cx, cy, tiles, floorCache, floorDirty }
let source = null; // authored tiles: (x, y) => tile | null
let defaultFloor = "floor_grass";
// What a read beyond the grown chunks sees (docs/31/05 item 8): plain floor, no
// walls, no prop, outdoors. Frozen, so a write to it throws instead of changing
// nothing. Reading never grows a chunk; only ensureAround and the mutators do.
let blank = Object.freeze({ floor: defaultFloor, n: null, w: null, prop: null, room: 0, items: null });
const rooms = new Map(); // room id -> { id, size, openings: [{ tx, ty, edge }] }
let roomsDirty = true;
// Every prop whose sprite definition declares `fire`, so light can list its
// sources and lit rooms without walking every tile (docs/07-lighting.md).
const fireProps = new Set();
// Beyond the authored bounds the world is wild: forest grown by rule, with a
// few of the dead per chunk (Michael, 2026-10-09). Harvest register, so the
// gloomy one is always a choice of place and never the default.
let wild = null; // { biome: { kinds, scale }, density: [min, max], seed, zombiesPerChunk }
let bounds = null; // [x, y, w, h] of the authored map
const pendingSpawns = []; // [x, y] tiles where a wild chunk wants a zombie
let popFactor = 1; // the world's Starting population as a factor (tuning.population): scales the dead a wild chunk brings
let noTrees = false; // the world's Trees rule is off: no tree is placed, scatter or wild (rocks, forage, and anything else stay)
const ghostTrees = new Set(); // with Trees off, the tiles of the authored scatter where a tree would have stood: forage is placed against these, as against the trees of a world that has them

// Whether a kind is a tree: its definition has a canopy (the engine's one idea of a tree), else its id says so.
function isTreeKind(kind) {
  const d = getDef(kind);
  return d ? !!d.canopy : String(kind).startsWith("tree_");
}
// Which biome a tile is in, for the ground (docs/15): the scatter rules' rects
// inside the bounds, the wild rule's biome beyond them.
let biomeRects = []; // [{ rect: [x, y, w, h], biome }]
let wildBiome = null;
// Small things placed near trees (docs/02, question 27): mushrooms now.
let forage = null; // { kinds, chance, near, seed }
// Called with (tiles, prop) when a floor changes or a prop comes or goes, so
// the ground can re-bake what it touches (docs/15). The ground registers it;
// the map does not import the ground.
const groundListeners = [];

export function reset({ floor = "floor_grass", authored = null, wildRule = null, mapBounds = null } = {}) {
  chunks.clear();
  sleepers.clear();
  woken.length = 0;
  nextRoomId = 1;
  lastChunk = null;
  rooms.clear();
  source = authored;
  defaultFloor = floor;
  blank = Object.freeze({ floor: defaultFloor, n: null, w: null, prop: null, room: 0, items: null });
  wild = wildRule;
  bounds = mapBounds;
  pendingSpawns.length = 0;
  roomsDirty = true;
}

export function takePendingSpawns() {
  return pendingSpawns.splice(0, pendingSpawns.length);
}

export function fires() {
  return fireProps;
}

// Burning (docs/07; docs/30 section 7, fire is maintenance): a burner holds
// units of its fuel (a log, a lump of charcoal: the definition's `fire.fuel`)
// and burns one per `fire.hoursPerUnit` game hours (two unless the definition
// says). At zero it goes out and says so. Nothing shuts off on a timer; it
// burned what you gave it.
export const HOUR_SECONDS = 30; // real seconds per game hour: a 12-minute day (clock.js's DAY_LENGTH / 24)
export const LOG_SECONDS = 2 * HOUR_SECONDS; // the default: two hours a unit

export function burnFires(dt) {
  for (const p of fireProps) {
    const f = p.fire;
    if (!f.burns || !f.lit) continue;
    const before = f.fuel;
    f.fuel -= dt / (f.hoursPerUnit * HOUR_SECONDS);
    // A guest's copy of the fuel refreshes when the chunk is sent: at every whole unit burned, so a guest's
    // hours left are never more than a unit behind (the sync check compares fuel to the unit; docs/31/04).
    if (Math.floor(before) !== Math.floor(f.fuel)) markDirty(p.tile[0], p.tile[1]);
    else unsaved(p.tile[0], p.tile[1], false); // the fuel between units: the save's copy only (the wire waits for the unit)
    if (f.fuel <= 0) {
      f.fuel = 0;
      f.lit = false;
      touch(p.tile[0], p.tile[1]);
      emit("fireOut", { id: p.id, tile: p.tile });
    }
  }
}

// Feed a burner one unit of its fuel (the caller has taken the item), lighting
// it if it was out. The one mutator of a fire's fuel: it touches the tile and
// says what changed (docs/31/08, habit 3). Returns false if it is full.
export function feedFire(prop) {
  const f = prop.fire;
  if (!f || !f.burns) return false;
  if (f.fuel >= f.maxFuel) return false;
  f.fuel = Math.min(f.maxFuel, f.fuel + 1);
  f.lit = true;
  touch(prop.tile[0], prop.tile[1]);
  emit("fireFed", { id: prop.id, tile: prop.tile, fuel: f.fuel });
  return true;
}

// Game hours a fire has left in it.
export function fireHoursLeft(prop) {
  const f = prop.fire;
  return f && f.burns ? f.fuel * f.hoursPerUnit : 0;
}

// ---- torches: brackets on walls, posts on tiles ----
// A bracket is state on a wall edge: `wall.bracket = { side, torch }`, where
// side is +1 for the near side of the edge (south of a north edge, east of a
// west edge) and -1 for the far side. A post is a prop whose fire `holds` a
// torch. A torch burns down while it is lit and a lantern (`bracket.lantern`, a `lantern_post`) never goes out (docs/07, #156).

const bracketSet = new Set(); // { tx, ty, edge, wall }

export function brackets() {
  return bracketSet;
}

// The torches players mounted burn down at the wall rate while lit (Michael, 2026-10-17, #156): a spent one is gone from its
// holder. The village's own lights are lanterns (a bracket's `lantern`, a `lantern_post`), which never burn out.
// A guest's copy of the wear refreshes when the chunk is sent: at every hundredth burned, as a fire's fuel does at every unit
// (the sync check compares wear to the hundredth); between, the save's copy alone is dropped (docs/31/04).
const hundredth = (w) => Math.floor(w * 100);
export function burnHolders(dt) {
  const k = dt / W.torchWallLife;
  for (const b of bracketSet) {
    const br = b.wall.bracket;
    if (!br.torch || br.lit !== true || br.wear === undefined) continue;
    const before = hundredth(br.wear);
    br.wear += k;
    if (br.wear >= 1) {
      br.torch = false;
      delete br.wear;
      delete br.lit;
      touchWall(b.wall);
      emit("torchSpent", { x: b.tx, y: b.ty });
    } else if (b.wall.at && before !== hundredth(br.wear)) markDirty(b.wall.at[0], b.wall.at[1]);
    else unsavedWall(b.wall, false);
  }
  for (const p of fireProps) {
    const f = p.fire;
    if (!f.holds || !f.has || !f.lit || f.wear === undefined) continue;
    const before = hundredth(f.wear);
    f.wear += k;
    if (f.wear >= 1) {
      f.has = false;
      f.lit = false;
      delete f.wear;
      touch(p.tile[0], p.tile[1]);
      emit("torchSpent", { x: p.tile[0], y: p.tile[1] });
    } else if (before !== hundredth(f.wear)) markDirty(p.tile[0], p.tile[1]);
    else unsaved(p.tile[0], p.tile[1], false);
  }
}

// A flame landing at a point lights what is made to be lit within `r` tiles (Michael, 2026-10-17, #156: "a campfire or a torch"): an
// unlit campfire with fuel in it, a torch on a post, or a torch in a bracket that is out. Not a hearth, an oven, or a forge, and
// nothing else burns or spreads. `clear(x, y)` says whether the flame reaches that point (no wall between it and the landing: the
// fireball passes it, as its hit does); the default is that it does. The authority's, from a fireball's landing (archery.js).
// Returns how many it lit.
export function kindleNear(x, y, r = 1, clear = null) {
  let n = 0;
  for (const p of fireProps) {
    if (!lightableProp(p) || p.fire.lit || Math.hypot(p.tile[0] - x, p.tile[1] - y) > r) continue;
    if (clear && !clear(p.tile[0], p.tile[1])) continue;
    if (lightProp(p)) n++;
  }
  for (const b of bracketSet) {
    if (!b.wall.bracket.torch || b.wall.bracket.lit !== false) continue;
    const [bx, by] = bracketPos(b);
    if (Math.hypot(bx - x, by - y) > r) continue;
    if (clear && !clear(bx, by)) continue;
    if (lightBracket(b)) n++;
  }
  return n;
}

export function addBracket(tx, ty, edge, side, torch = false, lantern = false) {
  const wall = growTile(tx, ty)[edge];
  if (!wall) return null;
  // A lantern is the village's own light (#156): steady, never out, not a torch and not taken; a bracket holds one or the other.
  wall.bracket = lantern ? { side, torch: false, lantern: true } : { side, torch };
  const b = { tx, ty, edge, wall };
  bracketSet.add(b);
  return b;
}

// Where a bracket's torch burns, in grid space: a little off the edge on its side.
export function bracketPos(b) {
  const s = b.wall.bracket.side * 0.3;
  return b.edge === "n" ? [b.tx, b.ty - 0.5 + s] : [b.tx - 0.5 + s, b.ty];
}

export function bracketsNear(gx, gy, r = 1.15) {
  const out = [];
  for (const b of bracketSet) {
    const mx = b.edge === "n" ? b.tx : b.tx - 0.5;
    const my = b.edge === "n" ? b.ty - 0.5 : b.ty;
    const d = Math.hypot(gx - mx, gy - my);
    if (d <= r) out.push({ bracket: b, d, mx, my });
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

// Holders (posts) within `r` tiles, nearest first.
export function holdersNear(gx, gy, r = 1.3) {
  const out = [];
  for (const p of fireProps) {
    if (!p.fire.holds) continue;
    const d = Math.hypot(gx - p.tile[0], gy - p.tile[1]);
    if (d <= r) out.push({ prop: p, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

// Does a bracket or a holder hold a torch?
export function holderHas(target) {
  return target.kind === "bracket" ? target.bracket.wall.bracket.torch : target.prop.fire.has;
}

// What the torch it holds has left: { wear, lit }. A torch with no `wear` (an old authored one; the village's lights are lanterns
// now) counts as lit for good; one a player mounted keeps its own (#156).
export function holderState(target) {
  const h = target.kind === "bracket" ? target.bracket.wall.bracket : target.prop.fire;
  return { wear: h.wear, lit: h.wear === undefined ? true : target.kind === "bracket" ? h.lit !== false : !!h.lit };
}

// `entry` is the torch being mounted: its wear and whether it is lit go with it, and come back out with it.
export function setHolder(target, has, entry = null) {
  if (target.kind === "bracket") {
    const b = target.bracket.wall.bracket;
    b.torch = has;
    if (has && entry) {
      b.wear = entry.wear || 0;
      b.lit = !!entry.lit;
    } else {
      delete b.wear;
      delete b.lit;
    }
    touchWall(target.bracket.wall);
  } else {
    const f = target.prop.fire;
    f.has = has;
    f.lit = has && (entry ? !!entry.lit : true);
    if (has && entry) f.wear = entry.wear || 0;
    else delete f.wear;
    touch(target.prop.tile[0], target.prop.tile[1]);
  }
  // It touched nothing before 2026-10-15: a guest saw a torch mounted or taken only once its chunk went for another
  // reason (found auditing the changes for the save's cache, `02`).
}

// Light what is made to be lit (Michael, 2026-10-17, #156: "fire lights what is made to be lit"): an unlit campfire with fuel in
// it, a torch on a post, or a torch in a bracket that is out (`lightableProp`). Nothing else burns and nothing spreads. The authority's, from
// the `light` verb (burn.js); each returns whether it lit, and touches the chunk so the wire and the save have it.
// The one rule for what a fire can be lit as (the verb and a fireball's landing both ask it): a campfire with fuel in it, or a holder
// (a post) with a torch in it. Not a hearth, an oven, or a forge: Michael named "a campfire or a torch".
export function lightableProp(prop) {
  const f = prop && prop.fire;
  return !!f && ((prop.sprite === "campfire" && f.burns && f.fuel > 0) || (!!f.holds && f.has));
}

export function lightProp(prop) {
  if (!lightableProp(prop) || prop.fire.lit) return false;
  const f = prop.fire;
  f.lit = true;
  touch(prop.tile[0], prop.tile[1]);
  emit("fireLit", { id: prop.id, tile: prop.tile });
  return true;
}

export function lightBracket(b) {
  const br = b && b.wall.bracket;
  if (!br || !br.torch || br.lit !== false) return false;
  br.lit = true;
  touchWall(b.wall);
  emit("fireLit", { tile: [b.tx, b.ty] });
  return true;
}

// Burners within `r` tiles of (gx, gy), nearest first.
export function burnersNear(gx, gy, r = 1.3) {
  const out = [];
  for (const p of fireProps) {
    if (!p.fire.burns) continue;
    const d = Math.hypot(gx - p.tile[0], gy - p.tile[1]);
    if (d <= r) out.push({ prop: p, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

export function getRoom(id) {
  return rooms.get(id) || null;
}

export function allRooms() {
  return rooms.values();
}

function inBounds(x, y) {
  return !!bounds && x >= bounds[0] && y >= bounds[1] && x < bounds[0] + bounds[2] && y < bounds[1] + bounds[3];
}

// ---- deterministic randomness ----
// Every roll is a hash of the tile and a seed, never a sequence, so a tile
// rolls the same whatever order chunks load in.

export function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Smooth value noise, 0..1, with lattice points `scale` tiles apart. Density
// drifts with it: thickets and clearings instead of an even sprinkle.
export function valueNoise(x, y, scale, seed) {
  const fx = x / scale;
  const fy = y / scale;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

function densityAt(rule, biome, x, y) {
  if (!Array.isArray(rule.density)) return rule.density;
  const [lo, hi] = rule.density;
  return lo + (hi - lo) * valueNoise(x, y, biome.scale || 8, (rule.seed ?? 1) + 7);
}

// Pick a key from { key: weight } with a 0..1 roll.
function weightedPick(weights, roll) {
  let total = 0;
  for (const k in weights) total += weights[k];
  let r = roll * total;
  for (const k in weights) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  return Object.keys(weights)[0];
}

// A big rock in the wild (Michael, 2026-10-11: sparse, no more than about two
// a screen): each `cell`-square patch of the wild has `chance` of one rock, at
// a spot rolled from the patch. Returns the rock's sprite at this tile, or null.
function wildRockAt(x, y) {
  const r = wild && wild.rocks;
  if (!r) return null;
  const c = r.cell || 40;
  const s = r.seed ?? 51;
  const cx = Math.floor(x / c);
  const cy = Math.floor(y / c);
  if (hash2(cx, cy, s) >= r.chance) return null;
  if (x !== cx * c + Math.floor(hash2(cx, cy, s + 1) * c) || y !== cy * c + Math.floor(hash2(cx, cy, s + 2) * c)) return null;
  return weightedPick(r.kinds, hash2(cx, cy, s + 3));
}

// The wild rule's tree at a tile, or null, without making the tile: the same
// rolls wildTile makes, so anything can ask where the trees are before their
// chunks exist.
function wildPickAt(x, y) {
  if (!wild || wildRockAt(x, y) || hash2(x, y, wild.seed ?? 1) >= densityAt(wild, wild.biome, x, y)) return null;
  return weightedPick(wild.biome.kinds, hash2(x, y, (wild.seed ?? 1) + 1));
}

// What the wild rule stands at a tile: its pick, unless Trees are off and the pick is a tree.
function wildTreeAt(x, y) {
  const kind = wildPickAt(x, y);
  return kind && noTrees && isTreeKind(kind) ? null : kind; // Trees off: the same tiles, minus the trees
}

// Whether a tree stands at a tile: the authored map inside the bounds, the
// wild rule beyond them. Pure, so it answers the same in any order.
// With Trees off it answers for where a tree *would* stand (the scatter's picks, the wild's rolls), so the mushrooms that
// grow beside trees are the same as in a world of the same seed that has them (#142).
function treeAt(x, y) {
  if (inBounds(x, y)) {
    const t = source && source(x, y);
    return !!(t && t.prop && getDef(t.prop.sprite).canopy) || ghostTrees.has(ghostKey(x, y));
  }
  const k = wildPickAt(x, y);
  return !!(k && getDef(k).canopy);
}

function ghostKey(x, y) {
  return (x + 32768) * 65536 + (y + 32768);
}

function treeNear(x, y, r) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if ((dx || dy) && treeAt(x + dx, y + dy)) return true;
  return false;
}

// A forage object for a tile, or null: by chance, only near a tree, at a small
// offset inside the tile so they do not line up (docs/02, question 27).
function forageProp(x, y) {
  if (!forage) return null;
  const s = forage.seed ?? 41;
  if (hash2(x, y, s) >= forage.chance) return null;
  if (noTrees && treeAt(x, y)) return null; // where a tree would have stood there is no mushroom, as in a world that has the tree
  if (!treeNear(x, y, forage.near ?? 2)) return null;
  const kind = weightedPick(forage.kinds, hash2(x, y, s + 1));
  const u = (hash2(x, y, s + 2) - 0.5) * 0.6;
  const v = (hash2(x, y, s + 3) - 0.5) * 0.6;
  return createProp({ sprite: kind, tile: [x, y], solid: false, offset: [Math.round((u - v) * 32), Math.round((u + v) * 16)] });
}

// A wild tile: forest by the wild rule, a forage object near the trees, or plain grass.
function wildTile(x, y) {
  const t = createTile();
  if (!wild) return t;
  const rock = wildRockAt(x, y);
  const kind = wildTreeAt(x, y);
  if (rock) t.prop = createProp({ sprite: rock, tile: [x, y] });
  else if (kind) t.prop = createProp({ sprite: kind, tile: [x, y] });
  else t.prop = forageProp(x, y);
  return t;
}

export function createTile(floor = defaultFloor) {
  return { floor, n: null, w: null, prop: null, room: 0, items: null };
}

// ---- items on the floor (docs/10) ----
// Entries { id, count, fill? } lying on a tile; the list is made on first use.

export function itemsAt(x, y, layer = 0) {
  return tileAt(x, y, layer).items || [];
}

export function dropItem(x, y, entry, layer = 0) {
  const t = growTile(x, y, layer);
  markDirty(x, y);
  if (!t.items) t.items = [];
  // The entry itself goes on the floor, less its grid position, so a bag
  // keeps everything in it and a belt its slots (docs/11).
  const e = douse({ ...entry }); // a torch on the floor is out
  delete e.x;
  delete e.y;
  delete e.rot;
  if (e.uid == null) e.uid = nextId("e"); // an item on the floor is named by its uid in a guest's command: the logs of a felled tree were literals with none
  t.items.push(e);
  return e;
}

export function takeItem(x, y, entry, layer = 0) {
  markDirty(x, y);
  const t = tileAt(x, y, layer);
  if (!t.items) return false;
  const i = t.items.indexOf(entry);
  if (i >= 0) t.items.splice(i, 1);
  if (!t.items.length) t.items = null;
  // A thrown thing remembers where it landed and how it points (docs/20); in a hand or a bag it does not.
  if (i >= 0) {
    delete entry.at;
    delete entry.angle;
  }
  return i >= 0;
}

// Clear a prop from every tile it stands on. Felling a tree is this plus logs
// on the ground (docs/02: nothing caches a tree anywhere else).
// Stand a prop (lifted with removeProp) with its anchor at (tx, ty). The
// footprint keeps its shape; the caller checks the tiles are clear.
export function placeProp(prop, tx, ty) {
  const [w, h] = prop.footprint;
  prop.tile = [tx, ty];
  prop.tiles = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) prop.tiles.push([tx + dx, ty + dy]);
  for (const [x, y] of prop.tiles) growTile(x, y).prop = prop;
  if (prop.fire) fireProps.add(prop);
  propsById.set(prop.id, prop); // a lifted prop left the registry (removeProp); put down, it is findable by its id again
  touch(tx, ty);
  groundChanged(prop.tiles, prop);
}

// A prop turned into another kind in place (a fruit tree picked bare, or bearing again), with the day it will change next or null: the
// sprite and `regrowAt` are saved with the prop, and the chunk goes to a guest (fruit.js).
export function restage(prop, sprite, regrowAt) {
  prop.sprite = sprite;
  if (regrowAt === null || regrowAt === undefined) delete prop.regrowAt;
  else prop.regrowAt = regrowAt;
  touch(prop.tile[0], prop.tile[1]);
}

export function removeProp(prop) {
  for (const [tx, ty] of prop.tiles) {
    const t = tileAt(tx, ty);
    if (t.prop === prop) t.prop = null;
  }
  fireProps.delete(prop);
  propsById.delete(prop.id);
  touch(prop.tile[0], prop.tile[1]);
  groundChanged(prop.tiles, prop);
}

// ---- the ground's hooks (docs/15) ----

export function onGroundChange(fn) {
  groundListeners.push(fn);
}

function groundChanged(tiles, prop = null) {
  for (const fn of groundListeners) fn(tiles, prop);
}

// The only way a floor changes after load, so the ground hears of it.
export function setFloor(x, y, id, layer = 0) {
  const t = growTile(x, y, layer);
  if (t.floor === id) return;
  t.floor = id;
  touch(x, y);
  groundChanged([[x, y]]);
}

// The biome a tile belongs to: inside the bounds the first scatter rule whose
// rect holds it, beyond them the wild rule's, else "harvest".
export function biomeAt(x, y) {
  if (inBounds(x, y)) {
    for (const r of biomeRects) {
      const [rx, ry, rw, rh] = r.rect;
      if (x >= rx && y >= ry && x < rx + rw && y < ry + rh) return r.biome;
    }
    return "harvest";
  }
  return wildBiome || "harvest";
}

// A wall segment on a tile edge. kind: "wall" | "door" | "window". A window has
// wooden shutters: closed blocks sight, open lets you see through (nobody climbs through a window).
//
// An opening is a stack (docs/09): boards on either side, each with its own
// health, and the leaf (the door, or the shutters) with health of its own.
// Read from the attacker's side: that side's boards, the leaf, the far side's
// boards. Everything is spent; a broken leaf is never a leaf again.
export const BOARD_HP = 40;
export const DOOR_HP = 100;
export const SHUTTER_HP = 60;
export const BOARDS_PER_SIDE = 3;

// ---- building (docs/13) ----

export const WALL_SPRITE_DEFAULT = "wall_log";

// The two tiles an edge separates: its own, and the one across it.
export function edgeTiles(tx, ty, edge) {
  return edge === "n" ? [[tx, ty], [tx, ty - 1]] : [[tx, ty], [tx - 1, ty]];
}

// The edge's midpoint on the ground, in grid coordinates.
export function edgeMid(tx, ty, edge) {
  return edge === "n" ? [tx, ty - 0.5] : [tx - 0.5, ty];
}

// Whether a door or a window may be built onto what stands on an edge (Michael, 2026-10-17, #147: "make all walls solid as
// built, and then you can build a window or door directly over top and it stamps it into place and creates the opening"):
// over a plain wall (a door, being a gate, over a fence or bars too; a window not), or over a broken door or window of its own kind,
// as a new one and never a repair ("everything spent, nothing repaired"). An edge with nothing on it takes any kind.
export function canStampOver(existing, kind) {
  if (!existing) return true;
  if (kind !== "door" && kind !== "window") return false;
  if (existing.kind === "wall") return kind === "door" || !wallRule(existing.sprite).seeThrough; // a window is no use in a fence or bars
  return existing.kind === kind && !!existing.broken;
}

// Whether a wall of this kind may be built on the edge: nothing there yet (or a plain wall or a broken opening a door or a
// window may stand in, `canStampOver`), no solid prop whose footprint spans it, and a door needs both its tiles to be
// walkable and clear so it can be walked through and stood at.
export function canBuildWall(tx, ty, edge, kind = "wall") {
  if (!canStampOver(tileAt(tx, ty)[edge], kind)) return false;
  const [a, b] = edgeTiles(tx, ty, edge);
  const pa = tileAt(a[0], a[1]).prop;
  const pb = tileAt(b[0], b[1]).prop;
  if (pa && pa === pb && pa.solid) return false;
  if (kind === "door" && (!isWalkableTile(a[0], a[1]) || !isWalkableTile(b[0], b[1]) || pa || pb)) return false; // both its tiles clear: the dead go for a door, and need to stand at it
  return true;
}

// Whether a tile is one of the two a door stands between (nothing is put down on one, and nothing is generated there:
// the dead who want a room go for its door and must be able to stand at it, #134).
export function besideDoor(x, y) {
  const t = tileAt(x, y);
  if ((t.n && t.n.kind === "door") || (t.w && t.w.kind === "door")) return true;
  const s = tileAt(x, y + 1);
  if (s.n && s.n.kind === "door") return true;
  const e = tileAt(x + 1, y);
  return !!(e.w && e.w.kind === "door");
}

// Build a wall, door, or window on an edge, as an authored one would be, and
// tell sight, light, and the rooms.
export function buildWall(tx, ty, edge, kind, sprite = WALL_SPRITE_DEFAULT) {
  const t = growTile(tx, ty);
  const existing = t[edge];
  if (existing && !canStampOver(existing, kind)) return false;
  if (existing) {
    // Stamped over a wall (or a broken opening): the new one is of the same material, so a door in a wood wall is a wood door,
    // and it remembers the wall it replaced, which the removal tool puts back (never a hole where a wall stood).
    sprite = existing.sprite;
    for (const b of [...bracketSet]) if (b.wall === existing) bracketSet.delete(b);
  }
  const wall = createWall(kind, sprite);
  if (existing && existing.kind === "wall") {
    wall.under = existing.sprite;
    if (existing.built) wall.underBuilt = true; // the player's own wall comes back the player's own
  } else if (existing && existing.under) {
    wall.under = existing.under; // a new door over a broken stamped one still stands in the wall it was stamped into
    if (existing.underBuilt) wall.underBuilt = true;
  }
  wall.built = true; // made by the player: the removal tool may take it down (docs/13)
  wall.at = [tx, ty];
  t[edge] = wall;
  touch(tx, ty);
  rebuildRoomsAround(tx, ty, edge);
  return true;
}

// Take a wall, door, or window off an edge, and whatever hangs on it (its
// boards go with it, a torch bracket is forgotten).
export function destroyWall(tx, ty, edge, restoreUnder = false) {
  const t = growTile(tx, ty);
  const wall = t[edge];
  if (!wall) return false;
  for (const b of [...bracketSet]) if (b.wall === wall) bracketSet.delete(b);
  t[edge] = null;
  if (restoreUnder && wall.under) {
    // The removal tool takes a built door or window out of the wall it was stamped into, and the wall is back.
    t[edge] = createWall("wall", wall.under);
    t[edge].at = [tx, ty];
    if (wall.underBuilt) t[edge].built = true;
  }
  touch(tx, ty);
  rebuildRoomsAround(tx, ty, edge);
  return true;
}

// ---- fences (Michael, 2026-10-17, #147; 2026-10-18, #174): the dead strike one down ----
// A fence, or a gate (a door in a fence), has hit points like a door: `fenceHp`, a gate `fenceGateFactor` of it (`createWall`). A dead one
// at it STRIKES it, on the attack animation and the bite's cooldown, each strike taking `zombie.fenceStrike` hit points (`strikeFence`),
// as on a player; a crowd is simply more strikers. The damage stays (saved with the wall; nothing mends it). At nothing left it is gone
// (`destroyWall`: the save and the wire carry it like any change) and `fenceBurst` says where, for the splinters every client draws;
// every strike says `wallStruck`, one small jolt for every client's drawing of it. Walls never break (2026-10-10 stands): only what
// `wall.fence` says.

export function isFence(wall) {
  return !!wall && wallRule(wall.sprite).fence === true;
}

// The closed fence (or gate) a body at (gx, gy) is pressed against on the way to (tx, ty): within reach of the edge's middle
// and on the goal's side, the most so of the four edges round its tile; null when there is none.
export function fenceAhead(gx, gy, tx, ty, reach = 0.8) {
  const x = Math.round(gx);
  const y = Math.round(gy);
  const dx = tx - gx;
  const dy = ty - gy;
  const len = Math.hypot(dx, dy) || 1;
  let best = null;
  for (const [ex, ey, edge, mx, my] of [[x, y, "n", x, y - 0.5], [x, y, "w", x - 0.5, y], [x, y + 1, "n", x, y + 0.5], [x + 1, y, "w", x + 0.5, y]]) {
    const wall = tileAt(ex, ey)[edge];
    if (!isFence(wall) || (wall.kind === "door" && wall.open)) continue;
    if (Math.hypot(mx - gx, my - gy) > reach) continue;
    const dot = ((mx - gx) * dx + (my - gy) * dy) / len;
    if (dot <= 0.05) continue;
    if (!best || dot > best.dot) best = { wall, tx: ex, ty: ey, edge, dot };
  }
  return best;
}

// What a fence or gate stands: its hit points when made.
function fenceLimit(wall) {
  return W.fenceHp * (wall.kind === "door" ? W.fenceGateFactor : 1);
}

// One strike on a fence or gate by one of the dead (zombie.js, the `pressHit` state at its active frame). Short of a break the health is
// the save's alone (`unsavedWall`, as a door's is: the wire sends no chunk for it; every client gets the jolt as an fx), and at nothing
// left it bursts (the destroyed wall rides the chunk).
export function strikeFence(wall, tx, ty, edge, amount) {
  if (tileAt(tx, ty)[edge] !== wall) return false;
  if (!Number.isFinite(wall.hp)) wall.hp = fenceLimit(wall); // a fence made before fences had hit points
  wall.hp -= amount;
  emit("wallStruck", { tx, ty, edge });
  if (wall.hp <= 0) {
    const [mx, my] = edgeMid(tx, ty, edge);
    destroyWall(tx, ty, edge);
    emit("fenceBurst", { x: mx, y: my, tx, ty, edge });
    return true;
  }
  unsavedWall(wall); // its health, short of a break, is the save's alone, as a door's is: the wire sends the break and the jolt
  return false;
}

export function createWall(kind, sprite) {
  return {
    kind,
    sprite,
    open: false,
    shutter: kind === "window" ? "closed" : null,
    boards: { near: [], far: [] }, // hit points per board, outermost last
    hp: wallRule(sprite).fence === true ? fenceLimit({ kind }) : kind === "wall" ? Infinity : kind === "door" ? DOOR_HP : SHUTTER_HP, // a door and a window always break, whatever they are made of: every entrance is one the dead can break; a fence has hit points too
    broken: false,
  };
}

export function boarded(wall) {
  return !!wall && (wall.boards.near.length + wall.boards.far.length > 0);
}

// Which side of the edge at (tx, ty) an actor at (gx, gy) stands on: +1 the
// near side (south of a north edge, east of a west edge), -1 the far side.
export function sideOf(tx, ty, edge, gx, gy) {
  return edge === "n" ? (gy >= ty - 0.5 ? 1 : -1) : gx >= tx - 0.5 ? 1 : -1;
}

function boardsOn(wall, side) {
  return side > 0 ? wall.boards.near : wall.boards.far;
}

// Nail a board on a side, if there is room. Planks are free until the inventory.
export function addBoard(wall, side) {
  const b = boardsOn(wall, side);
  if (b.length >= BOARDS_PER_SIDE) return false;
  b.push(BOARD_HP);
  touchWall(wall);
  return true;
}

// Pull a board on a side. It is gone.
export function pullBoard(wall, side) {
  const b = boardsOn(wall, side);
  if (!b.length) return false;
  b.pop();
  touchWall(wall);
  return true;
}

// Hit the stack from a side. Returns "board", "leaf", or null for what broke,
// after taking `amount` off whatever stands first in attack order.
export function damageOpening(wall, side, amount) {
  const mine = boardsOn(wall, side);
  const theirs = boardsOn(wall, -side);
  let broke = null;
  if (mine.length) {
    mine[mine.length - 1] -= amount;
    if (mine[mine.length - 1] <= 0) {
      mine.pop();
      broke = "board";
    }
  } else if (!wall.broken) {
    wall.hp -= amount;
    if (wall.hp <= 0) {
      wall.hp = 0;
      wall.broken = true;
      // A broken door is a doorway; broken shutters are an open hole.
      if (wall.kind === "door") wall.open = true;
      if (wall.kind === "window") wall.shutter = "open";
      broke = "leaf";
    }
  } else if (theirs.length) {
    theirs[theirs.length - 1] -= amount;
    if (theirs[theirs.length - 1] <= 0) {
      theirs.pop();
      broke = "board";
    }
  }
  if (broke) touchWall(wall);
  else if (amount) unsavedWall(wall); // its health, which the wire does not send short of a break, is saved
  return broke;
}

// Whether an opening is still shut against what the dead want of it: a door that is not a way through, or a window whose
// shutters are closed and whole or that carries boards (they batter one open to see in, never to pass, #134).
export function needsBreaking(wall) {
  if (!wall) return false;
  if (wall.kind === "door") return !wayOpen(wall);
  return boarded(wall) || (wall.shutter === "closed" && !wall.broken);
}

// Can a walking body pass this opening? Only a door, open or broken and unboarded: nobody climbs through a window
// (Michael, 2026-10-16), so a window is for sight and light alone, whatever state its shutters are in.
export function wayOpen(wall) {
  if (!wall) return true;
  if (boarded(wall)) return false;
  if (wall.kind === "door") return wall.open || wall.broken;
  return false;
}

// Is a room sealed (docs/09): every door shut and whole or boarded, every
// window shuttered and whole or boarded.
export function roomSealed(room) {
  if (!room) return false; // a room id from a step before a refind
  for (const op of room.openings) {
    const w = tileAt(op.tx, op.ty)[op.edge];
    if (!w) continue;
    if (boarded(w)) continue;
    if (w.broken) return false;
    if (w.kind === "door" && w.open) return false;
    if (w.kind === "window" && w.shutter === "open") return false;
  }
  return true;
}

// The opening of a room nearest to (gx, gy) that an attacker can stand beside: the tile on the attacker's side, which is
// whichever side of the edge is not in the room. Doors, and nobody climbs through a window (Michael, 2026-10-16), so the
// dead who want what is in a room go for its nearest door (open or shut, boarded or not: they break what is in the way).
// From outside, `windows` adds the windows still shut or boarded: Michael's ruling, "the dead may batter a window's
// shutters or boards open to see in, never to pass", so one is battered open for sight and a door is still the way in.
// Returns { wall, tx, ty, edge, stand, side, into, d }, or null when the room has nothing a body can stand at. `want`,
// a room id, is the room the attacker is trying to reach from inside this one: a door that leads into it is the one
// chosen, before the nearest.
export function breachTarget(room, gx, gy, want = 0, windows = false) {
  return breachTargets(room, gx, gy, want, windows)[0] || null;
}

// Every such opening of the room, the one `breachTarget` would pick first and then the rest, nearest first (the dead
// pick the first of them that they can walk to, zombie.js `wayIn`).
export function breachTargets(room, gx, gy, want = 0, windows = false) {
  // Breaking in from outside, or out from inside: the attacker stands on
  // whichever side of the opening they are on and goes through to the other.
  const inside = tileAt(Math.round(gx), Math.round(gy)).room === room.id;
  const out = [];
  for (const op of room.openings) {
    const w = tileAt(op.tx, op.ty)[op.edge];
    if (!w || !needsBreaking(w)) continue; // an opening that is already a way through is nothing to break (the dead walk through it)
    if (w.kind !== "door" && !(windows && !inside)) continue;
    const nearTile = [op.tx, op.ty];
    const farTile = op.edge === "n" ? [op.tx, op.ty - 1] : [op.tx - 1, op.ty];
    const nearIn = tileAt(nearTile[0], nearTile[1]).room === room.id;
    const roomTile = nearIn ? nearTile : farTile;
    const outTile = nearIn ? farTile : nearTile;
    const stand = inside ? roomTile : outTile;
    const into = inside ? outTile : roomTile;
    const side = stand === nearTile ? 1 : -1;
    if (!isWalkableTile(stand[0], stand[1])) continue;
    const toward = want > 0 && tileAt(into[0], into[1]).room === want;
    const d = Math.hypot(gx - stand[0], gy - stand[1]) - (toward ? 1000 : 0);
    out.push({ wall: w, tx: op.tx, ty: op.ty, edge: op.edge, stand, side, d, into });
  }
  return out.sort((a, b) => a.d - b.d);
}

// Bumped whenever the world changes, so sight is recomputed. With a tile given,
// the light's per-chunk version is bumped only for that chunk and its eight
// neighbours (a wall's shadow reaches no further than a source's radius, under
// a chunk) and the chunk is marked dirty, so it is never evicted (docs/23a, B2,
// B4); with none, every loaded chunk's version is bumped.
export let worldVersion = 0;
const touched = new Set(); // chunk keys changed since the wire last asked (docs/31/04: a chunk delta per change)
export function takeTouched() {
  const out = [];
  for (const k of touched) {
    const c = chunks.get(k);
    if (c) out.push([c.cx, c.cy]);
  }
  touched.clear();
  return out;
}
export function touch(x = null, y = null) {
  worldVersion++;
  if (x === null) {
    for (const c of chunks.values()) {
      c.lightVersion++;
      c.saved = null;
    }
    return;
  }
  const [cx, cy] = chunkCoord(Math.round(x), Math.round(y));
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const c = getChunk(cx + dx, cy + dy, false);
      if (c) c.lightVersion++;
    }
  }
  markDirty(x, y);
}

// A change on a wall names the wall's tile when the wall knows it.
function touchWall(wall) {
  if (wall.at) touch(wall.at[0], wall.at[1]);
  else touch();
}

// A chunk changed by play (a floor, a prop, an item, a wall): kept in memory for good.
export function markDirty(x, y) {
  const [cx, cy] = chunkCoord(Math.round(x), Math.round(y));
  const c = getChunk(cx, cy, false);
  if (c) {
    c.dirty = true;
    touched.add(chunkKey(cx, cy, c.layer));
  }
  unsaved(x, y);
}

// ---- the save's copy of each chunk (2026-10-15, `02`: a save that costs what changed) ----
// game.serialize keeps each chunk's saved form on the chunk (`saved`) and makes it again only once the chunk has
// changed. Every change that marks a chunk for the wire (markDirty, touch) drops it, for the chunk and its eight
// neighbours, since a prop is saved with the chunk of its anchor tile and a change may name another tile of its
// footprint. The few changes the wire never sends drop it here too, the anchor's chunk alone (`near` false): a
// fire's fuel burning, a station's job counting down, a sway's stamp, a door or a board losing health short of
// breaking, a container's bag made on first use. A change that forgets both is caught: the server's rolling copy
// and its last save, and the browser's every tenth autosave, make the whole save afresh and say which chunk the
// copy had wrong (game.verifySaveCache).
export function unsaved(x, y, near = true) {
  const [cx, cy] = chunkCoord(Math.round(x), Math.round(y));
  if (!near) {
    const c = getChunk(cx, cy, false);
    if (c) c.saved = null;
    return;
  }
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const c = getChunk(cx + dx, cy + dy, false);
      if (c) c.saved = null;
    }
  }
}

// A wall's change that the wire does not send (its health): the save's copy of its tile's chunks is dropped.
function unsavedWall(wall, near = true) {
  if (wall.at) unsaved(wall.at[0], wall.at[1], near);
  else for (const c of chunks.values()) c.saved = null;
}

// Every loaded chunk's saved form, in serializeMap's order: the copy kept on the chunk, or `make(chunk)`'s, kept.
export const saveCacheCount = { made: 0, kept: 0 };
export function savedChunks(make) {
  const out = [];
  for (const c of chunks.values()) {
    if (!c.saved) {
      c.saved = make(c);
      saveCacheCount.made++;
    } else saveCacheCount.kept++;
    out.push(c.saved);
  }
  return out;
}

// Every loaded chunk, for the cache's check (game.verifySaveCache).
export function eachChunk(fn) {
  for (const c of chunks.values()) fn(c);
}

export function chunkCount() {
  return chunks.size;
}

export function allProps() {
  return [...propsById.values()];
}

// ---- the map as data, and back (docs/31/05, item 24: the save, and the join's snapshot) ----
// Every loaded chunk whole: the floors run-length, the walls with their state, the
// props by their anchor tile with their live fields, the items on the floor. A chunk
// not loaded at the save regrows from the file and the seed. The characters that
// sleep on dropped chunks are the caller's to serialise (game.js); the map keeps
// the keys.

const PROP_DERIVED = new Set(["kind", "tiles"]); // made again by createProp from the sprite and the footprint

export function serializeProp(p) {
  const out = {};
  for (const [k, v] of Object.entries(p)) if (!PROP_DERIVED.has(k) && typeof v !== "function") out[k] = v;
  return out;
}

function wallData(w) {
  const { at, ...rest } = w; // `at` is the tile it hangs on, given back on install
  return rest;
}

export function serializeChunk(c) {
  const floors = []; // [kind, run] over the chunk's tiles, row by row
  const walls = [];
  const props = [];
  const items = [];
  let last = null;
  for (let i = 0; i < CHUNK * CHUNK; i++) {
    const t = c.tiles[i];
    if (last && last[0] === t.floor) last[1]++;
    else floors.push((last = [t.floor, 1]));
    const lx = i % CHUNK;
    const ly = (i - lx) / CHUNK;
    if (t.n) walls.push([lx, ly, "n", wallData(t.n)]);
    if (t.w) walls.push([lx, ly, "w", wallData(t.w)]);
    if (t.prop && t.prop.tile[0] === c.cx * CHUNK + lx && t.prop.tile[1] === c.cy * CHUNK + ly) props.push(serializeProp(t.prop));
    if (t.items && t.items.length) items.push([lx, ly, t.items]);
  }
  return { cx: c.cx, cy: c.cy, layer: c.layer, wild: !!c.wild, dirty: !!c.dirty, floors, walls, props, items };
}

export function serializeMap() {
  return {
    chunks: [...chunks.values()].map(serializeChunk),
    pending: serializePending(),
  };
}

// The spawns owed, alone: the save's cache asks for this part without the chunks (game.js).
export function serializePending() {
  return pendingSpawns.map(([x, y]) => [x, y]);
}

// The sleepers' lists by chunk key, for the caller to serialise and to put back.
export function sleeperEntries() {
  return [...sleepers.entries()];
}

export function setSleepers(entries) {
  sleepers.clear();
  woken.length = 0;
  for (const [k, list] of entries) sleepers.set(Number(k), list);
}

// A saved chunk in place of the one the file and the seed would grow. The
// authored props the load made for these tiles are superseded by the saved ones.
export function installChunk(d) {
  const { cx, cy } = d;
  const layer = d.layer || 0;
  const k = chunkKey(cx, cy, layer);
  // The chunk this one replaces: the props that stood on it (anchored here) leave the registry and the fire
  // set, and the delta's own are put back by installProp. Without this a prop removed on the host stayed in
  // a guest's registry and kept burning in its fire set, a light at a tile where nothing stood (found
  // reviewing placement, 2026-10-13). Only the authored ones were let go before.
  const old = chunks.get(k);
  if (old) {
    for (const t of old.tiles) {
      const pr = t && t.prop;
      if (!pr || pr.tile[0] < cx * CHUNK || pr.tile[0] >= (cx + 1) * CHUNK || pr.tile[1] < cy * CHUNK || pr.tile[1] >= (cy + 1) * CHUNK) continue;
      fireProps.delete(pr);
      if (propsById.get(pr.id) === pr) propsById.delete(pr.id);
    }
  }
  for (let i = 0; i < CHUNK * CHUNK; i++) {
    const x = cx * CHUNK + (i % CHUNK);
    const y = cy * CHUNK + Math.floor(i / CHUNK);
    const st = layer === 0 && source && source(x, y);
    if (st && st.prop) {
      fireProps.delete(st.prop);
      if (propsById.get(st.prop.id) === st.prop) propsById.delete(st.prop.id);
    }
  }
  const tiles = new Array(CHUNK * CHUNK);
  let i = 0;
  for (const [floor, n] of d.floors) for (let j = 0; j < n; j++) tiles[i++] = createTile(floor);
  for (const [lx, ly, edge, w] of d.walls) tiles[ly * CHUNK + lx][edge] = { ...w, at: [cx * CHUNK + lx, cy * CHUNK + ly] };
  for (const [lx, ly, list] of d.items) tiles[ly * CHUNK + lx].items = list;
  const c = { cx, cy, layer, tiles, floorCache: null, floorDirty: true, wild: !!d.wild, dirty: !!d.dirty, lightVersion: 0, saved: null };
  chunks.set(k, c);
  lastChunk = null;
  roomsDirty = true;
  return c;
}

// A saved prop back on its tiles (after every chunk is installed, since a
// footprint may cross a chunk's edge): made by createProp from its sprite, then
// its live fields put over the fresh ones.
// A prop from its record, not on any tile: what a character carries (docs/13) rides in its own
// record (entities/character.js `carried`), since a lifted prop is on no chunk to be found by id.
export function reviveProp(data, onMap = true) {
  const prop = createProp({ id: data.id, sprite: data.sprite, tile: data.tile, footprint: data.footprint, facing: data.facing, offset: data.offset, solid: data.solid, radius: data.radius });
  Object.assign(prop, data, { tiles: prop.tiles, kind: "prop" });
  if (prop.fire && !Number.isFinite(prop.fire.fuel)) prop.fire.fuel = 0; // a save from before 2026-10-15 may hold the word (createProp)
  for (const k of Object.keys(prop)) if (!(k in data) && !PROP_DERIVED.has(k)) delete prop[k]; // exactly the saved shape (a field the load had dropped stays dropped)
  // A carried prop stands on no tile, so it is no light at its old one and not in the registry (as removeProp leaves it).
  if (prop.fire && onMap) fireProps.add(prop);
  else fireProps.delete(prop);
  if (!onMap) propsById.delete(prop.id);
  return prop;
}

export function installProp(data) {
  const prop = reviveProp(data);
  for (const [x, y] of prop.tiles) {
    const t = peekTile(x, y, prop.layer || 0);
    if (t) t.prop = prop;
  }
  return prop;
}

// The brackets from the walls that carry one, over every loaded chunk.
export function rebuildBrackets() {
  bracketSet.clear();
  for (const c of chunks.values()) {
    for (let i = 0; i < CHUNK * CHUNK; i++) {
      const t = c.tiles[i];
      const tx = c.cx * CHUNK + (i % CHUNK);
      const ty = c.cy * CHUNK + Math.floor(i / CHUNK);
      if (t.n && t.n.bracket) bracketSet.add({ tx, ty, edge: "n", wall: t.n });
      if (t.w && t.w.bracket) bracketSet.add({ tx, ty, edge: "w", wall: t.w });
    }
  }
}

// The map put back from a save, after loadMap(json) has set the authored source.
export function restoreMap(data) {
  for (const d of data.chunks) installChunk(d);
  for (const d of data.chunks) for (const p of d.props) installProp(p);
  rebuildBrackets();
  pendingSpawns.length = 0;
  for (const [x, y] of data.pending || []) pendingSpawns.push([x, y]);
  rebuildRooms();
  touch();
}

// ---- eviction, and the dead that sleep with their chunk (docs/23a, B1, B2: a first slice of 03's records) ----

const sleepers = new Map(); // chunk key -> the characters that stood in it when it was dropped (an empty list: grown before, its dead gone elsewhere)
const woken = []; // keys of chunks grown again with sleepers on record
const evictListeners = [];

// Called with (key, cx, cy) for every chunk dropped; the light cache forgets it.
export function onEvict(fn) {
  evictListeners.push(fn);
}

// Drop every wild chunk that play has not changed and that lies more than
// `radius` chunks (Chebyshev) from (gx, gy), unless `keep(cx, cy)` says not to.
// Returns [[key, cx, cy], ...]; the caller puts the characters standing in them
// to sleep (sleep). The wild is deterministic by hash, so a dropped chunk grows
// back the same chunk, and its dead come back from their record.
export function evictFar(gx, gy, radius, keep = () => false) {
  const [pcx, pcy] = chunkCoord(Math.round(gx), Math.round(gy));
  const out = [];
  for (const [k, c] of chunks) {
    if (!c.wild || c.dirty || c.layer !== 0) continue;
    if (Math.max(Math.abs(c.cx - pcx), Math.abs(c.cy - pcy)) <= radius) continue;
    if (keep(c.cx, c.cy)) continue;
    // Its props leave the registry and the fire set with it (the sync check found evicted mushrooms kept
    // as ghosts in the host's registry, 2026-10-13); the chunk grows back with new props and new ids.
    for (const t of c.tiles) {
      const pr = t && t.prop;
      if (!pr || pr.tile[0] < c.cx * CHUNK || pr.tile[0] >= (c.cx + 1) * CHUNK || pr.tile[1] < c.cy * CHUNK || pr.tile[1] >= (c.cy + 1) * CHUNK) continue;
      fireProps.delete(pr);
      if (propsById.get(pr.id) === pr) propsById.delete(pr.id);
    }
    chunks.delete(k);
    out.push([k, c.cx, c.cy]);
    for (const fn of evictListeners) fn(k, c.cx, c.cy);
  }
  if (out.length) lastChunk = null;
  return out;
}

export function sleep(key, list) {
  sleepers.set(key, list);
}

// How many characters sleep on dropped chunks' records (for the checks).
export function sleepingCount() {
  let n = 0;
  for (const list of sleepers.values()) n += list.length;
  return n;
}

// The characters whose chunks grew back since the last call, to rejoin the world.
export function takeWoken() {
  const out = [];
  for (const k of woken.splice(0)) {
    out.push(...(sleepers.get(k) || []));
    sleepers.delete(k);
  }
  return out;
}

// Numeric keys: string keys allocated on every tile lookup were a measurable
// cost when visibility walked thousands of edges per step (2026-10-09).
const KEY_OFF = 32768;
// Every lookup takes a layer (docs/02, 2026-10-08: layer-ready data from day
// one; docs/08: added 2026-10-09). It is always 0 for now; a chunk on another
// layer is empty and never wild.
export function chunkKey(cx, cy, layer = 0) {
  return layer * 4294967296 + (cx + KEY_OFF) * 65536 + (cy + KEY_OFF);
}

export function chunkCoord(x, y) {
  return [Math.floor(x / CHUNK), Math.floor(y / CHUNK)];
}

let lastChunk = null; // most lookups hit the same chunk as the last one

export function getChunk(cx, cy, create = true, layer = 0) {
  if (lastChunk && lastChunk.cx === cx && lastChunk.cy === cy && lastChunk.layer === layer) return lastChunk;
  const k = chunkKey(cx, cy, layer);
  let c = chunks.get(k);
  if (c) lastChunk = c;
  if (c || !create) return c || null;
  const tiles = new Array(CHUNK * CHUNK);
  let hasWalls = false;
  let anyWild = false;
  for (let ly = 0; ly < CHUNK; ly++) {
    for (let lx = 0; lx < CHUNK; lx++) {
      const x = cx * CHUNK + lx;
      const y = cy * CHUNK + ly;
      let t = layer === 0 && source && source(x, y);
      if (!t) {
        if (layer !== 0 || inBounds(x, y)) t = createTile();
        else {
          t = wildTile(x, y);
          anyWild = true;
        }
      }
      if (t.n || t.w) hasWalls = true;
      if (t.n) t.n.at = [x, y]; // so a change on the wall can name its tile (touchWall)
      if (t.w) t.w.at = [x, y];
      tiles[ly * CHUNK + lx] = t;
    }
  }
  // `wild` and `dirty` decide eviction (docs/23a, B2); `lightVersion` is the light cache's key (B4).
  c = { cx, cy, layer, tiles, floorCache: null, floorDirty: true, wild: anyWild, dirty: false, lightVersion: 0, saved: null };
  chunks.set(k, c);
  touched.add(k); // grown: a guest learns of it like any change (net.js; the guest cannot grow it itself, its settings could shape it differently)
  lastChunk = c;
  // Open field cannot change any room, so only a chunk with walls (or one whose
  // edge walls a neighbouring room may touch) forces the rooms to be refound.
  if (hasWalls) roomsDirty = true;
  // A wild chunk brings a few of the dead with it, on free tiles.
  if (sleepers.has(k)) woken.push(k); // grown before: its dead sleep on record, not rolled again (B2)
  else if (anyWild && wild && wild.zombiesPerChunk) {
    const [lo, hi] = wild.zombiesPerChunk;
    const n0 = lo + Math.floor(hash2(cx, cy, (wild.seed ?? 1) + 3) * (hi - lo + 1));
    // The Starting population rule: the count scaled, its fraction settled by the chunk's own hash, so a factor of one
    // is exactly the map's number and any other is the same in any order and on every machine.
    const n = Math.floor(n0 * popFactor + hash2(cx, cy, (wild.seed ?? 1) + 6));
    for (let i = 0; i < n; i++) {
      const lx = Math.floor(hash2(cx * 31 + i, cy, (wild.seed ?? 1) + 4) * CHUNK);
      const ly = Math.floor(hash2(cx, cy * 31 + i, (wild.seed ?? 1) + 5) * CHUNK);
      const x = cx * CHUNK + lx;
      const y = cy * CHUNK + ly;
      if (!tiles[ly * CHUNK + lx].prop) pendingSpawns.push([x, y]);
    }
  }
  return c;
}

export function loadedChunks() {
  return chunks.values();
}

// The tile at integer (x, y) for reading. A read never grows a chunk: beyond
// the grown ring it sees the blank tile (plain floor, outdoors), the same on
// every machine whatever the window shows, so the world is the simulation's
// alone (docs/31/05, item 8; docs/02, 2026-10-13). Growth is ensureAround's
// (the ring round each player) and the mutators' (growTile).
export function tileAt(x, y, layer = 0) {
  const cx = Math.floor(x / CHUNK);
  const cy = Math.floor(y / CHUNK);
  const c = getChunk(cx, cy, false, layer);
  if (!c) return blank;
  return c.tiles[(y - cy * CHUNK) * CHUNK + (x - cx * CHUNK)];
}

// The tile at integer (x, y) for writing: grows the chunk if it is not loaded.
// The mutators' lookup; nothing that only reads should call it.
export function growTile(x, y, layer = 0) {
  const cx = Math.floor(x / CHUNK);
  const cy = Math.floor(y / CHUNK);
  const c = getChunk(cx, cy, true, layer);
  return c.tiles[(y - cy * CHUNK) * CHUNK + (x - cx * CHUNK)];
}

// The blank tile a read beyond the grown ring returns (for a check to recognise).
export function blankTile() {
  return blank;
}

// The tile at (x, y) only if its chunk is loaded.
export function peekTile(x, y, layer = 0) {
  const c = getChunk(Math.floor(x / CHUNK), Math.floor(y / CHUNK), false, layer);
  if (!c) return null;
  return c.tiles[(y - c.cy * CHUNK) * CHUNK + (x - c.cx * CHUNK)];
}

// ---- walls on edges ----

// The tile and slot that hold the edge between two 4-adjacent tiles.
export function edgeBetween(x0, y0, x1, y1) {
  if (x1 === x0 + 1) return [x1, y0, "w"];
  if (x1 === x0 - 1) return [x0, y0, "w"];
  if (y1 === y0 + 1) return [x0, y1, "n"];
  return [x0, y0, "n"];
}

// The wall on the edge between two 4-adjacent tiles, or null.
export function wallBetween(x0, y0, x1, y1) {
  if (x1 === x0 + 1) return tileAt(x1, y0).w;
  if (x1 === x0 - 1) return tileAt(x0, y0).w;
  if (y1 === y0 + 1) return tileAt(x0, y1).n;
  if (y1 === y0 - 1) return tileAt(x0, y0).n;
  return null;
}

export function blocksMove(wall) {
  if (!wall) return false;
  return !wayOpen(wall);
}

// How much light an edge lets through, 0..1 (docs/08). A plain wall and a
// closed door nothing, an open door or shutter everything, a closed shutter a
// small leak between the planks; later a glass pane most and a curtain little.
// Sight is transmission above a half: light and sight share one set of
// blockers, now with a number.
export const openingTunables = { shutterLeak: 0.05 };

export function transmission(wall) {
  if (!wall) return 1;
  if (boarded(wall)) return 0;
  if (wall.kind === "wall") return wallRule(wall.sprite).seeThrough ? 1 : 0; // a fence or bars: sight and light pass
  if (wall.broken) return 1;
  if (wall.kind === "window") return wall.shutter === "closed" ? openingTunables.shutterLeak : 1;
  return wall.open || wallRule(wall.sprite).seeThrough ? 1 : 0; // a shut gate in a fence still passes sight
}

export function blocksSight(wall) {
  return transmission(wall) < 0.5;
}

// Openings (doors and windows) within `r` tiles of (gx, gy), nearest first.
// Each carries the edge midpoint and the tile on the far side from the asker.
export function openingsNear(gx, gy, r = 1.15) {
  const out = [];
  const cx = Math.round(gx);
  const cy = Math.round(gy);
  for (let ty = cy - 2; ty <= cy + 2; ty++) {
    for (let tx = cx - 2; tx <= cx + 2; tx++) {
      const t = tileAt(tx, ty);
      if (t.n && t.n.kind !== "wall") {
        const mx = tx;
        const my = ty - 0.5;
        const d = Math.hypot(gx - mx, gy - my);
        if (d <= r) out.push({ wall: t.n, edge: "n", tx, ty, mx, my, d, to: gy < my ? [tx, ty] : [tx, ty - 1] });
      }
      if (t.w && t.w.kind !== "wall") {
        const mx = tx - 0.5;
        const my = ty;
        const d = Math.hypot(gx - mx, gy - my);
        if (d <= r) out.push({ wall: t.w, edge: "w", tx, ty, mx, my, d, to: gx < mx ? [tx, ty] : [tx - 1, ty] });
      }
    }
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

// Which side of the edge at (tx, ty) is outdoors: +1 for the near side (south
// of a north edge, east of a west edge), -1 for the far side. When both sides
// are rooms or both are outdoors, the near side is treated as outside.
export function outsideSign(tx, ty, edge) {
  const near = tileAt(tx, ty).room;
  const far = edge === "n" ? tileAt(tx, ty - 1).room : tileAt(tx - 1, ty).room;
  if (far !== 0 && near === 0) return 1;
  if (far === 0 && near !== 0) return -1;
  return 1;
}

// Segments of an edge (as fractions 0..1 along it) that a body cannot pass.
// An open doorway is passable across its whole width. A first version kept
// the jambs solid, which left a gap exactly one body wide: you fitted only when
// perfectly centred, and Michael found the doors impassable (2026-10-09).
function moveSegments(wall) {
  if (!wall) return null;
  if (wayOpen(wall)) return null;
  return FULL_EDGE;
}
const FULL_EDGE = [[0, 1]];

// ---- what a floor allows (docs/30, law 8) ----
// A floor's sprite definition may say `walk: false` (water: no entity walks
// it), `walk: 0.5` (shallow water: everyone slows), and `drink: true` (you
// drink and fill beside it, as at the well). Read once per floor id.
const floorRules = new Map();
export function floorRule(id) {
  let r = floorRules.get(id);
  if (r) return r;
  let def = null;
  try { def = getDef(id); } catch { def = null; }
  const walk = def && def.walk !== undefined ? def.walk : true;
  r = { walk: walk === false ? false : walk === true ? 1 : Number(walk) || 1, drink: !!(def && def.drink) };
  floorRules.set(id, r);
  return r;
}

// What a wall material allows (docs/30 step 0): `wall.seeThrough` (a fence, bars,
// a parapet: sight and light pass, bodies do not, and it bounds no room).
const wallRules = new Map();
export function wallRule(sprite) {
  let r = wallRules.get(sprite);
  if (r) return r;
  let def = null;
  try { def = getDef(sprite); } catch { def = null; }
  const w = (def && def.wall) || {};
  r = { seeThrough: !!w.seeThrough, fence: !!w.fence };
  wallRules.set(sprite, r);
  return r;
}

export function isWalkableTile(x, y) {
  const t = tileAt(x, y);
  return !(t.prop && t.prop.solid) && floorRule(t.floor).walk !== false;
}

// The speed factor of the ground under a point: 1 on land, less in shallow water.
export function floorSpeedAt(gx, gy) {
  const r = floorRule(tileAt(Math.round(gx), Math.round(gy)).floor);
  return r.walk === false ? 1 : r.walk;
}

export function drinkableAt(x, y) {
  return floorRule(tileAt(x, y).floor).drink;
}

// The same move for finding which fence lies across the dead's way to a goal they cannot reach (zombie.js `fenceWay`): in mode
// "gate" a closed gate (a door in a fence) is crossed, in mode "fence" any closed fence is, and only in a straight step, a
// diagonal never cutting through one.
export function canStepAcross(mode) {
  const through = (w) => isFence(w) && (mode === "fence" || w.kind === "door");
  return (x0, y0, x1, y1) => {
    if (x0 !== x1 && y0 !== y1) return canStep(x0, y0, x1, y1);
    if (!isWalkableTile(x1, y1)) return false;
    const w = wallBetween(x0, y0, x1, y1);
    return !blocksMove(w) || through(w);
  };
}

// One tile-to-tile move for pathing. Diagonals need both corner tiles free and
// both L-shaped routes clear of walls, so nothing cuts a wall corner.
export function canStep(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (!isWalkableTile(x1, y1)) return false;
  if (dx !== 0 && dy !== 0) {
    if (!isWalkableTile(x0 + dx, y0) || !isWalkableTile(x0, y0 + dy)) return false;
    return !blocksMove(wallBetween(x0, y0, x0 + dx, y0)) && !blocksMove(wallBetween(x0 + dx, y0, x1, y1))
      && !blocksMove(wallBetween(x0, y0, x0, y0 + dy)) && !blocksMove(wallBetween(x0, y0 + dy, x1, y1));
  }
  return !blocksMove(wallBetween(x0, y0, x1, y1));
}

function pointSegDist2(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy || 1;
  let t = ((px - ax) * vx + (py - ay) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + vx * t;
  const cy = ay + vy * t;
  return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

// Circle at float (gx, gy) with radius r against solid props and wall segments.
export function circleBlocked(gx, gy, r) {
  const r2 = r * r;
  const minX = Math.floor(gx - r + 0.5);
  const maxX = Math.floor(gx + r + 0.5);
  const minY = Math.floor(gy - r + 0.5);
  const maxY = Math.floor(gy + r + 0.5);
  for (let ty = minY; ty <= maxY + 1; ty++) {
    for (let tx = minX; tx <= maxX + 1; tx++) {
      const t = tileAt(tx, ty);
      // Water blocks like a solid tile: no body enters a wholly-water tile (docs/30, law 8).
      if (tx <= maxX && ty <= maxY && floorRule(t.floor).walk === false) {
        const cx = Math.max(tx - 0.5, Math.min(gx, tx + 0.5));
        const cy = Math.max(ty - 0.5, Math.min(gy, ty + 0.5));
        const dx = gx - cx;
        const dy = gy - cy;
        if (dx * dx + dy * dy < r2) return true;
      }
      if (t.prop && t.prop.solid && tx <= maxX && ty <= maxY) {
        if (t.prop.radius) {
          // A round thing (a trunk, a barrel) blocks only a circle at the tile
          // centre, so you can slip between canopies (Michael, 2026-10-09:
          // whole-tile trees made the wood impenetrable). Against round things
          // a body counts as narrower than against walls: two trunks a tile
          // apart left a 0.64 gap for a 0.6 body, passable only dead centre.
          const dx = gx - tx;
          const dy = gy - ty;
          const rr = Math.min(r, ROUND_BODY_RADIUS) + t.prop.radius;
          if (dx * dx + dy * dy < rr * rr) return true;
        } else {
          // Tile square spans [tx - 0.5, tx + 0.5]. Closest point to the circle centre:
          const cx = Math.max(tx - 0.5, Math.min(gx, tx + 0.5));
          const cy = Math.max(ty - 0.5, Math.min(gy, ty + 0.5));
          const dx = gx - cx;
          const dy = gy - cy;
          if (dx * dx + dy * dy < r2) return true;
        }
      }
      const ns = moveSegments(t.n);
      if (ns) {
        const ex = tx - 0.5;
        const ey = ty - 0.5;
        for (const [a, b] of ns) if (pointSegDist2(gx, gy, ex + a, ey, ex + b, ey) < r2) return true;
      }
      const ws = moveSegments(t.w);
      if (ws) {
        const ex = tx - 0.5;
        const ey = ty - 0.5;
        for (const [a, b] of ws) if (pointSegDist2(gx, gy, ex, ey + a, ex, ey + b) < r2) return true;
      }
    }
  }
  return false;
}

// The nearest open doorway on the row of north edges `row`, among the tiles
// within one of `x`. Returns its tile x, or null.
function doorOnRow(x, row) {
  let best = null;
  for (const tx of [x, x - 1, x + 1]) {
    const w = tileAt(tx, row).n;
    if (w && w.kind === "door" && wayOpen(w) && (best === null || Math.abs(tx - x) < Math.abs(best - x))) best = tx;
  }
  return best;
}

function doorOnColumn(col, y) {
  let best = null;
  for (const ty of [y, y - 1, y + 1]) {
    const w = tileAt(col, ty).w;
    if (w && w.kind === "door" && wayOpen(w) && (best === null || Math.abs(ty - y) < Math.abs(best - y))) best = ty;
  }
  return best;
}

// Move a circle by (dx, dy) with axis-separated resolution so it slides. If the
// circle is already inside something blocked, movement is unrestricted so it can
// walk out instead of being frozen. Same rule as the cozy parent.
//
// Door magnet: a doorway is one tile wide and a body is 0.6, so walking straight
// at a door only fits when nearly centred. When a step into a wall is blocked
// and an open doorway is within a tile along that wall, the blocked motion
// becomes a slide toward the doorway's centre instead.
// The round prop (trunk, barrel) that blocks a body at (gx, gy), or null.
function roundBlockerAt(gx, gy, r) {
  const cx = Math.round(gx);
  const cy = Math.round(gy);
  let best = null;
  let bestD = Infinity;
  for (let ty = cy - 1; ty <= cy + 1; ty++) {
    for (let tx = cx - 1; tx <= cx + 1; tx++) {
      const p = tileAt(tx, ty).prop;
      if (!p || !p.solid || !p.radius) continue;
      const dx = gx - tx;
      const dy = gy - ty;
      const rr = Math.min(r, ROUND_BODY_RADIUS) + p.radius;
      const d2 = dx * dx + dy * dy;
      if (d2 < rr * rr && d2 < bestD) {
        bestD = d2;
        best = [tx, ty];
      }
    }
  }
  return best;
}

export function moveCircle(gx, gy, r, dx, dy) {
  if (circleBlocked(gx, gy, r)) return { gx: gx + dx, gy: gy + dy };
  // Round things deflect: a step that would hit a trunk slides along its
  // tangent instead of stopping, so two trunks a tile apart funnel you into
  // the gap between them rather than catching you at the edge.
  const tx = gx + dx;
  const ty0 = gy + dy;
  if ((dx !== 0 || dy !== 0) && circleBlocked(tx, ty0, r)) {
    const c = roundBlockerAt(tx, ty0, r);
    if (c) {
      const vx = gx - c[0];
      const vy = gy - c[1];
      const len = Math.hypot(vx, vy) || 1;
      const tangX = -vy / len;
      const tangY = vx / len;
      const s = dx * tangX + dy * tangY;
      const sx = gx + tangX * s;
      const sy = gy + tangY * s;
      if (s !== 0 && !circleBlocked(sx, sy, r)) return { gx: sx, gy: sy };
    }
  }
  let nx = gx + dx;
  let ny = gy;
  if (dx !== 0 && circleBlocked(nx, gy, r)) {
    nx = gx;
    // Blocked crossing a west edge: the column of edges is at the tile we are entering.
    const col = dx > 0 ? Math.round(gx) + 1 : Math.round(gx);
    const door = doorOnColumn(col, Math.round(gy));
    if (door !== null && Math.abs(door - gy) <= 1) {
      const slide = Math.sign(door - gy) * Math.min(Math.abs(door - gy), Math.abs(dx));
      if (slide !== 0 && !circleBlocked(nx, gy + slide, r)) ny = gy + slide;
    }
  }
  const ty = ny + dy;
  if (dy !== 0 && circleBlocked(nx, ty, r)) {
    const row = dy > 0 ? Math.round(ny) + 1 : Math.round(ny);
    const door = doorOnRow(Math.round(nx), row);
    if (door !== null && Math.abs(door - nx) <= 1) {
      const slide = Math.sign(door - nx) * Math.min(Math.abs(door - nx), Math.abs(dy));
      if (slide !== 0 && !circleBlocked(nx + slide, ny, r)) nx += slide;
    }
  } else {
    ny = ty;
  }
  return { gx: nx, gy: ny };
}

// A free open tile within two steps of (x, y) by the authored map alone, never across a wall or a door, or null: where
// an extra of the dead the map places by hand stands (the Starting population rule, #130). It reads the authored tiles,
// not the chunks, which are not all grown when the world is made.
export function authoredNear(x, y, taken) {
  const at = (tx, ty) => (source ? source(tx, ty) : null);
  const open = (tx, ty) => {
    const t = at(tx, ty);
    return !t || (!(t.prop && t.prop.solid) && floorRule(t.floor).walk !== false);
  };
  const clear = (ax, ay, bx, by) => {
    const [ex, ey, slot] = edgeBetween(ax, ay, bx, by);
    const t = at(ex, ey);
    return !(t && t[slot]);
  };
  const seen = new Set([`${x},${y}`]);
  let frontier = [[x, y]];
  for (let ring = 1; ring <= 2; ring++) {
    const next = [];
    for (const [fx, fy] of frontier) {
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
        const tx = fx + dx;
        const ty = fy + dy;
        const k = `${tx},${ty}`;
        if (seen.has(k) || !open(tx, ty) || !clear(fx, fy, tx, ty)) continue;
        seen.add(k);
        next.push([tx, ty]);
        if (!taken.has(k)) return [tx, ty];
      }
    }
    frontier = next;
  }
  return null;
}

// Nearest walkable tile to (x, y), in expanding rings.
export function nearestWalkable(x, y, occupied = () => false, maxRing = 12) {
  for (let ring = 0; ring <= maxRing; ring++) {
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        if (isWalkableTile(x + dx, y + dy) && !occupied(x + dx, y + dy)) return [x + dx, y + dy];
      }
    }
  }
  return null;
}

// ---- rooms by flood fill ----
// Rooms are found, never authored (docs/02-decisions.md). A region of floor
// bounded by walls, doors, and windows is a room. Anything that touches an
// unloaded chunk or grows past ROOM_MAX tiles is outdoors, room 0.

export function markRoomsDirty() {
  roomsDirty = true;
}

const UNVISITED = -1;
const OUTDOORS = -2;
const STEPS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

let nextRoomId = 1; // never reused in a session, so a local refind cannot collide with a room it did not touch

// Flood-fill one region from (x0, y0) as room `id` over tiles whose room
// `fillable` accepts, stopping at any wall. Outdoors is a fill that reaches an
// unloaded tile or grows past ROOM_MAX; with `stopOutdoors` the fill ends
// there (a local refind throws the region away), without it the fill goes on
// to mark the whole outdoors in one pass (a full rebuild, which must not start
// a fill from every grass tile). Returns { region, outdoors, openings }.
function fillRegion(x0, y0, id, fillable, stopOutdoors = false) {
  const region = [];
  const stack = [x0, y0];
  tileAt(x0, y0).room = id;
  let outdoors = false;
  // The doors and windows the fill touched, so light can ask how much
  // daylight a room's openings admit (docs/07-lighting.md).
  const openings = [];
  const seenEdges = new Set();
  while (stack.length) {
    if (outdoors && stopOutdoors) {
      // Stop here, but every tile marked `id` must be in the region the caller resets:
      // the ones still on the stack were marked when pushed.
      while (stack.length) {
        const y = stack.pop();
        const x = stack.pop();
        region.push(x, y);
      }
      break;
    }
    const y = stack.pop();
    const x = stack.pop();
    region.push(x, y);
    if (region.length > ROOM_MAX * 2) outdoors = true;
    for (const [dx, dy] of STEPS4) {
      const nx = x + dx;
      const ny = y + dy;
      const nt = peekTile(nx, ny);
      if (!nt) {
        outdoors = true;
        continue;
      }
      const wall = wallBetween(x, y, nx, ny);
      // Any wall bounds a room, except a see-through one (a fence round a field, bars): a
      // region closed by fences is outdoors, and a cell behind bars is its corridor's room (docs/30 step 0).
      if (wall && !wallRule(wall.sprite).seeThrough) {
        if (wall.kind !== "wall" && !outdoors) {
          const [ex, ey, edge] = edgeBetween(x, y, nx, ny);
          const k = `${ex},${ey},${edge}`;
          if (!seenEdges.has(k)) {
            seenEdges.add(k);
            openings.push({ tx: ex, ty: ey, edge });
          }
        }
        continue;
      }
      if (!fillable(nt.room)) continue;
      nt.room = id;
      stack.push(nx, ny);
    }
  }
  return { region, outdoors, openings };
}

export function rebuildRooms() {
  roomsDirty = false;
  rooms.clear();
  // Outdoors is marked with its own value during the pass. A first version set
  // finished outdoor tiles back to 0, the same as "not visited", so every grass
  // tile started a new fill over the whole outdoors: 1.6 s for 16 chunks, and
  // the freeze Michael saw when walking into new ground (2026-10-09).
  for (const c of chunks.values()) for (const t of c.tiles) t.room = UNVISITED;
  for (const c of chunks.values()) {
    for (let i = 0; i < c.tiles.length; i++) {
      const t0 = c.tiles[i];
      if (t0.room !== UNVISITED) continue;
      const x0 = c.cx * CHUNK + (i % CHUNK);
      const y0 = c.cy * CHUNK + Math.floor(i / CHUNK);
      const id = nextRoomId;
      const { region, outdoors, openings } = fillRegion(x0, y0, id, (r) => r === UNVISITED);
      if (outdoors) {
        for (let j = 0; j < region.length; j += 2) peekTile(region[j], region[j + 1]).room = OUTDOORS;
      } else {
        rooms.set(id, { id, size: region.length / 2, openings });
        nextRoomId++;
      }
    }
  }
  for (const c of chunks.values()) for (const t of c.tiles) if (t.room < 0) t.room = 0;
}

// The rooms a wall change on one edge can touch, refound alone (docs/23a, B3):
// the edge's two tiles name at most two rooms; those rooms' tiles are reset
// and refilled from each tile. Outdoors (room 0) is fillable here, since a
// room opened to the yard must become the yard, and a fill that crosses open
// ground reaches ROOM_MAX and is outdoors as before; a yard newly walled in is
// a bounded fill from a tile of room 0, and becomes a room. A full rebuild
// scanned every loaded chunk (7 to 10 ms) on every wall built.
export function rebuildRoomsAround(tx, ty, edge) {
  if (roomsDirty) {
    rebuildRooms();
    return;
  }
  const seeds = [[tx, ty], edge === "n" ? [tx, ty - 1] : [tx - 1, ty]];
  const ids = new Set();
  for (const [x, y] of seeds) {
    const t = peekTile(x, y);
    if (t && t.room > 0) ids.add(t.room);
  }
  if (ids.size) {
    for (const c of chunks.values()) for (const t of c.tiles) if (ids.has(t.room)) t.room = UNVISITED;
    for (const id of ids) rooms.delete(id);
  }
  for (const [x, y] of seeds) {
    const t = peekTile(x, y);
    if (!t || t.room > 0) continue; // unloaded, or already refilled from the other seed
    const id = nextRoomId;
    const { region, outdoors, openings } = fillRegion(x, y, id, (r) => r === UNVISITED || r === 0, true);
    if (outdoors) {
      for (let j = 0; j < region.length; j += 2) peekTile(region[j], region[j + 1]).room = 0;
    } else {
      rooms.set(id, { id, size: region.length / 2, openings });
      nextRoomId++;
    }
  }
  for (const c of chunks.values()) for (const t of c.tiles) if (t.room === UNVISITED) t.room = 0;
}

export function roomsIfDirty() {
  if (roomsDirty) rebuildRooms();
}

export function roomAt(x, y) {
  roomsIfDirty();
  return tileAt(x, y).room;
}

export function roomCount() {
  return rooms.size;
}

// ---- authoring ----
// A map file is a base floor, `features` (roads), `sets` (buildings, floors,
// and props placed relative to a set's origin, with a padding ring), `scatter`
// rules, and a `wild` rule for beyond the bounds. A building is a rectangle of
// interior tiles with walls on its perimeter edges, openings in those walls,
// its own floor, and props placed relative to its corner. See loadMap below
// and data/maps/square.json. The result is sliced into chunks on first load.

export function createProp(def, offset = [0, 0]) {
  const [w, h] = def.footprint || [1, 1];
  const ox = def.tile[0] + offset[0];
  const oy = def.tile[1] + offset[1];
  const tiles = [];
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) tiles.push([ox + dx, oy + dy]);
  // A sprite definition may declare `collide: { radius }` in tiles: the prop
  // then blocks a circle at its tile centre rather than the whole tile. Tiles
  // with a solid prop stay unwalkable for pathing either way, so the dead walk
  // around trees while a body can brush past the trunk.
  const sdef = getDef(def.sprite);
  const radius = def.radius ?? sdef.collide?.radius ?? 0;
  const prop = {
    kind: "prop",
    id: def.id || nextId("p"), // the map file may carry one; else the world's counter (docs/31/08, habit 1)
    sprite: def.sprite,
    tile: [ox, oy],
    footprint: [w, h],
    tiles,
    solid: def.solid !== false,
    opaque: !!def.opaque,
    radius: w === 1 && h === 1 ? radius : 0,
    fire: null,
    // docs/10: a container has a bag made on first search from its loot
    // table; a tree has wood to chop; the well has water.
    container: sdef.container ? { ...sdef.container } : null,
    bag: null,
    searched: false,
    wood: sdef.wood || 0,
    water: !!sdef.water,
    // Drawn this many screen pixels off its tile's centre (forage objects), and
    // a thing the player can click (it wiggles, for now; question 27).
    offset: def.offset || null,
    interactable: !!sdef.interactable,
    // Which way it faces, for a sprite with facings (docs/17): the map's, else the first.
    facing: facingFor(sdef, def, w, h),
    furrowsPending: !!sdef.furrows && !def.facing,
  };
  // Fire is data on the sprite definition (docs/07-lighting.md): a light
  // radius, whether it lights its whole room, burns wood, cooks. Live state
  // (lit, fuel) sits on the prop.
  if (sdef.fire) {
    const f = sdef.fire;
    const holds = f.holds || null;
    const has = holds ? !!def.torch : false;
    prop.fire = {
      radius: f.radius || 0,
      room: !!f.room,
      burns: !!f.burns,
      cooks: !!f.cooks,
      holds, // "torch": a post, lit while it holds one
      has,
      lit: holds ? has : def.lit ?? f.lit ?? !f.burns,
      // The units in it now: the map's number, else none. The definition's `fire.fuel` names the item it burns (below),
      // and was read here as the count until 2026-10-15: an authored burner with no number of its own held the word
      // "log", and feeding it made the fuel not a number, a fire that never went out and marked its chunk every step
      // (found proving the save's cache, `02`).
      fuel: Number.isFinite(def.fuel) ? def.fuel : 0,
      maxFuel: f.maxFuel ?? 4,
      fuelItem: f.fuel || "log", // the item (or tag) it burns (docs/30 section 7)
      hoursPerUnit: f.hoursPerUnit ?? 2,
      flicker: f.flicker || null, // { amp, speed }: applied when the light map is composed on the GPU (docs/08)
    };
    fireProps.add(prop);
  }
  propsById.set(prop.id, prop);
  return prop;
}

// A prop's facing (docs/17): the map's if it has one, else the facing whose
// footprint matches the map's footprint (a bed laid along x is the mirror),
// else the first.
function facingFor(sdef, def, w, h) {
  if (!sdef.facings || !sdef.facings.length) return null;
  if (sdef.facings.includes(def.facing)) return def.facing;
  if (sdef.facingFootprint) {
    for (const f of sdef.facings) {
      const fp = sdef.facingFootprint[f];
      if (fp && fp[0] === w && fp[1] === h) return f;
    }
  }
  return sdef.facings[0];
}

// A set's origin: explicit, else its rect's corner, else its first rect's.
function setOrigin(s) {
  if (s.origin) return [s.origin[0], s.origin[1]];
  if (s.rect) return [s.rect[0], s.rect[1]];
  if (s.rects && s.rects.length) return [s.rects[0][0], s.rects[0][1]];
  return [0, 0];
}

// Every tile of a set's footprint, in world coordinates.
function setFootprint(s) {
  const out = [];
  const addRect = ([x0, y0, w, h]) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) out.push([x, y]);
  };
  if (s.rect) addRect(s.rect);
  for (const r of s.rects || []) addRect(r);
  if (s.mask) {
    const [ox, oy] = setOrigin(s);
    s.mask.forEach((row, dy) => {
      for (let dx = 0; dx < row.length; dx++) if (row[dx] === "#") out.push([ox + dx, oy + dy]);
    });
  }
  return out;
}

// Make sure every chunk within `radius` chunks of (x, y) exists, so wild
// forest and its dead are grown well outside the viewport, never in it. The
// simulation's ring round each player is four chunks (docs/02, 2026-10-13).
export function ensureAround(x, y, radius = 4) {
  const [cx, cy] = chunkCoord(Math.round(x), Math.round(y));
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) getChunk(cx + dx, cy + dy);
}

// Build an authored-tile lookup from a map file, then reset the map onto it.
//
// The vocabulary (Michael, 2026-10-09):
// - A **set** is an authored thing with a footprint and a padding ring that
//   scatter never enters: a cottage, a farm plot, an overturned wagon, a whole
//   castle compound. Its buildings, floors, and props are placed relative to
//   its corner. A set is defined by its own outline, so two sets joined by a
//   road stay two sets.
// - A **feature** is linear and reserves only its own tiles, with no padding:
//   roads now, rivers and bridges later. A road may run right up to a set.
// - **Scatter** fills what is left by rule, and the **wild** beyond the bounds
//   is scatter all the way down.
// `options` are the world's own rules (rules.js), read when it is made or restored, never once per page (#130):
// `trees` false makes no tree, inside the bounds or beyond them, and nothing else changes (rocks, forage, the ground,
// and any scatter that is not trees stay, in the same places; the forage is placed against where the trees would have
// stood, so a world of the same seed has the same mushrooms with or without them, #142); `population` is the factor the dead a wild chunk brings
// are scaled by (the authored dead are scaled by game.create).
export function loadMap(json, options = {}) {
  const treesOn = options.trees !== false;
  noTrees = !treesOn;
  ghostTrees.clear();
  popFactor = Number.isFinite(options.population) ? options.population : 1;
  fireProps.clear(); // props are created below, before reset() runs
  propsById.clear();
  bracketSet.clear();
  const pendingBrackets = []; // [tx, ty, edge, side, torch, lantern], added once the map is live
  const authored = new Map();
  const key = (x, y) => `${x},${y}`;
  const get = (x, y) => {
    let t = authored.get(key(x, y));
    if (!t) {
      t = createTile(json.floor || "floor_grass");
      authored.set(key(x, y), t);
    }
    return t;
  };
  const props = [];
  const placeProp = (def, offset) => {
    if (noTrees && isTreeKind(def.sprite)) { ghostTrees.add(ghostKey(def.tile[0] + offset[0], def.tile[1] + offset[1])); return; } // Trees off: an authored tree (an orchard's) is not placed either, and the forage counts where it would have stood
    const prop = createProp(def, offset);
    props.push(prop);
    for (const [tx, ty] of prop.tiles) get(tx, ty).prop = prop;
  };
  // placeProp above the map's `placeProp` export: the sheet's slices need the prop placed before the tiles exist.
  const floorRect = (r, offset) => {
    const [x0, y0, w, h] = r.rect;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) get(x + offset[0], y + offset[1]).floor = r.sprite;
  };
  // Features and loose top-level content. A `fence` feature is a run of walls round a
  // rect's perimeter in a see-through material, with gates (docs/30 step 0): it makes no
  // room, so a fenced field stays outdoors.
  const fence = (f, offset) => {
    const [x0, y0, w, h] = [f.rect[0] + offset[0], f.rect[1] + offset[1], f.rect[2], f.rect[3]];
    const mat = f.wall || "wall_fence";
    for (let x = x0; x < x0 + w; x++) {
      if (!get(x, y0).n) get(x, y0).n = createWall("wall", mat);
      if (!get(x, y0 + h).n) get(x, y0 + h).n = createWall("wall", mat);
    }
    for (let y = y0; y < y0 + h; y++) {
      if (!get(x0, y).w) get(x0, y).w = createWall("wall", mat);
      if (!get(x0 + w, y).w) get(x0 + w, y).w = createWall("wall", mat);
    }
    for (const g of f.gates || []) {
      const wall = createWall("door", mat);
      if (g.side === "n") get(x0 + g.at, y0).n = wall;
      else if (g.side === "s") get(x0 + g.at, y0 + h).n = wall;
      else if (g.side === "w") get(x0, y0 + g.at).w = wall;
      else if (g.side === "e") get(x0 + w, y0 + g.at).w = wall;
    }
  };
  for (const f of json.features || []) {
    if (f.kind === "fence") fence(f, [0, 0]);
    else floorRect(f, [0, 0]);
  }
  for (const r of json.floorRects || []) floorRect(r, [0, 0]);
  for (const p of json.props || []) placeProp(p, [0, 0]);
  // Sets: everything inside is relative to the set's origin (its rect's corner
  // unless an `origin` is given).
  const buildings = [...(json.buildings || []).map((b) => ({ ...b, origin: [0, 0] }))];
  for (const s of json.sets || []) {
    const origin = setOrigin(s);
    for (const r of s.floorRects || []) floorRect(r, origin);
    for (const f of s.fences || []) fence(f, origin);
    for (const p of s.props || []) placeProp(p, origin);
    for (const b of s.buildings || []) buildings.push({ ...b, origin });
  }
  for (const b of buildings) {
    const [bx, by, bw, bh] = [b.rect[0] + b.origin[0], b.rect[1] + b.origin[1], b.rect[2], b.rect[3]];
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) get(x, y).floor = b.floor || json.floor;
    // The material: one for all, or one per side (`{ n, s, e, w }`, stone at the back and
    // wood at the front; docs/30 step 0). The renderer's material-change posts handle the corners.
    const matOf = (side) => (typeof b.wall === "string" ? b.wall : (b.wall && (b.wall[side] || b.wall.all)) || WALL_SPRITE_DEFAULT);
    // Perimeter walls. North wall: n edge of the top row. West wall: w edge of
    // the left column. South wall: n edge of the row below. East wall: w edge
    // of the column to the right.
    for (let x = bx; x < bx + bw; x++) {
      get(x, by).n = createWall("wall", matOf("n"));
      get(x, by + bh).n = createWall("wall", matOf("s"));
    }
    for (let y = by; y < by + bh; y++) {
      get(bx, y).w = createWall("wall", matOf("w"));
      get(bx + bw, y).w = createWall("wall", matOf("e"));
    }
    for (const o of b.openings || []) {
      const wall = createWall(o.kind, o.wall || matOf(o.side));
      // An opening's state as authored (docs/30 step 1): `open`, `broken` (a door kicked in: an
      // opening for good), and `boards: { in, out }` nailed on the inside or the outside. The
      // inside of a north or west wall is the near side of its edge; of a south or east, the far.
      if (o.open) { wall.open = true; if (o.kind === "window") wall.shutter = "open"; }
      if (o.broken) { wall.broken = true; wall.hp = 0; if (o.kind === "door") wall.open = true; if (o.kind === "window") wall.shutter = "open"; }
      if (o.boards) {
        const inNear = o.side === "n" || o.side === "w";
        const inside = inNear ? wall.boards.near : wall.boards.far;
        const outside = inNear ? wall.boards.far : wall.boards.near;
        for (let i = 0; i < Math.min(BOARDS_PER_SIDE, o.boards.in || 0); i++) inside.push(BOARD_HP);
        for (let i = 0; i < Math.min(BOARDS_PER_SIDE, o.boards.out || 0); i++) outside.push(BOARD_HP);
      }
      if (o.side === "n") get(bx + o.at, by).n = wall;
      else if (o.side === "s") get(bx + o.at, by + bh).n = wall;
      else if (o.side === "w") get(bx, by + o.at).w = wall;
      else if (o.side === "e") get(bx + bw, by + o.at).w = wall;
    }
    // Interior partitions (docs/30 step 0): a run of `len` edges on the `n` or `w` slot
    // starting at a tile inside the building, with openings along it by index, so a house
    // of several rooms is one entry. `{ "edge": "n", "at": [x, y], "len": 4, "openings": [{ "at": 1, "kind": "door" }] }`
    for (const part of b.partitions || []) {
      const mat = part.wall || matOf(part.edge === "n" ? "n" : "w");
      const [px, py] = [bx + part.at[0], by + part.at[1]];
      for (let i = 0; i < part.len; i++) {
        const o = (part.openings || []).find((op) => op.at === i);
        const wall = createWall(o ? o.kind : "wall", mat);
        if (part.edge === "n") get(px + i, py).n = wall;
        else get(px, py + i).w = wall;
      }
    }
    for (const p of b.props || []) placeProp(p, [bx, by]);
    // Brackets: `{ side, at, facing: "in" | "out", torch | lantern }`. The inside of a
    // north or west wall is the near side of its edge (+1); of a south or east
    // wall, the far side (-1).
    for (const br of b.brackets || []) {
      const inSide = br.side === "n" || br.side === "w" ? 1 : -1;
      const side = br.facing === "out" ? -inSide : inSide;
      if (br.side === "n") pendingBrackets.push([bx + br.at, by, "n", side, !!br.torch, !!br.lantern]);
      else if (br.side === "s") pendingBrackets.push([bx + br.at, by + bh, "n", side, !!br.torch, !!br.lantern]);
      else if (br.side === "w") pendingBrackets.push([bx, by + br.at, "w", side, !!br.torch, !!br.lantern]);
      else if (br.side === "e") pendingBrackets.push([bx + bw, by + br.at, "w", side, !!br.torch, !!br.lantern]);
    }
  }
  const baseFloor = json.floor || "floor_grass";
  // Reserved tiles take no scatter: each building's rectangle plus its
  // `padding` ring (default 1, so a trunk can stand one tile from a wall,
  // which reads as deep woods), and any `reserve` rectangles for yards,
  // fields, and compounds. Michael's CSS-padding idea (2026-10-09).
  const reserved = new Set();
  const reserveRect = (x0, y0, w, h) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) reserved.add(key(x, y));
  };
  // A set's footprint may be any shape: a `rect`, a union of `rects`, or a
  // `mask` of text rows ('#' is footprint) at the set's `origin`. The padding
  // ring is the footprint grown outward by `padding` tiles in every direction,
  // which works for concave shapes and courtyards alike (Michael, 2026-10-09).
  for (const s of json.sets || []) {
    const pad = s.padding ?? 1;
    for (const [x, y] of setFootprint(s)) reserveRect(x - pad, y - pad, pad * 2 + 1, pad * 2 + 1);
  }
  for (const b of json.buildings || []) {
    const pad = b.padding ?? 1;
    reserveRect(b.rect[0] - pad, b.rect[1] - pad, b.rect[2] + pad * 2, b.rect[3] + pad * 2);
  }
  for (const r of json.reserve || []) reserveRect(...r);
  const biomes = json.biomes || {};
  for (const sc of json.scatter || []) {
    const biome = sc.biome ? biomes[sc.biome] : { kinds: sc.kinds, scale: sc.scale || 8 };
    const [x0, y0, w, h] = sc.rect;
    const footprint = sc.footprint || [1, 1];
    const seed = sc.seed ?? 1;
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        if (reserved.has(key(x, y))) continue;
        if (hash2(x, y, seed) >= densityAt(sc, biome, x, y)) continue;
        const t = authored.get(key(x, y));
        if (t && (t.floor !== baseFloor || t.prop || t.n || t.w)) continue;
        const sprite = weightedPick(biome.kinds, hash2(x, y, seed + 1));
        if (noTrees && isTreeKind(sprite)) { ghostTrees.add(ghostKey(x, y)); continue; } // Trees off: the pick is made as ever, a tree is simply not placed (forage still counts it)
        placeProp({ sprite, tile: [x, y], footprint, solid: sc.solid !== false, opaque: !!sc.opaque }, [0, 0]);
      }
    }
  }
  let wildRule = null;
  if (json.wild) {
    const biome = json.wild.biome ? biomes[json.wild.biome] : { kinds: json.wild.kinds, scale: json.wild.scale || 8 };
    wildRule = { ...json.wild, biome };
  }
  reset({
    floor: baseFloor,
    authored: (x, y) => authored.get(key(x, y)) || null,
    wildRule,
    mapBounds: json.bounds || null,
  });
  biomeRects = (json.scatter || []).filter((sc) => sc.biome).map((sc) => ({ rect: sc.rect, biome: sc.biome }));
  wildBiome = json.wild?.biome || null;
  // Forage inside the bounds, now that the trees and the wild rule are known:
  // on plain base floor with nothing on it. Beyond the bounds wildTile does it.
  forage = json.forage || null;
  if (forage && json.bounds) {
    const [bx, by, bw, bh] = json.bounds;
    for (let y = by; y < by + bh; y++) {
      for (let x = bx; x < bx + bw; x++) {
        const t = authored.get(key(x, y));
        if (t && (t.floor !== baseFloor || t.prop || t.n || t.w)) continue;
        const prop = forageProp(x, y);
        if (!prop) continue;
        props.push(prop);
        get(x, y).prop = prop;
      }
    }
  }
  // The brackets last: placing one grows its chunk, and a chunk grown before the forage pass took a blank
  // tile wherever nothing was authored, so the forage's mushroom landed on an authored tile that chunk never
  // saw (fifteen ghosts in the registry, found by the sync check, 2026-10-13).
  for (const [tx, ty, edge, side, torch, lantern] of pendingBrackets) addBracket(tx, ty, edge, side, torch, lantern);
  // A crop's rows follow the furrows of the soil it stands in (docs/17), unless
  // the map gave it a facing; the floors are all laid by now.
  for (const prop of props) {
    if (prop.furrowsPending) prop.facing = furrowsOf(get(prop.tile[0], prop.tile[1]).floor) || prop.facing;
    delete prop.furrowsPending;
  }
  return { props, spawn: json.spawn || [0, 0], zombies: json.zombies || [], villagers: json.villagers || [], name: json.name || "map" };
}

// The direction a floor's furrows run ("x" or "y"), or null for a floor without.
function furrowsOf(floor) {
  try {
    return getDef(floor).furrows || null;
  } catch {
    return null;
  }
}
