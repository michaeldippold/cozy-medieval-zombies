// The save's cache proved (2026-10-15, `02`: a save that costs what changed). Boots the valley headless, grows all of
// it and a ring of the wild (a well-explored world), then makes every kind of change a chunk can take through the
// game's own mutators, stepping between them, and after each compares three saves character for character: the
// cached text (game.serializeText, what the server writes), the cached object as text (game.serialize, what the
// browser stores and a guest receives), and the whole world made afresh. Then a change made behind the cache's back
// (a prop's field set with no mark) must be caught by game.verifySaveCache, or the check proves nothing. Prints the
// times and the cache's counts. From the repo's root:
//   node tools/savecache.js
// The headless suite runs it (tools/check.js).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { bootData } = await import("../server/boot.js");
const [map, game, loop, interact, stations, save, clock] = await Promise.all([
  import("../src/map.js"), import("../src/game.js"), import("../src/loop.js"), import("../src/interact.js"), import("../src/stations.js"), import("../src/save.js"), import("../src/clock.js"),
]);
await bootData(root);
const json = JSON.parse(fs.readFileSync(path.join(root, "data/maps/valley.json"), "utf8"));
game.create({ json });
loop.init({ update: (dt) => { game.begin(dt); game.step(dt, game.idleSnapshot()); }, render: () => {} });

const fail = (msg) => { console.log(`FAIL: ${msg}`); process.exit(1); };
const W = Math.ceil((json.width || 256) / map.CHUNK), H = Math.ceil((json.height || 256) / map.CHUNK);
for (let cy = -2; cy < H + 2; cy++) for (let cx = -2; cx < W + 2; cx++) map.getChunk(cx, cy);
const steps = (n) => { for (let i = 0; i < n; i++) loop.advance(1 / 60); };
steps(30);

let compared = 0;
const same = (what) => {
  const fresh = JSON.stringify(game.serialize({ fresh: true }));
  const text = game.serializeText();
  const obj = JSON.stringify(game.serialize());
  for (const [name, got] of [["the cached text", text], ["the cached object", obj]]) {
    if (got === fresh) continue;
    let i = 0;
    while (i < got.length && got[i] === fresh[i]) i++;
    fail(`after ${what}, ${name} differs from the world made afresh at character ${i}:\n  cached ${got.slice(Math.max(0, i - 80), i + 80)}\n  fresh  ${fresh.slice(Math.max(0, i - 80), i + 80)}`);
  }
  compared++;
};
same("the boot");

// What the valley offers, found once.
const props = map.allProps();
const tiles = [];
map.eachChunk((c) => tiles.push(c));
let door = null;
for (const c of tiles) {
  for (const t of c.tiles) {
    for (const e of ["n", "w"]) if (!door && t[e] && t[e].kind === "door" && !t[e].broken) door = t[e];
  }
}
const p = game.state.player;
const done = [];
// A chunk with no lit fire and no station at work: a fire's or a job's own mark remakes its chunk every step, which
// would hide a change elsewhere in it that marked nothing.
const chunkOf = (x, y) => `${Math.floor(x / map.CHUNK)},${Math.floor(y / map.CHUNK)}`;
const busy = () => new Set(map.allProps().filter((q) => (q.fire && q.fire.lit) || (q.queue && q.queue.length)).map((q) => chunkOf(q.tile[0], q.tile[1])));
const quiet = (x, y) => !busy().has(chunkOf(x, y));
const did = (what, n = 20) => { steps(n); same(what); done.push(what); };

// A floor, an item down and taken up, a wall built and destroyed, a prop placed and removed.
const [px, py] = [Math.round(p.gx), Math.round(p.gy)];
map.setFloor(px + 3, py + 3, "floor_dirt"); did("a floor set");
const e = map.dropItem(px + 2, py + 2, { id: "stick", count: 1 }); did("an item dropped");
map.takeItem(px + 2, py + 2, e); did("an item taken");
if (map.canBuildWall(px + 5, py + 5, "n")) { map.buildWall(px + 5, py + 5, "n", "wall"); did("a wall built"); map.destroyWall(px + 5, py + 5, "n"); did("a wall destroyed"); }
const at = [px + 4, py - 3];
const bench = map.createProp({ sprite: "workbench", tile: at, footprint: [1, 1] });
map.placeProp(bench, at[0], at[1]); did("a prop placed");
// A door: opened as the interface opens it, hit short of breaking (the wire never sends that), boarded.
if (!door) fail("the valley has no door to try");
door.open = !door.open; map.touch(door.at[0], door.at[1]); did("a door opened");
map.damageOpening(door, 1, 1); did("a door hit short of breaking");
door.open = false; map.touch(door.at[0], door.at[1]);
map.addBoard(door, 1); did("a board nailed");
map.damageOpening(door, 1, 1); did("a board hit short of breaking");
// A fire fed and burning between its units (the save's copy only), a holder's torch.
const burner = props.find((q) => q.fire && q.fire.burns);
if (!burner) fail("no burner in the valley");
map.feedFire(burner); did("a fire fed", 90);
did("a fire burning between units", 200);
// The valley's posts are lanterns now (#156), so a torch post is made for the change, and an empty bracket is looked for.
let holder = [...map.allProps()].find((q) => q.fire && q.fire.holds);
let madePost = null;
if (!holder) {
  const hx = Math.round(p.gx) + 3;
  const hy = Math.round(p.gy);
  madePost = map.createProp({ sprite: "torch_post", tile: [hx, hy] });
  map.placeProp(madePost, hx, hy);
  holder = madePost;
}
map.setHolder({ kind: "prop", prop: holder }, !holder.fire.has); did("a holder's torch changed");
if (madePost) { map.removeProp(madePost); did("the post taken away"); }
const bracket = [...map.brackets()].find((b) => !b.wall.bracket.lantern);
if (!bracket) fail("no bracket for a torch in the valley");
map.setHolder({ kind: "bracket", bracket }, !bracket.wall.bracket.torch); did("a bracket's torch changed");
// A sway's stamp, a container's bag made on first use, a station's job counting down and landing.
// The bench moved to a quiet chunk first, then the stamp in another, the player stepped away before the world steps.
map.removeProp(bench);
const benchAt = tiles.map((c) => [c.cx * map.CHUNK + 8, c.cy * map.CHUNK + 8]).find(([x, y]) => quiet(x, y) && !map.tileAt(x, y).prop && map.isWalkableTile(x, y));
if (!benchAt) fail("no quiet chunk for the bench");
bench.tile = benchAt;
map.placeProp(bench, benchAt[0], benchAt[1]); did("a prop moved");
const [hx, hy] = [p.gx, p.gy];
const swayer = props.find((q) => q.interactable && !q.fire && !q.container && quiet(q.tile[0], q.tile[1]) && chunkOf(q.tile[0], q.tile[1]) !== chunkOf(benchAt[0], benchAt[1]) && chunkOf(q.tile[0], q.tile[1]) !== chunkOf(hx, hy));
if (!swayer) fail("no quiet thing to sway");
p.gx = swayer.tile[0] + 0.5; p.gy = swayer.tile[1] + 1;
const pokedBefore = swayer.pokedAt;
if (!interact.stampFromGuest(p, swayer.id, 0) || swayer.pokedAt === pokedBefore) fail(`the sway was not stamped (${swayer.sprite}, ${pokedBefore} to ${swayer.pokedAt})`);
p.gx = hx; p.gy = hy;
did("a sway stamped", 2);
const chest = props.find((q) => q.container && !q.bag);
if (chest) { interact.propBag(chest); did("a container's bag made"); }
const r = stations.recipe("handle");
stations.start(p, bench, r, 2); did("a station's job started", 30);
if (!bench.queue || !bench.queue.length) fail("the station took no job");
did("a station's job counting down", 60);
did("a station's job landing", 200);
// The wild dropped and grown again, a whole-world touch.
map.evictFar(p.gx, p.gy, 3); did("the far wild evicted");
for (let cy = -2; cy < H + 2; cy++) for (let cx = -2; cx < W + 2; cx++) map.getChunk(cx, cy);
did("the wild grown again");
map.touch(); did("the whole world touched");
map.removeProp(bench); did("a prop removed");
// A fruit tree picked bare (its sprite and the day it bears again change with no other mark), and bearing again on that day (fruit.js).
const apple = map.allProps().find((q) => q.sprite === "tree_apple");
if (!apple) fail("the valley has no apple tree");
map.restage(apple, "tree_apple_bare", clock.getElapsed() + 2 * clock.DAY_LENGTH); did("a fruit tree picked bare");
clock.setElapsed(clock.getElapsed() + 3 * clock.DAY_LENGTH); did("a fruit tree bearing again", 120);
if (apple.sprite !== "tree_apple" || apple.regrowAt !== undefined) fail(`the apple tree did not bear again (${apple.sprite}, ${apple.regrowAt})`);
// A torch burning down in a bracket: its wear changes every step and only the save's copy of the chunk hears (map.burnHolders).
const mount = [...map.brackets()].find((b) => !b.wall.bracket.torch) || [...map.brackets()][0];
if (!mount) fail("the valley has no bracket for a mounted torch");
const mountTarget = { kind: "bracket", bracket: mount, mx: mount.tx, my: mount.ty };
map.setHolder(mountTarget, true, { wear: 0.2, lit: true }); did("a torch mounted, lit");
did("a mounted torch burning down", 200);
map.setHolder(mountTarget, false); did("the torch taken out");

// The save as the server writes it: the snapshot's text, the same characters as the object's.
const extra = { worldId: "w", name: "n", owners: {}, dormant: {}, myPlayerId: null, server: true };
const st = save.snapshotText("valley", extra);
const so = JSON.stringify({ ...save.snapshot("valley", extra), savedAt: JSON.parse(st).savedAt });
if (st !== so) fail("the snapshot's text is not the snapshot's object as text");

// A change behind the cache's back is caught, and saved right after.
const sneaky = props.find((q) => q.container && q !== chest) || props.find((q) => q.interactable);
game.serializeText();
sneaky.searched = !sneaky.searched;
const caught = game.verifySaveCache();
if (caught.length !== 1) fail(`a change with no mark was not caught (verifySaveCache gave ${caught.length})`);
same("the change with no mark, after the cache was proved");
sneaky.searched = !sneaky.searched;
map.unsaved(sneaky.tile[0], sneaky.tile[1], false);

// The times, on this world.
const t = (f) => { const a = performance.now(); f(); return performance.now() - a; };
const fresh = Math.min(...[0, 1, 2].map(() => t(() => JSON.stringify(game.serialize({ fresh: true })))));
const cachedText = Math.min(...[0, 1, 2].map(() => t(() => game.serializeText())));
const cachedObj = Math.min(...[0, 1, 2].map(() => t(() => game.serialize())));
const kb = Math.round(game.serializeText().length / 1024);
console.log(`savecache: ${done.length} kinds of change, ${compared} comparisons, the same each time; a change with no mark caught; ${map.chunkCount()} chunks, ${kb} KB`);
console.log(`savecache: afresh ${fresh.toFixed(1)} ms, cached text ${cachedText.toFixed(1)} ms, cached object ${cachedObj.toFixed(1)} ms; chunks made ${map.saveCacheCount.made}, kept ${map.saveCacheCount.kept}`);
