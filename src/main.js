// Boot and the game state. A scrolling camera over a chunked map with real
// line of sight, buildings with doors and shuttered windows, forest scattered
// by rule, the player with a sack on their back, and the dead. Milestone 1
// (the probe) passed on 2026-10-09; lighting, the renderer, openings, the
// interface, and the character followed. See TODO.md and docs/00-vision.md.

import * as iso from "./iso.js";
import * as input from "./input.js";
import * as loop from "./loop.js";
import * as assets from "./assets.js";
import * as events from "./events.js";
import * as map from "./map.js";
import * as camera from "./camera.js";
import * as visibility from "./visibility.js";
import * as clock from "./clock.js";
import * as light from "./light.js";
import * as gl from "./gl.js";
import * as ground from "./ground.js";
import { renderScene, night, shakeFence } from "./render.js";
import { createPlayer, aimOrigin } from "./entities/player.js";
import * as host from "./host.js"; // the authority's half of the game, shared with the server world (item 5's first step)
import { lookOf } from "./host.js";
import { createZombie } from "./entities/zombie.js";
import { createVillager } from "./entities/villager.js";
import { initHud, updateHud } from "./ui/hud.js";
import { initPrompt, updatePrompt, showMessage, updateMessage } from "./ui/prompt.js";
import { initZombieBars, updateZombieBars } from "./ui/zombie-bars.js";
import { initSwingTimer, updateSwingTimer } from "./ui/swing-timer.js";
import { initSpeech, updateSpeech } from "./ui/speech.js";
import * as archery from "./archery.js";
import * as burning from "./fire.js";
import * as bleed from "./bleed.js";
import * as buttons from "./buttons.js";
import { refreshCorpse, createCharacter, wardrobeInto, say } from "./entities/character.js";
import * as menu from "./ui/context-menu.js";
import * as panel from "./ui/inventory-panel.js";
import * as kit from "./ui/kit.js";
import * as cursor from "./ui/cursor.js";
import * as log from "./ui/log.js";
import { initNames, updateNames } from "./ui/names.js";
import * as use from "./use.js";
import * as interactions from "./interactions.js";
import * as startingKit from "./kit.js"; // the starting kit (#136)
import * as world from "./world.js";
import * as game from "./game.js";
import * as save from "./save.js";
import * as net from "./net.js";
import * as stations from "./stations.js";
import * as stationPanel from "./ui/station-panel.js";
import * as interact from "./interact.js";
import * as items from "./items.js";
import * as inventory from "./inventory.js";
import * as view from "./view.js";
import * as settings from "./settings.js";
import * as screens from "./ui/screens.js";
import * as figure from "./figure.js";
import * as placement from "./placement.js";
import * as combat from "./combat.js";
import * as buildPalette from "./ui/build-palette.js";
import * as shell from "./boot.js";
import { createDevApi } from "./dev.js";
import { createInventoryActions, createRemoteInventoryActions } from "./ui/inventory-actions.js";
import * as identities from "./identities.js"; // identities, the browser id, friends' worlds (docs/31/09)
import * as rng from "./rng.js";
import * as rules from "./rules.js";
import * as tuning from "./tuning.js";

const V = view.view; // the world's size in its own pixels, kept current by view.js
// The map: the valley (docs/29, 30) unless the URL says `?map=square` (the old proving ground, which the checks still use).
const MAP_NAME = new URLSearchParams(window.location.search).get("map") || "valley";
const MAP_FILE = `data/maps/${/^[a-z0-9_-]+$/.test(MAP_NAME) ? MAP_NAME : "valley"}.json`;
const ZOOM_PACE = 0.3; // seconds between wheel steps that count
let lastZoomAt = 0;

const canvas = document.getElementById("game");
const ui = document.getElementById("ui");
const debugEl = document.getElementById("debug");
// The world is drawn in raw WebGL2 (docs/08). There is no other renderer: if
// WebGL2 is missing the debug corner says so and nothing is drawn.
let glError = null;
try {
  gl.init(canvas);
} catch (err) {
  glError = err.message;
}

// The world's state (the player, the dead, the villagers, the map's info) is
// game.js's; this file is the client: the view, the keys, the panels (docs/31/05, item 17).
const S = game.state;
let uiSimTime = 0; // the sim time the interface was last ticked to (docs/23a, F)
let started = false; // in a world of this browser's: the autosave runs (save.js); never for a guest
let urlLag = null; // `?lag=` for a join opened later from the Join screen
// The world chosen (docs/31/09): nothing runs until one is. `currentWorld` is this browser's own
// (its id, its name, its code once it has one, when it was made, and `owners`: a browser id to the
// player it made there); null for a guest, whose world is the host's, and for a test world.
let inWorld = false;
let currentWorld = null;
let reopenTries = 0; // a world left open is opened again when played; a refresh can leave its old room on the relay a moment
// In a world or not: the step and the frame run only in one, and the interface (the bars, the log, the
// belt) shows only in one; the title sits over black otherwise (docs/31/09).
function setInWorld(v) {
  inWorld = !!v;
  const el = typeof document !== "undefined" ? document.getElementById("ui") : null;
  if (el) el.classList.toggle("no-world", !inWorld);
}
const URLQ = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
const TEST_WORLD = URLQ.has("nosave"); // the checks want a fresh world at boot, as the game always had (CLAUDE.md)
let editing = null; // the identity being edited on the identity screen: { id?, name, look }
let lastAutosave = 0; // sim seconds at the last autosave
let lastAutosaveAt = 0; // the wall clock's at the last (this client's, never the world's)
const AUTOSAVE = 60; // seconds of game time between autosaves (the parent's cadence), and at least as many real ones:
// while everyone sleeps the world runs sixty times over and game time alone saved once a real second (the wiki census's bugs, 2026-10-15)
let mapJson = null; // the map file, kept for a restore
let looksJson = null; // the character screen's palettes (data/looks.json)

// The identity a test world's player wears: `&as=<name>` on the URL, else the last kept, else what the
// browser had before identities.
function testIdentity() {
  const asName = URLQ.get("as");
  if (asName) return { name: asName.slice(0, 24), look: { hairStyle: "short" } };
  return identities.last() || { name: settings.get("playerName") || null, look: { ...(settings.get("look") || {}), hairStyle: settings.get("hairStyle") || "short" } };
}

// Whose character is whose in the world here (docs/31/09): the save's wrapper for a world of this
// browser's, a page's own for a test world. `owners`: a browser id's hash to the player it made;
// `dormant`: the hash to the record of a character gone dormant with its player away.
const testStore = { owners: {}, dormant: {} };
function ownersStore() {
  return currentWorld || testStore;
}
const myHash = () => identities.idHash(identities.clientId());

// Stepping away (item 3, `02` 2026-10-13): in a world with friends in it, a player with no input for five minutes of
// real time leaves the world, safe, through the dormant path (its record kept under its browser's hash, so a save
// and a reload keep it), and comes back where it stood on its next key, click, or mouse movement. Never a sleeper
// (Michael: waiting in bed for friends is deliberate), never the dead, never in a solo world.
const AWAY_AFTER_MS = 5 * 60 * 1000;
let awayAfterMs = AWAY_AFTER_MS; // a check shortens it (__game.away.after)
let lastInputAt = performance.now();
let away = false; // this client's own player is stepped away

const sharedWorld = () => (net.isHost() && net.hasGuests()) || (net.isGuest() && net.status().joined);

// This client's own: the idle clock, read every step. Any input resets it; asleep, dead, or alone it does not run.
function checkAway() {
  const me = S.player;
  if (away || !inWorld) return;
  if (!sharedWorld() || !me || me.dead || me.sleeping) {
    lastInputAt = performance.now();
    return;
  }
  if (performance.now() - lastInputAt >= awayAfterMs) stepAway();
}

function stepAway() {
  if (away) return false;
  const me = S.player;
  if (net.isGuest()) {
    if (!net.stepAway()) return false;
  } else if (!host.awayNow(me.id, myHash())) return false;
  away = true;
  closeModes();
  screens.show("away");
  applyPause();
  return true;
}

function comeBack() {
  if (!away) return false;
  away = false;
  lastInputAt = performance.now();
  if (net.isGuest()) net.comeBack();
  else {
    const p = host.backNow(myHash());
    if (p) game.pickPlayer(p);
  }
  if (screens.currentScreen() === "away") screens.hide();
  applyPause();
  return true;
}

// The host refused a guest's step away (net.js `stay`): in again, nothing lost.
function stayed() {
  away = false;
  lastInputAt = performance.now();
  if (screens.currentScreen() === "away") screens.hide();
}

// The panels and the modes that act through my player, shut (a step away; the character is not in the world).
function closeModes() {
  panel.closeAll();
  stationPanel.close();
  placement.cancel();
  use.cancel();
  buildPalette.close();
  menu.closeContextMenu();
  openBag = null;
  corpseWatch = null;
}

// Any input of this client's: the idle clock starts over, and a step away ends. While away, a key or a click is
// spent on coming back and goes no further (the coder agent: input blocked but for "back").
function anyInput(e) {
  lastInputAt = performance.now();
  if (!away) return;
  if (e.type === "keydown" || e.type === "pointerdown" || e.type === "mousedown") {
    e.stopPropagation();
    e.preventDefault();
  }
  comeBack();
}
for (const type of ["keydown", "pointerdown", "mousedown", "pointermove", "wheel"]) window.addEventListener(type, anyInput, { capture: true, passive: false });

// After a world is set (made or restored): the player's sheet, the camera, the first sight.
function afterWorldSet() {
  figureKey = "";
  figureQuick = "";
  refreshFigure(true);
  camera.snapTo(S.player.gx, S.player.gy);
  camera.applyOrigin(V.w, V.h);
  tiles = camera.viewportTiles(V.w, V.h);
  visKey = null;
  openBag = null;
  corpseWatch = null;
  panel.closeAll();
  stationPanel.close();
  placement.cancel();
  use.cancel();
  buildPalette.close();
  light.update();
  if (!glError) ground.invalidateAll();
  for (const [cx, cy] of ground.prebakeTargets(tiles)) light.chunkLight(cx, cy);
  visible = visibility.computeVisible(Math.round(S.player.gx), Math.round(S.player.gy), tiles);
  lastAutosave = loop.simTime();
}

// ---- the loading screen into and out of a world (docs/38, #107; boot.js's screen) ----
// Entering a world marks every ground chunk dirty, and the step would re-bake the whole view in one frame (about a
// second, measured 2026-10-16). Behind the screen the view and its ring are baked two a frame instead, as boot does,
// a lone world held still meanwhile, and the screen closes on frames that keep to the budget. `from` is where the bar
// stands when the bake begins, so it never runs backwards (the review of #115).
async function settleWorld(from = 0) {
  const solo = !net.onTheWire();
  if (solo) loop.setPaused(true);
  try {
    if (!glError) {
      tiles = camera.viewportTiles(V.w, V.h);
      const targets = ground.prebakeTargets(tiles).filter(([cx, cy]) => ground.needsBake(cx, cy));
      for (let i = 0; i < targets.length; i++) {
        ground.bakeNow(targets[i][0], targets[i][1]);
        shell.worldStage("The ground round you", from + (1 - from) * (i + 1) / targets.length);
        if (i % 2 === 1) await shell.nextFrame();
      }
    }
    shell.worldStage("Waking the valley", 1);
    // The first frames drawn behind the screen (the figures' sheets, the light): two in a row under 34 ms, or thirty tried.
    // A tab that is shown but given no frames (a background tab of the pane) waits on nextFrame's 40 ms timer, so it
    // never counts a calm frame and runs all thirty, about a second and a quarter: bounded.
    let calm = 0;
    for (let n = 0; n < 30 && calm < 2 && !document.hidden; n++) {
      const t = performance.now();
      await shell.nextFrame();
      calm = performance.now() - t < 34 ? calm + 1 : 0;
    }
  } finally {
    if (solo) setPaused(!!screens.currentScreen());
  }
}

// A guest's join under the screen, with Cancel: the stand-in world stays underneath until the welcome (docs/31/09),
// so main.js is not restructured; the screen covers it (#107).
// A fresh join waits for its welcome in the stand-in world: the screens treat it as out of a world, so the host's
// "who" (choose an identity) is a page of the site and never a box over a valley that is not the friend's (#111).
// A respawn's rejoin is not one: that player is still in the world.
let awaitingWelcome = false;

function showJoining(code) {
  shell.worldBegin(`Joining ${code}`, { cancel: cancelJoin });
  shell.worldStage("Asking the host", 0.2);
}

function cancelJoin() {
  if (net.isGuest()) net.leave();
  if (net.onTheWire()) net.close();
  shell.worldHide();
  toSite("worlds");
}

// The Sandbox step's choices (docs/38, #109, #130): the world's rules (five switches, Trees, and the Starting
// population) and whether the dev chest is made with it. The settings keep only the last choices, offered first at the
// next step; a world's rules are its own from then on.
const RULE_KEYS = Object.keys(rules.DEFAULTS);
function sandboxChoices() {
  return { rules: Object.fromEntries(RULE_KEYS.map((k) => [k, rules.coerce(k, settings.get(k))])), devChest: !!settings.get("devChest") };
}

// The host changes the world's rules from the pause menu (#109): between two steps, on the authority. They ride in the
// next frame to every guest (net.js sends `rules` when they change) and in the save, and a guest's own client never
// sets them (a server world's owner has the owner screen). Returns whether it was done.
function setWorldRules(next) {
  if (!inWorld || net.isGuest()) return false;
  // Trees and the Starting population are chosen when the world is made and shape what is placed: never changed after.
  rules.set(Object.fromEntries(Object.entries(next).filter(([k]) => !rules.FIXED.includes(k))));
  if (currentWorld) saveWorld();
  return true;
}

// A new world of this browser's, with a character made from an identity (docs/31/09). Kept, it is made behind the
// loading screen; a guest's stand-in (keep false) is made at once, under the joining screen. `rules` and `devChest`
// are what its Sandbox step chose; a stand-in takes the defaults and the host's world replaces it at the welcome.
async function enterNewWorld(name, identity, { keep = true, rules: chosenRules = null, devChest = null } = {}) {
  const sandbox = sandboxChoices();
  if (keep) {
    const rulesNow = { ...sandbox.rules, ...(chosenRules || {}) };
    chosenRules = rulesNow;
    if (devChest === null) devChest = sandbox.devChest;
    for (const k of RULE_KEYS) settings.set(k, rules.coerce(k, rulesNow[k])); // remembered, as the next Sandbox step's first choices
    settings.set("devChest", !!devChest);
  }
  if (keep) {
    shell.worldBegin(`Making ${name || "a world"}`);
    shell.worldStage("Waking the valley", 0);
    await shell.nextFrame();
  }
  try {
    game.create({
      json: mapJson,
      look: lookOf(identity),
      name: (identity && identity.name) || null,
      devChest: keep ? !!devChest : false,
      rules: keep ? chosenRules : null,
    });
    afterWorldSet();
    setInWorld(true);
    currentWorld = keep ? { worldId: save.newWorldId(), name: name || "A world", code: null, created: Date.now(), open: false, owners: { [myHash()]: S.player.id }, dormant: {} } : null;
    started = keep;
    screens.hide();
    if (!keep) return false;
    const saved = saveWorld().catch(() => false); // never rejects today; caught so a change there cannot go unhandled
    await settleWorld(0.1);
    return await saved;
  } finally {
    if (keep) await shell.worldEnd();
  }
}

// A world of this browser's, put back, as the character this browser made there.
async function playWorld(worldId) {
  const row = save.listWorlds().find((r) => r.worldId === worldId);
  shell.worldBegin(`Reading ${(row && row.name) || "the world"}`); // the loading screen (#107)
  try {
    return await playWorldBehindScreen(worldId);
  } finally {
    await shell.worldEnd();
  }
}

async function playWorldBehindScreen(worldId) {
  shell.worldStage("Reading the world", 0);
  const snap = await save.readWorld(worldId);
  if (!snap || snap.mapName !== MAP_NAME) return false;
  if (snap.home === "server" || snap.arriving) return false; // its one home is the server, or it is on its way here (item 5)
  shell.worldStage("Putting the world back", 0.2);
  await shell.nextFrame();
  await restoreWorld(snap);
  currentWorld = { worldId, name: snap.name || "A world", code: snap.code || null, created: snap.created || snap.savedAt, open: !!snap.open, owners: { ...(snap.owners || {}) }, dormant: { ...(snap.dormant || {}) } };
  reopenTries = 0;
  const mineId = currentWorld.owners[myHash()] || snap.myPlayerId;
  let mine = S.players.find((p) => p.id === mineId) || null;
  if (!mine && currentWorld.dormant[myHash()]) {
    mine = game.putPlayer(currentWorld.dormant[myHash()]);
    delete currentWorld.dormant[myHash()];
    if (mine) refreshFigureOf(mine, true);
  }
  // Mine fallen: its body (a corpse since 2026-10-14) is this screen's player for the dead screen, never someone else's.
  const myBody = !mine ? S.corpses.find((c) => c.id === mineId && c.kind === "player") || null : null;
  if (myBody) {
    S.player = myBody;
    camera.snapTo(myBody.gx, myBody.gy);
  }
  mine = mine || (myBody ? null : S.players[0]);
  if (mine) {
    game.pickPlayer(mine);
    camera.snapTo(mine.gx, mine.gy);
  }
  setInWorld(true);
  started = true;
  if (!S.player || S.player.dead) screens.show("dead", { when: clock.getLabel(), who: S.player ? S.player.name || S.player.id : "Your survivor" }); // none of mine in it: a new character, as after a death
  else {
    screens.hide();
    showMessage(`${clock.getLabel()}. Welcome back.`, 3);
  }
  camera.applyOrigin(V.w, V.h);
  await settleWorld(0.3); // before the wire opens, so a lone world is held still while its ground bakes
  // A world left open to friends is open again when it is played (Michael, 2026-10-13: it had to be switched on every time).
  if (currentWorld.open) setOpen(true);
  return true;
}

// A new character in this world, from an identity: the body of the last one stays where it fell.
function respawn(identity) {
  if (!identity) return false;
  // A guest's next survivor is the host's to make (2026-10-14): the join again, with the identity chosen; the host
  // finds this browser's character fallen (a body now) and makes a new one where its world spawns them.
  if (net.isGuest()) {
    const code = net.status().code;
    if (!code) return false;
    net.leave();
    net.close();
    deadShown = false;
    standInWorld(identity);
    net.setIdentity(identity);
    if (!net.open({ join: code, lag: urlLag })) return false;
    started = false;
    screens.hide();
    showJoining(code); // the loading screen until the welcome (#107)
    return true;
  }
  if (!inWorld) return false;
  const spawn = S.info ? S.info.spawn : [S.player.gx, S.player.gy];
  const at = map.nearestWalkable(spawn[0] + 1, spawn[1] + 1, (x, y) => S.players.some((p) => Math.round(p.gx) === x && Math.round(p.gy) === y)) || spawn;
  const p = game.addPlayer(at[0], at[1], { look: lookOf(identity), name: identity.name || null });
  game.pickPlayer(p);
  refreshFigureOf(p, true);
  camera.snapTo(p.gx, p.gy);
  ownersStore().owners[myHash()] = p.id;
  screens.hide();
  return saveWorld();
}

let deadShown = false; // a guest's dead screen, raised once a death

// The world's save, with its own fields (save.js writeWorld); never for a guest or a test world.
// A save that fails says so on screen (Michael, 2026-10-13: never silently).
let savesMade = 0; // every tenth save proves the save's cache first (game.verifySaveCache, 2026-10-15)
async function saveWorld(extra = {}) {
  if (!inWorld || !currentWorld || net.isGuest()) return false;
  if (++savesMade % 10 === 0) {
    const wrong = game.verifySaveCache();
    if (wrong.length) console.warn(`The save's cache missed ${wrong.length} chunk(s), saved right now (a change marked nothing; see map.unsaved):`, wrong);
  }
  const r = await save.writeWorld(save.snapshot(MAP_NAME, { worldId: currentWorld.worldId, name: currentWorld.name, code: currentWorld.code, created: currentWorld.created, open: !!currentWorld.open, owners: currentWorld.owners, dormant: currentWorld.dormant || {}, myPlayerId: S.player.id, ...extra }));
  if (r.ok) {
    lastAutosave = loop.simTime();
    lastAutosaveAt = performance.now();
  }
  else showMessage(`The world could not be saved: ${r.error}.`, 6);
  return r.ok;
}

// ---- THE CROSSING (docs/38, #112) ----
// The line between the game's site and a world is crossed in a few named places, so a game client can later be cut
// along it (the Chromium wrap for Steam, `35`). In: `playWorld`, `enterNewWorld`, and a guest's join (`joinWorld`, its
// welcome in `net.init`'s `restore`), each behind the loading screen; `screens.hide()` takes the site away and brings
// the stage. Out: `toSite` below, the one place the world side is shut and the site shown, called by `exitGame` (which
// saves first), by a cancelled join, and by a dropped guest's hook. Nothing else shows or hides either side.

// Back to the site: the world side shut (not in a world, nothing open on the panels, the bag, a station, a placement,
// the Use mode, or the build palette), then the page shown. The caller has closed the wire and ended or hidden any
// loading screen of its own.
function toSite(page, data = {}) {
  awaitingWelcome = false;
  setInWorld(false);
  started = false;
  currentWorld = null;
  panel.closeAll();
  stationPanel.close();
  placement.cancel();
  use.cancel();
  buildPalette.close();
  screens.show(page, data);
}

// Exit game: the guests' characters dormant at once, saved if it is this browser's, the wire closed, the site back.
// Behind the loading screen, which stays until the save is written (#107).
async function exitGame() {
  const mine = inWorld && currentWorld && !net.isGuest();
  const name = (currentWorld && currentWorld.name) || (joinedWorld && joinedWorld.name) || "the world";
  shell.worldBegin(mine ? `Saving ${name}` : `Leaving ${name}`);
  shell.worldStage(mine ? "Saving the world" : "Leaving the world", 0.5);
  try {
    if (inWorld && net.isHost()) for (const id of net.guestPlayerIds()) host.dormantNow(id);
    if (inWorld) await saveWorld();
    if (net.isGuest()) net.leave(); // the host begins the grace at once, not at the socket's drop
    if (net.onTheWire()) net.close();
    toSite("worlds"); // the Worlds page, as docs/31/09 says (the title was shown until 2026-10-15; Back goes there)
  } finally {
    await shell.worldEnd();
  }
}

// ---- a world moved to the server, and brought home (item 5's fifth step, 2026-10-14) ----
// A world has one home at a time: moved up, the copy here is marked and not playable (its row joins the server world);
// brought home, the server lets go only once this browser says it has the world (two phases), so a broken connection
// never loses it or forks it.

async function gzipText(text) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipBase64(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

async function postJson(url, headers, body) {
  let res;
  try {
    res = await fetch(url, { method: "POST", headers, body });
  } catch {
    return { status: 0, json: { error: "The server could not be reached." } };
  }
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function moveUp(worldId) {
  const base = net.relayHttp();
  if (!base) return { ok: false, error: "There is no server on this page (the loopback)." };
  const key = identities.creatorKey();
  if (!key) return { ok: false, need: "creatorKey" };
  if (inWorld && currentWorld && currentWorld.worldId === worldId) return { ok: false, error: "Leave the world before you move it." };
  const snap = await save.readWorld(worldId);
  if (!snap) return { ok: false, error: "That world would not read." };
  if (snap.home === "server") return { ok: false, error: "It is on the server already." };
  const ownerPlayerId = snap.myPlayerId || (snap.owners || {})[myHash()] || null;
  const body = await gzipText(JSON.stringify({ snap, ownerPlayerId }));
  const r = await postJson(`${base}/worlds`, { "content-type": "application/gzip", "x-creator-key": key }, body);
  if (r.status !== 201) {
    const wrongKey = r.status === 403 && /creator/.test(r.json.error || "");
    if (wrongKey) identities.setCreatorKey("");
    return { ok: false, need: wrongKey ? "creatorKey" : null, error: r.json.error ? `The server said: ${r.json.error}.` : `The server said ${r.status}.` };
  }
  identities.rememberOwned({ code: r.json.code, serverWorldId: r.json.worldId, name: snap.name, ownerKey: r.json.ownerKey, localWorldId: worldId });
  await save.writeWorld({ ...snap, home: "server", serverCode: r.json.code, open: false });
  return { ok: true, code: r.json.code, ownerKey: r.json.ownerKey, name: snap.name || "A world" };
}

// The world's second phase home: the server told this browser has it, the server's copy let go, the row here playable.
// A confirm the server turns away (its wait ran out, so the world was the server's again and may have been played since;
// the coder agent's review of step 5) is a fresh start: the copy here goes back to being a marker and the world is asked
// for again, once. A confirm that does not reach the server is tried again by Finish.
async function confirmHome(worldId, owned, snap, again = true) {
  const base = net.relayHttp();
  const r = await postJson(`${base}/worlds/home/confirm`, { "content-type": "application/json", "x-owner-key": owned.ownerKey }, JSON.stringify({ code: owned.code, token: snap.arriving.token }));
  if (r.status === 409) {
    const marker = { ...snap, home: "server", serverCode: owned.code };
    delete marker.arriving;
    await save.writeWorld(marker);
    return again ? bringHome(worldId, false) : { ok: false, error: "The server would not let the world go. Try Bring it home again." };
  }
  if (r.status !== 200) return { ok: false, error: `Nearly home: the server has not let go yet (${r.json.error || r.status}). Try Finish again.` };
  const done = { ...snap };
  delete done.arriving;
  await save.writeWorld(done);
  identities.forgetOwned(owned.code);
  return { ok: true, name: done.name || "A world" };
}

async function bringHome(worldId, again = true) {
  const base = net.relayHttp();
  const owned = identities.ownedFor(worldId);
  if (!base || !owned) return { ok: false, error: "This browser holds no owner key for that world." };
  if (net.isGuest() && net.status().code === owned.code) return { ok: false, error: "Leave the world before you bring it home." };
  const local = await save.readWorld(worldId);
  if (local && local.arriving && local.arriving.token) return confirmHome(worldId, owned, local); // the second phase, again
  const r = await postJson(`${base}/worlds/home`, { "content-type": "application/json", "x-owner-key": owned.ownerKey }, JSON.stringify({ code: owned.code }));
  if (r.status !== 200 || !r.json.save) return { ok: false, error: r.json.error ? `The server said: ${r.json.error}.` : `The server said ${r.status}.` };
  const srv = save.upgrade(await gunzipBase64(r.json.save));
  if (!srv) return { ok: false, error: "The world came back in a shape this page does not know." };
  // The owner's character, filed under the owner key's hash on the server, back under this browser's id.
  const owners = { ...(srv.owners || {}) };
  const dormant = { ...(srv.dormant || {}) };
  const mine = owners[r.json.ownerHash] || null;
  if (mine) {
    owners[myHash()] = mine;
    delete owners[r.json.ownerHash];
  }
  if (dormant[r.json.ownerHash]) {
    dormant[myHash()] = dormant[r.json.ownerHash];
    delete dormant[r.json.ownerHash];
  }
  const snap = { ...srv, worldId, name: (local && local.name) || srv.name || "A world", code: null, open: false, owners, dormant, myPlayerId: mine, arriving: { code: owned.code, token: r.json.token } };
  delete snap.home;
  delete snap.serverCode;
  delete snap.server;
  const w = await save.writeWorld(snap);
  if (!w.ok) return { ok: false, error: `The world could not be kept here (${w.error}); the server still has it.` };
  return confirmHome(worldId, owned, snap, again);
}

// ---- the owner's powers over a server world (item 5's sixth step) ----
// The owner key opens them, from this browser or any other that holds it; the server checks it each time.

function ownedByCode(code) {
  return identities.owned().find((o) => o.code === code) || null;
}

async function ownerCall(path, owned, body = {}) {
  const base = net.relayHttp();
  if (!base || !owned) return { status: 0, json: { error: "There is no server on this page, or no owner key for that world." } };
  return postJson(`${base}${path}`, { "content-type": "application/json", "x-owner-key": owned.ownerKey }, JSON.stringify({ code: owned.code, ...body }));
}

// The world, its players, the barred, and its rules, as the server has them.
async function ownerInfo(code) {
  const r = await ownerCall("/worlds/owner", ownedByCode(code));
  return r.status === 200 ? { ok: true, ...r.json, code } : { ok: false, error: r.json.error || `The server said ${r.status}.` };
}

// A new join code: this browser's record of it and the marker of a moved world follow.
async function rotateCode(code) {
  const owned = ownedByCode(code);
  const r = await ownerCall("/worlds/rotate", owned);
  if (r.status !== 200) return { ok: false, error: r.json.error || `The server said ${r.status}.` };
  identities.forgetOwned(code);
  identities.rememberOwned({ ...owned, code: r.json.code });
  if (owned.localWorldId) {
    const local = await save.readWorld(owned.localWorldId);
    if (local && local.home === "server") await save.writeWorld({ ...local, serverCode: r.json.code });
  }
  if (net.isGuest() && net.status().code === code) net.renameGuestCode(r.json.code);
  return { ok: true, code: r.json.code };
}

async function setRules(code, rulesNow) {
  const r = await ownerCall("/worlds/rules", ownedByCode(code), { rules: rulesNow });
  return r.status === 200 ? { ok: true, rules: r.json.rules } : { ok: false, error: r.json.error || `The server said ${r.status}.` };
}

async function removePlayer(code, playerId) {
  const r = await ownerCall("/worlds/remove", ownedByCode(code), { playerId });
  return r.status === 200 ? { ok: true, name: r.json.name } : { ok: false, error: r.json.error || `The server said ${r.status}.` };
}

async function unbar(code, hash) {
  const r = await ownerCall("/worlds/unbar", ownedByCode(code), { hash });
  return r.status === 200 ? { ok: true } : { ok: false, error: r.json.error || `The server said ${r.status}.` };
}

// A world of mine on the server, on another device: its code and owner key, checked with the server before they are kept.
async function addOwned(code, ownerKey) {
  const c = String(code || "").trim().toLowerCase();
  const key = String(ownerKey || "").trim();
  if (!c || !key) return { ok: false, error: "Both the code and the owner key." };
  const r = await ownerCall("/worlds/owner", { code: c, ownerKey: key });
  if (r.status !== 200) return { ok: false, error: r.status === 403 ? "That is not the owner key for that world." : r.json.error || `The server said ${r.status}.` };
  identities.rememberOwned({ code: c, name: r.json.name, ownerKey: key, localWorldId: null });
  return { ok: true, name: r.json.name };
}

// A lost owner key: the creator key has the server issue a new one (and the old one stops working).
async function rekey(code, creatorKey) {
  const base = net.relayHttp();
  const c = String(code || "").trim().toLowerCase();
  if (!base) return { ok: false, error: "There is no server on this page." };
  const r = await postJson(`${base}/worlds/rekey`, { "content-type": "application/json", "x-creator-key": String(creatorKey || "").trim() }, JSON.stringify({ code: c }));
  if (r.status !== 200) return { ok: false, error: r.json.error || `The server said ${r.status}.` };
  const was = ownedByCode(c);
  identities.rememberOwned({ ...(was || {}), code: c, name: r.json.name, ownerKey: r.json.ownerKey, localWorldId: was ? was.localWorldId : null });
  return { ok: true, code: c, ownerKey: r.json.ownerKey, name: r.json.name };
}

// The server worlds this browser owns with no copy here (added on this device, or moved up from another).
function ownedElsewhere() {
  const here = new Set(save.listWorlds().map((w) => w.worldId));
  return identities.owned().filter((o) => !o.localWorldId || !here.has(o.localWorldId));
}

// A join of a friend's world, or of a world of mine on the server (with its owner key, so my character comes back).
function joinWorld(code, ownerKey = null) {
  if (!code) return;
  net.setIdentity(null);
  net.setOwnerKey(ownerKey);
  if (!ownerKey) identities.rememberJoined({ code });
  standInWorld(identities.last() || testIdentity());
  if (!net.open({ join: code, lag: urlLag })) return;
  awaitingWelcome = true;
  started = false; // a guest's world is the host's to save
  screens.hide();
  showJoining(code); // the loading screen over the stand-in until the welcome (#107)
}

function playServer(worldId) {
  const owned = identities.ownedFor(worldId);
  if (owned) joinWorld(owned.code, owned.ownerKey);
}

// A stand-in world for a guest while the host's is on its way: never saved, replaced by the welcome.
function standInWorld(identity) {
  if (inWorld) return;
  enterNewWorld("", identity, { keep: false });
}

// Hosting as a switch (docs/31/09): on, this world on the relay under its code, kept with it; off, closed.
function setOpen(on) {
  if (!inWorld || net.isGuest()) return;
  if (on) {
    if (net.isHost()) return;
    const code = (currentWorld && currentWorld.code) || net.makeCode();
    if (!net.open({ host: code, lag: urlLag })) return;
    if (currentWorld) {
      currentWorld.code = code;
      currentWorld.open = true; // remembered: the world is open again the next time it is played (saveWorld)
    }
    saveWorld();
    showMessage(`Open to friends: the code is ${code}.`, 5);
  } else if (net.isHost()) {
    // The guests' characters go dormant first, as on Exit game: closed, they are out of the world and kept for their
    // owners, never left standing and saved as players (the wiki census's bugs, 2026-10-15).
    for (const id of net.guestPlayerIds()) host.dormantNow(id);
    net.close();
    if (currentWorld) currentWorld.open = false;
    saveWorld();
    showMessage("Closed to friends.", 3);
  }
}

// Where this client is, for the pause menu and the host screen.
let joinedWorld = null; // a guest's: { name, host } from the welcome
function here() {
  const st = net.status();
  const guest = st.role === "guest";
  return {
    inWorld,
    joining: awaitingWelcome, // in the stand-in, waiting for the host's world (#111)
    name: currentWorld ? currentWorld.name : guest ? (joinedWorld && joinedWorld.name) || st.code : "",
    myCharacter: inWorld && S.player ? S.player.name || S.player.id : "",
    role: st.role,
    code: currentWorld ? currentWorld.code : st.code,
    worldId: currentWorld ? currentWorld.worldId : null,
    ownedCode: st.role === "guest" && identities.owned().some((o) => o.code === st.code) ? st.code : null, // a server world of mine I am in
    guests: st.guests ? st.guests.length : 0,
    hostName: guest && joinedWorld ? joinedWorld.host || null : null, // a server world has no host player: its name alone
    rules: { ...rules.rules }, // the world's rules; a guest's are the host's, shown read-only (item 4)
    canSetRules: inWorld && !guest, // the host's, and a solo player's (a server world's owner has the owner screen)
  };
}
let tiles = [];
let visible = new Set();
let playerRoom = 0;
let drawAll = false; // debug: V shows everything, fog off
let drawn = 0;
let visKey = null; // player tile and camera tile the visible set was computed for
let openBag = null; // { bag, tiles, name, corpse?, closeDist? }: the container open beside yours
let corpseWatch = null; // the body whose grid is open: redrawn as things leave it, once more when it closes
let handlers = null; // the inventory panel's handlers, on window.__game for tests
let remoteHandlers = null; // the same panel's commands as a guest sends them (ui/inventory-actions.js)
let armedGuest = false; // the guest's senders (Use, placement, Make) are set while this client is a guest
const timing = { step: 0, stepMax: 0, vis: 0, maxResetAt: 0 };

// Right-click builds a menu of what is under the cursor; Walk here is in it
// (docs/10). Left click is kept free for selecting and placing things later
// (Michael, 2026-10-10).
let drawCancelled = false; // a right tap during a draw, for this step's snapshot
function handleMouse() {
  // A right tap is the actions menu, opened where it was pressed; the end of a
  // draw spends it instead. The right button held is the off hand's stance (docs/21).
  const tap = buttons.off.tap;
  if (tap) {
    if (archery.drawState(S.player)) {
      // The draw ends in the world's step, as an event in my snapshot (`drawCancel`), here or on the host: a guest's
      // tap once ended only its own copy, and the host loosed the arrow on the left button's release (the wiki
      // census's bugs, 2026-10-15).
      drawCancelled = true;
      buttons.spendTap();
    } else if (use.cancel()) {
      // A right click in Use mode puts the thing down (use.js).
    } else {
      openActionsMenu(tap);
    }
  }
  menu.tookClick();
  if (menu.isMenuOpen() && S.player.moving) menu.closeContextMenu();
}

function openActionsMenu(m) {
  // A mushroom or a rock wiggles; the menu still opens if it has actions
  // other than walking there (none yet; question 27).
  const poked = interact.pokeAt(m.x, m.y, S.player);
  let actions = interact.actionsAt(m.x, m.y, S.player);
  if (poked) {
    // The thing clicked offers its own actions (a tree: Chop down), once each.
    actions = actions.filter((a) => a.kind !== "walk" && !/^Walk/.test(a.label || ""));
    for (const a of interact.actionsForProp(poked, S.player)) if (!actions.some((b) => b.label === a.label)) actions.push(a);
  }
  // A guest's choice goes to the host by its address and label (net.js, docs/31/05 item 10); the host walks
  // the guest's player there and performs it. Building stays this client's own until it is a command too.
  const guest = net.isGuest();
  const entries = actions.map((a) => ({ label: a.label, enabled: a.enabled, onSelect: () => (guest ? net.sendAct(a.target, a.label) : interact.runAction(S.player, a)) }));
  // Build is in every menu, in case the key is forgotten (Michael, 2026-10-12).
  entries.push({ label: "Build", enabled: !S.player.carrying && !panel.isOpen(), onSelect: toggleBuild });
  const u = view.toUi(m.x, m.y);
  menu.openContextMenu(u.x, u.y, entries);
}

// What is under the cursor for Use mode (use.js): a character, else a prop by its pixels, else the tile.
function useTargetAt(sx, sy) {
  const ch = interact.characterAt(sx, sy, S.player);
  if (ch) return { kind: "character", ch };
  const prop = interact.interactableAt(sx, sy, () => true);
  if (prop) return { kind: "prop", prop };
  const bracket = interact.bracketAt(sx, sy); // a torch mounted on a wall (#170)
  if (bracket) return { kind: "bracket", bracket };
  const g = iso.toGrid(sx, sy);
  const t = map.peekTile(Math.round(g.gx), Math.round(g.gy));
  return { kind: "tile", x: Math.round(g.gx), y: Math.round(g.gy), floor: t ? t.floor : null };
}

// Escape closes the top thing that can close: the menu (which closes itself
// and says so), then a screen steps back, then the bag or the character
// screen; with nothing open it opens the pause menu (Michael, 2026-10-10, as
// Zomboid does). Handled on the key event, not in the step, because the step
// does not run while paused.
// A screen pauses the world only in a game played alone. On the wire, as a host or a guest,
// the world never pauses (Michael, 2026-10-13, Zomboid's way): the menu is this client's own,
// over a running world, and its player stands still while it is up (the idle snapshot below).
function setPaused(v) {
  loop.setPaused(v && !net.onTheWire());
  if (!v) input.endStep(); // keys pressed while paused do not fire on resume
}
// And the world is held while its host has stepped away with no guest in it (the coder agent's review of item 3):
// nobody is in the world, so it stops as a solo world does; a friend's join is still heard (loop.js answers the wire
// while held) and starts it again, and the host's own input brings the host back.
const worldHeld = () => away && inWorld && net.isHost() && !net.hasGuests();
function applyPause() {
  loop.setHeld(worldHeld());
}

function handleEscape() {
  if (!inWorld) { screens.back(); return; } // no world: the title and its screens only
  if (menu.tookEscape()) return;
  if (use.cancel()) return; // Use mode is the top thing that can close
  if (stationPanel.close()) return;
  if (screens.back()) return;
  if (buildPalette.isOpen()) {
    buildPalette.close();
    return;
  }
  if (placement.cancel()) return;
  if (panel.isOpen()) {
    panel.closeAll();
    openBag = null;
    return;
  }
  screens.show("pause");
}

// N: the build palette, or out of build mode if in it. Not while carrying or
// with the bag open (docs/13).
function toggleBuild() {
  if (placement.cancel()) return;
  if (buildPalette.isOpen()) {
    buildPalette.close();
    return;
  }
  if (S.player.carrying) return showMessage("Your hands are full.");
  if (panel.isOpen()) return showMessage("Close your bag to build."); // the palette and the bag take turns on the screen (02, 2026-10-15)
  buildPalette.openPalette(S.player);
}

// X: the removal tool, or out of it if in it. Same limits as N.
function toggleRemove() {
  if (placement.state.kind === "remove") {
    placement.cancel();
    return;
  }
  if (S.player.carrying) return showMessage("Your hands are full.");
  if (panel.isOpen()) return showMessage("Close your bag to build.");
  buildPalette.close();
  placement.beginRemove();
}

function applyDebugCorner() {
  debugEl.hidden = !settings.get("debugCorner");
}

function updateInventoryUi() {
  // Carrying furniture: both hands are full and nothing else happens until it
  // is down (docs/02). The bag closes if it was open.
  if (S.player.carrying) {
    if (panel.isOpen()) {
      panel.closeAll();
      openBag = null;
    }
    if (input.wasPressed("Tab") || input.wasPressed("KeyC")) showMessage("Your hands are full.");
    return;
  }
  // Tab opens and closes the bag; with none worn it opens the character screen
  // instead, with the message (docs/11, check 6). C opens and closes the
  // character screen. The two are independent (Michael, 2026-10-12).
  if (input.wasPressed("Tab")) {
    if (inventory.bagOf(S.player)) panel.toggleBag();
    else {
      panel.toggleCharacter();
      if (panel.isCharacter()) showMessage("No bag on your back.");
    }
    if (!panel.isBagOpen()) openBag = null;
  }
  if (input.wasPressed("KeyC")) panel.toggleCharacter();
  if (openBag && (!panel.isBagOpen() || panel.takeContainerClose())) openBag = null; // the bag or the container closed by its X
  // The belt keys (1 to 4) are key events in my snapshot, performed by the world's step for my player, here or on the
  // host (interact.beltEvents, updateInteract; item 4: on a guest they changed only its own replica).
  if (openBag && openBag.address) {
    // On a guest the replica's objects are new with every frame: the grid is found again by its address.
    const c = interact.containerAt(S.player, openBag.address);
    if (!c) openBag = null;
    else {
      if (c.bag !== openBag.bag) openBag.prev = openBag.bag; // the panel may still hold the last frame's object for a click (inventory-actions addressOf)
      openBag.bag = c.bag;
      openBag.corpse = c.corpse;
    }
  }
  if (openBag) {
    let d = Infinity;
    for (const [tx, ty] of openBag.tiles) d = Math.min(d, Math.hypot(S.player.gx - tx, S.player.gy - ty));
    if (d > (openBag.closeDist || tuning.world.containerCloseDist)) openBag = null; // a station's output reaches as far as its panel
  }
  if (openBag && openBag.corpse) corpseWatch = openBag.corpse;
  if (corpseWatch) {
    refreshCorpse(corpseWatch); // what was taken from its grid comes off its body
    if (!openBag || openBag.corpse !== corpseWatch) corpseWatch = null;
  }
}

// Hair painted in tools/hair.html (docs/12): data/hair/index.json lists the
// styles. Reloaded from the settings screen so a style saved a moment ago
// shows without a restart.
async function loadPaintedHair() {
  const folders = [["hair", "data/hair"], ...["head", "chest", "legs", "hands", "feet", "body", "beard", "waist"].map((s) => [s, `data/layers/${s}`])];
  // Every index at once, then every style at once (docs/23: the server answers in parallel).
  const indexes = await Promise.all(folders.map(([, folder]) => assets.loadJson(`${folder}/index.json`).catch(() => ({ styles: [] })))); // no folder yet: nothing painted
  await Promise.all(folders.flatMap(([slot, folder], i) => (indexes[i].styles || []).map(async (name) => figure.registerLayer(slot, name, await assets.loadJson(`${folder}/${name}.json`)))));
  figureKey = ""; // the pixels may have changed under the same name
  figureQuick = "";
  // The dead and villagers rebake too, since their outfits draw from the painted pool.
  for (const sheet of assets.rebakeFigures()) gl.redrawSheet(sheet);
}

// The player's sheet is rebuilt whenever their look or their clothes change
// (docs/12): a few milliseconds, redrawn into the atlas in place.
// One sheet per player, named by their id and redrawn in place (docs/31/05, item 5): mine
// from my own look and clothes, another player's from theirs as the world reports them.
const figureKeys = new Map(); // player id -> { key, quick }
let figureKey = ""; // kept for loadPaintedHair, which clears the keys
let figureQuick = "";
function refreshFigure(force = false) {
  if (figureKey === "" && figureQuick === "") figureKeys.clear(); // a painted layer reloaded: every sheet again
  figureKey = "-";
  figureQuick = "-";
  for (const p of S.players) refreshFigureOf(p, force);
}
function refreshFigureOf(p, force = false) {
  // The swing's keyframe set follows the weapon in the main hand (docs/14); a spear's throw has its own.
  const style = combat.styleOf(p, !!archery.drawState(p));
  const painted = p === S.player ? settings.get("paintedLayers") || {} : {};
  // What the sheet depends on, as ids: the cheap test every step; the spec and its key only when it changed (docs/23a, B7).
  const quick = JSON.stringify([p.look, p.worn, p.hands, style, painted]);
  const keys = figureKeys.get(p.id) || { key: "", quick: "" };
  if (!force && quick === keys.quick) return; // `force`: the rig's numbers changed from the console (dev.js setLook), which no key sees
  keys.quick = quick;
  figureKeys.set(p.id, keys);
  const mainDef = p.hands && p.hands.main ? items.getItem(p.hands.main.id) : null;
  const extra = { altStyle: combat.altStyleOf(p), heldPose: (mainDef && mainDef.held && mainDef.held.pose) || null }; // docs/32, items 1 and 2
  const spec = figure.characterSpec(figure.characterInputs(p, undefined, painted, style, extra));
  const key = figure.specKey(spec);
  if (!force && key === keys.key) return;
  keys.key = key;
  const id = `player_${p.id}`;
  const sheet = assets.replaceSheet(id, figure.generateFigure(spec));
  gl.placeSheet(sheet); // a new player's sheet into the atlas; an old one is already there
  gl.redrawSheet(sheet);
  p.sprite = id;
}

// One step of the game. The keys' and the mouse's "pressed this step" state is
// cleared in a finally, so a throw cannot re-apply a press on the next step (docs/23a, A1).
function update(dt) {
  const t0 = performance.now();
  if (!inWorld) return; // no world chosen yet (docs/31/09)
  try {
    stepGame(dt);
  } finally {
    input.endStep();
  }
  timing.step = performance.now() - t0;
  if (t0 - timing.maxResetAt > 3000) {
    timing.stepMax = 0;
    timing.maxResetAt = t0;
  }
  timing.stepMax = Math.max(timing.stepMax, timing.step);
}

// A guest's Use, placement, and Make go to the host as commands; a host's run here. The senders are set while
// this client is a guest and cleared when it is not (checked each step, since a client joins and leaves
// without a reload).
function armGuest(on) {
  if (on === armedGuest || !remoteHandlers) return;
  armedGuest = on;
  use.setSender(on ? (cur, target) => {
    const bagAddr = (bag, kept) => kept || remoteHandlers.addressOf(bag);
    const src = cur.from.kind === "slot" ? { kind: "slot", id: cur.from.id } : (a => a && { kind: "bag", bag: a })(bagAddr(cur.from.bag, cur.from.address));
    let addr = null;
    if (target.kind === "item") { if (typeof target.slot === "string") addr = { kind: "item", uid: target.entry.uid, slot: target.slot }; else { const b = remoteHandlers.addressOf(target.bag); if (b) addr = { kind: "item", uid: target.entry.uid, bag: b }; } }
    else if (target.kind === "prop") addr = { kind: "prop", id: target.prop.id };
    else if (target.kind === "bracket") addr = { kind: "bracket", tx: target.bracket.tx, ty: target.bracket.ty, edge: target.bracket.edge };
    else if (target.kind === "character") addr = { kind: "character", id: target.ch.id };
    else if (target.kind === "tile") addr = { kind: "tile", x: target.x, y: target.y };
    if (src && addr) net.sendUse({ uid: cur.entry.uid, src, target: addr });
  } : null);
  placement.setSender(on ? (cmd) => net.sendPlace(cmd) : null);
  interact.setStampSink(on ? (id, kind) => net.sendPoke(id, kind) : null); // a click's sway or the well's bucket, told to the host for everyone's screen
  stationPanel.setSender(on ? (cmd) => net.sendCraft(cmd) : null);
}

function stepGame(dt) {
  // A guest's world is the host's (net.js): nothing here steps it; the keys, the camera, sight,
  // and the ground are still this client's own.
  const guest = net.isGuest();
  armGuest(guest);
  // A guest's own death: the host's world says so in the record, and this screen shows it, once (2026-10-14: a guest
  // who died never saw the dead screen, which only the host's own death raised).
  if (guest && S.player && !S.player.dead) deadShown = false; // alive again (a new character, another world)
  if (guest && S.player && S.player.dead && !deadShown && net.status().joined) {
    deadShown = true;
    screens.show("dead", { when: clock.getLabel(), who: S.player.name || S.player.id });
  }
  checkAway();
  applyPause(); // the last guest gone while this host is away: held from the next step
  // A screen up on the wire: the world runs on, but nothing pressed reaches it or this client's modes.
  const screenUp = !!screens.currentScreen();
  loop.setFreezeAllowed(!net.onTheWire());
  // The world first: the rules, the clock, the fires, the chunks round each player (game.js).
  if (!guest) game.begin(dt);
  if (screenUp) {
    stepWithScreenUp(dt, guest);
    return;
  }
  if (input.wasPressed("KeyV")) drawAll = !drawAll;
  // Enter opens the chat box with the cursor ready; a slash opens it with the slash typed, the hook for commands (Michael, 2026-10-13).
  if (input.wasPressed("Enter") || input.wasPressed("NumpadEnter")) log.focusChat("");
  if (input.wasPressed("Slash")) log.focusChat("/");
  if (input.wasPressed("KeyN")) toggleBuild();
  if (input.wasPressed("KeyX")) toggleRemove();
  // The wheel zooms in integer steps, 1× to 3× (docs/02, 2026-10-10 night):
  // down zooms out. The panel's own wheel use (rotating a drag) wins; an open panel alone does not stop it (2026-10-15).
  // (The wheel only reaches the world from the canvas: over a panel it never arrives.)
  // Zoom snaps between three levels: Z cycles them, the wheel steps one way
  // or the other, one step per ZOOM_PACE seconds so a rough wheel's burst is
  // one step (Michael, 2026-10-10 late).
  if (input.wasPressed("KeyZ")) view.zoomStep(1, true);
  const wheel = input.takeWheel();
  if (wheel && !panel.isDragging()) {
    const now = performance.now();
    if (now - lastZoomAt >= ZOOM_PACE * 1000) {
      lastZoomAt = now;
      view.zoomStep(-Math.sign(wheel));
    }
  }
  if (input.wasPressed("KeyL")) night.debug = (night.debug + 1) % 4;
  // Debug: ] and [ skip the clock an hour forward or back.
  if (input.wasPressed("BracketRight")) clock.setHour(clock.getHour() + 1);
  if (input.wasPressed("BracketLeft")) clock.setHour(clock.getHour() - 1);
  stationPanel.update(S.player); // the panel follows the station's queue, which game.begin stepped
  camera.follow(S.player, dt);
  camera.applyOrigin(V.w, V.h);
  // The ground: re-bake what changed in view, bake one chunk ahead, evict far ones (docs/15).
  if (!glError) ground.update(camera.cam.gx, camera.cam.gy, tiles);
  // Placement first: its ghost follows the cursor and a left click that
  // places is spent before anything else can use it (docs/13).
  if (guest) placement.syncCarried(S.player); // the carried prop's mode follows the record (placement.js)
  placement.update(S.player);
  if (buildPalette.isOpen()) {
    if (S.player.carrying || panel.isOpen()) buildPalette.close();
    else buildPalette.render(S.player);
  }
  // A left click is placement's if it takes it, else a swing (docs/14), made
  // after the player has turned to the cursor this step.
  buttons.update(dt);
  let clicked = input.mouseLeftPressed() && !menu.tookClick();
  // With the hand cursor, the zombie hand over one of the dead (ui/cursor.js).
  const under = interact.characterAt(input.getMouse().x, input.getMouse().y, S.player);
  cursor.setOverDead(!!under && under.kind === "zombie" && !under.dead);
  // Use mode (use.js): the label names what is under the cursor, and a left click on the world is the target, spent here,
  // the bag open or not (a Use begun from the bag is aimed with the bag still open).
  if (use.isActive()) {
    const target = useTargetAt(input.getMouse().x, input.getMouse().y);
    use.hover(target);
    if (clicked) {
      use.apply(target, S.player);
      clicked = false;
    }
  }
  const clickSpent = clicked && placement.tryConfirm(S.player); // on a guest the confirm is a command (placement.setSender)
  // A guest's left click makes a gatherable sway and the well's bucket play on its own screen as the host's player's does
  // (player-controller.js, which only a world's step runs): the stamp tells the host, which tells everyone (interact.setStampSink).
  if (guest && clicked && !clickSpent) {
    const m = input.getMouse();
    const launcher = archery.launcherOf(S.player);
    if (m && !(launcher && launcher.button === "primary") && !archery.drawState(S.player)) {
      interact.pokeAt(m.x, m.y, S.player);
      interact.playAt(m.x, m.y, S.player);
      // A villager under the cursor answers on the host, by its id (item 4: the host has no cursor of mine).
      const c = interact.characterAt(m.x, m.y, S.player);
      if (c && c.kind === "villager") net.sendPokeVillager(c.id);
    }
  }
  handleMouse();
  // E, B, and T as events in my snapshot (interact.keyEvents): the world performs them for my player in its
  // step, here or on the host (game.step), so a guest's boards and torch are the host's doing. They work with
  // any panel or menu open (Michael, 2026-10-15: only the pause menu stops the game), as the belt keys always have.
  const keyEv = interact.keyEvents(dt);
  const beltEv = interact.beltEvents();
  const keys = keyEv || beltEv || drawCancelled ? { ...(keyEv || {}), ...(beltEv || {}), ...(drawCancelled ? { drawCancel: true } : {}) } : null;
  drawCancelled = false;
  // The world: the player from the mouse and the keys as a snapshot (docs/23a, D1;
  // never the input module), the dead, the villagers, the light (game.js).
  const mouse = input.getMouse();
  const o = aimOrigin(S.player);
  const mySnap = {
    axis: input.moveAxis(),
    sprint: input.isDown("ShiftLeft") || input.isDown("ShiftRight"),
    aim: { x: mouse.x - o.x, y: mouse.y - o.y }, // the cursor relative to the chest, a vector a host can read (net.js)
    aimAt: archery.aimPoint(S.player, mouse), // the ground point the cursor means, for a bow drawn on a host (net.js)
    clicked,
    clickSpent,
    keys,
    mouse: input.getMouse(),
    leftDown: input.mouseLeftDown(),
    altPressed: buttons.alt.pressed,
    altDown: buttons.alt.down,
    offDown: buttons.off.down,
    space: input.wasPressed("Space"),
    blocked: menu.isMenuOpen(), // a draw ends while choosing from a menu; an open bag, a container, a station, or the character screen stops nothing (Michael, 2026-10-15)
  };
  if (guest) net.guestStep(mySnap);
  else {
    game.step(dt, net.hostStep(mySnap, S.player));
    net.hostAfterStep();
  }
  const px = Math.round(S.player.gx);
  const py = Math.round(S.player.gy);
  playerRoom = map.roomAt(px, py); // refinds rooms if a wall changed
  // Sight is cast from the player's tile centre and only recomputed when the
  // player or the camera enters a new tile. Casting every step at 60 Hz was the
  // bulk of a step's cost and fed the catch-up spiral behind the freezes.
  const key = `${px},${py}|${Math.round(camera.cam.gx)},${Math.round(camera.cam.gy)}|${map.worldVersion}|${V.w}x${V.h}`;
  if (key !== visKey) {
    const t1 = performance.now();
    tiles = camera.viewportTiles(V.w, V.h);
    visible = visibility.computeVisible(px, py, tiles);
    visKey = key;
    timing.vis = performance.now() - t1;
  }
  // Who the next swing would hit, flagged for the renderer's outline (docs/14).
  combat.markTargets(S.player, S.zombies, settings.get("showSwingTargets"));
  updateInventoryUi();
  refreshFigure();
}

function groundLine() {
  const s = ground.stats();
  return `${s.baked} baked, last ${s.lastMs.toFixed(1)}ms, max ${s.maxMs.toFixed(1)}ms, ${s.textures} textures, ${s.syncBakes} at draw`;
}

// The interface, every frame rather than every step (docs/23a, F): it follows
// the camera and a resize while paused, and its cost is not the step's. What it
// ticks (a bubble's life, the message's fade) ticks on sim time, so it freezes
// with the sim.
function renderUi() {
  const now = loop.simTime();
  const dt = now - uiSimTime;
  uiSimTime = now;
  panel.renderInventoryPanel(S.player, inventory.bagOf(S.player), openBag ? openBag.bag : null, inventory.beltOf(S.player));
  updateHud({ player: S.player });
  updatePrompt(interact.promptFor(S.player, S.progress), S.progress);
  updateZombieBars(S.zombies, visible, S.player);
  updateSwingTimer(S.player);
  updateSpeech(S.others, visible, S.player, dt);
  updateNames(S.players, visible, S.player);
  updateMessage(dt);
}

// The world put back from a save (game.restore), then everything the client
// holds about it made afresh: the player's sheet, the camera, sight, the ground's
// pictures, the light's cache, the panels and the modes closed.
async function restoreWorld(snap) {
  game.restore(snap, mapJson);
  figureKey = "";
  figureQuick = "";
  refreshFigure(true);
  // A world may come back with nobody standing in it (a server world brought home: every character dormant until its
  // player returns, item 5); the camera and the first sight start at the spawn, and playWorld puts my character back.
  const at = S.player || { gx: S.info && S.info.spawn ? S.info.spawn[0] : 0, gy: S.info && S.info.spawn ? S.info.spawn[1] : 0 };
  camera.snapTo(at.gx, at.gy);
  camera.applyOrigin(V.w, V.h);
  tiles = camera.viewportTiles(V.w, V.h);
  visKey = null;
  openBag = null;
  corpseWatch = null;
  panel.closeAll();
  stationPanel.close();
  placement.cancel();
  use.cancel();
  buildPalette.close();
  light.update();
  if (!glError) ground.invalidateAll();
  visible = visibility.computeVisible(Math.round(at.gx), Math.round(at.gy), tiles);
  lastAutosave = loop.simTime();
}

// The step while a screen is up on the wire: the camera and the world, my player idle, no keys.
function stepWithScreenUp(dt, guest) {
  const player = S.player;
  camera.follow(player, dt);
  camera.applyOrigin(V.w, V.h);
  if (!glError) ground.update(camera.cam.gx, camera.cam.gy, tiles);
  const mySnap = { ...game.idleSnapshot(), idle: true };
  if (guest) net.guestStep(mySnap);
  else {
    game.step(dt, net.hostStep(mySnap, player));
    net.hostAfterStep();
  }
  const px = Math.round(player.gx);
  const py = Math.round(player.gy);
  playerRoom = map.roomAt(px, py);
  const key = `${px},${py}|${Math.round(camera.cam.gx)},${Math.round(camera.cam.gy)}|${map.worldVersion}|${V.w}x${V.h}`;
  if (key !== visKey) {
    tiles = camera.viewportTiles(V.w, V.h);
    visible = visibility.computeVisible(px, py, tiles);
    visKey = key;
  }
  refreshFigure();
}

function render() {
  const r0 = performance.now();
  if (!inWorld || !S.player) { gl.blank(); return; } // the title over black, never the world left (docs/31/09, #16)
  if (started && !S.player.dead && loop.simTime() - lastAutosave >= AUTOSAVE && performance.now() - lastAutosaveAt >= AUTOSAVE * 1000) {
    // Stamped when asked, so a save still being written (or a world that saves nothing, a guest's) is asked once a minute, not every frame.
    lastAutosave = loop.simTime();
    lastAutosaveAt = performance.now();
    events.emit("autosaveTick");
  }
  const scene = {
    w: V.w,
    h: V.h,
    tiles,
    visible,
    entities: [...S.players, ...S.zombies, ...S.villagers, ...S.corpses], // every player, not mine alone (Michael's first real join, 2026-10-13: the other player was a name with no body)
    arrows: archery.arrowsInFlight(),
    fire: burning.all(),
    marker: settings.get("aimGuide") ? archery.getMarker(S.player) : null, // the viewer's own Aim guide (docs/20, 02 2026-10-16)
    playerRoom,
    player: S.player,
    camera: camera.cam,
    drawAll,
    fog: !drawAll,
    ghost: placement.ghost(),
    hitShapes: combat.overlays(S.player, S.zombies, settings.get("showHitShapes")),
    // The tile grid shows only while building or removing (docs/15).
    grid: placement.state.kind === "build" || placement.state.kind === "remove",
  };
  if (!glError) drawn = renderScene(scene);
  timing.render = performance.now() - r0;
  renderUi();
  const [cx, cy] = map.chunkCoord(Math.round(S.player.gx), Math.round(S.player.gy));
  const hand = (e) => (e ? e.id : "-");
  debugEl.textContent =
    `fps ${loop.getFps()}\n` +
    `player ${S.player.gx.toFixed(2)},${S.player.gy.toFixed(2)} ${S.player.facing} hp ${Math.ceil(S.player.hp)} hunger ${Math.round(S.player.hunger)} thirst ${Math.round(S.player.thirst)}\n` +
    `${clock.getLabel()} ${clock.getPhase()}  bright ${clock.getBrightness().toFixed(2)}  light@player ${light.lightAt(S.player.gx, S.player.gy).toFixed(2)}  hands ${hand(S.player.hands.main)}/${hand(S.player.hands.off)}  guard ${combat.shieldOf(S.player) ? (S.player.blocking ? "UP" : "ready") : "no shield"}\n` +
    `chunk ${cx},${cy}  room ${playerRoom}${playerRoom > 0 ? (map.roomSealed(map.getRoom(playerRoom)) ? " sealed" : " open") : ""}  rooms ${map.roomCount()}  sources ${light.sources().length} (${light.sources().filter((s) => s.kind === "portal").length} portals)\n` +
    `tiles ${tiles.length} visible ${visible.size} drawables ${drawn}  step ${timing.step.toFixed(1)}ms max3s ${timing.stepMax.toFixed(1)}ms vis ${timing.vis.toFixed(1)}ms render ${(timing.render || 0).toFixed(1)}ms\n` +
    `ground ${groundLine()}${net.onTheWire() ? `  wire out ${(net.wireRates().out / 1024).toFixed(1)} KB/s in ${(net.wireRates().in / 1024).toFixed(1)} KB/s` : ""}\n` +
    `villagers ${S.villagers.length}  zombies ${S.zombies.length}  corpses ${S.corpses.length}  chunks ${map.chunkCount()}  near ${S.zombies.filter(game.nearPlayer).length}  ${S.zombies.slice(0, 6).map((z) => z.state).join(" ")}\n` +
    `Tab: bag   C: character   1-4: belt   N: build   X: remove   Z: zoom   right-click: actions   Esc: close or pause   E: nearest   T: torch   Enter: chat   B: boards   V: ${drawAll ? "all" : "fog"}   ] [: hour   L: debug ${["off", "light", "ambient", "fog"][night.debug]}${glError ? `   WebGL2 unavailable: ${glError}` : ""}`;
}



// A file that may be missing: null instead of a failed boot (combat.json and
// poses.json have built-in numbers behind them).
async function optionalJson(path) {
  try {
    return await assets.loadJson(path);
  } catch (err) {
    console.warn(`No ${path}; using the built-in numbers:`, err.message);
    return null;
  }
}

// Boot is a plan of stages run behind the loading screen (docs/23, step 1;
// src/boot.js): each names what it does, moves the bar, fails naming its file,
// and is timed on window.__boot. Everything the manifest lists is loaded and
// everything that can be baked is baked here, so nothing bakes in play.
async function boot() {
  input.init(canvas);
  settings.load();
  await save.migrate(MAP_NAME, "The valley"); // the one slot per map before docs/31/09 becomes a world
  identities.migrate(); // the one name and look kept before identities become the first identity
  net.setClient(identities.clientId()); // the browser's id on every join (its hash is what a world records)
  view.init(canvas, ui);
  applyDebugCorner();
  settings.onChange((key) => {
    if (key === "debugCorner") applyDebugCorner();
  });
  let json = null;

  await shell.run([
    { name: "manifest", label: "Reading the manifest", weight: 1, async run() {
      assets.setManifest(await assets.loadJson("data/manifest.json"));
    } },
    { name: "data", label: "Reading the data", weight: 2, async run() {
      const [itemsJson, buildJson, combatJson, posesJson, lootJson, wardrobesJson, interactionsJson] = await Promise.all([
        assets.loadJson("data/items.json"),
        assets.loadJson("data/build.json"),
        optionalJson("data/combat.json"),
        optionalJson("data/poses.json"),
        assets.loadJson("data/loot.json"),
        assets.loadJson("data/wardrobes.json"),
        optionalJson("data/interactions.json"),
      ]);
      interactions.load(interactionsJson); // anything on anything (docs/30, law 2)
      stations.loadRecipes(await optionalJson("data/recipes.json")); // the stations' recipes (docs/30, section 6)
      looksJson = await optionalJson("data/looks.json"); // the character screen's palettes (docs/12)
      tuning.load(await optionalJson("data/tuning.json")); // the entities' numbers (docs/23a, D9)
      startingKit.load(await assets.loadJson("data/kit.json")); // the starting kit (#136)
      items.loadItems(itemsJson);
      placement.setBuildData(buildJson);
      if (combatJson) combat.setCombatData(combatJson); // the fists' and the shove's numbers (docs/14); the weapons' are on their items
      if (combatJson) archery.setBowData(combatJson.bow); // the bow's and the flight's (2026-10-15)
      if (posesJson) figure.setPoses(posesJson); // the swing's keyframes, as data Michael can edit (docs/14)
      items.loadLoot(lootJson);
      figure.setArtResolver((id) => items.getItem(id).art || null);
      figure.setWardrobes(wardrobesJson); // who wears what (docs/19)
    } },
    // Every sprite definition and every picture in the manifest, not only what the map names.
    { name: "art", label: "Loading the art", weight: 10, run: (progress) => assets.loadAll(progress) },
    { name: "layers", label: "Reading the painted layers", weight: 1, run: () => loadPaintedHair() },
    { name: "map", label: "Reading the map", weight: 1, async run() {
      json = await assets.loadJson(MAP_FILE);
      mapJson = json; // kept for a restore (save.js); the map is read whole, and each world's own rules (trees, population) shape what it makes of it (#130)
      // Everything is loaded already; this adds the two-tile variants, and a name the manifest lacks fails here with its id.
      await assets.loadMapSprites(json);
      for (const k of placement.buildKinds()) await assets.loadSprite(k.sprite); // what can be built must be drawable
    } },
    // Every outfit the wardrobes can produce is baked now, one per frame so the bar moves, so no one is baked when first seen.
    { name: "figures", label: "Dressing everyone", weight: 6, async run(progress) {
      assets.registerSheet("arrow", archery.generateArrow()); // the bow's arrow, flying and landed (docs/20)
      assets.registerSheet("spear", archery.generateSpear()); // the thrown spear
      assets.registerSheet("fire_arrow", archery.generateFireArrow()); // a fire arrow in flight (#14)
      // The fireball (docs/24; the design agent's sheet). A failed load leaves the spell flying unseen, never the boot stopped.
      try {
        assets.registerSheet("fireball", archery.fireballSheet(await assets.loadImage("data/art/items/fireball.png")));
      } catch (err) {
        console.warn("the fireball's picture did not load:", err && err.message);
      }
      assets.registerSheet("burn", burning.generateSheet()); // flames, embers, and smoke on a burning figure (docs/05)
      const nZ = figure.wardrobeCount("zombie");
      const nV = figure.wardrobeCount("village");
      let n = 0;
      for (let k = 0; k < nZ; k++) {
        wardrobeInto(createCharacter("zombie", 0, 0), "zombie", k); // what createZombie does, for the sheet alone
        progress(++n / (nZ + nV));
        await shell.nextFrame();
      }
      for (let k = 0; k < nV; k++) {
        createVillager(0, 0, { id: "bake", wardrobe: k });
        progress(++n / (nZ + nV));
        await shell.nextFrame();
      }
    } },
    // The held art, generated like everything else (docs/12); drawn items come from a picture and a grip pixel.
    { name: "held", label: "Making the held things", weight: 2, async run(progress) {
      const held = items.allItems().filter((def) => def.held);
      for (let i = 0; i < held.length; i++) {
        const def = held[i];
        if (def.held.image || def.held.angles) assets.registerSheet(`held_${def.id}`, await assets.heldSheetFromImage(def.held));
        else assets.registerSheet(`held_${def.id}`, figure.generateHeld(def.held.shape, def.held.colours, def.held.size));
        progress((i + 1) / held.length);
      }
      for (const def of items.allItems()) if (def.shield) assets.registerSheet("held_shield_guard", figure.generateHeld("shield_guard", def.held.colours)); // the raised guard (docs/21)
    } },
    { name: "world", label: "Growing the world", weight: 1, async run() {
      // The world itself (game.js): the same calls headless under Node (tools/world.js).
      // No world until one is chosen on the Worlds screen (docs/31/09). The checks want a fresh world
      // at boot as the game always had: `?nosave` makes one, never saved (the same calls in the same
      // order as tools/world.js, so both worlds hash the same).
      if (TEST_WORLD) {
        game.create({
          json,
          look: lookOf(testIdentity()),
          name: testIdentity().name || null,
          devChest: !!settings.get("devChest"),
          // The test world plays by the last choices, as the pane always had it, except for the two a world is made with
          // (Trees, Starting population): a world Michael made with no dead or no trees must not leave every test page so.
          rules: { ...sandboxChoices().rules, ...Object.fromEntries(rules.FIXED.map((k) => [k, rules.DEFAULTS[k]])) },
        });
        refreshFigure();
        camera.snapTo(S.player.gx, S.player.gy);
        camera.applyOrigin(V.w, V.h);
        tiles = camera.viewportTiles(V.w, V.h);
        light.update();
        for (const [cx, cy] of ground.prebakeTargets(tiles)) light.chunkLight(cx, cy);
        visible = visibility.computeVisible(Math.round(S.player.gx), Math.round(S.player.gy), tiles);
        setInWorld(true);
      }
    } },
    // The ground's pictures for the view and a ring around it (docs/15), two per frame.
    { name: "ground", label: "Baking the ground", weight: 6, async run(progress) {
      if (glError) return;
      await ground.init(json);
      map.onGroundChange(ground.invalidate);
      const targets = ground.prebakeTargets(tiles);
      for (let i = 0; i < targets.length; i++) {
        const [cx, cy] = targets[i];
        if (!ground.textureFor(cx, cy)) ground.bakeNow(cx, cy);
        progress((i + 1) / targets.length);
        if (i % 2 === 1) await shell.nextFrame();
      }
    } },
    // Every sheet into the atlas now, so its one full upload happens here, not at the first sight of a thing.
    { name: "atlas", label: "Packing the atlas", weight: 1, async run() {
      if (glError) return;
      // Tallest first: the atlas packs in shelves, and a figure sheet (768 x 576) beside
      // small sprites wastes a shelf's height (94 percent full in registration order, 2026-10-12).
      const unseen = ground.sheetIds(); // read by the bake, never drawn
      unseen.add("zombie"); // the dead draw their shared outfit sheets, never the definition's generated body
      const sheets = assets.allSheets().filter((s) => !unseen.has(s.id)).sort((a, b) => b.image.height - a.image.height);
      for (const sheet of sheets) gl.placeSheet(sheet);
    } },
    { name: "ui", label: "Setting the table", weight: 1, async run() {
      kit.apply(); // the stone, the well, and the button as CSS, before any panel is built (docs/23, step 4)
      cursor.init();
      log.initLog({
        // The log is the chat (docs/31/03): a line typed is said by my player; a guest's is said on the host.
        onSay: (text) => {
          if (net.isGuest()) net.sendSay(text);
          else say(S.player, text);
        },
      }); // before anything can show a message
      initNames();
      use.init();
      stationPanel.initStationPanel(() => S.player);
      initHud();
      initPrompt();
      initZombieBars();
      initSwingTimer();
      initSpeech();
      menu.initContextMenu();
      // A guest's panel sends commands (docs/31/05, item 9); the open container is found by its address each frame.
      // Which handlers the panel uses is decided at each call, by whether this client is a guest right now, not
      // once at boot by looking for ?join= in the URL: a joiner who came in through the Worlds screen (Join a game,
      // Rejoin) has no ?join=, got the host's handlers, and its every panel action changed its own copy of the
      // world and told the host nothing (a bag taken from the dev chest vanished from the joiner's chest and went
      // nowhere; Michael's real join, 2026-10-13).
      const localHandlers = createInventoryActions(() => S.player);
      remoteHandlers = createRemoteInventoryActions(() => S.player, () => openBag, (cmd) => net.sendItem(cmd));
      handlers = {};
      for (const k of new Set([...Object.keys(localHandlers), ...Object.keys(remoteHandlers)])) {
        const lv = localHandlers[k];
        const rv = remoteHandlers[k];
        // On a guest the remote one, else the local one; never the remote one in a world of one's own or a host's, where it
        // would only send to a host that is not there (2026-10-14: every move between bags did nothing).
        handlers[k] = typeof lv === "function" || typeof rv === "function" ? (...a) => { const f = net.isGuest() && typeof rv === "function" ? rv : lv; return typeof f === "function" ? f(...a) : undefined; } : lv;
      }
      // A host's own drag into a chest marks its chunk, so a guest sees the chest change.
      handlers.changed = () => { if (!net.isGuest() && openBag && openBag.tiles && openBag.tiles[0]) map.markDirty(openBag.tiles[0][0], openBag.tiles[0][1]); };
      panel.initInventoryPanel(handlers);
      placement.init({ startAction: interact.startAction });
      buildPalette.initBuildPalette({
        onPick: (what) => {
          buildPalette.close();
          if (what === "__remove") placement.beginRemove();
          else placement.beginBuild(what);
        },
      });
      // Any screen up means the game is paused when played alone; the title is up at boot.
      const kitWorn = { chest: { id: "tunic" }, legs: { id: "breeches" }, feet: { id: "boots" }, waist: { id: "belt" }, back: { id: "small_sack" } };
      const bake = (look, worn, painted) => figure.generateFigure(figure.characterSpec(figure.characterInputs({ kind: "player", look, worn, hands: { main: null, off: null } }, undefined, painted, null)));
      screens.initScreens({
        onChange: (name) => setPaused(!!name),
        onReload: () => window.location.reload(),
        // The wire (net.js): hosting as a switch on this world, a join as a character for a friend's (docs/31/09).
        wire: {
          status: () => net.status(),
          setOpen,
          // A join goes out with the browser's id and no identity: the host hands back the character this
          // browser made there, or asks (`who`) for an identity, which the creation steps give (joinAs).
          join: (code) => joinWorld(code),
          joinAs: (identityId) => {
            const identity = identities.get(identityId);
            if (!identity || !net.isGuest()) return;
            net.setIdentity({ name: identity.name || null, look: lookOf(identity) });
            identities.rememberJoined({ code: net.status().code, myCharacter: identity.name || null });
            screens.hide();
            showJoining(net.status().code); // back under the loading screen (#107)
            shell.worldStage(`Joining as ${identity.name || "a survivor"}`, 0.3);
          },
          isOpen: (code) => net.isOpen(code),
        },
        onSave: () => {
          saveWorld().then((ok) => { if (ok) showMessage("Saved."); });
        },
        // The worlds flow (docs/31/09): this browser's worlds and the friends' worlds it has joined.
        worlds: {
          list: () => save.listWorlds().map((r) => ({ ...r, playable: r.mapName === MAP_NAME })),
          friends: () => identities.joined(),
          play: (worldId) => { playWorld(worldId); },
          remove: (worldId) => save.deleteWorld(worldId), // a promise: the screen re-renders when it settles
          forget: (code) => identities.forgetJoined(code),
          create: (name, identityId, options = {}) => { const identity = identities.get(identityId); if (identity) enterNewWorld(name, identity, options); },
          sandbox: sandboxChoices, // the Sandbox step's first choices (#109)
          setWorldRules, // the host's, from the pause menu
          respawn: (identityId) => respawn(identities.get(identityId)),
          defaultName: () => `${MAP_NAME === "valley" ? "The valley" : MAP_NAME}, ${new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" })}`,
          here,
          leave: exitGame, // the old name, kept for the checks
          exitGame,
          comeBack, // the step-away screen's button and its Escape
          // A world moved to the server and home again (item 5's fifth step).
          canMove: () => !!net.relayHttp(),
          creatorKey: () => identities.creatorKey(),
          setCreatorKey: (k) => identities.setCreatorKey(k),
          moveUp,
          bringHome,
          playServer,
          // The owner's powers (item 5's sixth step).
          ownedElsewhere,
          ownedFor: (worldId) => identities.ownedFor(worldId),
          playOwned: (code) => { const o = ownedByCode(code); if (o) joinWorld(o.code, o.ownerKey); },
          ownerInfo,
          rotateCode,
          setRules,
          removePlayer,
          unbar,
          addOwned,
          rekey,
        },
        // Identities (identities.js): the list, and the one being edited on the identity screen.
        identities: {
          list: () => identities.list(),
          last: () => identities.last(),
          setLast: (id) => identities.setLast(id),
          editing: () => editing,
          beginNew: () => { editing = { id: null, name: "", look: { hairStyle: "short" } }; },
          beginEdit: (id) => { const i = identities.get(id); editing = i ? { id: i.id, name: i.name, look: { ...i.look } } : null; },
          commit: () => {
            if (!editing) return null;
            const saved = editing.id ? identities.update(editing.id, { name: editing.name, look: editing.look }) : identities.add({ name: editing.name, look: editing.look });
            editing = null;
            return saved;
          },
          cancel: () => { editing = null; },
          remove: (id) => identities.remove(id),
        },
        hair: {
          styles: () => figure.hairStyles(),
          current: () => (editing ? lookOf(editing).hairStyle : "short"),
          set: (name) => { if (editing) editing.look = { ...editing.look, hairStyle: name }; },
          reload: async () => { await loadPaintedHair(); refreshFigure(); },
        },
        // The identity editor's api (docs/12, the creation screen as built; docs/31/09): the identity in hand.
        you: {
          name: () => (editing ? editing.name : ""),
          setName: (n) => { if (editing) editing.name = String(n || "").slice(0, 24); },
          look: () => lookOf(editing),
          setLook: (partial) => { if (editing) editing.look = { ...editing.look, ...partial }; },
          styles: () => figure.hairStyles(),
          palette: () => looksJson || { skins: { living: [figure.DEFAULT_LOOK.skin], dead: [] }, hair: [figure.DEFAULT_LOOK.hair], eyes: [figure.DEFAULT_LOOK.eyes] },
          // The figure in the kit's clothes, the hands empty, baked by the game's own code.
          sheet: () => bake(lookOf(editing), kitWorn, {}),
          // This world's character as it is, for the pause menu's Character screen.
          characterSheet: () => (inWorld && S.player ? bake(S.player.look, S.player.worn, settings.get("paintedLayers") || {}) : null),
        },
        // Painted layers to try on, per slot, regardless of what is worn (docs/12).
        layers: {
          slots: () => ["body", "head", "beard", "chest", "waist", "legs", "hands", "feet"],
          names: (slot) => figure.layerNames(slot),
          current: (slot) => (settings.get("paintedLayers") || {})[slot] || null,
          set: (slot, name) => {
            const next = { ...(settings.get("paintedLayers") || {}) };
            if (name) next[slot] = name; else delete next[slot];
            settings.set("paintedLayers", next);
            refreshFigure();
          },
        },
      });
      // The world's events, as this screen shows them: the world applies them (game.js: a bite's damage, the wound,
      // the infection, a villager's damage; combat.js: the shield's flash) and the host answers them for the
      // players they are for (host.js); this client only reads the world (item 5's first step, 2026-10-14).
      // A bite names its victim (docs/31/05, item 18): the wound is theirs; the words are mine alone.
      events.on("bitten", ({ player: p, opened, infected }) => {
        if (p !== S.player) return;
        if (infected) showMessage("The bite broke the skin.");
        else if (opened && bleed.stacks(p) === 1) showMessage("You are bleeding. A bandage will stop it.");
      });
      // A blow met by the shield: sparks where they meet (docs/21); the flash is the player's own state (combat.js).
      events.on("blocked", ({ zombie, player: p = S.player }) => {
        const d = iso.normalize(zombie.gx - p.gx, zombie.gy - p.gy);
        burning.spark(p.gx + d.x * 0.45, p.gy + d.y * 0.45, 22);
      });
      // A wall the dead strike jolts once a strike, and a fence that gives bursts into splinters (map.strikeFence, #147, #174): drawn here.
      events.on("wallStruck", ({ tx, ty, edge }) => shakeFence(tx, ty, edge));
      events.on("fenceBurst", ({ x, y }) => burning.splinters(x, y, 12));
      // A blow that landed kicks the camera of the client whose player struck (docs/31/05, item 13).
      events.on("kicked", ({ player: p, x, y, seconds }) => {
        if (p === S.player) camera.kick(x, y, seconds);
      });
      events.on("gameOver", ({ player: p }) => {
        if (p !== S.player) return; // another player's death is theirs to see
        // The world says so (game.js) and the host saves it (host.js); the client shows it.
        screens.show("dead", { when: clock.getLabel(), who: p.name || p.id });
      });
      // Sleep and fire say what happened (docs/30 step 2): the world's events, shown here.
      // Time skips only when everyone in the world is asleep (game.everyoneAsleep): said to the sleeper, here or on the guest the verb ran for.
      events.on("sleepStart", () => showMessage(game.everyoneAsleep() ? "You lie down. The night goes on without you." : "You lie down. Time will pass faster once everyone in the world is asleep.", 5));
      events.on("sleepEnd", ({ hours }) => showMessage(`${clock.getLabel()}. You slept ${hours} hours.`, 4));
      events.on("fireOut", ({ tile }) => {
        if (Math.hypot(tile[0] - S.player.gx, tile[1] - S.player.gy) <= tuning.world.fireOutRadius) showMessage("A fire has gone out.");
      });
      // A craft done and a weapon worn out (docs/30, sections 5.2 and 6): the line and the word for my own player
      // (a guest's reach it through the host, host.js).
      events.on("craftDone", ({ out, tile }) => {
        const line = `Made ${out.prop ? out.prop.replace(/_/g, " ") : `${out.count > 1 ? `${out.count} ` : ""}${items.getItem(out.id).name.toLowerCase()}`}.`;
        if (Math.hypot(tile[0] - S.player.gx, tile[1] - S.player.gy) <= tuning.world.craftDoneRadius) log.push(line, "result");
      });
      events.on("torchSpent", ({ x, y }) => {
        if (Math.hypot(x - S.player.gx, y - S.player.gy) <= tuning.world.torchSpentRadius) log.push("A torch burns out.", "result"); // a guest's, host.js
      });
      events.on("weaponBroke", ({ item, who }) => {
        if (!who || who === S.player.id) showMessage(`Your ${items.getItem(item).name.toLowerCase()} is spent.`, 3);
      });
      events.on("drank", ({ who, auto }) => {
        if (auto && who === S.player.id) showMessage("You drink from your waterskin.", 2); // a guest's, host.js
      });
      events.on("containerGone", ({ bags }) => {
        if (openBag && bags.includes(openBag.bag)) openBag = null; // its panel closes with it (placement.js destroy)
      });
      events.on("containerOpened", ({ bag, tiles: where, name, corpse, closeDist }) => {
        // Opened by a guest's player (the acting player, game.js): the host tells the guest (host.js), not this screen.
        const by = game.state.acting;
        if (by && by !== S.player) return;
        openBag = { bag, tiles: where, name, corpse: corpse || null, closeDist: closeDist || 0 };
        panel.setBagOpen(true);
      });
      // The host's answers to the world's events, and the routing of a message or a log line said while a guest's
      // player acts (host.js): once, here, as this page may host.
      host.init({ cap: () => tuning.world.playerCapBrowser, store: ownersStore, save: () => saveWorld(), self: () => S.player, arrived: (p) => refreshFigureOf(p, true) });
      host.install();
      // After the menu's own listener, so a menu closed by Escape is seen first.
      window.addEventListener("keydown", (e) => {
        if (e.code === "Escape") handleEscape();
      });
      // A sprite saved by the tool in another tab shows here at once (docs/23, step 3f).
      try {
        new BroadcastChannel("cmz").onmessage = async (e) => {
          if (!e.data || e.data.type !== "sheet") return;
          await assets.reloadSheet(e.data.id);
          if (ground.sheetIds().has(e.data.id)) await ground.reload();
          if (e.data.id === "ui_kit") kit.apply();
          showMessage(`Reloaded ${e.data.id}.`);
        };
      } catch {
        // no BroadcastChannel: the hard refresh is the loop
      }
    } },
  ]);

  // The wire (net.js, docs/31/04): `?host=<code>` opens this world to guests on this origin; `?join=<code>`
  // joins one (`&lag=100` adds a delay each way). A guest skips the title: its world arrives from the host.
  const url = URLQ;
  urlLag = url.get("lag");
  net.setRelay(url.get("relay")); // `?relay=wss://...` for a relay (server/relay.js), `?relay=none` for the two-tab loopback
  const joinCode = TEST_WORLD ? url.get("join") : null; // `?host=` and `?join=` are the checks' (a test world); the game's own flow is the Worlds screen
  net.setIdentity({ name: testIdentity().name || null, look: lookOf(testIdentity()) }); // the wire's identity until a join picks one
  net.init({ host: TEST_WORLD ? url.get("host") : null, join: joinCode, lag: urlLag }, {
    restore: async (snap, playerId, world) => {
      shell.worldStage("Receiving the world", 0.4);
      shell.worldNoCancel(); // the world is here: Leave is the way out now (the review of #115)
      awaitingWelcome = false;
      await restoreWorld(snap);
      S.player = S.players.find((p) => p.id === playerId) || S.player;
      game.state.player = S.player;
      refreshFigure(true);
      camera.snapTo(S.player.gx, S.player.gy);
      setInWorld(true);
      currentWorld = null; // the host's world, never saved here
      joinedWorld = world || null; // its name and its host's, for the pause menu (the wiki census's bugs, 2026-10-15)
      started = false;
      // The bookmark learns the world's name, its host, and my character there (docs/31/09).
      // (A world of mine on the server has its own row among my worlds, item 5: not a friend's world too.)
      if (!identities.owned().some((o) => o.code === net.status().code)) identities.rememberJoined({ code: net.status().code, name: world ? world.name : null, hostName: world ? world.host : null, myCharacter: S.player.name || S.player.id });
      // The host's world is here: its ground baked behind the screen, then the screen goes (#107).
      await settleWorld(0.5);
      await shell.worldEnd();
    },
    // The host's side (host.js): the joins and whose character, the saves, dormancy, stepping away, a guest's commands.
    ...host.netHooks(),
    stay: stayed,
    // The host knows no living character of mine here: the creation steps, then joinAs (which brings the screen back).
    who: (dead) => { shell.worldHide(); screens.creationFor({ for: "join", code: net.status().code, dead }); },
    joined: (id) => showMessage(`Joined as ${id}.`, 3),
    message: (text, seconds = 3) => showMessage(text, seconds),
    kick: (x, y, seconds) => camera.kick(x, y, seconds), // my own landed blow, told by the host (item 4)
    fx: (kind, x, y, z) => { // a visual the host's world made (a blocked blow's sparks, z its height; a fence's splinters; a fence shaking, its tile and z 1 for a west edge)
      if (kind === "spark") burning.spark(x, y, z);
      else if (kind === "splinters") burning.splinters(x, y, z);
      else if (kind === "shake") shakeFence(Math.round(x), Math.round(y), z ? "w" : "n");
    },
    // A container my player opened on the host: the grid is on my replica's prop, entry, or body, found by
    // its address (interact.containerAt; a station's output is its own bag, docs/30 section 6), again every frame.
    opened: (w) => {
      const c = interact.containerAt(S.player, w);
      if (!c) return;
      // A station my player used on the host: its recipes panel on my replica (the output opens below as any container).
      if (w.station && w.propId) {
        const pr = map.propById(w.propId);
        if (pr) stationPanel.openPanel(pr, S.player);
      }
      openBag = { bag: c.bag, tiles: w.tiles, name: w.name, corpse: c.corpse, closeDist: w.closeDist || 0, address: w };
      panel.setBagOpen(true);
    },
    // A log line said for my player on the host (the Use mode's result).
    log: (text, kind) => log.push(text, kind),
    // The wire gone (net.js dropped): a guest back at the title, told why, the world here untouched; a host told and playing on alone.
    failed: (code, why, role) => {
      const st = net.status();
      const where = st.relay ? `the relay at ${st.relay}` : "another tab of this browser";
      const notes = {
        timeout: st.relay ? `No host answered "${code}". The host may have closed the world, or the code is not quite right.` : `No host answered "${code}". Without a relay the host and its guests must be tabs of one browser.`,
        nohost: `No world is open under "${code}". Check the code with the host.`,
        taken: `The code "${code}" is in use on the relay; open the world again for a new one.`,
        busy: "The server is running as many worlds as it holds. Try again in a minute.",
        broken: `The world "${code}" failed to start on the server a few times; it is resting before it tries again.`,
        moving: "That world is on its way home to its owner's browser.",
        removed: "The world's owner removed you from it.",
        updated: "The game was updated. Reload the page (the new version can take a few minutes to reach your browser).",
        relay: `${where[0].toUpperCase()}${where.slice(1)} could not be reached.`,
        dropped: "The connection to the host dropped.",
        hostLeft: "The host closed the world.",
        replaced: "This world was joined again from another tab or window; this one let go.",
        full: "This world is full.",
        refused: "The host would not take that join.",
        versionGuest: "The host is on a newer build. Refresh and rejoin.",
        versionHost: "You are on a newer build than the host; they should refresh.",
      };
      const note = notes[why] || `The wire to "${code}" is gone.`;
      if (role === "host") {
        // Opened again by itself after a refresh, the old room may still be on the relay: ask again a few times with the same code.
        if (why === "taken" && currentWorld && currentWorld.open && reopenTries < 4) {
          reopenTries++;
          setTimeout(() => { if (inWorld && currentWorld && currentWorld.open && !net.onTheWire()) setOpen(true); }, 3000);
          return;
        }
        if (why === "taken" && currentWorld) currentWorld.code = null; // the next opening draws a new code
        return showMessage(note, 5);
      }
      // A guest's wire gone: out of the stand-in or the replica, the site's Home with the reason.
      shell.worldHide();
      toSite("title", { note });
    },
    chunksChanged: (chunks) => {
      for (const d of chunks) ground.invalidate([[d.cx * map.CHUNK + 8, d.cy * map.CHUNK + 8], [d.cx * map.CHUNK, d.cy * map.CHUNK], [d.cx * map.CHUNK + 15, d.cy * map.CHUNK + 15]]);
    },
  });
  window.addEventListener("pagehide", () => net.leave());
  // pump: a hidden host's world open to friends with nobody in it yet answers the wire (a join) without stepping.
  // pump: a world that is not stepping (hidden and open with nobody in, or held) still answers the wire, so a join is heard.
  loop.start({ update, render, crash: shell.crash, pump: () => {
    if (inWorld && net.isHost()) net.hostStep({ ...game.idleSnapshot(), idle: true }, S.player);
    applyPause();
  } });
  // A world with friends in it is stepped by a Worker's timer when the browser stops drawing this tab (item 3, `02`):
  // the host's for everyone, a guest's so its own clock, its sends, and the frames it is owed keep up. A solo world
  // is not: hidden, it stops, as single player always has.
  loop.setBackgroundDriver(() => (!inWorld ? null : net.isGuest() || (net.isHost() && net.hasGuests()) ? "step" : net.isHost() ? "pump" : null));
  // A guest waits for the host's welcome; a host or a lone world starts from the Worlds screen (docs/31/09).
  if (net.isGuest()) {
    started = false;
    showMessage("Joining the host's world…", 4);
  } else screens.show(window.__wantPage || "title"); // nothing runs behind it (docs/31/09): Worlds is where a world is chosen; a page asked for while loading opens now (index.html, #111)
  window.__siteReady = true; // the site's buttons are the screens' from here
  // Autosave: every AUTOSAVE seconds of game time, and when the tab is hidden or left (the parent's rule).
  const autosave = () => {
    if (!inWorld || !started || !currentWorld || net.isGuest()) return; // a guest's world is the host's to save; a test world is nobody's
    saveWorld();
  };
  events.on("autosaveTick", autosave);
  document.addEventListener("visibilitychange", () => { if (document.hidden) autosave(); });
  // A hosting window with friends in it must stay in front (a covered one is slowed to a crawl by the browser,
  // and its world with it): the tab's title says so while it is hidden, where the tab strip and the taskbar show it.
  const plainTitle = document.title;
  // With friends in the world, a hidden host's world runs on (loop.js's second driver), so the title only says so.
  document.addEventListener("visibilitychange", () => {
    document.title = document.hidden && net.isHost() && net.hasGuests() ? "Hosting: friends are playing" : plainTitle;
    if (document.hidden && net.isGuest()) net.idleNow(); // the host hears at once that nothing is held
  });
  window.addEventListener("pagehide", autosave);
  await shell.finish(); // the screen goes once the first frame is under it
  // A test join from the URL (`?join=`) still waiting for its welcome: the joining screen over the stand-in (#107).
  if (net.isGuest() && !joinedWorld) { awaitingWelcome = true; showJoining(net.status().code); }

  window.__game = createDevApi({
    get player() { return S.player; },
    get zombies() { return S.zombies; },
    get corpses() { return S.corpses; },
    get villagers() { return S.villagers; },
    get tiles() { return tiles; },
    get visible() { return visible; },
    get playerRoom() { return playerRoom; },
    get info() { return S.info; },
    game,
    save,
    restoreWorld,
    // A second player into this world, for the checks and for the plan (docs/31/03): standing, controlled by nobody.
    net,
    // The worlds flow (docs/31/09), for check("worlds"): a world made, left, listed, played again; a new character after a death.
    // Stepping away (item 3), for the checks: the idle time shortened, the state, and the two moves by hand.
    away: { after: (ms) => { awayAfterMs = ms == null ? AWAY_AFTER_MS : ms; lastInputAt = performance.now(); }, get now() { return away; }, step: stepAway, back: comeBack, check: checkAway },
    worlds: { moveUp, bringHome, playServer, ownerInfo, rotateCode, setRules, removePlayer, unbar, addOwned, rekey, create: (name, identityId, options = {}) => enterNewWorld(name, identities.get(identityId), options), setWorldRules, sandbox: sandboxChoices, play: playWorld, leave: exitGame, exitGame, respawn: (id) => respawn(identities.get(id)), here, setOpen, save: () => saveWorld(), joinFor: host.joinFor, full: host.full, awayNow: host.awayNow, backNow: host.backNow, dormantNow: host.dormantNow, get current() { return currentWorld; }, get inWorld() { return inWorld; }, get store() { return ownersStore(); } },
    identities,
    addPlayer: (gx, gy, opts) => {
      const p = game.addPlayer(gx, gy, opts);
      refreshFigureOf(p, true);
      return p;
    },
    get openBag() { return openBag; },
    get handlers() { return handlers; },
    get timing() { return timing; },
    get drawn() { return drawn; },
    setPaused,
    refreshFigure,
  });
}

boot().catch((err) => {
  console.error(err);
  debugEl.textContent = `boot failed: ${err.message}`;
});
