// The light verb (Michael, 2026-10-17, #156: "fire lights what is made to be lit"): a tinderbox or a lit torch used on an unlit
// campfire with fuel, a torch on a post, a torch in a bracket that is out, or an unlit torch in a hand lights it (and an unlit torch
// used on a burning fire is lit from it), and nothing else burns (not a hearth, an oven, or a forge); not through a wall, not from
// afar; every refusal says why. It runs through data/interactions.json and the verb table (use.applyWith, the path a guest's Use
// takes on the host) and through the holder's menu. From the console, on a tab with `?nosave`:
//   await __game.check("kindle")
// It builds on open ground and puts everything it made or moved back.

export async function run(game) {
  const G = game;
  const rows = [];
  const row = (check, ok, detail) => rows.push({ check, result: ok ? "pass" : "FAIL", detail });
  const wasPaused = G.loop.isPaused();
  const me = G.player;
  const meAt = [me.gx, me.gy];
  const hands0 = { main: me.hands.main, off: me.hands.off };
  const bag = G.inventory.bagOf(me);
  const bagItems0 = bag.items.slice();
  const restore = [];
  const mk = (id, props = {}) => G.items.makeEntry(id, 1, props);
  const run = (target) => G.verbs.run("light", G.world, me, target);
  // The bracket Use mode finds under the cursor at a bracket's own point (what main.js's useTargetAt asks), so the Use rows go through it.
  const viaCursor = (b) => { const p = G.iso.toScreen(...G.map.bracketPos(b)); return G.interact.bracketAt(p.x, p.y); };
  const lastLine = async () => (await import("/src/ui/log.js")).lines().slice(-1)[0] || "";
  // A point `d` tiles from a bracket's wall edge, on the bracket's side (negative: the far side).
  const nearSide = (b, d) => {
    const e0 = b.edge === "n" ? b.ty - 0.5 : b.tx - 0.5;
    const s = b.wall.bracket.side;
    return b.edge === "n" ? [b.tx, e0 + s * d] : [e0 + s * d, b.ty];
  };
  try {
    G.loop.setPaused(true);
    let c = null;
    for (let y = 120; y < 240 && !c; y += 3) {
      for (let x = 30; x < 230 && !c; x += 3) {
        G.map.ensureAround(x, y, 2);
        let clear = true;
        for (let dy = -3; dy <= 3 && clear; dy++) for (let dx = -3; dx <= 5 && clear; dx++) clear = G.map.isWalkableTile(x + dx, y + dy) && G.map.tileAt(x + dx, y + dy).room === 0 && !G.map.tileAt(x + dx, y + dy).prop && !G.map.tileAt(x + dx, y + dy).n && !G.map.tileAt(x + dx, y + dy).w;
        if (clear) c = [x, y];
      }
    }
    if (!c) {
      row("open ground was found", false, "none in the loaded map");
      return finish();
    }
    const [cx, cy] = c;
    G.teleport(cx, cy);
    me.hands.main = null;
    me.hands.off = null;
    const box = mk("tinderbox");
    G.inventory.stow(me, box);
    restore.push(() => G.inventory.detach(me, box)); // the one this test added; the kit's own is never touched but for a moment below
    const prop = (sprite, x, y, extra = {}) => { const p = G.map.createProp({ sprite, tile: [x, y], ...extra }); G.map.placeProp(p, x, y); restore.push(() => G.map.removeProp(p)); return p; };
    const use = (entry, target) => G.use.applyWith(entry, target, me);

    // A campfire: with fuel it is lit by a tinderbox through the interaction row; with none it is not; lit, it says so.
    const fire = prop("campfire", cx + 1, cy, { fuel: 2, lit: false });
    use(box, { kind: "prop", prop: fire });
    row("a tinderbox used on a campfire with fuel lights it", fire.fire.lit === true, `lit ${fire.fire.lit}`);
    const again = run({ prop: fire, entry: box.uid });
    row("one already burning is refused, with its reason", !again.ok && /already burning/.test(again.reason), String(again.reason));
    const dry = prop("campfire", cx + 1, cy + 2, { fuel: 0, lit: false });
    const nothing = run({ prop: dry.id, entry: box.uid });
    row("one with nothing to burn is refused, and stays out", !nothing.ok && !dry.fire.lit && /nothing to burn/.test(nothing.reason), String(nothing.reason));

    // A lantern post is a flame too (#175): an unlit torch held to it is lit; the post stays lit.
    const lpost = prop("lantern_post", cx + 3, cy - 2);
    const taperP = mk("torch", { lit: false, wear: 0 });
    me.hands.main = taperP;
    G.teleport(cx + 1.8, cy - 2);
    use(taperP, { kind: "prop", prop: lpost });
    row("an unlit torch held to a lantern post is lit from it (and the post is lit still)", taperP.lit === true && lpost.fire.lit === true, `torch lit ${taperP.lit}, post lit ${lpost.fire.lit}`);
    // A lantern post is always lit: a tinderbox or a lit torch on it says so (the word a lantern bracket uses), not "Nothing interesting
    // happens" or "That cannot be lit".
    {
      const tp = { prop: lpost.id };
      const withBox = run({ ...tp, entry: box.uid });
      const litTorch = mk("torch", { lit: true, wear: 0 });
      me.hands.main = litTorch;
      const withTorch = run({ ...tp, entry: litTorch.uid });
      me.hands.main = null;
      row("a tinderbox or a lit torch on a lantern post says it is always lit", !withBox.ok && /always lit/.test(withBox.reason) && !withTorch.ok && /always lit/.test(withTorch.reason), `${withBox.reason} / ${withTorch.reason}`);
      use(box, { kind: "prop", prop: lpost });
      row("Use of the tinderbox on a lantern post says so too, not 'Nothing interesting happens'", /always lit/.test(await lastLine()), `"${await lastLine()}"`);
    }
    me.hands.main = null;

    // Not a hearth, an oven, or a forge: only a campfire or a torch.
    const hearth = prop("fireplace", cx + 1, cy - 2, { fuel: 2, lit: false });
    use(box, { kind: "prop", prop: hearth });
    const noHearth = run({ prop: hearth.id, entry: box.uid });
    row("a fireplace with fuel is not lit by a tinderbox (a campfire or a torch only)", !noHearth.ok && !hearth.fire.lit, String(noHearth.reason));

    // A fire's own menu needs a flame carried too (Michael, 2026-10-17, #168): a campfire, a fireplace, an oven, a forge, each with fuel
    // and without a flame, then with a tinderbox (the rule is `inventory.flameOf`, the verb's).
    const menuLight = (p) => G.interact.actionsForProp(p, me).find((a) => /^Light the/.test(a.label));
    const kinds = ["campfire", "fireplace", "oven", "forge"];
    for (let i = 0; i < kinds.length; i++) {
      const kind = kinds[i];
      const p = prop(kind, cx + 4, cy - 3 + i * 2, { fuel: 0, lit: false });
      const fuelId = p.fire.fuelItem;
      const fuel = mk(fuelId);
      G.inventory.stow(me, fuel);
      restore.push(() => G.inventory.detach(me, fuel));
      const boxes = bag.items.filter((e) => e.id === "tinderbox");
      const onBelt = (G.inventory.beltOf(me) || []).map((e, k) => (e && e.id === "tinderbox" ? [k, e] : null)).filter(Boolean); // a belt tinderbox is a flame too
      for (const e of boxes) G.inventory.detach(me, e);
      for (const [, e] of onBelt) G.inventory.detach(me, e);
      const a0 = menuLight(p);
      const msgEl = document.getElementById("message");
      if (msgEl) msgEl.textContent = "";
      const said = a0 ? a0.perform() : null;
      const text = msgEl ? msgEl.textContent : "";
      const noFlame = !!a0 && said === false && a0.simple === false && !p.fire.lit && G.inventory.countAll(me, fuelId) >= 1 && /flame/.test(a0.label) && /You need a tinderbox or a lit torch to light it/.test(text);
      for (const e of boxes) G.inventory.stow(me, e);
      for (const [k, e] of onBelt) G.inventory.beltOf(me)[k] = e;
      const a1 = menuLight(p);
      const did = a1 ? a1.perform() : null;
      row(`a ${kind} cannot be lit from its menu with fuel and no flame, and can with a tinderbox`, noFlame && did === true && p.fire.lit === true, `no flame: ${a0 && a0.label}, simple ${a0 && a0.simple}, said "${text}"; with: lit ${p.fire.lit}`);
    }
    // A lit torch in a hand is a flame too; a fire that is burning is fed with none.
    const wood = prop("campfire", cx + 3, cy + 3, { fuel: 0, lit: false });
    const flameTorch = mk("torch", { lit: true, wear: 0 });
    const boxes2 = bag.items.filter((e) => e.id === "tinderbox");
    for (const e of boxes2) G.inventory.detach(me, e);
    const log = mk("log");
    G.inventory.stow(me, log);
    restore.push(() => G.inventory.detach(me, log));
    me.hands.main = flameTorch;
    const byTorch = menuLight(wood);
    byTorch.perform();
    row("a lit torch in the hand is a flame for a fire's menu", wood.fire.lit === true, `lit ${wood.fire.lit}`);
    me.hands.main = null;
    const log2 = mk("log");
    G.inventory.stow(me, log2);
    restore.push(() => G.inventory.detach(me, log2));
    const feed = G.interact.actionsForProp(wood, me).find((a) => /^Feed the/.test(a.label));
    const fed = feed ? feed.perform() : null;
    row("a burning fire is fed with no flame carried", fed === true, `fed ${fed}`);
    for (const e of boxes2) G.inventory.stow(me, e);

    // An unlit torch in a hand used on a burning fire is lit from it; on one that is out, it is not.
    const taper = mk("torch", { lit: false, wear: 0 });
    me.hands.main = taper;
    const outFire = prop("campfire", cx + 1, cy + 3, { fuel: 2, lit: false });
    const fromOut = run({ prop: outFire.id, entry: taper.uid });
    row("an unlit torch used on a fire that is out is no flame", !fromOut.ok && taper.lit !== true, String(fromOut.reason));
    use(taper, { kind: "prop", prop: fire });
    row("an unlit torch used on a burning campfire is lit from it", taper.lit === true, `lit ${taper.lit}`);
    me.hands.main = null;

    // A torch on a post, by a lit torch in the hand.
    const post = prop("torch_post", cx + 2, cy);
    G.map.setHolder({ kind: "post", prop: post }, true, mk("torch", { lit: false, wear: 0.1 }));
    const lit = mk("torch", { lit: true, wear: 0 });
    me.hands.main = lit;
    use(lit, { kind: "prop", prop: post });
    row("a lit torch used on a mounted torch that is out lights it", post.fire.lit === true, `lit ${post.fire.lit}`);

    // An unlit torch in the other hand, by the lit one; and one in the bag is refused.
    const cold = mk("torch", { lit: false, wear: 0 });
    me.hands.off = cold;
    use(lit, { kind: "item", entry: cold });
    row("a lit torch used on an unlit torch in a hand lights it", cold.lit === true, `lit ${cold.lit}`);
    const stowed = mk("torch", { lit: false, wear: 0 });
    G.inventory.stow(me, stowed);
    restore.push(() => G.inventory.detach(me, stowed));
    const inBag = run({ onEntry: stowed.uid, entry: box.uid });
    row("a torch in the bag is refused (it burns only where it is used)", !inBag.ok && !stowed.lit, String(inBag.reason));

    // An unlit torch is no flame.
    me.hands.off = null;
    const unlit = mk("torch", { lit: false, wear: 0 });
    me.hands.main = unlit;
    const post2 = prop("torch_post", cx + 2, cy + 2);
    G.map.setHolder({ kind: "post", prop: post2 }, true, mk("torch", { lit: false }));
    const noFlame = run({ prop: post2, entry: unlit.uid });
    row("an unlit torch gives no flame", !noFlame.ok && !post2.fire.lit && /no flame/.test(noFlame.reason), String(noFlame.reason));
    me.hands.main = null;

    // A bracket, by the holder's menu: refused with no flame, lit with a tinderbox; a lantern never.
    const bracket = [...G.map.brackets()].find((b) => !b.wall.bracket.torch && !b.wall.bracket.lantern);
    if (bracket) {
      const target = { kind: "bracket", bracket, mx: bracket.tx, my: bracket.ty };
      G.map.setHolder(target, true, mk("torch", { lit: false, wear: 0.2 }));
      restore.push(() => G.map.setHolder(target, false));
      G.teleport(bracket.tx + (bracket.edge === "w" ? 1.2 : 0), bracket.ty + (bracket.edge === "n" ? 1.2 : 0));
      const own = bag.items.filter((e) => e.id === "tinderbox" && e !== box); // the starting kit's: no flame at all, put back after
      for (const e of own) G.inventory.detach(me, e);
      G.inventory.detach(me, box);
      restore.push(() => { for (const e of own) G.inventory.stow(me, e); });
      const addr = { kind: "bracket", tx: bracket.tx, ty: bracket.ty, edge: bracket.edge };
      const menu = () => G.interact.actionsForTarget(addr, me).find((a) => a.label === "Light the torch");
      const none = menu();
      const noBox = none && none.perform();
      row("the holder's menu lights nothing with no flame on you", !!none && noBox === false && bracket.wall.bracket.lit === false, `lit ${bracket.wall.bracket.lit}`);
      const where = G.inventory.stow(me, box);
      const act = menu();
      if (act) act.perform();
      else row("the holder's menu offers Light", false, `box stowed ${where}; menu ${G.interact.actionsForTarget(addr, me).map((a) => a.label).join(", ")}`);
      row("and lights the torch in the bracket with a tinderbox", bracket.wall.bracket.lit === true, `lit ${bracket.wall.bracket.lit}`);
      row("a lit one offers no Light", !menu(), "the menu entry is gone");
      // By Use (#170): Use can target a bracket, and a lit torch in one is a flame like a post's.
      bracket.wall.bracket.lit = false;
      row("Use mode finds the bracket under the cursor", viaCursor(bracket) === bracket, `${viaCursor(bracket) ? "found" : "none"}`);
      // The Use label names what hangs there (#177).
      const names = await import("/src/interactions.js");
      const lanternB = [...G.map.brackets()].find((b) => b.wall.bracket.lantern);
      row("a Use on a bracket is labelled for what is there: the torch, the lantern, the empty bracket", names.nameOfTarget({ kind: "bracket", bracket }) === "the torch in the bracket" && (!lanternB || names.nameOfTarget({ kind: "bracket", bracket: lanternB }) === "the lantern"), `${names.nameOfTarget({ kind: "bracket", bracket })}${lanternB ? `, ${names.nameOfTarget({ kind: "bracket", bracket: lanternB })}` : ""}`);
      use(box, { kind: "bracket", bracket: viaCursor(bracket) });
      row("a tinderbox used on a mounted torch that is out lights it (Use targets a bracket)", bracket.wall.bracket.lit === true, `lit ${bracket.wall.bracket.lit}`);
      const taper2 = mk("torch", { lit: false, wear: 0 });
      me.hands.main = taper2;
      use(taper2, { kind: "bracket", bracket: viaCursor(bracket) });
      row("an unlit torch in the hand used on the lit torch in a bracket is lit from it", taper2.lit === true, `lit ${taper2.lit}`);
      bracket.wall.bracket.lit = false;
      const taper3 = mk("torch", { lit: false, wear: 0 });
      me.hands.main = taper3;
      const refused3 = run({ bracket: addr, entry: taper3.uid });
      row("and not from one that is out (no flame)", !refused3.ok && taper3.lit !== true && /no flame/.test(refused3.reason), String(refused3.reason));
      me.hands.main = null;
      bracket.wall.bracket.lit = true;
      G.teleport(bracket.tx + (bracket.edge === "w" ? 6 : 0), bracket.ty + (bracket.edge === "n" ? 6 : 0));
      bracket.wall.bracket.lit = false;
      const far = run({ bracket: addr, entry: box.uid });
      row("too far away is refused, and the torch stays out", !far.ok && /far/.test(far.reason) && bracket.wall.bracket.lit === false, String(far.reason));
    } else row("an empty bracket for the menu test", false, "none in the loaded map");
    const lantern = [...G.map.brackets()].find((b) => b.wall.bracket.lantern);
    if (lantern) {
      G.teleport(lantern.tx + (lantern.edge === "w" ? 1.2 : 0), lantern.ty + (lantern.edge === "n" ? 1.2 : 0));
      const l = run({ bracket: { tx: lantern.tx, ty: lantern.ty, edge: lantern.edge }, entry: box.uid });
      row("a lantern is always lit: nothing to light", !l.ok && /lantern/.test(l.reason), String(l.reason));
      // By Use, through the cursor: a lantern and an empty bracket are targets too, each with its own word (not "Nothing interesting happens").
      const onLantern = viaCursor(lantern);
      use(box, { kind: "bracket", bracket: onLantern });
      row("Use on a lantern is a target of its own: it says it is always lit", onLantern === lantern && /always lit/.test(await lastLine()), `found ${onLantern === lantern}; "${await lastLine()}"`);
      // A lantern is a flame (Michael, 2026-10-17, #175: "Sure why not."): an unlit torch held to it is lit from it; it stays lit and unchanged.
      const taperL = mk("torch", { lit: false, wear: 0 });
      me.hands.main = taperL;
      const lanternRecord = JSON.stringify(lantern.wall.bracket); // the whole record, not one field of it
      use(taperL, { kind: "bracket", bracket: viaCursor(lantern) });
      row("an unlit torch held to a lantern bracket is lit from it (and the lantern is as it was)", taperL.lit === true && JSON.stringify(lantern.wall.bracket) === lanternRecord && /at the lantern/.test(await lastLine()), `torch lit ${taperL.lit}; "${await lastLine()}"`);
      me.hands.main = null;
      // A guest's Use goes to the host as an address (inventory-actions.performUseCommand): the tinderbox in the bag by uid, the lantern by its edge.
      if (!bag.items.includes(box)) G.inventory.stow(me, box);
      const performUse = (await import("/src/ui/inventory-actions.js")).performUseCommand;
      const byGuest = performUse(me, { uid: box.uid, src: { kind: "bag", bag: { mine: true } }, target: { kind: "bracket", tx: lantern.tx, ty: lantern.ty, edge: lantern.edge } });
      row("a guest's Use of the tinderbox on the lantern, by address, says it is always lit and changes nothing", byGuest === true && /always lit/.test(await lastLine()) && JSON.stringify(lantern.wall.bracket) === lanternRecord, `ran ${byGuest}; "${await lastLine()}"`);
      // Not through a wall (the one rule): from the far side of the lantern's wall, if there is room on both sides.
      // A lantern with room on both sides of its wall, found as the torch bracket is below; none is a failure, not a skipped row.
      const walledL = [...G.map.brackets()].find((b) => b.wall.bracket.lantern && [nearSide(b, 0.8), nearSide(b, -0.8)].every(([px, py]) => G.map.isWalkableTile(Math.round(px), Math.round(py))));
      if (walledL) {
        const taperF = mk("torch", { lit: false, wear: 0 });
        me.hands.main = taperF;
        const [fx, fy] = nearSide(walledL, -0.8);
        G.teleport(fx, fy);
        const behindL = run({ bracket: { tx: walledL.tx, ty: walledL.ty, edge: walledL.edge }, entry: taperF.uid });
        row("but not through the wall from its far side", !behindL.ok && /wall/.test(behindL.reason) && taperF.lit !== true, String(behindL.reason));
        me.hands.main = null;
      } else row("a lantern bracket with room on both sides for the far-side row", false, "none in the loaded map");
    } else row("a lantern bracket for the always-lit row", false, "none in the loaded map (the lanterns are #164's)");


    // Not through a wall: a torch in a bracket from the far side of its wall, a campfire on the other side of one.
    const walled = [...G.map.brackets()].find((b) => {
      if (b.wall.bracket.torch || b.wall.bracket.lantern) return false;
      const [x, y] = nearSide(b, 0.8);
      const [fx, fy] = nearSide(b, -0.8);
      return [[x, y], [fx, fy]].every(([px, py]) => G.map.isWalkableTile(Math.round(px), Math.round(py)));
    });
    if (walled) {
      const t = { kind: "bracket", bracket: walled, mx: walled.tx, my: walled.ty };
      G.map.setHolder(t, true, mk("torch", { lit: false, wear: 0.2 }));
      restore.push(() => G.map.setHolder(t, false));
      const addr = { tx: walled.tx, ty: walled.ty, edge: walled.edge };
      if (!bag.items.includes(box)) G.inventory.stow(me, box);
      const [bx, by] = nearSide(walled, -0.8);
      G.teleport(bx, by);
      const behind = run({ bracket: addr, entry: box.uid });
      row("a torch in a bracket cannot be lit from the far side of its wall", !behind.ok && /wall/.test(behind.reason) && walled.wall.bracket.lit === false, String(behind.reason));
      const [sx, sy] = nearSide(walled, 0.8);
      G.teleport(sx, sy);
      const beside = run({ bracket: addr, entry: box.uid });
      row("and is lit from its own side, as close as that", beside.ok && walled.wall.bracket.lit === true, `lit ${walled.wall.bracket.lit}`);
      // An unlit torch held to the lit torch from the far side of the wall is not lit from it.
      const taper4 = mk("torch", { lit: false, wear: 0 });
      me.hands.main = taper4;
      G.teleport(bx, by);
      const wallFlame = run({ bracket: addr, entry: taper4.uid });
      row("an unlit torch held to a lit bracket torch from the far side of its wall is not lit", !wallFlame.ok && /wall/.test(wallFlame.reason) && taper4.lit !== true, String(wallFlame.reason));
      me.hands.main = null;
      G.teleport(sx, sy);
      // A campfire on one side of the same wall, the player on the other.
      const [tx0, ty0] = walled.edge === "n" ? [walled.tx, walled.ty + (walled.wall.bracket.side > 0 ? 0 : -1)] : [walled.tx + (walled.wall.bracket.side > 0 ? 0 : -1), walled.ty];
      if (!G.map.tileAt(tx0, ty0).prop) {
        const wf = prop("campfire", tx0, ty0, { fuel: 2, lit: false });
        G.teleport(bx, by);
        const thru = run({ prop: wf.id, entry: box.uid });
        row("a campfire cannot be lit through a wall", !thru.ok && /wall/.test(thru.reason) && !wf.fire.lit, String(thru.reason));
      } else row("a free tile for the campfire behind the wall", false, `${tx0},${ty0} has a prop`);
    } else row("a bracket with room on both sides for the wall rows", false, "none in the loaded map");
  } finally {
    for (const r of restore.reverse()) r();
    me.hands.main = hands0.main;
    me.hands.off = hands0.off;
    G.teleport(meAt[0], meAt[1]);
    G.loop.setPaused(wasPaused);
  }
  return finish();

  function finish() {
    for (const r of rows) console.log(`${r.result}  ${r.check}  (${r.detail})`);
    return { rows, passed: rows.filter((r) => r.result === "pass").length, total: rows.length };
  }
}
