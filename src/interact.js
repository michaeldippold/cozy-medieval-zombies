// Interaction: what can be done to the world (docs/10-interface.md). Rewritten
// on cozy-zombie-game src/interact.js's action shape on 2026-10-10:
//
//   { kind, label, tiles, mx, my, range, duration, enabled, simple, perform() }
//
// `tiles` is where the target is; the player must be within `range` of one of
// them. Right-click builds a menu of every action under the cursor
// (actionsAt); E runs the nearest simple action in range (nearestSimpleAction);
// an action out of range auto-walks the player there first (runAction). Timed
// actions show the prompt's bar and cancel on movement. Items live in slots
// (docs/11): a hand, a worn slot, the belt, the bag on your back, a container,
// or the floor, and every move here takes an entry out of one and puts it in
// another.

import * as iso from "./iso.js";
import * as input from "./input.js";
import * as map from "./map.js";
import { getSheet, idleFrame } from "./assets.js";
import { resolveFacing, frameName } from "./sprites.js";
import { getItem, makeEntry, hold, release, holding, heldEntry, canHold, handFor, containerGrid, rollLoot } from "./items.js";
import { stacks as bleedStacks, clear as clearBleed } from "./bleed.js";
import { beltKey, flameOf, NO_FLAME } from "./inventory.js";
import { bagOf, beltOf, ensureBag, countAll, takeAll, findItem, detach, stow, equip, restoreOffHand, addItem, createBag, waterContainers, canStoreIn, isContainer } from "./inventory.js";
import { getDef } from "./assets.js";
import { canPutDown, putDownTarget, canCarry, propRect } from "./placement.js";
import * as placement from "./placement.js";
import * as grid from "./grid.js";
import { autoWalk, eat, drink, isFull } from "./entities/player.js";
import { showMessage } from "./ui/prompt.js";
import { pokeVillager } from "./entities/villager.js";
import { lootOf } from "./entities/character.js";
import { emit } from "./events.js";
import * as loop from "./loop.js";
import * as use from "./use.js"; // the Use entry on item menus (docs/30, law 2)
import * as verbs from "./verbs.js"; // the verb table (docs/31/08, habit 4)
import { world } from "./world.js";
import * as clock from "./clock.js";
import * as sight from "./sight.js";
import { tiredStage } from "./moodles.js";
import * as stations from "./stations.js"; // what a prop is as a station (docs/30, section 6)
import * as stationPanel from "./ui/station-panel.js";

export const INTERACT_RANGE = 1.15; // tiles
export const SEARCH_TIME = 1.0;
export const BOARD_TIME = 2.0;
export const PULL_TIME = 1.5;
export const CHOP_TIME = 3.0;
export const DRINK_TIME = 1.5;
export const FILL_TIME = 2.0;
export const HOLD_TIME = 0.35; // seconds of a key that count as a hold

export function distToTiles(player, tiles) {
  let best = Infinity;
  for (const [tx, ty] of tiles) best = Math.min(best, Math.hypot(player.gx - tx, player.gy - ty));
  return best;
}

function act(a) {
  return { range: INTERACT_RANGE, duration: 0, enabled: true, simple: false, ...a };
}

// The address of what an action is on (docs/31/05, item 10; docs/31/04, the wire): a tile, an edge,
// a prop by id, a bracket by its edge, an item by its uid on its tile, a character by id. A guest's
// menu entry sends its address and label, and the host rebuilds the action on its own world.
function tag(actions, target) {
  for (const a of actions) a.target = target;
  return actions;
}

const onTile = (tx, ty) => ({ kind: "tile", tile: [tx, ty] });
const onProp = (prop) => ({ kind: "prop", id: prop.id });
const onEdge = (o) => ({ kind: "edge", tx: o.tx, ty: o.ty, edge: o.edge });
const onBracket = (b) => ({ kind: "bracket", tx: b.tx, ty: b.ty, edge: b.edge });
const onItem = (entry, tx, ty) => ({ kind: "item", uid: entry.uid, tile: [tx, ty] });
const onCharacter = (c) => ({ kind: "character", id: c.id });

// The actions on an address, rebuilt here from the world (a host's, for a guest's command).
export function actionsForTarget(t, player) {
  if (!t) return [];
  if (t.kind === "tile") {
    const [tx, ty] = t.tile;
    const out = [];
    if (player.carrying) out.push(putDownAction(player, tx, ty));
    else if (map.peekTile(tx, ty) && map.drinkableAt(tx, ty)) out.push(...waterTileActions(tx, ty, player));
    if (map.isWalkableTile(tx, ty)) out.push(walkAction([tx, ty]));
    return tag(out, t);
  }
  if (t.kind === "item") {
    const [tx, ty] = t.tile;
    const entry = map.itemsAt(tx, ty).find((e) => e.uid === t.uid);
    return entry ? tag(itemActions(entry, tx, ty, player), t) : [];
  }
  if (t.kind === "prop") {
    const prop = map.propById(t.id);
    return prop ? tag(propActions(prop, player), t) : [];
  }
  if (t.kind === "edge") {
    const o = map.openingsNear(t.tx, t.ty, 2.5).find((q) => q.tx === t.tx && q.ty === t.ty && q.edge === t.edge);
    return o ? tag(openingActions(o, player), t) : [];
  }
  if (t.kind === "bracket") {
    const b = [...map.brackets()].find((q) => q.tx === t.tx && q.ty === t.ty && q.edge === t.edge);
    if (!b) return [];
    const [mx, my] = map.bracketPos(b);
    return tag(holderActions({ kind: "bracket", bracket: b, mx, my }, player), t);
  }
  if (t.kind === "character") {
    const c = t.id === player.id ? player : allCharacters().find((q) => q.id === t.id);
    return c ? tag(characterActions(c, player), t) : [];
  }
  return [];
}

// A command from a client not here (net.js): the action with that label on that address, run as if
// chosen from this player's own menu (the walk there, the timed bar, the message, all the host's).
export function performByLabel(player, target, label) {
  const a = actionsForTarget(target, player).find((q) => q.label === label);
  if (!a) return false;
  runAction(player, a);
  return true;
}

// A container by its address (docs/31/05, item 9): the shape `containerOpened` sends a guest
// (main.js): a prop by id (`name` "output" for a station's own bag), a floor bag by its entry's uid
// on its tile, a body by id; `{ mine: true }` is the player's own bag. Resolved on a guest every
// frame, since a chunk delta installs a prop anew, and on the host for a guest's command.
// Returns { bag, corpse, tiles } or null.
export function containerAt(player, a) {
  if (!a) return null;
  if (a.mine) {
    const bag = bagOf(player);
    return bag ? { bag, corpse: null, tiles: [[Math.round(player.gx), Math.round(player.gy)]] } : null;
  }
  if (a.propId) {
    const pr = map.propById(a.propId);
    if (!pr) return null;
    const bag = a.name === "output" ? stations.outputOf(pr) : pr.bag || null;
    return bag ? { bag, corpse: null, tiles: pr.tiles } : null;
  }
  if (a.entryUid && a.tile) {
    const e = map.itemsAt(a.tile[0], a.tile[1]).find((q) => q.uid === a.entryUid);
    return e && e.bag ? { bag: e.bag, corpse: null, tiles: [a.tile] } : null;
  }
  if (a.characterId) {
    const c = allCharacters().find((q) => q.id === a.characterId);
    const bag = c ? lootOf(c) : null;
    return bag ? { bag, corpse: c, tiles: [[Math.round(c.gx), Math.round(c.gy)]] } : null;
  }
  return null;
}

function nameOf(entry) {
  return getItem(entry.id).name;
}

// Put a loose entry somewhere on the player: a free hand if it is holdable,
// else the bag or belt. Returns where it went, or null with a message.
export function takeIn(player, entry) {
  if (canHold(player.hands, entry.id) && entry.count === 1 && hold(player.hands, entry)) return "hand";
  const where = stow(player, entry);
  if (!where) showMessage(bagOf(player) ? "No room in your bag." : "You have no bag.");
  return where;
}

// ---- action builders ----

// Equip something lying on the floor (the action's kind is still `wear`, the code's word): what was in that slot
// stows, or for a bag drops where you stand.
function wearAction(entry, tx, ty, player) {
  const def = getItem(entry.id);
  const worn = player.worn[def.wear];
  const name = def.name.toLowerCase();
  const swap = worn ? (def.wear === "back" ? `Swap bags (drop your ${nameOf(worn).toLowerCase()})` : `Equip ${name} (swap)`) : `Equip ${name}`;
  return act({
    kind: "wear",
    label: swap,
    tiles: [[tx, ty]],
    mx: tx,
    my: ty,
    perform() {
      map.takeItem(tx, ty, entry);
      const old = player.worn[def.wear];
      if (old) {
        player.worn[def.wear] = null;
        if (def.wear === "back" || !stow(player, old)) map.dropItem(tx, ty, old);
      }
      player.worn[def.wear] = entry;
      return true;
    },
  });
}

function itemActions(entry, tx, ty, player) {
  const def = getItem(entry.id);
  const tiles = [[tx, ty]];
  if (player.carrying) return [];
  if (def.bag) {
    // A bag on the floor is a container you can also wear (docs/11), and
    // pick up into your bag while it is empty (the container rule).
    const bag = ensureBag(entry);
    const out = [act({
      kind: "container",
      simple: true,
      label: `Open ${def.name.toLowerCase()}`,
      tiles,
      mx: tx,
      my: ty,
      perform() {
        map.touch(tx, ty); // the bag's grid made on first use travels with its tile (docs/31/05, item 6)
        emit("containerOpened", { bag, tiles, name: def.name.toLowerCase(), entry, tile: [tx, ty] });
        return true;
      },
    })];
    out.push(wearAction(entry, tx, ty, player));
    if (canStoreIn(entry)) out.push(pickUpAction(entry, tx, ty, player, false));
    return out;
  }
  const out = [];
  const storable = canStoreIn(entry);
  out.push(pickUpAction(entry, tx, ty, player, storable));
  if (def.wear) out.push(wearAction(entry, tx, ty, player));
  return out;
}

function pickUpAction(entry, tx, ty, player, simple) {
  const def = getItem(entry.id);
  const tiles = [[tx, ty]];
  const fill = entry.fill != null ? ` (${Math.round(entry.fill)}%)` : "";
  const count = entry.count > 1 ? ` (${entry.count})` : "";
  const storable = canStoreIn(entry);
  return act({
    kind: "item",
    simple: simple && storable,
    enabled: storable,
    label: storable ? `Pick up ${def.name}${fill}${count}` : `Pick up ${def.name} (empty it first, or equip it)`,
    tiles,
    mx: tx,
    my: ty,
    perform() {
      const bag = bagOf(player);
      if (bag && def.stack) {
        const added = addItem(bag, entry.id, entry.count, entry.fill != null ? { fill: entry.fill } : {});
        if (added <= 0) {
          showMessage("No room in your bag.");
          return false;
        }
        entry.count -= added;
        if (entry.count <= 0) map.takeItem(tx, ty, entry);
        return true;
      }
      map.takeItem(tx, ty, entry);
      if (!takeIn(player, entry)) {
        map.dropItem(tx, ty, entry);
        return false;
      }
      return true;
    },
  });
}

// ---- carrying furniture (docs/02, 2026-10-10 late) ----
// A prop whose sprite says `carry` can be lifted with both hands empty. While
// carrying you can only walk: no sprint, no actions, no bag. Put it
// down on any clear tiles in reach, or with E on the tile you face.

function propName(prop) {
  return prop.sprite.replace(/_/g, " ");
}

function carryAction(prop, player) {
  const free = !player.hands.main && !player.hands.off;
  return act({
    kind: "carry",
    label: free ? `Pick up ${propName(prop)}` : `Pick up ${propName(prop)} (needs both hands)`,
    tiles: prop.tiles,
    mx: prop.tile[0],
    my: prop.tile[1],
    enabled: free && !player.carrying,
    perform() {
      if (player.carrying || !(!player.hands.main && !player.hands.off)) return false;
      map.removeProp(prop);
      player.carrying = prop;
      player.auto = null;
      return true;
    },
  });
}

// Whether the carried prop could stand with its anchor at (tx, ty): the rule
// lives in placement.js (docs/13), re-exported here for the callers below.
export { canPutDown, putDownTarget, canCarry };

function putDownAction(player, tx, ty, simple = false) {
  const prop = player.carrying;
  const ok = canPutDown(player, tx, ty);
  return act({
    kind: "putdown",
    simple,
    label: ok ? `Put down ${propName(prop)}` : `Put down ${propName(prop)} (no room)`,
    tiles: [[tx, ty]],
    range: 1.6,
    mx: tx,
    my: ty,
    enabled: ok,
    perform() {
      if (!canPutDown(player, tx, ty)) return false;
      map.placeProp(prop, tx, ty);
      player.carrying = null;
      return true;
    },
  });
}

// A container prop's bag, made on first use from its loot table's grid.
export function propBag(prop) {
  if (!prop.bag) {
    const [cols, rows] = containerGrid(prop.container.loot);
    prop.bag = createBag(cols, rows, prop.sprite.replace(/_/g, " "));
    prop.searched = false;
    map.unsaved(prop.tile[0], prop.tile[1], false); // made on first use, by whichever path asks first
  }
  return prop.bag;
}

function containerActions(prop) {
  const name = prop.sprite.replace(/_/g, " ");
  return [act({
    kind: "container",
    simple: true,
    label: prop.searched ? `Open ${name}` : `Search ${name}`,
    tiles: prop.tiles,
    mx: prop.tile[0],
    my: prop.tile[1],
    duration: prop.searched ? 0 : SEARCH_TIME,
    perform() {
      const bag = propBag(prop);
      if (!prop.searched) {
        prop.searched = true;
        // Rolled loot is placed into the grid; what does not fit is not spawned.
        if (!bag.items.length) grid.fill(bag, rollLoot(prop.container.loot));
        map.touch(prop.tile[0], prop.tile[1]); // a change on the prop: the save and the wire carry it (docs/31/05, item 6)
      }
      emit("containerOpened", { bag, tiles: prop.tiles, name, prop });
      return true;
    },
  })];
}

// A fire takes a unit of its own fuel from wherever you have one (docs/07; logs stopped being free
// with docs/10; the fuel and the hours per unit are the definition's since docs/30 step 2). The
// label says what it burns and how long it has: maintenance, not a hassle.
function fireActions(prop, player) {
  const f = prop.fire;
  if (!f || !f.burns) return [];
  const name = prop.sprite.replace(/_/g, " ");
  const fuelId = f.fuelItem;
  const fuelName = getItem(fuelId).name.toLowerCase();
  const have = countAll(player, fuelId);
  const full = f.fuel >= f.maxFuel;
  const hours = map.fireHoursLeft(prop);
  const left = f.lit ? `, ${hours < 1 ? "under an hour" : `${Math.round(hours)} h`} left` : "";
  // Lighting a fire that is out needs a flame carried too (Michael, 2026-10-17, #168): a tinderbox or a lit torch, the light verb's rule.
  const flame = f.lit ? true : !!flameOf(player);
  let label;
  if (!f.lit) label = !have ? `Light the ${name} (need a ${fuelName})` : flame ? `Light the ${name} (a ${fuelName})` : `Light the ${name} (need a tinderbox or a flame)`;
  else if (full) label = `The ${name} is full (${f.maxFuel} ${fuelName}s${left})`;
  else label = have ? `Feed the ${name} (${Math.ceil(f.fuel)} of ${f.maxFuel}${left})` : `Feed the ${name} (need a ${fuelName}${left})`;
  return [act({
    kind: "fire",
    simple: have > 0 && !full && flame,
    label,
    tiles: prop.tiles,
    mx: prop.tile[0],
    my: prop.tile[1] - 0.6,
    enabled: have > 0 && !full,
    perform() {
      if (countAll(player, fuelId) <= 0) return false;
      if (!prop.fire.lit && !flameOf(player)) { showMessage(NO_FLAME); return false; } // the refusal says why
      if (!map.feedFire(prop)) return false;
      takeAll(player, fuelId, 1);
      return true;
    },
  })];
}

// A bed (docs/30, 3.3): one entry that runs the sleep verb; the verb says no with a reason.
function sleepAction(prop, player) {
  const h = clock.getHour();
  const night = h >= 20 || h < 6;
  return [act({
    kind: "sleep",
    simple: tiredStage(player) >= 1 || night,
    label: "Sleep",
    tiles: prop.tiles,
    mx: prop.tile[0],
    my: prop.tile[1] - 0.6,
    perform() {
      const r = verbs.run("sleep", world, player, { prop: prop.id });
      if (!r.ok) showMessage(r.reason);
      return r.ok;
    },
  })];
}

// Brackets and posts: take the torch into a hand or the bag, or mount the one you carry.
function holderActions(target, player) {
  if (target.kind === "bracket" && target.bracket.wall.bracket.lantern) return []; // a lantern is the village's, not taken or mounted (#156)
  const what = target.kind === "bracket" ? "bracket" : "post";
  const mx = target.kind === "bracket" ? target.mx : target.prop.tile[0];
  const my = target.kind === "bracket" ? target.my - 0.4 : target.prop.tile[1] - 0.9;
  const tiles = target.kind === "bracket" ? [[target.bracket.tx, target.bracket.ty]] : target.prop.tiles;
  const has = map.holderHas(target);
  if (has) {
    // Out: a flame lights it (the `light` verb, burn.js; a tinderbox, or a lit torch in a hand or on the belt).
    const out = map.holderState(target).lit === false ? [act({
      kind: "holder",
      simple: false,
      label: "Light the torch",
      tiles,
      mx,
      my,
      perform() {
        const r = verbs.run("light", world, player, target.kind === "bracket" ? { bracket: { tx: target.bracket.tx, ty: target.bracket.ty, edge: target.bracket.edge } } : { prop: target.prop });
        if (!r.ok) showMessage(r.reason || "You cannot light it.");
        else showMessage("You light the torch.");
        return r.ok;
      },
    })] : [];
    return [...out, act({
      kind: "holder",
      simple: true,
      label: "Take the torch",
      tiles,
      mx,
      my,
      perform() {
        const st = map.holderState(target);
        const entry = makeEntry("torch", 1, { wear: st.wear || 0, lit: false }); // as burnt as it is, and out: a torch leaving a holder is doused (#156)
        if (!takeIn(player, entry)) return false;
        map.setHolder(target, false);
        return true;
      },
    })];
  }
  const have = countAll(player, "torch") > 0;
  return [act({
    kind: "holder",
    simple: have,
    label: have ? "Mount the torch" : `An empty ${what} (need a torch)`,
    tiles,
    mx,
    my,
    enabled: have,
    perform() {
      const found = findItem(player, "torch");
      if (!found) return false;
      detach(player, found.entry);
      map.setHolder(target, true, found.entry);
      return true;
    },
  })];
}

// Doors and windows: open and close, board and pull (docs/09). Nobody climbs through a window (Michael, 2026-10-16).
function openingActions(o, player) {
  const w = o.wall;
  const name = w.kind === "door" ? "door" : "shutters";
  const side = map.sideOf(o.tx, o.ty, o.edge, player.gx, player.gy);
  const mine = side > 0 ? w.boards.near : w.boards.far;
  const theirs = side > 0 ? w.boards.far : w.boards.near;
  const tiles = [[o.tx, o.ty], o.edge === "n" ? [o.tx, o.ty - 1] : [o.tx - 1, o.ty]];
  const base = { tiles, mx: o.mx, my: o.my };
  const out = [];
  const open = w.kind === "door" ? w.open : w.shutter === "open";
  if (map.boarded(w)) {
    const parts = [];
    if (mine.length) parts.push(`${mine.length} this side`);
    if (theirs.length) parts.push(`${theirs.length} far side`);
    out.push(act({ ...base, kind: "opening", label: `${name}: boarded (${parts.join(", ")})`, enabled: false }));
  } else if (w.broken) {
    out.push(act({ ...base, kind: "opening", label: w.kind === "door" ? "A broken doorway" : "Broken shutters", enabled: false }));
  } else {
    out.push(act({
      ...base,
      kind: "opening",
      simple: true,
      label: open ? `Close ${name}` : `Open ${name}`,
      perform() {
        if (w.kind === "door") w.open = !w.open;
        else w.shutter = w.shutter === "open" ? "closed" : "open";
        map.touch(o.tx, o.ty); // the wall's own tile, so the save and the wire carry it (docs/31/05, item 6; it touched nothing before)
        return true;
      },
    }));
  }
  const planks = countAll(player, "plank");
  if (mine.length < map.BOARDS_PER_SIDE) {
    out.push(act({
      ...base,
      kind: "board",
      label: planks ? `Board up (${mine.length}/${map.BOARDS_PER_SIDE})` : "Board up (need a plank)",
      duration: BOARD_TIME,
      enabled: planks > 0,
      perform() {
        if (countAll(player, "plank") <= 0) return false;
        if (!map.addBoard(w, side)) return false;
        takeAll(player, "plank", 1);
        return true;
      },
    }));
  }
  if (mine.length) {
    out.push(act({
      ...base,
      kind: "pull",
      label: `Pull a board (${mine.length} this side, gone)`,
      duration: PULL_TIME,
      perform() {
        return map.pullBoard(w, side);
      },
    }));
  }
  return out;
}

// Trees: chop down, logs on the ground, the tree gone (docs/02: felling is clearing the tile's prop).
function treeActions(prop) {
  return [act({
    kind: "tree",
    label: `Chop down (${prop.wood} log${prop.wood > 1 ? "s" : ""})`,
    tiles: prop.tiles,
    mx: prop.tile[0],
    my: prop.tile[1],
    duration: CHOP_TIME,
    perform() {
      const [tx, ty] = prop.tile;
      map.removeProp(prop);
      for (let i = 0; i < prop.wood; i++) map.dropItem(tx, ty, { id: "log", count: 1 });
      showMessage(`${prop.wood} logs on the ground.`);
      return true;
    },
  })];
}

// Water to drink and fill from: the well (infinite, docs/02 question 16) and, since docs/30
// law 8, any water tile beside you (the river, a pond, the mere). `source` is
// { tiles, mx, my, name, onStart? }.
function waterActions(source, player) {
  const toFill = () => waterContainers(bagOf(player)).filter((it) => (it.fill ?? 0) < 100);
  return [
    act({
      kind: "water",
      simple: player.thirst < 90,
      label: `Drink from the ${source.name}`,
      tiles: source.tiles,
      mx: source.mx,
      my: source.my,
      duration: DRINK_TIME,
      present: true, // the held-out pose for the bar (docs/32, item 1)
      onStart: source.onStart || null,
      perform() {
        player.thirst = player.maxThirst;
        showMessage("You drink your fill.");
        return true;
      },
    }),
    act({
      kind: "fill",
      label: toFill().length ? "Fill waterskins" : "Fill waterskins (none to fill)",
      tiles: source.tiles,
      mx: source.mx,
      my: source.my,
      duration: FILL_TIME,
      enabled: toFill().length > 0,
      perform() {
        const list = toFill();
        for (const it of list) it.fill = 100;
        showMessage(list.length > 1 ? `Filled ${list.length} waterskins.` : "Filled your waterskin.");
        return list.length > 0;
      },
    }),
  ];
}

function wellActions(prop, player) {
  return waterActions({ tiles: prop.tiles, mx: prop.tile[0], my: prop.tile[1] - 0.6, name: prop.sprite.replace(/_/g, " "), onStart: () => play(prop) }, player); // the bucket goes down for the water; named for what it is (a trough, a font: the wiki census's bugs, 2026-10-15)
}

// A water tile's actions, from its bank.
function waterTileActions(tx, ty, player) {
  return waterActions({ tiles: [[tx, ty]], mx: tx, my: ty, name: "water" }, player);
}

function walkAction(tile) {
  return act({
    kind: "floor",
    label: "Walk here",
    tiles: [tile],
    mx: tile[0],
    my: tile[1],
    range: 0,
    goal: tile,
    perform() {
      return true;
    },
  });
}

// ---- hit testing ----

function pointInRect(x, y, r) {
  return r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

// What can be done to a prop: its own actions first, and lifting it last when
// the rule (canCarry, in placement.js) allows. Additive, so a prop with several
// uses lists them all.
function propActions(prop, player) {
  if (player.carrying) return [];
  const out = [];
  if (prop.container) out.push(...containerActions(prop));
  if (prop.fire && prop.fire.burns) out.push(...fireActions(prop, player));
  if (prop.fire && prop.fire.holds) out.push(...holderActions({ kind: "post", prop }, player));
  if (prop.wood) out.push(...treeActions(prop));
  if (prop.water) out.push(...wellActions(prop, player));
  if (getDef(prop.sprite).sleep) out.push(...sleepAction(prop, player));
  if (stations.stationOf(prop)) out.push(...stationActions(prop, player));
  if (canCarry(prop)) out.push(carryAction(prop, player));
  return out;
}

// A station (docs/30, section 6): one entry that opens its panel; the panel calls the craft verb.
function stationActions(prop, player) {
  const station = stations.stationOf(prop);
  const label = station === "cooking" ? "Cook here" : `Use the ${prop.sprite.replace(/_/g, " ")}`;
  return [act({
    kind: "station",
    simple: true,
    label,
    tiles: prop.tiles,
    mx: prop.tile[0],
    my: prop.tile[1] - 0.6,
    perform() {
      return stationPanel.openFor(prop, player);
    },
  })];
}

// Openings under a canvas point. A door or shutter is drawn as a face up to
// WALL_FACE pixels tall above its edge, so the click is tested against that
// face on screen, not only against the edge's midpoint on the ground (a
// right-click on the door itself found nothing, Michael 2026-10-10).
const WALL_FACE = 80; // the walls' height since 2026-10-11 (docs/17)
const FACE_HALF_W = 26;

function openingsAtScreen(sx, sy) {
  const seen = new Set();
  const out = [];
  for (const dy of [0, WALL_FACE / 2, WALL_FACE]) {
    const g = iso.toGrid(sx, sy + dy);
    for (const o of map.openingsNear(g.gx, g.gy, 2.5)) {
      const k = `${o.edge}@${o.tx},${o.ty}`;
      if (seen.has(k)) continue;
      const p = iso.toScreen(o.mx, o.my);
      const dx = sx - p.x;
      const dyy = sy - p.y;
      if (Math.abs(dx) <= FACE_HALF_W && dyy >= -WALL_FACE && dyy <= 12) {
        seen.add(k);
        out.push(o);
      }
    }
  }
  out.sort((a, b) => Math.hypot(a.mx - iso.toGrid(sx, sy).gx, a.my - iso.toGrid(sx, sy).gy) - Math.hypot(b.mx - iso.toGrid(sx, sy).gx, b.my - iso.toGrid(sx, sy).gy));
  return out;
}

// A bracket under a canvas point (Use mode's target, #170): the nearest to the ground point under the cursor, as the right-click menu
// finds it, or null. A torch in it, a lantern, or nothing: the light verb says which ("There is no torch there.", "A lantern is always lit.").
export function bracketAt(sx, sy) {
  const g = iso.toGrid(sx, sy);
  const near = map.bracketsNear(g.gx, g.gy, 0.8); // any bracket: a Use on a lantern or an empty one gets its own word, not the grass's
  return near.length ? near[0].bracket : null;
}

// Every action for whatever is under a canvas point.
export function actionsAt(sx, sy, player) {
  const g = iso.toGrid(sx, sy);
  const tx = Math.round(g.gx);
  const ty = Math.round(g.gy);
  const out = [];
  if (player.carrying) {
    // Only walking and putting the thing down.
    out.push(...tag([putDownAction(player, tx, ty)], onTile(tx, ty)));
    if (map.isWalkableTile(tx, ty)) out.push(...tag([walkAction([tx, ty])], onTile(tx, ty)));
    return out;
  }
  for (const entry of map.itemsAt(tx, ty)) out.push(...tag(itemActions(entry, tx, ty, player), onItem(entry, tx, ty)));
  if (map.peekTile(tx, ty) && map.drinkableAt(tx, ty)) out.push(...tag(waterTileActions(tx, ty, player), onTile(tx, ty))); // the river, a pond (docs/30, law 8)
  // Props: on their tile, or under their sprite in the tiles around (a tall tree).
  const seen = new Set();
  for (let dy = -3; dy <= 1; dy++) {
    for (let dx = -3; dx <= 1; dx++) {
      const prop = map.peekTile(tx + dx, ty + dy)?.prop; // a hit test never grows a chunk (docs/23a, A4)
      if (!prop || seen.has(prop)) continue;
      const onTile = dx === 0 && dy === 0;
      const onSprite = !onTile && pointInRect(sx, sy, propRect(prop, tx + dx, ty + dy));
      if (!onTile && !onSprite) continue;
      seen.add(prop);
      out.push(...tag(propActions(prop, player), onProp(prop)));
    }
  }
  for (const o of openingsAtScreen(sx, sy)) out.push(...tag(openingActions(o, player), onEdge(o)));
  for (const b of map.bracketsNear(g.gx, g.gy, 0.8)) out.push(...tag(holderActions({ kind: "bracket", bracket: b.bracket, mx: b.mx, my: b.my }, player), onBracket(b.bracket)));
  const under = characterAt(sx, sy, player);
  if (under) out.push(...tag(characterActions(under, player), onCharacter(under)));
  else if (playerAt(sx, sy, player)) out.push(...tag(characterActions(player, player), onCharacter(player)));
  if (!out.length && map.isWalkableTile(tx, ty)) out.push(...tag([walkAction([tx, ty])], onTile(tx, ty)));
  return out;
}

// The nearest simple action within range, for the E key and the prompt.
export function nearestSimpleAction(player) {
  if (player.carrying) {
    const [tx, ty] = putDownTarget(player);
    const a = putDownAction(player, tx, ty, true);
    a.target = onTile(tx, ty);
    return a.enabled ? a : null;
  }
  let best = null;
  let bestD = Infinity;
  // A loose thing lying on a tile is picked up before a container on the same tile is opened (Michael's playtest,
  // 2026-10-14: with a sack on the ground and an item dropped beside it, E always opened the sack, already open, so
  // the item could only be taken from the menu). A tie in distance goes to the pick-up.
  const rank = (a) => (a.kind === "item" ? 0 : 1);
  const consider = (actions) => {
    for (const a of actions) {
      if (!a.simple || a.enabled === false) continue;
      const d = distToTiles(player, a.tiles);
      if (d <= a.range && (d < bestD - 1e-9 || (d <= bestD + 1e-9 && best && rank(a) < rank(best)))) {
        best = a;
        bestD = d;
      }
    }
  };
  const px = Math.round(player.gx);
  const py = Math.round(player.gy);
  const seen = new Set();
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const t = map.peekTile(px + dx, py + dy); // a hit test never grows a chunk (docs/23a, A4)
      if (!t) continue;
      for (const entry of map.itemsAt(px + dx, py + dy)) consider(tag(itemActions(entry, px + dx, py + dy, player), onItem(entry, px + dx, py + dy)));
      if (map.drinkableAt(px + dx, py + dy)) consider(tag(waterTileActions(px + dx, py + dy, player), onTile(px + dx, py + dy))); // E at the bank
      if (t.prop && !seen.has(t.prop)) {
        seen.add(t.prop);
        consider(tag(propActions(t.prop, player), onProp(t.prop)));
      }
    }
  }
  for (const o of map.openingsNear(player.gx, player.gy, INTERACT_RANGE)) consider(tag(openingActions(o, player), onEdge(o)));
  for (const b of map.bracketsNear(player.gx, player.gy, INTERACT_RANGE)) consider(tag(holderActions({ kind: "bracket", bracket: b.bracket, mx: b.mx, my: b.my }, player), onBracket(b.bracket)));
  // A body lying within reach (a corpse is a container, docs/19).
  for (const c of allCharacters()) {
    if ((c.kind !== "zombie" && c.kind !== "player") || !c.dead || !c.corpse || Math.abs(c.gx - player.gx) > 3 || Math.abs(c.gy - player.gy) > 3) continue;
    consider(tag(characterActions(c, player), onCharacter(c)));
  }
  return best;
}

// ---- performing ----

export function startAction(player, action) {
  if (!action || action.enabled === false) return false;
  if (action.onStart) action.onStart();
  if (action.duration <= 0) {
    action.perform();
    return true;
  }
  player.action = { action, elapsed: 0 };
  if (action.present) player.presentFor = action.duration;
  return true;
}

// Advance a timed action. Returns progress 0..1 or null when idle. Keyboard
// movement or drifting out of range cancels it.
export function updateAction(player, dt) {
  const a = player.action;
  if (!a) return null;
  if (player.moving || distToTiles(player, a.action.tiles) > a.action.range + 0.2) {
    player.action = null;
    if (a.action.present) player.presentFor = 0;
    return null;
  }
  a.elapsed += dt;
  if (a.elapsed >= a.action.duration) {
    player.action = null;
    a.action.perform();
    return null;
  }
  return a.elapsed / a.action.duration;
}

// A walkable tile within range of the action's tiles, nearest to the player.
export function approachTile(action, player) {
  if (action.goal) return action.goal;
  let best = null;
  let bestD = Infinity;
  for (const [tx, ty] of action.tiles) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = tx + dx;
        const y = ty + dy;
        if (!map.isWalkableTile(x, y)) continue;
        if (Math.hypot(dx, dy) > action.range) continue;
        const d = Math.hypot(player.gx - x, player.gy - y);
        if (d < bestD) {
          bestD = d;
          best = [x, y];
        }
      }
    }
  }
  return best;
}

// Do an action now if in range, else walk over and do it on arrival.
export function runAction(player, action) {
  if (action.enabled === false) return;
  if (distToTiles(player, action.tiles) <= action.range) {
    startAction(player, action);
    return;
  }
  const goal = approachTile(action, player);
  const onArrive = (arrived) => {
    if (arrived) startAction(player, action);
    else if (action.kind !== "floor") showMessage("Can't reach that.");
  };
  if (!goal || !autoWalk(player, goal, { tiles: action.tiles, range: action.range, onArrive })) {
    showMessage("Can't get there from here.");
  }
}

// ---- keys ----

function keyTracker(code) {
  return { code, held: 0, consumed: false };
}
const keyE = keyTracker("KeyE");
const keyB = keyTracker("KeyB");

function track(k, dt, onHold, onTap) {
  if (input.isDown(k.code) || input.wasPressed(k.code)) {
    k.held += dt;
    if (onHold && !k.consumed && k.held >= HOLD_TIME) {
      k.consumed = true;
      onHold();
    }
  } else {
    if (k.held > 0 && !k.consumed) onTap();
    k.held = 0;
    k.consumed = false;
  }
}

function nearestOpening(player) {
  return map.openingsNear(player.gx, player.gy, INTERACT_RANGE)[0] || null;
}

// What the prompt should say, and where, or null: a running action with its
// bar, else the nearest simple action with E.
export function promptFor(player, progress) {
  // Placement first: its ghost carries its own prompt (docs/13).
  const pp = !player.action ? placement.prompt() : null;
  if (pp) return pp;
  if (player.carrying) {
    const [tx, ty] = putDownTarget(player);
    const a = putDownAction(player, tx, ty, true);
    return { label: a.enabled ? `E: ${a.label}` : a.label, mx: tx, my: ty, progress: null, enabled: a.enabled };
  }
  if (player.action) {
    const a = player.action.action;
    return { label: a.label, mx: a.mx, my: a.my, progress };
  }
  // On a guest the action runs on the host and arrives as a description (net.js record): its bar is the host's progress.
  if (player.actionView) {
    const a = player.actionView;
    return { label: a.label, mx: a.mx, my: a.my, progress };
  }
  const a = nearestSimpleAction(player);
  if (!a) return null;
  return { label: `E: ${a.label}`, mx: a.mx, my: a.my, progress: null };
}

// Unequip a held entry: into the bag, else the belt, else it stays in hand.
export function unequip(player, entry) {
  const both = getItem(entry.id).hands === "both";
  release(player.hands, entry);
  if (stow(player, entry)) {
    if (both) restoreOffHand(player); // the shield it pushed out comes back (docs/21)
    return true;
  }
  hold(player.hands, entry);
  showMessage("Nowhere to put it.");
  return false;
}

// Equip an entry from the belt or a bag, swapping out what the hand holds.
export function equipFrom(player, entry, prefer = null) {
  if (!detach(player, entry)) return false;
  if (equip(player, entry, prefer)) return true;
  if (!stow(player, entry)) map.dropItem(Math.round(player.gx), Math.round(player.gy), entry);
  showMessage("Your hands are full.");
  return false;
}

// Wear an entry from a bag (yours or a container's). A bag on the back with
// one already worn swaps, the old one dropping at your feet; any other slot
// swaps into the bag if there is room.
export function wearFrom(player, entry, fromBag) {
  const def = getItem(entry.id);
  if (!def.wear) return false;
  const old = player.worn[def.wear];
  if (fromBag) grid.remove(fromBag, entry);
  else detach(player, entry);
  if (old) {
    player.worn[def.wear] = null;
    if (def.wear === "back") map.dropItem(Math.round(player.gx), Math.round(player.gy), old);
    else if (!stow(player, old)) {
      player.worn[def.wear] = old;
      if (fromBag) grid.insert(fromBag, entry);
      else stow(player, entry);
      showMessage("No room in your bag to unequip the old one.");
      return false;
    }
  }
  player.worn[def.wear] = entry;
  return true;
}

// The keys' events for this step, from the keyboard here: a tap or a hold of E and B (the trackers'
// state is this client's), a press of E, a press of T. They ride in the player's snapshot (main.js), so
// a guest's go to the host in its input and the host performs them for the guest's player (game.step;
// docs/31/05 item 10, tier 3). Nothing pressed gives an empty object, which the snapshot leaves out.
// The belt keys, 1 to 4, as key events in the player's snapshot (item 4): performed by the world's step for the
// player whose client pressed them (updateInteract), here or on the host.
export function beltEvents() {
  let ev = null;
  for (let i = 1; i <= 4; i++) if (input.wasPressed(`Digit${i}`)) (ev = ev || {})[`belt${i}`] = true;
  return ev;
}

export function keyEvents(dt) {
  const ev = {};
  track(keyE, dt, null, () => { ev.eTap = true; }); // no hold of E: a long press is a tap on its release
  track(keyB, dt, () => { ev.bHold = true; }, () => { ev.bTap = true; });
  if (input.wasPressed("KeyE")) ev.ePressed = true;
  if (input.wasPressed("KeyT")) ev.t = true;
  return Object.keys(ev).length ? ev : null;
}

// What the keys do to a player: E the nearest simple action, on its release however long it was held; B's tap a board
// on the nearest opening, its hold a board pulled; T the torch in or out of hand. The events are the
// player's own client's (keyEvents), handed in by the step with its snapshot.
export function updateInteract(player, dt, keys) {
  if (!keys) return;
  // The belt (docs/11; the belt as utility slots, Michael 2026-10-10 late): a consumable on the slot is used; anything
  // else swaps with its hand. Moved from main.js into the world's step (item 4), so a guest's press reaches its body.
  for (let i = 0; i < 4; i++) if (keys[`belt${i + 1}`]) beltPress(player, i);
  if (player.carrying) {
    // Only E, and only to put it down.
    if (keys.ePressed) {
      const a = nearestSimpleAction(player);
      if (a) startAction(player, a);
      else showMessage("No room to put it down there.");
    }
    return;
  }
  if (keys.eTap && !player.action) {
    const a = nearestSimpleAction(player);
    if (a) startAction(player, a);
  }
  if (keys.bHold) {
    const o = nearestOpening(player);
    if (o) {
      const a = openingActions(o, player).find((x) => x.kind === "pull");
      if (a) startAction(player, a);
    }
  } else if (keys.bTap) {
    const o = nearestOpening(player);
    if (o) {
      const a = openingActions(o, player).find((x) => x.kind === "board");
      if (a && a.enabled) startAction(player, a);
      else if (a) showMessage("You need a plank.");
    }
  }
  if (keys.t) toggleTorch(player);
}

// T (Michael, 2026-10-17, #156): the torch in a hand, else on the belt, is lit with a tinderbox carried and doused when it
// is lit; with no tinderbox it says why; with none in hand or on the belt, the one in the bag is taken into a hand (unlit).
function toggleTorch(player) {
  const belt = beltOf(player) || [];
  const e = heldEntry(player.hands, "torch") || belt.find((q) => q && q.id === "torch");
  if (e) {
    if (e.lit) {
      e.lit = false;
      showMessage("You douse the torch.");
    } else if (countAll(player, "tinderbox") <= 0) showMessage("You need a tinderbox to light it.");
    else {
      e.lit = true;
      showMessage("You light the torch.");
    }
    return;
  }
  const found = findItem(player, "torch");
  if (!found) return showMessage("No torch on you.");
  equipFrom(player, found.entry);
  showMessage("You take the torch in hand. T lights it.");
}

// Eat one of a food entry (the bag's menu, the belt's menu and its key all come here; a guest's reach it as the host's command, so the
// word below reaches it through the acting player). Refused with a word when the belly is full (#186); true when one was eaten.
function eatOne(player, entry, def, take) {
  if (isFull(player)) { showMessage("You are full."); return false; }
  if (!eat(player, def)) return false;
  entry.count -= 1;
  if (entry.count <= 0) take();
  return true;
}

function beltPress(player, i) {
  const belt = beltOf(player);
  const e = belt && belt[i];
  const def = e && getItem(e.id);
  if (def && !def.hands && (def.kind === "food" || def.capacity)) {
    if (def.kind === "food") {
      eatOne(player, e, def, () => { belt[i] = null; });
    } else if ((e.fill ?? 0) > 0) drink(player, e);
    else showMessage("It is empty.");
    return;
  }
  const r = beltKey(player, i);
  if (r === "nobelt") showMessage("No belt, or no such slot.");
  else if (r === "handsfull") showMessage("Your hands are full.");
}

// ---- the item menus, for the panel ----

// An item in a grid: yours or an open container's.
export function itemMenu(player, entry, bag, otherBag) {
  const def = getItem(entry.id);
  const out = [];
  const mine = bag === bagOf(player);
  // Use: pick the thing up as what you are about to use on something (docs/30, law 2; Michael, 2026-10-12).
  out.push({ label: "Use", enabled: true, onSelect: () => use.begin(entry, { kind: "bag", bag }) });
  if (def.hands && mine) {
    if (def.hands === "either") {
      // A weapon fits either hand: the main hand swaps what is there, the off hand takes a second weapon (docs/21).
      out.push({ label: "Equip (main hand)", enabled: true, onSelect: () => equipFrom(player, entry, "main") });
      out.push({ label: "Equip (off hand)", enabled: true, onSelect: () => equipFrom(player, entry, "off") });
    } else {
      out.push({
        label: `Equip (${def.hands === "both" ? "both hands" : `${def.hands} hand`})`,
        enabled: true,
        onSelect: () => equipFrom(player, entry),
      });
    }
  }
  if (def.wear) {
    // One verb for putting anything on, one for taking it off (Michael, 2026-10-15): Equip and Unequip, never Wear or Take off.
    out.push({ label: def.bag ? `Equip (${def.bag[0]}×${def.bag[1]})` : "Equip", enabled: true, onSelect: () => wearFrom(player, entry, bag) });
  }
  if (def.bandage) {
    // Closes a bleeding wound at once (docs/02 question 29b).
    const bleeding = bleedStacks(player) > 0;
    out.push({
      label: bleeding ? "Apply" : "Apply (not bleeding)",
      enabled: bleeding,
      onSelect: () => { clearBleed(player); showMessage("The bleeding stops."); entry.count -= 1; if (entry.count <= 0) grid.remove(bag, entry); },
    });
  }
  if (def.kind === "food") {
    out.push({ label: "Eat", enabled: true, onSelect: () => { eatOne(player, entry, def, () => grid.remove(bag, entry)); } });
  }
  if (def.capacity) {
    const pct = Math.round(entry.fill ?? 0);
    out.push({ label: `Drink (${pct}%)`, enabled: pct > 0, onSelect: () => drink(player, entry) });
  }
  if (def.splitsInto && mine) {
    const s = def.splitsInto;
    out.push({
      label: `Split into ${s.count} ${getItem(s.id).name.toLowerCase()}s`,
      enabled: true,
      onSelect: () => {
        grid.remove(bag, entry);
        const added = addItem(bag, s.id, s.count);
        if (added < s.count) {
          for (let i = added; i < s.count; i++) map.dropItem(Math.round(player.gx), Math.round(player.gy), { id: s.id, count: 1 });
          showMessage("Some planks fell to the floor.");
        }
      },
    });
  }
  if (otherBag) {
    const nested = !canStoreIn(entry); // the container rule: only empty containers go in
    out.push({
      label: (mine ? `Store in ${otherBag.container}` : "Take") + (nested ? " (empty it first)" : ""),
      enabled: !nested,
      onSelect: () => {
        if (!grid.transfer(bag, otherBag, entry)) showMessage(mine ? "No room in there." : "No room in your bag.");
      },
    });
  }
  if (mine) {
    out.push({
      label: entry.count > 1 ? `Drop all (${entry.count})` : "Drop",
      enabled: true,
      onSelect: () => {
        grid.remove(bag, entry);
        map.dropItem(Math.round(player.gx), Math.round(player.gy), entry);
      },
    });
  }
  return out;
}

// An item in a slot: "worn:head", "belt:2", "hand:main". Every slot offers
// Drop, which puts the thing at your feet without passing through the sack
// (Michael, 2026-10-10 night); a belt or a bag drops as a container, with
// what it holds still in it.
export function slotMenu(player, slotId) {
  const [kind, key] = slotId.split(":");
  const out = [];
  const held = kind === "worn" ? player.worn[key] : kind === "hand" ? player.hands[key] : kind === "belt" ? beltOf(player)?.[Number(key)] : null;
  if (held) out.push({ label: "Use", enabled: true, onSelect: () => use.begin(held, { kind: "slot", id: slotId }) });
  const dropEntry = (entry) => ({
    label: "Drop",
    enabled: true,
    onSelect: () => {
      detach(player, entry);
      map.dropItem(Math.round(player.gx), Math.round(player.gy), entry);
    },
  });
  if (kind === "worn") {
    const entry = player.worn[key];
    if (!entry) return out;
    out.push({
      label: "Unequip",
      enabled: true,
      onSelect: () => {
        player.worn[key] = null;
        if (key === "back" || !stow(player, entry)) {
          map.dropItem(Math.round(player.gx), Math.round(player.gy), entry);
          showMessage(key === "back" ? `You set the ${nameOf(entry).toLowerCase()} down.` : "No room in your bag; it is on the floor.");
        }
      },
    });
    out.push(dropEntry(entry));
  } else if (kind === "belt") {
    const belt = beltOf(player);
    const entry = belt && belt[Number(key)];
    if (!entry) return out;
    const bdef = getItem(entry.id);
    // A food on the belt is eaten from it, and a skin drunk from it (Michael, 2026-10-18, #179: "being able to eat from your belt"): the
    // slot's first entry, so a double-click does it; a hand item is equipped as before.
    if (bdef.kind === "food") {
      out.push({ label: "Eat", enabled: true, onSelect: () => { eatOne(player, entry, bdef, () => { belt[Number(key)] = null; }); } });
    } else if (bdef.capacity) {
      const pct = Math.round(entry.fill ?? 0);
      out.push({ label: `Drink (${pct}%)`, enabled: pct > 0, onSelect: () => drink(player, entry) });
    } else out.push({ label: "Equip", enabled: true, onSelect: () => equipFrom(player, entry) });
    out.push({
      label: "Put in bag",
      enabled: !!bagOf(player),
      onSelect: () => {
        belt[Number(key)] = null;
        if (!grid.insert(bagOf(player), entry)) {
          belt[Number(key)] = entry;
          showMessage("No room in your bag.");
        }
      },
    });
    out.push(dropEntry(entry));
  } else if (kind === "hand") {
    const entry = player.hands[key];
    if (!entry) return out;
    out.push({ label: "Unequip", enabled: true, onSelect: () => unequip(player, entry) });
    out.push(dropEntry(entry));
  }
  return out;
}

// ---- interactables (docs/02, question 27) ----
// A mushroom or a rock under the cursor, by its visible pixels, the frontmost
// one; it wiggles, then rests for a moment before it will wiggle again.
const POKE_COOLDOWN_MS = 600;
// A click sways a thing, or plays its animation, only within the player's reach,
// the same as placing and building (Michael, 2026-10-12: trees wiggled from
// across the map). A far right-click still finds it for its menu.
export const CLICK_REACH = 2.6; // burn.js's DIP_REACH is the same number, kept there to keep this module out of combat's imports
const inReach = (prop, player) => !!player && distToTiles(player, prop.tiles) <= CLICK_REACH;
const pokePixels = new Map(); // sheet -> { w, h, a: Uint8Array of alpha }

function alphaOf(sheet) {
  let p = pokePixels.get(sheet);
  if (p) return p;
  const img = sheet.image;
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  const a = new Uint8Array(img.width * img.height);
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
  p = { w: img.width, h: img.height, a };
  pokePixels.set(sheet, p);
  return p;
}

export function interactableAt(sx, sy, wanted = (prop) => prop.interactable) {
  const g = iso.toGrid(sx, sy);
  const tx = Math.round(g.gx);
  const ty = Math.round(g.gy);
  let best = null;
  // A giant tree's crown is about six tiles up the screen from its trunk's
  // tile, so look that far down the grid as well as a little around.
  for (let dy = -2; dy <= 7; dy++) {
    for (let dx = -2; dx <= 7; dx++) {
      const prop = map.peekTile(tx + dx, ty + dy)?.prop; // a hit test never grows a chunk (docs/23a, A4)
      if (!prop || !wanted(prop)) continue;
      const r = propRect(prop, prop.tile[0], prop.tile[1]);
      if (!r || !pointInRect(sx, sy, r)) continue;
      const sheet = getSheet(prop.sprite, prop.tiles.length);
      const f = sheet.frames[idleFrame(sheet, prop, 0)];
      const px = Math.floor(sx - r.x) + (sheet.bounds ? sheet.bounds.x : 0) + f[0];
      const py = Math.floor(sy - r.y) + (sheet.bounds ? sheet.bounds.y : 0) + f[1];
      const al = alphaOf(sheet);
      if (px < 0 || py < 0 || px >= al.w || py >= al.h || al.a[py * al.w + px] === 0) continue;
      const depth = prop.tile[0] + prop.tile[1];
      if (!best || depth > best.depth) best = { prop, depth };
    }
  }
  return best ? best.prop : null;
}

// Poke the interactable under the cursor: the thing found, or null. It sways
// if it is within the player's reach and not still resting from the last poke.
// The rule (Michael, 2026-10-12, written in stone): anything interactable
// wobbles when clicked, by default; a definition turns it off with
// `"sway": false`, and one with a `clickAnim` plays that instead (the well).
// The props stamped this step, [id, sim ms], for the frame to carry: a stamp is presentation (the sway), but
// a guest watching someone walk through a field should see it wobble (the sync check found the stamps
// differing, 2026-10-13). Drained by net.js each step.
const stamped = [];
export function takePokes() {
  return stamped.splice(0);
}
// `field` is pokedAt (a sway, kind 0) or playedAt (the well's bucket, kind 1). A guest's own click also tells the host
// (the sink net.js sets), so everyone sees it; the host's list goes out in the frame to every guest.
let stampSink = null;
export function setStampSink(fn) {
  stampSink = fn;
}
function stamp(prop, now, field = "pokedAt") {
  prop[field] = now;
  map.unsaved(prop.tile[0], prop.tile[1], false); // the stamp is saved; the wire sends it in the frame's pokes, not the chunk
  const kind = field === "playedAt" ? 1 : 0;
  if (stamped.length < 400) stamped.push([prop.id, now, kind]);
  if (stampSink) stampSink(prop.id, kind);
}

// A guest's click on a thing, performed here for its player: the same reach and rest the host's own click meets.
export function stampFromGuest(player, id, kind) {
  const prop = typeof id === "string" ? map.propById(id) : null;
  if (!prop || !inReach(prop, player)) return false;
  if (kind) return play(prop);
  const def = getDef(prop.sprite);
  if (!prop.interactable || def.sway === false || def.clickAnim) return false;
  const now = loop.simTime() * 1000;
  if (!prop.pokedAt || now - prop.pokedAt >= POKE_COOLDOWN_MS) stamp(prop, now);
  return true;
}

export function pokeAt(sx, sy, player) {
  const prop = interactableAt(sx, sy);
  if (!prop) return null;
  const def = getDef(prop.sprite);
  if (def.sway === false || def.clickAnim) return prop;
  const now = loop.simTime() * 1000; // sim milliseconds (docs/23a, C2); the renderer reads the same clock
  if (inReach(prop, player) && (!prop.pokedAt || now - prop.pokedAt >= POKE_COOLDOWN_MS)) stamp(prop, now);
  return prop;
}

// ---- brushing through (Michael, 2026-10-12) ----
// Any character walking through an interactable that can be walked through
// (a crop, a mushroom: `solid` false; never a tree or a rock) sets it swaying
// as a click would. One round finishes before the next starts, so a walk
// through a field keeps it wobbling without ever restarting a sway mid-way;
// standing still in it does nothing.
const BRUSH_MS = 560; // the sway's length (render/props.js, WIGGLE_MS)
export function brushThrough(ch) {
  if (!ch || ch.dead) return;
  // Moved: a fiftieth of a tile since the last point that counted, so a slow
  // walker (the dead at one tile a second cover a sixtieth a step) adds up to
  // it over a few steps and a stander never does.
  const moved = ch.brushX === undefined || Math.hypot(ch.gx - ch.brushX, ch.gy - ch.brushY) > 0.02;
  if (!moved) return;
  ch.brushX = ch.gx;
  ch.brushY = ch.gy;
  const prop = map.peekTile(Math.round(ch.gx), Math.round(ch.gy))?.prop;
  if (!prop || !prop.interactable || prop.solid) return;
  const def = getDef(prop.sprite);
  if (def.sway === false || def.clickAnim) return;
  const now = loop.simTime() * 1000;
  if (!prop.pokedAt || now - prop.pokedAt >= BRUSH_MS) stamp(prop, now);
}

// ---- characters under the cursor (docs/19) ----

let allCharacters = () => []; // main.js hands in everyone but the player
export function setCharacters(fn) {
  allCharacters = fn;
}


// The character (never the player) whose body the point falls on: a box a
// little wider than the figure and as tall as it, standing on its feet, since
// a figure moves and a pixel test would be fussy. The nearest to the camera
// wins a tie.
// `viewer`, the player pointing, decides which of the dead are there to point at (sight.js, #88): the dark hides
// information, never physics, so a dead one lost in the dark has no hover hand and cannot be clicked or right-clicked,
// while a swing or a shot that meets it still hits it. Without a viewer nothing is hidden.
export function characterAt(sx, sy, viewer = null) {
  let best = null;
  for (const c of allCharacters()) {
    if (c.kind === "player") continue;
    if (viewer && c.kind === "zombie" && !c.dead && !sight.seen(viewer, c)) continue; // lost in the dark: nothing to point at
    const p = iso.toScreen(c.gx, c.gy);
    if (sx < p.x - 40 || sx > p.x + 40 || sy < p.y - 72 || sy > p.y + 8) continue;
    // The frame's own pixels, placed as the renderer places them; a standing one also
    // keeps the forgiving column over its feet. A body lies to one side of its feet,
    // so the column alone never found it (Michael, 2026-10-13: no Search body on a corpse).
    const standing = !c.corpse && sx >= p.x - 12 && sx <= p.x + 12 && sy >= p.y - 64 && sy <= p.y + 2;
    if (!standing && !characterPixelAt(c, sx, sy, p)) continue;
    if (!best || c.gx + c.gy > best.gx + best.gy) best = c;
  }
  return best;
}

// Is the point on an opaque pixel of the character's current frame?
function characterPixelAt(c, sx, sy, p) {
  let sheet;
  try { sheet = getSheet(c.sprite); } catch { return false; }
  if (!sheet || !sheet.image) return false;
  const r = resolveFacing(sheet, c.facing);
  const f = sheet.frames[frameName(sheet, c.anim.name, r.facing, c.anim.frame)];
  if (!f) return false;
  let lx = Math.floor(sx - (Math.round(p.x) - sheet.anchor[0]));
  const ly = Math.floor(sy - (Math.round(p.y) - sheet.anchor[1]));
  if (lx < 0 || ly < 0 || lx >= f[2] || ly >= f[3]) return false;
  if (r.flip) lx = f[2] - 1 - lx;
  const al = alphaOf(sheet);
  return al.a[(f[1] + ly) * al.w + f[0] + lx] > 0;
}

// A left click on a villager within reach pokes it. Returns the character under the cursor.
// A guest's click on a villager, by its id (item 4): the host has no cursor of the guest's, so the guest names it.
export function pokeVillagerFromGuest(player, id) {
  const c = allCharacters().find((q) => q.id === id && q.kind === "villager");
  if (!c || c.dead || Math.hypot(player.gx - c.gx, player.gy - c.gy) > CLICK_REACH) return false;
  pokeVillager(c, player);
  return true;
}

export function clickCharacterAt(sx, sy, player) {
  const c = characterAt(sx, sy, player);
  if (c && c.kind === "villager" && Math.hypot(player.gx - c.gx, player.gy - c.gy) <= CLICK_REACH) pokeVillager(c, player);
  return c;
}

// A dead zombie's body, searched like a chest (docs/19): the first time takes a
// moment and rolls its pockets; after that it just opens. The grid is the body's.
function searchBodyAction(c) {
  const tiles = [[Math.round(c.gx), Math.round(c.gy)]];
  return act({
    kind: "container",
    simple: true,
    label: c.searched ? "Open body" : "Search body",
    tiles,
    mx: c.gx,
    my: c.gy,
    duration: c.searched ? 0 : SEARCH_TIME,
    perform() {
      const bag = lootOf(c);
      c.searched = true;
      emit("containerOpened", { bag, tiles, name: "body", corpse: c, character: c });
      return true;
    },
  });
}

// What a right-click on a character offers, by kind. Everyone, the player
// included, can be set on fire and put out: a visual test with no effect
// (fire.js, docs/05 "Burning"), from anywhere on screen.
function characterActions(c, player) {
  const out = [];
  if ((c.kind === "zombie" || c.kind === "player") && c.dead && c.corpse) out.push(searchBodyAction(c)); // a player's body too (2026-10-14)
  if (c.kind === "villager") {
    out.push(act({
      kind: "poke",
      label: `Poke ${c.name}`,
      tiles: [[Math.round(c.gx), Math.round(c.gy)]],
      range: CLICK_REACH,
      simple: false,
      perform() {
        pokeVillager(c, player);
        return true;
      },
    }));
  }
  return out;
}

// The player's own figure under the cursor (characterAt skips the player).
function playerAt(sx, sy, player) {
  const p = iso.toScreen(player.gx, player.gy);
  return sx >= p.x - 12 && sx <= p.x + 12 && sy >= p.y - 64 && sy <= p.y + 2;
}

// A prop with a click animation (`clickAnim` on its sprite: the well's bucket)
// plays it once. Just for fun, so a click while it plays does nothing: spam
// cannot stack or restart it (Michael, 2026-10-11). Returns whether it started.
export function play(prop) {
  const anim = prop && getDef(prop.sprite).clickAnim;
  if (!anim) return false;
  const now = loop.simTime() * 1000; // sim milliseconds (docs/23a, C2)
  const total = anim.ms.reduce((a, b) => a + b, 0);
  if (prop.playedAt && now - prop.playedAt < total) return false;
  stamp(prop, now, "playedAt");
  return true;
}

// Left click: play the click animation of the thing under the cursor, by its
// pixels, if it is within the player's reach.
export function playAt(sx, sy, player) {
  const prop = interactableAt(sx, sy, (p) => !!getDef(p.sprite).clickAnim);
  if (prop && inReach(prop, player)) play(prop);
  return prop;
}

// The actions of a thing the player clicked by its pixels (a tree's crown is
// further up the screen than the menu's own search reaches).
export function actionsForProp(prop, player) {
  return propActions(prop, player);
}
