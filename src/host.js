// The authority's half of the game (docs/31/04; item 5's first step, 2026-10-14, `02`): what a world's host does
// beyond `game.step`, in one module the browser host and the server world share. Moved out of main.js as a pure
// move: the joins and whose character is whose, dormancy, stepping away and back, the routing of a message, a log
// line, an opened container, the spent word, and the kick to the player they are for, and the save on a death.
// The browser's client (main.js) keeps what is a screen's and only reads the world. Nothing here touches a window:
// it runs under Node for a server world (server/world.js).
//
// The client hands in what differs between a browser and a server (`init`): the store of whose character is whose
// (`owners`: a browser id's hash to the player it made; `dormant`: the hash to the record of a character out of the
// world; `name`), the world's save, its own player (a browser host's; a server has none), and what to do with a
// character put back into the world (the browser rebakes its sheet).

import * as game from "./game.js";
import * as map from "./map.js";
import * as net from "./net.js";
import * as figure from "./figure.js";
import * as events from "./events.js";
import * as items from "./items.js";
import * as log from "./ui/log.js";
import * as world from "./world.js";
import * as verbs from "./verbs.js";
import * as placement from "./placement.js";
import * as bleed from "./bleed.js";
import * as iso from "./iso.js";
import { performItemCommand, performUseCommand } from "./ui/inventory-actions.js";
import { showMessage, setMessageSink } from "./ui/prompt.js";
import * as tuning from "./tuning.js";

const S = game.state;

export const MAX_OWNERS = 16; // the browsers a world remembers a character for

// The players a world holds at once (Michael, #93: "4 players in a browser-hosted world, 8 in a server world, both in
// data"): `cap` is read from `data/tuning.json` by whoever runs the world (main.js a browser's, server/world.js a
// server's). See `full` for what counts. MAX_OWNERS above is a different number: the browsers a world remembers.
let cfg = {
  cap: () => Infinity,
  store: () => ({ owners: {}, dormant: {} }),
  save: () => Promise.resolve(false),
  self: () => null,
  arrived: () => {},
};

export function init(c) {
  cfg = { ...cfg, ...c };
}

const self = () => cfg.self();
const store = () => cfg.store();

// Whether the world holds as many players as it may: a new character, or one coming back from the save after its
// player left, would take the place of none that is there already. The places held are the characters standing in the
// world, the guests still connected who have stepped away (idling at the keyboard is not leaving; their `back` needs no
// check, since they never gave the place up), and, in a browser's world, the host's own, whether it stands in the world,
// is stepped away, or is on the dead screen (`self()` stays set, so a guest cannot take the host's place and the host's
// respawn or comeBack never goes over). A character resting in the save whose player is gone holds none. The friends'
// dot (#139) will count with this one function.
export function full() {
  const me = self();
  let held = S.players.filter((p) => !me || p.id !== me.id).length;
  if (me) held += 1;
  held += net.awayGuestHashes().length;
  return held >= cfg.cap();
}

// The look a character is baked from: DEFAULT_LOOK under an identity's colours and style.
export function lookOf(identity) {
  const chosen = (identity && identity.look) || {};
  return { ...figure.DEFAULT_LOOK, ...chosen, hairStyle: chosen.hairStyle || "short" };
}

// A join (net.js hooks.joinFor): the character this browser made here, back from dormancy if it went; never
// the host's own; a dead one or an unknown browser asks for an identity (`who`).
export function joinFor(hash, identity) {
  const st = store();
  const me = self();
  const myId = me ? me.id : null;
  let owned = hash ? st.owners[hash] : null;
  if (owned && owned === myId) owned = null;
  if (owned) {
    let p = S.players.find((q) => q.id === owned) || null;
    if (!p && st.dormant[hash]) {
      if (full()) return { full: true }; // refused before anything is taken out of the save: never half in
      p = game.putPlayer(st.dormant[hash]);
      delete st.dormant[hash];
      if (p) cfg.arrived(p);
    }
    if (!p) p = S.corpses.find((c) => c.id === owned && c.kind === "player") || null; // fallen: a body now (2026-10-14)
    if (p && !p.dead) return { player: p };
    if (!identity) return { who: { dead: !!(p && p.dead) } };
  }
  if (!identity) return { who: {} };
  // A world holds so many browsers' characters: anyone with the code could otherwise make characters
  // without end, each kept in the save (the review of the worlds move, 2026-10-13).
  if (hash && !st.owners[hash] && Object.keys(st.owners).length >= MAX_OWNERS) return { full: true };
  if (full()) return { full: true }; // the world's players at once (above), before a character is made or a hash filed
  const spawn = S.info ? S.info.spawn : me ? [me.gx, me.gy] : [0, 0];
  const at = map.nearestWalkable(spawn[0] + 1, spawn[1] + 1, (x, y) => S.players.some((p) => Math.round(p.gx) === x && Math.round(p.gy) === y)) || spawn;
  const p = game.addPlayer(at[0], at[1], { look: identity.look, name: identity.name });
  if (hash) st.owners[hash] = p.id;
  return { player: p };
}

// A guest's identity as the host accepts it: a short name, a listed hair style, hex colours, nothing else.
export function clampIdentity(raw) {
  const styles = new Set(figure.hairStyles());
  const hex = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
  const L = (raw && raw.look) || {};
  const look = {};
  if (styles.has(L.hairStyle)) look.hairStyle = L.hairStyle;
  for (const k of ["skin", "hair", "eyes"]) if (hex(L[k])) look[k] = L[k];
  const name = typeof raw.name === "string" ? raw.name.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 24) : "";
  return { name: name || null, look: lookOf({ look }) };
}

// A guest's character after the grace (net.js hooks.dormant): out of the simulation, its record kept.
export function dormantNow(playerId) {
  const st = store();
  const hash = Object.keys(st.owners).find((h) => st.owners[h] === playerId) || null;
  const rec = game.takePlayer(playerId);
  if (rec && hash) st.dormant[hash] = game.toSafe(rec);
  cfg.save();
}

// Stepping away (item 3, `02` 2026-10-13): for any player, out of the world, kept by its owner's hash; false when
// refused (asleep or dead). `ownHash` files a character the store has no owner for yet (a test world's
// own host) under that hash.
export function awayNow(playerId, ownHash = null) {
  const p = S.players.find((q) => q.id === playerId);
  if (!p || p.dead || p.sleeping) return false;
  const st = store();
  let hash = Object.keys(st.owners).find((h) => st.owners[h] === playerId) || null;
  if (!hash && ownHash) {
    hash = ownHash;
    st.owners[hash] = p.id;
  }
  if (!hash) return false;
  if (p.action) p.action = null;
  p.auto = null; // a walk there under way (player.cancelAutoWalk)
  const name = p.name || p.id;
  dormantNow(playerId);
  log.push(`${name} stepped away.`);
  net.logAll(`${name} stepped away.`);
  return true;
}

// The character of that browser back where it stood. Null when there is none.
export function backNow(hash) {
  const st = store();
  if (!hash || !st.dormant[hash]) return null;
  const p = game.putPlayer(st.dormant[hash]);
  delete st.dormant[hash];
  if (!p) return null;
  cfg.arrived(p);
  const name = p.name || p.id;
  log.push(`${name} is back.`);
  net.logAll(`${name} is back.`);
  return p;
}

// What a welcome says about this world (the guest's bookmark).
export function worldInfo() {
  const me = self();
  const st = store();
  return { name: st.name || "a world", host: me ? me.name || me.id : null };
}

// The host's side of the wire's hooks (net.js): the joins, the saves on a join and a leave, dormancy, stepping
// away, and a guest's commands run here as its player through the same code the host's own panel, Use mode,
// placement, and station panel use. The client merges these with its own (restore, who, message, opened, ...).
export function netHooks() {
  return {
    joinFor,
    clampIdentity,
    guestJoined: () => { cfg.save(); },
    guestLeft: () => { cfg.save(); },
    dormant: dormantNow,
    away: awayNow,
    back: backNow,
    worldInfo,
    item: (p, cmd) => performItemCommand(p, cmd),
    use: (p, cmd) => performUseCommand(p, cmd, (id) => [...S.players, ...S.zombies, ...S.villagers, ...S.corpses].find((c) => c.id === id) || null),
    place: (p, cmd) => placement.performPlacement(p, cmd),
    craft: (p, cmd) => {
      const propId = typeof cmd.propId === "string" ? cmd.propId : null;
      const recipe = typeof cmd.recipe === "string" ? cmd.recipe : null;
      const count = Math.max(1, Math.min(10, Math.round(Number(cmd.count)) || 1));
      if (!propId || !recipe) return;
      const r = verbs.run("craft", world.world, p, { prop: propId }, { recipe, count }); // the world object (world.js), as the panel passes it
      if (!r.ok) showMessage(r.reason || "Cannot.");
    },
  };
}

// The world's events, answered for the players they are for: what a browser host did for its guests in main.js.
// Once per page or process.
let installed = false;
export function install() {
  if (installed) return;
  installed = true;
  // A landed blow kicks the camera of the client whose player struck (docs/31/05, item 13): a guest's on its screen.
  events.on("kicked", ({ player: p, x, y, seconds }) => {
    if (p !== self() && net.isHost()) net.kickTo(p.id, x, y, seconds);
  });
  // A bite's words go to the screen of the player bitten (the coder agent's review of steps 1 and 2): the host's own
  // say them in main.js; a guest's, and every player's on a server world, are told here.
  events.on("bitten", ({ player: p, opened, infected }) => {
    if (!p || p === self() || !net.isHost()) return;
    if (infected) net.messageTo(p.id, "The bite broke the skin.", 2);
    else if (opened && bleed.stacks(p) === 1) net.messageTo(p.id, "You are bleeding. A bandage will stop it.", 2);
  });
  // A blocked blow's sparks, on every guest's screen too (the review of steps 1 and 2): where the blow met the shield.
  events.on("blocked", ({ zombie, player: p }) => {
    if (!p || !zombie || !net.isHost()) return;
    const d = iso.normalize(zombie.gx - p.gx, zombie.gy - p.gy);
    net.fxAll("spark", p.gx + d.x * 0.45, p.gy + d.y * 0.45, 22); // 22 pixels up, as the host draws its own (main.js)
  });
  // A wall the dead strike gives one small jolt for each strike, and a fence that gives bursts into splinters, on every guest's screen too
  // (Michael, 2026-10-17, #147; 2026-10-18, #174): the world's events, drawn by the host's own client (main.js) and sent to each guest's (fx).
  events.on("wallStruck", ({ tx, ty, edge }) => {
    if (net.isHost()) net.fxAll("shake", tx, ty, edge === "w" ? 1 : 0);
  });
  events.on("fenceBurst", ({ x, y }) => {
    if (net.isHost()) net.fxAll("splinters", x, y, 12);
  });
  // A weapon worn out: the word goes to the screen of the player whose it was (item 4).
  events.on("weaponBroke", ({ item, who }) => {
    if (who && who !== (self() ? self().id : null) && net.isHost()) net.messageTo(who, `Your ${items.getItem(item).name.toLowerCase()} is spent.`, 3);
  });
  // A torch mounted on a bracket or a post burnt out: a line in the log of every guest whose player stands near (nobody's
  // item, so no weaponBroke).
  events.on("torchSpent", ({ x, y }) => {
    if (!net.isHost()) return;
    for (const id of net.guestPlayerIds()) {
      const p = S.players.find((q) => q.id === id);
      if (p && Math.hypot(x - p.gx, y - p.gy) <= tuning.world.torchSpentRadius) net.logTo(id, "A torch burns out.", "result");
    }
  });
  // An auto-drink (docs/02 question 22): the word to the screen of the player who drank, a guest's here.
  events.on("drank", ({ who, auto }) => {
    if (auto && who && who !== (self() ? self().id : null) && net.isHost()) net.messageTo(who, "You drink from your waterskin.", 2);
  });
  // A craft done: a line in the log of every guest whose player stands near (the stations step outside any acting player).
  events.on("craftDone", ({ out, tile }) => {
    if (!net.isHost()) return;
    const line = `Made ${out.prop ? out.prop.replace(/_/g, " ") : `${out.count > 1 ? `${out.count} ` : ""}${items.getItem(out.id).name.toLowerCase()}`}.`;
    for (const id of net.guestPlayerIds()) {
      const p = S.players.find((q) => q.id === id);
      if (p && Math.hypot(tile[0] - p.gx, tile[1] - p.gy) <= tuning.world.craftDoneRadius) net.logTo(id, line, "result");
    }
  });
  // A container opened by a guest's player (the acting player, game.js): told to the guest.
  events.on("containerOpened", ({ tiles: where, name, closeDist, prop, entry, tile, character, station }) => {
    const by = S.acting;
    if (by && by !== self() && net.isHost()) net.openedFor(by.id, { propId: prop ? prop.id : null, entryUid: entry ? entry.uid : null, tile: tile || null, characterId: character ? character.id : null, tiles: where, name, closeDist: closeDist || 0, station: !!station });
  });
  // A death: the world is saved with the survivor dead; the next survivor is a new character in it (docs/31/09;
  // docs/31/05, item 34). The authority saves for any player's death (a guest's too, which the browser host had not).
  events.on("gameOver", () => {
    if (!net.isGuest()) cfg.save();
  });
  // A message said while a guest's player acts goes to the guest's screen, not this one (docs/31/04); a log line
  // (the Use mode's result, use.js) the same way.
  setMessageSink((text, seconds) => {
    const by = S.acting;
    if (!by || by === self() || !net.isHost()) return false;
    return net.messageTo(by.id, text, seconds);
  });
  log.setSink((text, kind) => {
    const by = S.acting;
    if (!by || by === self() || !net.isHost()) return false;
    return net.logTo(by.id, text, kind);
  });
}
