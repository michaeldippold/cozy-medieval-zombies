// Food heals a little (Michael, 2026-10-18, #179: "I DO want food to heal. It should be a stopgap while you wait for natural heal or
// grab a potion. The only big heals allowed are from potions"; cooked and combined foods more than raw; eat from the belt). From the
// console, on a tab with `?nosave`:
//   await __game.check("food")
// It hurts the player, eats each food from the bag and then from the belt (a menu entry, a double-click), and puts health, hunger, and
// the bag and belt back.

export async function run(game) {
  const G = game;
  const rows = [];
  const row = (check, ok, detail) => rows.push({ check, result: ok ? "pass" : "FAIL", detail });
  const me = G.player;
  const bag = G.inventory.bagOf(me);
  const belt = G.inventory.beltOf(me);
  const state0 = { hp: me.hp, hunger: me.hunger, thirst: me.thirst, survival: G.rules.rules.survival };
  G.rules.rules.survival = true; // a world without Survival is always full and eats nothing: the rows below set it where they mean it
  const bag0 = bag.items.slice();
  const belt0 = belt ? [...belt] : null;
  const defs = G.items.allItems().filter((d) => d.kind === "food");
  const heal = (id) => G.items.getItem(id).heal || 0;
  const actions = (await import("/src/ui/inventory-actions.js")).createInventoryActions(() => me);
  try {
    // Every food heals a little, and none a great deal.
    row("every food heals a little (at least one, at most ten: a stopgap, never a potion's)", defs.every((d) => (d.heal || 0) >= 1 && (d.heal || 0) <= 10), defs.map((d) => `${d.id} ${d.heal || 0}`).join(", "));
    row("cooked food heals more than the raw it is made of", heal("roast_potato") > heal("potato") && heal("stew") > heal("potato") && heal("stew") > heal("cabbage") && heal("porridge") > heal("potato") && heal("bread") > heal("apple"), `roast potato ${heal("roast_potato")} over potato ${heal("potato")}; stew ${heal("stew")}; porridge ${heal("porridge")}; bread ${heal("bread")} over apple ${heal("apple")}`);

    // Eaten from the bag: the heal is applied, and capped at full health.
    let exact = true;
    for (const d of defs) {
      me.hp = 50;
      me.hunger = Math.max(0, me.maxHunger - 80);
      const entry = G.items.makeEntry(d.id, 1);
      G.inventory.stow(me, entry);
      G.interact.itemMenu(me, entry, bag, null).find((m) => m.label === "Eat").onSelect();
      const got = me.hp - 50;
      if (got !== (d.heal || 0)) { exact = false; row(`${d.id} heals exactly its heal`, false, `${got} of ${d.heal}`); }
      G.inventory.detach(me, entry);
    }
    row("each food eaten from the bag heals exactly its number", exact, "every food, from 50 health");
    me.hp = me.maxHp - 1;
    const bread = G.items.makeEntry("bread", 1);
    G.inventory.stow(me, bread);
    G.interact.itemMenu(me, bread, bag, null).find((m) => m.label === "Eat").onSelect();
    row("a heal is capped at full health", me.hp === me.maxHp, `health ${me.hp} of ${me.maxHp}`);

    // From the belt: the slot's Eat entry, and a double-click.
    me.hunger = 0; // the belt rows eat stew twice, so there is room for it
    if (belt) {
      const slot = belt.findIndex((e) => !e);
      if (slot >= 0) {
        me.hp = 40;
        belt[slot] = G.items.makeEntry("stew", 2);
        const id = `belt:${slot}`;
        row("a food on the belt offers Eat from its slot, and not Equip", G.interact.slotMenu(me, id).some((m) => m.label === "Eat") && !G.interact.slotMenu(me, id).some((m) => m.label.startsWith("Equip")), G.interact.slotMenu(me, id).map((m) => m.label).join(", "));
        const did = actions.useSlot(id);
        row("a double-click on it eats one: health up, one fewer on the belt", did === true && me.hp === 40 + heal("stew") && belt[slot] && belt[slot].count === 1, `health ${me.hp}, ${belt[slot] ? belt[slot].count : 0} left`);
        actions.useSlot(id);
        row("and the last one empties the slot", belt[slot] === null && me.hp === 40 + 2 * heal("stew"), `slot ${belt[slot] ? "still full" : "empty"}, health ${me.hp}`);
      } else row("a free belt slot for the belt rows", false, "none");
      // Appetite bounds food (Michael, 2026-10-18, #186): a full belly eats nothing, by the menu, the double-click, and the key alike.
      const word = () => (document.getElementById("message") || {}).textContent || "";
      const was = G.rules.rules.survival;
      G.rules.rules.survival = true;
      const full = async (what, fn, keep) => {
        me.hp = 40;
        me.hunger = me.maxHunger - 2; // above the line, and below the exact top it drains from
        const msg = document.getElementById("message");
        if (msg) { msg.textContent = ""; msg.hidden = true; }
        fn();
        row(`a full belly eats nothing: ${what}`, me.hp === 40 && keep() && /full/i.test(word()), `health ${me.hp}, "${word()}"`);
      };
      try {
        const slot2 = belt.findIndex((e) => !e);
        belt[slot2] = G.items.makeEntry("stew", 2);
        await full("the belt slot's menu", () => G.interact.slotMenu(me, `belt:${slot2}`).find((m) => m.label === "Eat").onSelect(), () => belt[slot2].count === 2);
        await full("the double-click on it", () => actions.useSlot(`belt:${slot2}`), () => belt[slot2].count === 2);
        await full("the bag's menu", () => {
          const ent = G.items.makeEntry("bread", 1);
          G.inventory.stow(me, ent);
          G.interact.itemMenu(me, ent, bag, null).find((m) => m.label === "Eat").onSelect();
          G.inventory.detach(me, ent);
        }, () => true);
        belt[slot2] = G.items.makeEntry("stew", 2);
        const press = (await import("/src/interact.js")).updateInteract;
        await full("the belt key", () => press(me, 1 / 60, { [`belt${slot2 + 1}`]: true }), () => belt[slot2].count === 2);
        // Just under the line it eats, and tops hunger at the full mark.
        me.hp = 40;
        me.hunger = G.tuning.player.fullAt - 1;
        G.interact.slotMenu(me, `belt:${slot2}`).find((m) => m.label === "Eat").onSelect();
        const room = me.maxHunger - (G.tuning.player.fullAt - 1);
        const scaled = 40 + heal("stew") * (room / G.items.getItem("stew").hunger);
        row("one point under the full line it eats, heals only for the appetite it fills, and hunger never passes the top", Math.abs(me.hp - scaled) < 1e-9 && me.hunger === me.maxHunger && belt[slot2].count === 1, `health ${me.hp} (wanted ${scaled}), hunger ${me.hunger}`);
        // With Survival off the needs stay full for good, so a body is always full: no big heal by the back door (health still regenerates).
        G.rules.rules.survival = false;
        me.hp = 40;
        me.hunger = 0;
        G.interact.slotMenu(me, `belt:${slot2}`).find((m) => m.label === "Eat").onSelect();
        row("with Survival off a body is always full: food is refused", me.hp === 40 && belt[slot2].count === 1, `health ${me.hp}`);
      } finally {
        G.rules.rules.survival = was;
      }
    } else row("the player has a belt", false, "no belt");
  } finally {
    G.rules.rules.survival = state0.survival;
    me.hp = state0.hp;
    me.hunger = state0.hunger;
    me.thirst = state0.thirst;
    bag.items.splice(0, bag.items.length, ...bag0);
    if (belt && belt0) belt.splice(0, belt.length, ...belt0);
  }
  for (const r of rows) console.log(`${r.result}  ${r.check}  (${r.detail})`);
  return { rows, passed: rows.filter((r) => r.result === "pass").length, total: rows.length };
}
