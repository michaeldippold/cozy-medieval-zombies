// Apple trees (#190; Michael, 2026-10-18: apples "come from certain trees and be pickable in some fashion and this makes it part of
// production, which needs to be upkept"). From the console, on a tab with `?nosave`:
//   await __game.check("apples")
// It goes to the orchard, picks a tree by the verb and by the menu entry (a guest's path: the label on the prop's address), watches the
// tree go bare and bear again on its day, chops one, and puts the player, the clock, the bag, and the tree back.

export async function run(game) {
  const G = game;
  const rows = [];
  const row = (check, ok, detail) => rows.push({ check, result: ok ? "pass" : "FAIL", detail });
  const me = G.player;
  const meAt = [me.gx, me.gy];
  const bag = G.inventory.bagOf(me);
  const bag0 = bag.items.slice();
  const clock0 = G.clock.getElapsed();
  const wasPaused = G.loop.isPaused();
  const fruit = await import("/src/fruit.js");
  const restore = [];
  const apples = () => bag.items.filter((e) => e.id === "apple").reduce((n, e) => n + e.count, 0);
  const treeAt = (x, y) => G.map.tileAt(x, y).prop;
  try {
    G.loop.setPaused(true);
    G.map.ensureAround(46, 240, 4);
    const orchard = G.map.allProps().filter((p) => p.sprite === "tree_apple" || p.sprite === "tree_apple_bare");
    const inOrchard = orchard.filter((p) => p.tile[0] >= 38 && p.tile[0] < 54 && p.tile[1] >= 232 && p.tile[1] < 250);
    row("the orchard stands: twenty apple trees in rows at Hollow Farm", inOrchard.length === 20, `${inOrchard.length}`);
    G.map.ensureAround(60, 70, 4);
    const gardens = G.map.allProps().filter((p) => p.sprite === "tree_apple" && p.tile[1] < 232);
    row("and a few trees in cottage gardens, reachable early", gardens.length >= 3, `${gardens.length}`);

    const tree = inOrchard.find((p) => p.sprite === "tree_apple");
    const [tx, ty] = tree.tile;
    const stand = [tx + 1.0, ty + 0.2];
    G.teleport(stand[0], stand[1]);
    const def = G.assets.getDef("tree_apple");
    row("it is a gatherable: outlined and interactable, with wood to chop, and a pick block in data", def.interactable === true && def.wood > 0 && def.pick && def.pick.count && def.pick.days > 0, JSON.stringify(def.pick));

    const label = `Pick ${G.items.getItem("apple").name.toLowerCase()}s`;
    const actions = () => G.interact.actionsForProp(tree, me);
    row("the menu offers Pick apples, and Chop down", actions().some((a) => a.label === label && a.enabled) && actions().some((a) => a.label.startsWith("Chop down")), actions().map((a) => a.label).join(", "));

    // The verb, as the menu's timed action and a guest's command both run it.
    const before = apples();
    const r = G.verbs.run("pick", G.world, me, { prop: tree.id });
    const got = apples() - before;
    const [lo, hi] = def.pick.count;
    row("picking gives the apples (a count in data) into the bag", r.ok && got >= lo && got <= hi, `got ${got} of ${lo} to ${hi}`);
    row("and the tree is bare, with the day it bears again set three days on", tree.sprite === "tree_apple_bare" && Math.abs(tree.regrowAt - (G.clock.getElapsed() + def.pick.days * G.clock.DAY_LENGTH)) < 1, `${tree.sprite}, regrowAt ${tree.regrowAt}`);
    const again = G.verbs.run("pick", G.world, me, { prop: tree.id });
    row("a second pick finds it bare and gets nothing", !again.ok && apples() === before + got, String(again.reason));
    const bareMenu = actions();
    row("a bare tree says when it will bear, and offers no pick", bareMenu.some((a) => /^Bare \(fruit in about 3 days\)/.test(a.label) && a.enabled === false) && !bareMenu.some((a) => a.label === label), bareMenu.map((a) => a.label).join(", "));
    row("its chunk is marked, so a guest has the bare tree (touched, saved with the prop)", JSON.stringify(G.map.serializeProp(tree)).includes("regrowAt"), "regrowAt is in the prop's record");
    const copy = { ...JSON.parse(JSON.stringify(G.map.serializeProp(tree))), id: "p_apples_check" }; // another id: reviving under the tree's own would take it out of the registry
    const revived = G.map.reviveProp(copy, false);
    row("the saved prop comes back bare with its day", revived.sprite === "tree_apple_bare" && revived.regrowAt === tree.regrowAt, `${revived.sprite} ${revived.regrowAt}`);

    // Time: bare until its day, then it bears again at the next look.
    const day = tree.regrowAt;
    G.clock.setElapsed(day - 40);
    fruit.reset();
    G.game.begin(0);
    row("a day short it is still bare", tree.sprite === "tree_apple_bare", tree.sprite);
    G.clock.setElapsed(day + 31);
    G.game.begin(0);
    row("past its day it bears again, with no day left on it", tree.sprite === "tree_apple" && tree.regrowAt === undefined, `${tree.sprite} ${tree.regrowAt}`);

    // A guest's way: the label on the prop's address, run on the host.
    const before2 = apples();
    const did = G.interact.performByLabel(me, { kind: "prop", id: tree.id }, label);
    // the action walks if needed and runs timed: finish it
    for (let i = 0; i < 200 && me.action; i++) G.interact.updateAction(me, 1 / 30);
    row("a guest's command (the label on the prop's id) picks it too", did === true && apples() > before2 && tree.sprite === "tree_apple_bare", `ran ${did}, +${apples() - before2}, ${tree.sprite}`);

    // Chopping a bare tree: logs, the tree gone, the fruit lost.
    const logsAt = () => G.map.itemsAt(tx, ty).filter((e) => e.id === "log").reduce((n, e) => n + e.count, 0);
    const chop = actions().find((a) => a.label.startsWith("Chop down"));
    chop.perform();
    row("chopping it is any tree's: logs on the ground and the tree gone", logsAt() >= def.wood && !treeAt(tx, ty), `${logsAt()} logs, prop ${treeAt(tx, ty) ? treeAt(tx, ty).sprite : "gone"}`);
    restore.push(() => {
      const p = G.map.createProp({ sprite: "tree_apple", tile: [tx, ty] });
      G.map.placeProp(p, tx, ty);
      for (const e of [...G.map.itemsAt(tx, ty)]) if (e.id === "log") G.map.takeItem(tx, ty, e);
    });
  } finally {
    for (const r of restore.reverse()) r();
    G.clock.setElapsed(clock0);
    fruit.reset();
    bag.items.splice(0, bag.items.length, ...bag0);
    G.teleport(meAt[0], meAt[1]);
    G.loop.setPaused(wasPaused);
  }
  for (const r of rows) console.log(`${r.result}  ${r.check}  (${r.detail})`);
  return { rows, passed: rows.filter((r) => r.result === "pass").length, total: rows.length };
}
