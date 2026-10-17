// The inventory panel's handlers: what a drag, a drop, and a double-click do
// to the player's slots, bag, and the floor (docs/10, docs/11). Moved out of
// main.js on 2026-10-12 (docs/23a, D1): the rules of where an entry may go and
// what gives way live here, the panel only draws and asks. `getPlayer` is a
// getter, so a second player could have handlers of their own.

import * as items from "../items.js";
import * as inventory from "../inventory.js";
import * as grid from "../grid.js";
import * as map from "../map.js";
import * as interact from "../interact.js";
import * as tuning from "../tuning.js";
import * as use from "../use.js";
import { showMessage } from "./prompt.js";

function slotGet(player, id) {
  const { kind, key, index } = inventory.parseSlot(id);
  if (kind === "worn") return player.worn[key];
  if (kind === "belt") return inventory.beltOf(player)?.[index] ?? null;
  if (kind === "hand") return player.hands[key];
  return null;
}

function slotSet(player, id, entry) {
  const { kind, key, index } = inventory.parseSlot(id);
  if (kind === "worn") player.worn[key] = entry;
  else if (kind === "belt") {
    const belt = inventory.beltOf(player);
    if (belt) belt[index] = entry;
  } else if (kind === "hand") {
    // Clearing a hand releases the entry (from both hands if it is two-handed);
    // filling one goes through equip in placeInSlot, so this only clears.
    if (entry) items.hold(player.hands, entry, key);
    else if (player.hands[key]) items.release(player.hands, player.hands[key]);
  }
}

// Take an entry out of where a drag started.
function detachFrom(player, entry, from) {
  if (from.kind === "bag") grid.remove(from.bag, entry);
  else if (slotGet(player, from.id) === entry) slotSet(player, from.id, null);
}

function restoreTo(player, entry, from) {
  if (from.kind === "bag") {
    if (!grid.insert(from.bag, entry)) map.dropItem(Math.round(player.gx), Math.round(player.gy), entry);
  } else slotSet(player, from.id, entry);
}

export function createInventoryActions(getPlayer) {
  return {
    changed() {},
    belt() {
      return inventory.beltOf(getPlayer());
    },
    isItemBag(bag) {
      return bag === inventory.bagOf(getPlayer());
    },
    canStore(entry) {
      return inventory.canStoreIn(entry);
    },
    canPlace(entry, slotId) {
      const player = getPlayer();
      const { kind, key, index } = inventory.parseSlot(slotId);
      const def = items.getItem(entry.id);
      if (kind === "worn") return def.wear === key;
      if (kind === "belt") {
        // Hand items, one at a time, or consumables as a stack.
        const belt = inventory.beltOf(player);
        if (!belt || index >= belt.length) return false;
        if (def.hands) return entry.count === 1;
        return def.kind === "food" || !!def.capacity;
      }
      // A hand takes what fits it; an occupant swaps out if it can be stowed.
      if (kind === "hand") return !!def.hands && entry.count === 1 && (def.hands === "both" || def.hands === "either" || def.hands === key);
      return false;
    },
    // Drop onto a worn or belt slot. An occupant goes to the bag or belt if
    // it can; an old bag on the back drops at your feet, since bags do not nest.
    placeInSlot(entry, from, slotId) {
      const player = getPlayer();
      const { kind, key } = inventory.parseSlot(slotId);
      const occupant = slotGet(player, slotId);
      if (occupant === entry) return;
      // One hand dragged onto the other swaps the two (Michael, 2026-10-12), instead of sending the
      // one in the way to the bag, when each is allowed in the other's hand.
      // (A drag's `from` is { kind: "slot", id }; the hand is the slot id's kind. Until 2026-10-13 this
      // asked for from.kind === "hand", which never held, so the occupant was always stowed: Michael.)
      const fromSlot = from.kind === "slot" ? inventory.parseSlot(from.id) : null;
      if (kind === "hand" && fromSlot && fromSlot.kind === "hand" && occupant) {
        const fromKey = fromSlot.key;
        const allowed = (e, k) => { const h = items.getItem(e.id).hands; return h === "either" || h === k; };
        if (fromKey !== key && allowed(entry, key) && allowed(occupant, fromKey)) {
          player.hands[fromKey] = occupant;
          player.hands[key] = entry;
          return;
        }
      }
      detachFrom(player, entry, from);
      if (kind === "hand") {
        // equip swaps whatever is in the way out to the bag or belt.
        if (!inventory.equip(player, entry, key)) {
          restoreTo(player, entry, from);
          showMessage("No room to swap.");
        }
        return;
      }
      // Dragging a bag off your back takes its grid away; the bag column may
      // have been the source, so it is detached already.
      if (occupant) {
        slotSet(player, slotId, null);
        if (kind === "worn" && key === "back") {
          slotSet(player, slotId, entry);
          map.dropItem(Math.round(player.gx), Math.round(player.gy), occupant);
          return;
        }
        if (!inventory.stow(player, occupant)) {
          slotSet(player, slotId, occupant);
          restoreTo(player, entry, from);
          showMessage("No room to swap.");
          return;
        }
      }
      slotSet(player, slotId, entry);
    },
    // Drop from a slot into a grid at a cell.
    placeInGrid(entry, from, bag, x, y, rot) {
      const player = getPlayer();
      if (!inventory.canStoreIn(entry)) return showMessage("Empty it first, or equip it.");
      detachFrom(player, entry, from);
      // Taking the bag off the back while dropping into its own grid cannot work.
      if (!bag.items && !bag.cols) return restoreTo(player, entry, from);
      if (!grid.fits(bag, entry.id, x, y, rot)) return restoreTo(player, entry, from);
      entry.x = x;
      entry.y = y;
      entry.rot = !!rot;
      items.douse(entry);
      bag.items.push(entry);
    },
    dropToFloor(entry, from) {
      const player = getPlayer();
      detachFrom(player, entry, from);
      map.dropItem(Math.round(player.gx), Math.round(player.gy), entry);
    },
    noRoom(intoBag) {
      showMessage(intoBag ? "No room in your bag." : "No room in there.");
    },
    // The grid's own moves, here as well as on the wire's side (Michael's playtest, 2026-10-14: nothing could be dragged
    // between bags or within one). The panel once did these itself when a handler was missing; main.js's switch between
    // the local and the remote handlers took a missing local one to mean "the remote one", which only sends to a host,
    // so in a world of one's own every move between grids, the shift-click, Tidy, and Rotate did nothing.
    moveInGrid(entry, fromBag, toBag, x, y, rot) {
      grid.moveEntry(fromBag, toBag, entry, x, y, rot);
    },
    quickMove(entry, bag, toBag) {
      if (!grid.transfer(bag, toBag, entry)) showMessage(toBag === inventory.bagOf(getPlayer()) ? "No room in your bag." : "No room in there.");
    },
    rotate(entry, bag) {
      if (grid.fits(bag, entry.id, entry.x, entry.y, !entry.rot, entry)) entry.rot = !entry.rot;
    },
    tidy(bag) {
      grid.tidy(bag);
    },
    itemMenu(entry, bag, otherBag) {
      return interact.itemMenu(getPlayer(), entry, bag, otherBag);
    },
    // Double-click in your bag: equip what can be held, wear what can be worn.
    use(entry, bag) {
      const def = items.getItem(entry.id);
      if (def.hands) return interact.equipFrom(getPlayer(), entry);
      if (def.wear) return interact.wearFrom(getPlayer(), entry, bag);
      return false;
    },
    // Double-click on a slot: its Equip or Unequip (Use comes first in the menu, and a double-click that began the
    // Use mode never took anything off; the review of #66).
    useSlot(slotId) {
      const m = interact.slotMenu(getPlayer(), slotId);
      const a = m.find((q) => q.label === "Unequip" || q.label.startsWith("Equip") || q.label === "Eat" || q.label.startsWith("Drink")); // a food on the belt is eaten by a double-click (#179)
      if (!a || a.enabled === false) return false;
      a.onSelect();
      return true;
    },
    slotMenu(slotId) {
      return interact.slotMenu(getPlayer(), slotId);
    },
  };
}

// ---- the panel over the wire (docs/31/05, item 9; docs/31/04) ----
// A guest's panel is a view on its replica: every drag, drop, double-click, and menu entry goes to
// the host as a command by the entry's uid, the slot's id, and the bag's address (interact.containerAt),
// and the frame brings the result back (the source is `src` on the wire: `from` is the sender's stamp). The reads (what fits where, the menus' labels and enabled
// flags) are the local handlers' on the replica, so the panel looks the same; only the mutators send.
// `getOpen` gives the container open beside the bag as { bag, address }, or null.
// The "Use" entry stays local: it only begins the Use mode (use.js); its apply is the Use mode's own command.

function fromAddress(from, addressOf) {
  if (from.kind === "slot") return { kind: "slot", id: from.id };
  const bag = addressOf(from.bag);
  return bag ? { kind: "bag", bag } : null;
}

export function createRemoteInventoryActions(getPlayer, getOpen, send) {
  const local = createInventoryActions(getPlayer);
  const addressOf = (bag) => {
    if (!bag) return null;
    if (bag === inventory.bagOf(getPlayer())) return { mine: true };
    const open = getOpen();
    // The bag the panel drew is this frame's or the last one's: a chunk update replaces the container's bag, and a click in
    // the frame between found no address, so no menu and no drop (Michael's playtest: "no take option", 2026-10-13).
    return open && (bag === open.bag || (open.prev && bag === open.prev)) ? open.address : null;
  };
  const sendFrom = (op, entry, from, more) => {
    const f = fromAddress(from, addressOf);
    if (f) send({ op, uid: entry.uid, src: f, ...more });
  };
  // Use begins here as it does alone, with the bag's address kept on the mode, since the replica's bag
  // object is new with every frame (main.js's sender reads it when the click lands).
  const remoteMenu = (entries, more) => entries.map((en) => (en.label === "Use" ? en : { ...en, onSelect: () => send({ op: "menu", label: en.label, ...more }) }));
  const useFromBag = (entries, entry, bag, address) => entries.map((en) => (en.label === "Use" ? { ...en, onSelect: () => use.begin(entry, { kind: "bag", bag, address }) } : en));
  return {
    ...local,
    addressOf,
    placeInSlot(entry, from, slotId) {
      sendFrom("slot", entry, from, { slot: slotId });
    },
    placeInGrid(entry, from, bag, x, y, rot) {
      const to = addressOf(bag);
      if (to) sendFrom("grid", entry, from, { bag: to, x, y, rot: !!rot });
    },
    moveInGrid(entry, fromBag, toBag, x, y, rot) {
      const to = addressOf(toBag);
      if (to) sendFrom("grid", entry, { kind: "bag", bag: fromBag }, { bag: to, x, y, rot: !!rot });
    },
    dropToFloor(entry, from) {
      sendFrom("floor", entry, from, {});
    },
    quickMove(entry, bag, toBag) {
      const to = addressOf(toBag);
      if (to) sendFrom("quick", entry, { kind: "bag", bag }, { bag: to });
    },
    rotate(entry, bag) {
      sendFrom("rotate", entry, { kind: "bag", bag }, {});
    },
    tidy(bag) {
      const a = addressOf(bag);
      if (a) send({ op: "tidy", bag: a });
    },
    itemMenu(entry, bag, otherBag) {
      const from = addressOf(bag);
      if (!from) return [];
      return useFromBag(remoteMenu(local.itemMenu(entry, bag, otherBag), { uid: entry.uid, src: { kind: "bag", bag: from }, other: addressOf(otherBag) }), entry, bag, from);
    },
    use(entry, bag) {
      sendFrom("dbl", entry, { kind: "bag", bag }, {});
      return true;
    },
    useSlot(slotId) {
      const m = local.slotMenu(slotId);
      const a = m.find((q) => q.label === "Unequip" || q.label.startsWith("Equip") || q.label === "Eat" || q.label.startsWith("Drink")); // as the host's own (above)
      if (!a || a.enabled === false) return false;
      send({ op: "menu", label: a.label, src: { kind: "slot", id: slotId } });
      return true;
    },
    slotMenu(slotId) {
      return remoteMenu(local.slotMenu(slotId), { src: { kind: "slot", id: slotId } });
    },
  };
}

// The host's side: a guest's command run on this world as that player, through the same handlers its
// own panel uses. Every object is found again by its address and uid, so a command on a stale view
// (the frame that moved the thing was still in flight) finds nothing and does nothing. A container
// not the player's must be within the panel's closing distance, the same rule that shuts it. Returns
// true when something ran. Messages said on the way reach the guest through the acting player (net.js).
// What a command's addresses mean on this world: the bag, the source, the entry, each found again,
// and the tiles of every container not the player's own, marked once something ran.
function resolvers(player) {
  const touched = new Set();
  const containerOf = (a) => {
    const r = interact.containerAt(player, a);
    if (!r) return null;
    if (!a.mine) {
      if (interact.distToTiles(player, r.tiles) > Math.max(a.closeDist || 0, tuning.world.containerCloseDist)) return null;
      touched.add(r.tiles[0]);
    }
    return r;
  };
  const fromOf = (f) => {
    if (!f) return null;
    if (f.kind === "slot") return typeof f.id === "string" ? { kind: "slot", id: f.id } : null;
    const r = containerOf(f.bag);
    return r ? { kind: "bag", bag: r.bag } : null;
  };
  const entryIn = (from, uid) => {
    if (uid == null) return null;
    if (from.kind === "slot") {
      const e = slotGet(player, from.id);
      return e && e.uid === uid ? e : null;
    }
    return from.bag.items.find((e) => e.uid === uid) || null;
  };
  return { touched, containerOf, fromOf, entryIn };
}

export function performItemCommand(player, c) {
  if (!player || !c) return false;
  const h = createInventoryActions(() => player);
  const { touched, containerOf, fromOf, entryIn } = resolvers(player);
  let ran = false;
  if (c.op === "tidy") {
    const to = containerOf(c.bag);
    if (to) grid.tidy(to.bag);
    if (to) for (const [tx, ty] of touched) map.markDirty(tx, ty);
    return !!to;
  }
  const from = fromOf(c.src); // `src`, since the wire stamps `from` with the sender (net.js send)
  const entry = from ? entryIn(from, c.uid) : null;
  if (c.op === "slot" && entry && typeof c.slot === "string") {
    h.placeInSlot(entry, from, c.slot);
    ran = true;
  } else if (c.op === "grid" && entry) {
    const to = containerOf(c.bag);
    if (to) {
      const x = Math.round(c.x) || 0;
      const y = Math.round(c.y) || 0;
      if (from.kind === "bag") grid.moveEntry(from.bag, to.bag, entry, x, y, !!c.rot);
      else h.placeInGrid(entry, from, to.bag, x, y, !!c.rot);
      ran = true;
    }
  } else if (c.op === "floor" && entry) {
    h.dropToFloor(entry, from);
    ran = true;
  } else if (c.op === "quick" && entry && from.kind === "bag") {
    const to = containerOf(c.bag);
    if (to && to.bag !== from.bag) {
      const intoMine = to.bag === inventory.bagOf(player);
      if (!h.canStore(entry) || !grid.transfer(from.bag, to.bag, entry)) h.noRoom(intoMine);
      ran = true;
    }
  } else if (c.op === "rotate" && entry && from.kind === "bag") {
    if (grid.fits(from.bag, entry.id, entry.x, entry.y, !entry.rot, entry)) entry.rot = !entry.rot;
    ran = true;
  } else if (c.op === "dbl" && entry && from.kind === "bag") {
    h.use(entry, from.bag);
    ran = true;
  } else if (c.op === "menu" && from && typeof c.label === "string") {
    let entries = [];
    if (from.kind === "slot") entries = h.slotMenu(from.id);
    else if (entry) {
      const other = c.other ? containerOf(c.other) : null;
      entries = h.itemMenu(entry, from.bag, other ? other.bag : null);
    }
    const en = entries.find((q) => q.label === c.label);
    if (en && en.enabled && en.label !== "Use") {
      en.onSelect();
      ran = true;
    }
  }
  if (ran) for (const [tx, ty] of touched) map.markDirty(tx, ty); // a container's grid travels with its chunk
  return ran;
}

// A guest's Use (use.js, docs/30 law 2): the item by its uid and source, the target by its address
// (an item in a bag, a prop by id, a character by id, a tile), resolved and run here as that player;
// the line it says reaches the guest through the log's sink (main.js). `findCharacter` is the
// world's lookup across players, the dead, villagers, and corpses.
export function performUseCommand(player, c, findCharacter) {
  if (!player || !c || !c.target) return false;
  const { touched, containerOf, fromOf, entryIn } = resolvers(player);
  const from = fromOf(c.src);
  const entry = from ? entryIn(from, c.uid) : null;
  if (!entry) return false;
  const t = c.target;
  let target = null;
  if (t.kind === "item" && typeof t.slot === "string") {
    const e = slotGet(player, t.slot); // an item in a hand, on the belt, or worn: the slot is its address
    if (e && e.uid === t.uid) target = { kind: "item", entry: e, slot: t.slot };
  } else if (t.kind === "item") {
    const r = containerOf(t.bag);
    const e = r && r.bag.items.find((q) => q.uid === t.uid);
    if (e) target = { kind: "item", entry: e };
  } else if (t.kind === "bracket") {
    const b = [...map.brackets()].find((q) => q.tx === t.tx && q.ty === t.ty && q.edge === t.edge); // a torch on a wall, by its address (#170)
    if (b) target = { kind: "bracket", bracket: b };
  } else if (t.kind === "prop") {
    const prop = typeof t.id === "string" ? map.propById(t.id) : null;
    if (prop) target = { kind: "prop", prop };
  } else if (t.kind === "character") {
    const ch = findCharacter && typeof t.id === "string" ? findCharacter(t.id) : null;
    if (ch) target = { kind: "character", ch };
  } else if (t.kind === "tile") {
    const x = Math.round(t.x) || 0;
    const y = Math.round(t.y) || 0;
    const tile = map.peekTile(x, y);
    target = { kind: "tile", x, y, floor: tile ? tile.floor : null };
  }
  if (!target) return false;
  use.applyWith(entry, target, player);
  for (const [tx, ty] of touched) map.markDirty(tx, ty);
  return true;
}
