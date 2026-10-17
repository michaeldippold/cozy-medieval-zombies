# 30 — The big pass, specified: what you can do, what you must do, and where it all lives

**Status, 2026-10-16: the spec of the big pass, written 2026-10-12 from `22` (Michael's brain-dump of the what, now a record), `29-world` (another agent's ideation of the where), and Michael's answers the same night (`02`, "The big pass answered"); it supersedes `22` as the plan and overrides `29` where the two differ (`02`, 2026-10-12, "The 1.0 map's first rulings"). Steps 0 to 3 are built** (2026-10-12 and 13: the generator and the engine's tier 1, the village, the needs and sleep, interactions and the first stations; the record is `docs/history/30-as-built.md`, the rulings they forced `02` under those dates). **Step 4 onward is not**, held by Michael since 2026-10-13 while the multiplayer work landed; step 4, the farms and farming, is pickable as it stands, with three defaults added at the end of section 11. Scoped for implementation by another model, step by step, each step playable; defaults in brackets are Michael's to overrule, not the implementer's. Combat is paused by ruling and is not here; magic (`24`) is its own doc; NPC routines (`04`) and records beyond the active region (`03`) come after. This document holds the one engine list (section 12, with `29/10`'s open items under its numbers) and the one open-questions list (section 15, with `29/11`'s). **Multiplayer is live** (`02`, 2026-10-13; `31-multiplayer/08`): every step from 4 on is built for a guest in the same commit, running in the host's step, reached by a guest through the same verb, handler, key event, or command, travelling in the save and the frame, and hashed by the sync check; the sections below name the guest's side where it is not obvious.

## 1. What this pass is

The pass that gives the game its stuff and its reasons: the needs that keep you alive, the verbs you have on the world, the items and their interactions, the stations and their recipes, farming, tools, durability, fire as maintenance, and the 1.0 map those things live on, built place by place. At its end the player can list every action the game offers by walking the village, and the loop closes without a vendor: everything `22` names has a source on the map and a station that uses it (`29/08`, the table).

What it is not: new combat rules (paused), magic beyond the two items that exist, quests, story, trade, travel, roofs, floors, animals beyond two, weather, seasons.

## 2. The laws this pass adds

Rulings, all in `02`:

1. **Everything is data.** A need's rate, a recipe, an interaction, a fire's fuel, a weapon's kills, a crop's days: a number or a row in `data/`, never a branch in code. Adding an item or a recipe is a row.
2. **Nothing interesting happens.** Any item can be used on any item, any tool on any thing in the world. The default result is that message. A real interaction is a row in `data/interactions.json` that replaces the message with its outcome (a result, a confirmation, a count to pick). One rule for the bag and the map.
3. **A station is a prop.** Placed like furniture (carried on the head, set down, built), opened with `E` or its menu, worked from your bag and every container within reach, one shared panel on the kit.
4. **Fire is maintenance.** A fire burns its fuel down over game hours and goes out; a station with a fire works only while lit; a craft in progress pauses while it is out and resumes when it is fed. Nothing is lost by forgetting, only time.
5. **Durability is kills.** A weapon's number is the dead it will put down; the wear per landed hit is derived from its hits per kill; a miss costs nothing; at zero it is gone; no repair (`22`'s ruling stands). A stick is about five, the best weapon no more than a hundred.
6. **Sleep fast-forwards the simulation.** Only in a bed, indoors; the clock runs fast with the world simulated at that speed until morning; you are never woken; you get up. Decided by the co-op tiebreaker of 2026-10-12 (since replaced by the multiplayer rule, `31/08`): the sim runs, nothing is poked. With friends in the world, time runs fast only while every living player in it is in bed (`02`, 2026-10-13).
7. **Nothing waits for art.** Every new thing has a placeholder from boot through the same sheet interface; a bookcase is a box with a definition until the picture arrives (`CLAUDE.md`'s rule, applied to every item below).
8. **Water stops walkers.** A tile that is wholly water is unwalkable by every entity: you, the dead, villagers, animals (Michael, 2026-10-12: "it also segments the map"). The bank's blend is ground. The ford and the weir's crest are a shallow kind with stones showing, never blue water, slow for everyone. The river and its crossings are the map's shape (`29`); you drink and fill from any water beside you, as from the well. Boats are someday (`05`); for now water is a source of water and, later, of fish, and that is all.
9. **Animals last.** Chickens and deer are the last step, so nothing before them depends on them; the knife's skinning, raw meat, leather, and the tannery ride with them.

## 3. Staying alive: the needs

### 3.1 The clock

A day is 720 seconds of real time (`clock.js`); the player wakes at 08:00. The needs are tuned to the day, which the numbers before step 2 were not (hunger drained full to empty in 600 s, thirst in 420 s, both less than a day). [New defaults in `data/tuning.json`: hunger full to empty in a day and a half, thirst in one day, tiredness in a day and a quarter; starving or dehydrated loses 1.5 and 2 health a second as now.] All behind the Survival setting as now; the setting stays, on by default since step 2 [on].

### 3.2 Hunger and thirst (exist; made real here)

Four stages each as now (`moodles.js`), with effects in the last two: at "very hungry" or "parched" stamina regenerates at half rate; at "starving" or "dying of thirst" health drains. Food restores hunger by its value, cooked food more than raw (section 7); drink restores thirst. The waterskin sips as now. **Drinking and filling from water:** at any water tile beside the player (the river, the brook, the ponds, the mere, the moat, the trough, the spring), the well's two actions; shallow water included. [Any water; no sickness from any of it in 1.0.]

### 3.3 Sleep (new)

- **Tiredness**, a fourth need, 0 to 100, drains over a day and a quarter awake; stages: Yawning, Tired (stamina regen at three quarters), Exhausted (sprint gone), Falling asleep (health stops regenerating). Never kills.
- **The action:** `E` on a bed, or its menu, while indoors (the tile is in a room, `map.roomAt`; a sealed room is not required). Refused outdoors [and with the dead in sight ("Not with that watching."): a lean never built], **and while any of the dead holds a siege on the player within `zombie.siegeSleepRadius` (14 tiles): "The dead that know you are in here are still about."** (Michael, 2026-10-17, #147: "you cannot sleep while the dead that know you are inside are still about; the siege bites at night"; `09`). A sleep already begun is not broken: nothing interrupts it.
- **What happens:** the clock and the simulation run at 60 times speed (once every living player in the world is in bed) until the player's tiredness is full or it is 06:00, whichever is later, with the player lying in the bed (the `down` pose; the figure is drawn, the dead treat them as a body; not built: the sleeper stands by the bed until `32`, item 7). The world simulates at that speed: the dead walk, fires burn down, crops grow. Nothing interrupts the sleep (Michael's ruling); a zombie that reaches the bed bites a sleeper as it would a standing player, which is the one danger, and the reason a shut door matters.
- **Waking:** the player stands, tiredness restored, health regenerated by the night's share (3.4), the message says the day.
- **With friends (built, `02`, 2026-10-13):** nothing here reads a global player; the fast-forward is the world's time scale, never a clock jump, computed each step from who is asleep (`game.everyoneAsleep`, `timeScaleNow`): sixty only while every living player in the world is in bed, a dormant or dead one counting for neither side. A sleeper alone among the waking sleeps at ordinary speed, rested and regenerating at the sleeping rate, and is told "Time will pass faster once everyone in the world is asleep." A guest lies down through the same verb by the bed's id.

### 3.4 Health

Regenerates [1 a minute] while hunger and thirst are above their second stage and nothing bleeds; [4 a minute] asleep; none otherwise. Bandages close bleeds as now. **Food heals a little** (Michael, 2026-10-18, #179: "I DO want food to heal. It should be a stopgap while you wait for natural heal or grab a potion. The only big heals allowed are from potions"): each food has a `heal` in `data/items.json` beside its hunger, 1 to 2 raw (a potato, a cabbage, an apple, a pumpkin), 4 to 6 cooked (a roast potato, cheese, bread, porridge), 10 for a stew, and none heals as much as a potion will; **a full belly eats nothing** (Michael, 2026-10-18, #186: "you can't eat when your hunger is full"; "You are full."): hunger at or above `fullAt` (90) refuses the food by every way of eating it, the Survival-off world's needs being full for good, and a food heals in proportion to the appetite it fills, so food is never a way to top up; eaten from the bag or from the belt (a food on the belt offers Eat and a double-click eats it, as a skin is drunk). The infection stays the marker it is; when it is made real a craftable cure with the mushrooms joins the cauldron's recipes (section 8).

### 3.5 Death

As ruled (`02`): the next survivor arrives elsewhere with the kit. Where: the inn, the toll house, or the croft, by turn [the inn first]. **Built in part** (`31/09`): the dead screen's New character makes the next survivor in the same world from an identity, the body left where it fell; it arrives beside the map's spawn for now, and the turn of the inn, the toll house, and the croft is not built.

## 4. Every action, by what you have in your hands

The whole vocabulary. "Exists" means built before this pass; everything else is this pass. The verbs appear in the right-click menu of the thing, or on `E` for the nearest; the hands decide which appear (law 2). **Built by step 3:** drink and fill at water, sleep in a bed, feed a fire, craft, cook (any lit fire that cooks), bake, and smith; combine is the Use mode, an item used on an item (the drag in the bag is not built). **Since, by #14 (2026-10-15):** dip, a stack of arrows used on any lit fire for fire arrows (`src/burn.js`, a row in `interactions.json` with `action: dip`). Everything else in the list is step 4 onward. Every verb is reached by a guest the way the host's player reaches it (the menu entry or `E` as a command by address, a Use row by the entry's uid), and performed in the host's step.

**Moving and the home (exist):** walk, sprint, open and close doors and shutters, board a window or a door, pull a board, carry furniture on your head and set it down, build walls, doors, and windows from the palette, remove what you built, light and feed a hearth, light a torch, mount it, take it.

**Looking and talking (exist):** the menu on anything, `E` the nearest action, open a container, loot a body, talk to a villager (a line), poke a thing (it wobbles).

**Eating, drinking, resting:** eat (exists), drink from a skin (exists), **drink at water**, **fill at water**, **sleep in a bed**, bandage (exists).

**Gathering:** pick a mushroom, a herb, a berry, an apple, a ready crop (hands); forage sticks under trees (exists by rule); **chop** a tree or a stump (hatchet); **mine** a rock or an ore rock (pickaxe); **dig** at a marked spot or a grave (shovel); **take** from a stack (logs, planks, stone blocks: a container that gives its material); **harvest** a grain field a row at a time (scythe); **fish** at water (rod; after the pass).

**Farming:** **till** grass or dirt into soil (hoe); **plant** a seed on soil; **water** a plot (the bucket, or a skin for one tile); pick or harvest; a crop's seeds come back with its harvest.

**Making:** **craft** at a station (recipes); **combine** two items in the bag (drag one onto the other; law 2); **split** a log into planks (exists); **cook** at a lit hearth with a pot; **bake** at a lit oven; **smith** at a lit forge with the anvil; **weave** at the loom; **dye** at a vat; **mill** at the millstones; **brew** at the cauldron; **press** at the cider press; **smoke** at the rack (with animals).

**Fire:** light (a torch or a flint, exists), **feed** with the fire's fuel (logs, charcoal), read how long it has.

**Fighting (exists, paused):** swing, shove, block, draw and loose, throw the spear.

**Animals (the last step):** **collect eggs** from a nest, **shoo** a chicken, **hunt** a deer (the bow), **skin** a dead deer (knife), **butcher** (knife).

## 5. Items

### 5.1 The registry

`data/items.json` grows by rows. Every row has `kind`, `size`, `color`, `short` (the placeholder block), and, as art lands, `icon`, `portrait`, and `held` (`26`'s three pictures). New in this pass:

- **Tags** (`tags: ["wood", "fuel"]`): wood, stone, metal, cloth, fibre, food, raw, cooked, fuel, seed, tool, herb, container, drink. Recipes may ask for a tag instead of an id (any `fuel`, any `raw` meat).
- **Materials:** log (exists), plank (exists), stick (exists), stone block, iron ore, iron bar, charcoal, cloth, wool, flax, thread, leather (with animals), straw.
- **Foods, raw:** potato, cabbage, garlic, pumpkin, rye grain, turnip, wheat grain, beans, onion, carrot, egg, raw meat (as their crops and art land; the first five exist as crops). **Foods, cooked:** stew, roast potato, bread (exists as an item), pie, porridge, cider, ale, smoked meat. **Drinks:** the waterskin (exists), a bottle, a mug.
- **Seeds:** one per crop, stackable, from a harvest and from the granaries.
- **Tools:** hatchet (exists), pickaxe, hoe, scythe, shovel, knife, hammer, fishing rod (later). Each `kind: "tool"`, a `verbs` list, a weak weapon block (they swing badly: low damage, high wear).
- **Herbs:** sage, yarrow, feverfew, nettle, each a gatherable and a dried bunch; mushrooms exist.
- **Stations and furniture as items:** a station is placed from the bag like furniture (it is a prop with `carry: true` until set down), or found placed on the map.

### 5.2 Durability (law 5)

On a weapon's block: `kills` (the design number) and, derived at load, `wearPerHit = 1 / (kills * hitsPerKill)` where `hitsPerKill` is the weapon's damage against the standard zombie's health, rounded up. A landed hit subtracts `wearPerHit` from the entry's `wear` (0 to 1); at 1 the entry evaporates with a message. Dual wielding splits the wear as ruled. **Display:** a thin bar on the item's icon once `wear > 0`, red under a fifth; no warning. **Defaults** (`items.json`, Michael's numbers, tuned up if unfair): stick 5, plank 5, hatchet 20, spear 25, mace 40, sword 60, halberd 80, the bow's string 100 shots, tools as weapons 5.

### 5.3 Interactions (law 2)

**Built ahead, 2026-10-12** (`02`, "Build in every right-click menu, Use on every item, and a text log"): the Use mode (`src/use.js`: the item outlined where it is, a label following the cursor, the next click the target, Escape cancels), `src/interactions.js` with `resolve` and the default message, the text log (`src/ui/log.js`) as the place results print, and Build in every world menu. Step 3 adds the rows' actions.

`data/interactions.json`: rows of `{ "use": <item id or tag>, "on": <item id, tag, prop sprite, or "tree" | "rock" | "water" | "soil" | "grass">, "verb": "Chop", "action": <kind>, ...}`. Kinds: `give` (a result item, a count, a confirmation if the input is consumed), `transform` (the target becomes another prop or floor: a tree to a stump, grass to soil), `open` (a station panel), `fill`, `plant`, `water`, `message` (a specific line). Without a row: "Nothing interesting happens." The menu lists only rows whose `use` is in a hand; the drag in the bag tries the row for the pair (not built; the Use mode does item on item today). A number picker appears when the input stacks and the row allows a count.

## 6. Stations (law 3)

One panel for all of them, on the kit: the recipe list on the left (greyed when short, the shortfall named), the ingredients and your count of each, a count to make, Make, the queue with its bar; the station's fire shown with its fuel if it has one. Ingredients and the fuel come from your bag, the belt, and every container within reach (`CLICK_REACH`, 2.6 tiles) including the wheelbarrow. A craft takes its recipe's seconds with the bar and you may walk off: the station keeps working; the result lands in the station's own output slot (a small container on it) to collect. **For a guest (built in tier 3 of `31`):** the panel opens on its replica when the host says its player used a station, Make is a command the host runs as the craft verb (`net.sendCraft`), the output opens as a container by the same path as any other, and the queues ride in the frame (`queues`) so a guest's bar shows the job's time left; a new station needs nothing more than its definition and its rows.

| Station | Fire | Lives (`29`) | First recipes |
|---|---|---|---|
| Workbench | no | the joiner, your lean-to | planks to boards, a stick to a torch, a hoe, a shovel, a handle; a chest, a shelf, a bed frame, a table, a bench; the wheelbarrow |
| Anvil and forge | the forge, charcoal | the village smithy (the castle's is cold) | ore to a bar; a bar to a knife, a hatchet head, a pickaxe head, a sword, a mace head, a spear point; a hammer |
| Cooking hearth | the hearth, logs, with a pot placed on it | the inn, the castle kitchen, Hollow's, any hearth with a pot | stew, roast potato, porridge, a pie |
| Oven | the oven, logs | the baker, the inn, the castle | bread from flour, a pie |
| Loom | no | the weaver | cloth from wool or flax thread; bandages; a tunic, breeches, a cap |
| Dye vats | no | the weaver's yard | a garment plus a dye plant to the dyed garment |
| Millstones | no | the mill | grain to flour |
| Cauldron | its own fire, logs | the witch | the cure (when infection is real); until then a herb tea that restores stamina |
| Cider press | no | the orchard | apples to cider |
| Smoking rack | its own, logs | the hunter | raw meat to smoked (with animals) |

Built in step 3: the workbench, the anvil and forge, the cooking hearth (any lit fire that cooks), and the oven. Not built, their rows above the plan: the loom and the dye vats (placed in the weaver's as labelled boxes with no recipes; cloth and wool wait for step 7's dressing or the animals), the millstones (step 4, with the mill), the cauldron (step 6, with the witch), the cider press (with the orchard), and the smoking rack (step 8, with the animals).

Recipes in `data/recipes.json`: `{ station, out: {id, count}, in: [{id or tag, count}], seconds, fire: true|false }`. **Learned and earned** (`02`, 2026-10-18, The valley first; food heals a little; teachers are safe; the wizard; the dead strike what they break, overturning "all known from the start"): a recipe comes from a villager who teaches it or as a region's reward (*Primary's additions, Michael's to overrule:* or from a skill; which are known at the start is settled with the production-chain map).

## 7. Fire and fuel (law 4)

`data/fires.json` (today's fire data in sprite definitions moves here, or stays per definition and gains the fields; **built in step 2 the second way**: `fire.fuel` and `fire.hoursPerUnit` on each fire's sprite definition beside `maxFuel` and `radius`, no `fires.json`): per kind, `fuel` (an item or tag), `hoursPerUnit`, `maxUnits`, `radius`, `cooks`, `heats`. Kinds: hearth (logs, 3 h a log, 4 units), campfire, forge (charcoal, 2 h, 4), oven (logs, 2 h, 3), brazier (charcoal), cauldron, smoking rack, candle (none, burns a day, tiny), lantern post, charcoal clamp (burns a day, smoke, no light). Feeding is the menu's Feed with the fuel in a hand or the bag; the prompt shows hours left. A lit fire in a room lights it as now. Cooking needs a lit hearth with a pot (ruled at step 3: any lit fire that cooks, the pot not asked for until it is an item worth placing); the cooked food's value is the raw's doubled [doubled]. No spoilage.

## 8. Farming

- **Soil:** the hoe on grass or dirt turns the tile to farm soil (`map.setFloor`, the furrow direction from the hoe's swing direction); the two drawn soils serve.
- **Planting:** a seed on soil places the crop prop at stage 0 (the five crops exist with three stages; new crops as drawn).
- **Growth:** per crop, days per stage in `data/crops.json` [potato 2 and 2, cabbage 2 and 3, garlic 3 and 3, pumpkin 3 and 4, rye 3 and 3]; a stage advances on the clock whether the player is near or not (the map tile carries the planted hour; a chunk that was evicted catches up on load).
- **Water:** each soil tile has `dry` (0 to 2 days); a dry tile pauses growth, never kills; the bucket waters a 3 by 3, a skin one tile; rain is not in 1.0.
- **Harvest:** a ready crop gives its food and [two] seeds and the tile stays soil; the scythe harvests a row of grain at a swing. Crops are gatherables: outlined, wobbling (walked through too).
- **Seeds:** granaries, the storehouse, the gardener's shed, and every harvest.
- **New crops** (`29/09` request 1.4, as drawn): turnip, wheat, beans, hops, flax, onion, carrot; the four herbs.
- **For a guest** (`31/08`): till, plant, water, and harvest are verbs in the table and rows in `interactions.json`, so a guest reaches them by the menu, `E`, or the Use mode as commands by the tile's address and the entry's uid, and the host performs them in its step with its own reach checks. The soil, the crop's planted hour and stage, and a tile's `dry` are map state changed through mutators that touch the tile (`map.setFloor`, the crop prop's own), so they reach a guest in the frame's touched chunks and the save, and the sync check's `map` part hashes them; growth reads the world's clock and `loop.simTime()`, never a client's.

## 9. The bucket

A **prop you carry** on your head like furniture (both hands full, no fighting), not an item: filled at a well or any water tile (its menu), poured on a plot (waters 3 by 3), set down anywhere (a container of water: a cooking hearth beside a full bucket needs no skin). Art: the barrel's placeholder path until drawn. The waterskin waters one tile for the small case. **For a guest:** the bucket is carried as any prop is (the prop in hand rides in the character's record as `carried`, and a guest's put-down is `placement.performPlacement` run on the host); fill and pour are verbs by the bucket's id and the target tile, performed in the host's step; how full it is is a field on the prop, so it travels with the prop in the frame and the save.

## 10. Tools and their verbs

Hatchet: chop a tree (exists), chop a stump (a log). Pickaxe: mine a rock (stone blocks; the rock goes), mine an ore rock (ore). Hoe: till. Scythe: harvest grain rows, cut hay. Shovel: dig a grave (a grave's goods), dig the buried chest, dig up a plot. Knife: butcher and skin (with animals), cut flax to fibre. Hammer: the smith's and the workbench's recipes ask for it in hand; building stone walls asks for it. All are weapons with 5 kills and poor damage. The fishing rod after the pass. Each tool's verb is a row in the verb table with its target as an address (a prop's id, a tile), re-validated when it fires so two players cannot fell one tree or mine one rock twice; what it removes or gives goes through the map's mutators, so a guest sees the stump, the gone rock, and the dug plot in the touched chunks.

## 11. The map, built place by place (the Where, from `29`, with this pass slotted in)

The order from `29/11` with the pass's pieces placed where they first matter. Each step ends playable, with its checks, its `02` entries, and a commit. **Steps 0 to 3 are built** (2026-10-12 and 13; the notes are `docs/history/30-as-built.md`); **4 to 9 are not**, and each is built for a guest in the same commit (`31/08`).

0. **The generator and the engine's tier 1.** `tools/mapgen/` (Python): a description per place (rooms as rects with a material per side, a floor, openings; fences as perimeters; roads as polylines with a width and a surface; props by name at offsets; decals; the dead and villagers) that writes `data/maps/valley.json` in today's format. Engine: water impassable with shallow slow (`map.moveCircle`, `pathfind`); see-through walls (`seeThrough`); interior partitions and a material per side in the building format; fences as features that do not make rooms; drinking and filling at water. A 256 by 256 bounds. The dev chest and combat testing as a setting on the real map.
1. **The village,** from the art that exists: your cottage with its well and plot, the lane, the green and the pond, the square and the well, the inn with its boarded windows and its people, the chapel and the graveyard, the smithy, the joiner, the weaver, the baker, the merchant's house, six cottages, the bridge to nothing. Furniture that has no art is a placeholder box with its definition (the bookcase, the shelf, the dresser, the counter).
2. **The needs.** Tiredness and sleep, health regeneration, the retuned rates, drinking at water, fire fuel and feeding with hours shown. Survival on by default.
3. **Interactions and the first stations.** `interactions.json` and the "nothing interesting happens" default; the station panel; the workbench, the anvil and forge, the cooking hearth with the pot, the oven; recipes; durability by kills with the bar; the hammer, the knife, the pickaxe, the hoe, the shovel as items. The smith's loop closes with the castle's armoury not yet built, so the first iron is the smithy's own rack.
4. **The farms and farming** (the next step, held by Michael 2026-10-13). Hollow Farm and Long Acre, the mill and the millstones, the roads; tilling, planting, growth, watering, the bucket, harvest, seeds; the scythe; grain to flour to bread. The pumpkin field as the postcard.
5. **The castle** and the bridge road: the taller walls (data), the gatehouse, the towers, the great hall, the kitchens with their stations, the barracks and the armoury (its door shut and boarded from inside; no locks), the wizard's study with the staff and the book, the garrison. To verify when the taller walls land, not to build (`29/10`'s notes): the cap redraw, the opening hit test (`WALL_FACE` from the sheet's height, `17`), the light's climb (`night.climb` is one number for all walls; a per-sheet climb would be a small follow-up), and the arrow's `scanPath` (walls stop below 80: should read the sheet's height).
6. **The forest places,** one a session: the woodcutters (stacks that give), the witch (the cauldron, the herbs), the quarry (mining, stone), the charcoal burners (charcoal), the iron workings (ore), the hunter's lodge, the bandit camp, then the hooks (the barrow first).
7. **Dressing:** authored decals, signs, lights unlit, the dead's wardrobes as the character art lands, the barricades, the edges and the waystone.
8. **Animals.** Chickens (in coops and yards, wander, eggs in nests daily, a thing to look after) and deer (the forest, flee at sight, the bow hunts them, the knife skins and butchers): a drawn sheet each through the sprite system, the villagers' wander and the owed flee, a loot table each. With them: raw meat and the smoking rack's recipes, leather and the tannery back from the cut list, a leather jerkin at the loom. For a guest, an animal is a character like the dead and the villagers: its wander and flee run in the host's step on the sim's `rng`, its list travels in the frame as a delta with a roster beside theirs and in the save, the sync check's `dead` part covers it, and a nest's eggs come by the world's clock.
9. **After the pass:** fishing (the rod, a cast at water, a table per water, fish that cook); then `04`'s routines and `24`'s magic have their world.

**Step 4's three defaults**, so the step is pickable as it stands (bracketed like the rest: Michael's to overrule, not the implementer's). [The farm places are a `place` each in `tools/mapgen/valley.py` as the village's are, written from `29/05`'s plans (rooms as rects with a material per side and openings, fences as perimeters with gates, `crops` rects at mixed stages, the dead and the villagers), in the reserves the valley holds for them, with the mill's wheel a labelled box against the mill's wall until drawn.] [Growth is derived, not stepped: a crop carries the hour it was planted and the hours it has stood dry, and its stage is computed from those and the world's clock whenever its chunk is live, so a chunk evicted for a week is right the moment it loads and a guest's replica reads the same two numbers from the touched chunk; nothing walks the crops each step.] [The scythe's row harvest is one verb per swing whose targets are the tiles the swing's arc covers (the three ahead, as a weapon's), re-validated on the host; every ready grain crop among them gives its grain and seeds as a hand harvest would, and the tiles stay soil.]

## 12. Engine asks, consolidated: the one engine list

From `29/10` (archived whole in `docs/history/29-world-ideation.md`, with its "works today" list, its authoring note, and its performance notes) with the cuts applied and this pass's needs added; sizes without times. First the list by step; then the open asks as `29/10` wrote them, under its own numbers, so a citation of "`29/10` item 7" still resolves here. Done of `29/10`: tier 1 (items 1 to 5, step 0), 11's fuel per fire (step 2), 12's label (drawn on every box, `placeholder.label`), 17 (drinking at water, step 0), and 18 (this pass's stations and recipes, step 3); its three verification notes for the taller walls are under step 5 in section 11.

- Tier 1 (step 0): water impassable and shallow slow; see-through walls; partitions and per-side materials; fences as features; the generator. Small to medium each.
- Step 2: the tiredness need and the sleep fast-forward (a loop speed multiplier, built as the world's time scale; the `down` pose on a bed, not built, `32` item 7; the wake rule); health regeneration; water drinking; fire fuel data and the feed action with hours.
- Step 3: `interactions.json` and its resolver (the menu's verbs from the hands; the drag in the bag); the station panel on the kit; recipes with a queue and an output slot; durability fields and the bar; tools as items with verbs.
- Step 4: soil by hoe (`setFloor`), crop props with a planted hour and growth on the clock, dryness per soil tile, the bucket as a carried prop with fill and pour, the scythe's row harvest, stacks as containers that give.
- Step 5: the castle's wall heights verified through the cap redraw, the hit tests, and the arrow's scan; larger prop footprints (2 by 2, 3 by 1, 2 by 3; a general slice) or the two-piece fallback; wall-hung props beyond the bracket (banners, shelves, racks, signs); rugs as flat props; the hearth-radius cap for the hall; props with a prompt label.
- Step 6: mining (a rock gives and goes); the dead placed down and rising; containers on trees and stacks; authored decals.
- Step 8: an animal entity (a drawn sheet with facings, wander, flee, hit, loot); nests as containers that refill daily.
- Cut (`29/11`, taken): locked doors and keys, paired openings, carpet as an autotile, coin, the maze, the second smithy's fire, the willow's eyes.

### The open asks of `29/10`, by its numbers

Step 5, the castle and the interiors:

6. **Larger prop footprints.** 2 by 2 (the loom, the four-poster, the fountain, the haystack, the tent, the cage, the charcoal clamp), 2 by 3 (the cart), 3 by 1 (the bar counter, the grand hearth), 3 by 3 (the granary). The loader slices only two-tile pieces today (`17`: "four-tile footprints are not needed and not built"), by a vertical screen line at the second tile's centre. A general slice is the same idea per tile boundary along both axes, with the depth sort per slice. **Medium**, in `assets.js`'s slicing and `render/props.js`. The fallback that needs nothing: draw big things as two 2 by 1 pieces placed side by side (a bar counter as a 2 by 1 and a 1 by 1), which the art can be cut to.
7. **Wall-hung props beyond the torch bracket.** Banners, tapestries, signs on brackets, shelves, weapon racks, antlers, chains, saddles, mangers, ladders, the dragon skull: an edge-state prop (`wallProps` on an edge, like `torch: side`) with a sprite per orientation, drawn on the near face after the wall at a height, no light of their own, some of them containers (a shelf, a rack). **Medium**, a generalisation of `brackets` in `map.js` and `render/walls.js`. The castle and the trades are mostly this.
8. **Carpet and rugs.** Either (a) a floor kind whose frame is chosen by its four neighbours (a 16-frame blob) instead of by hash, in `ground.js`'s laid-floor pass (**medium**, the ground already knows its neighbours for the blends), or (b) flat props drawn in the ground pass under everything (**medium**, a new drawable class that bakes into the chunk). (a) is the better carpet (a bordered area of any shape), (b) the better rug (a thing you can carry). Both wanted; (a) first.
    (a), the autotile, was cut on 2026-10-12; (b), rugs as flat props, stands.
11. **Fire kinds by data.** `07`'s table already says a fire is data; the plan adds brazier (burns charcoal), oven (burns wood, cooks bread specifically when cooking exists), forge (burns charcoal, heats, never cooks), candle (burns nothing, tiny), lantern post (the torch post with a lantern picture), charcoal clamp (burns slowly, smoke), smoking rack. One addition: **a `fuel` item per fire** (logs for a hearth, charcoal for a brazier) where today every burner takes a log. **Small**, in `map.js`'s fire data and the feed action. And **a cap on the hearth's room light by room size** for the great hall (`05`, "A great hall"): **one line** in `light.js`'s ambient rule.
    The fuel per fire is built (step 2); the cap on the hearth's room light for the hall stands open.
12. **Props with a prompt label and a prompt-only action.** A signpost, a waystone, the notice board, the barrow's door: `label` and `prompt` on a prop instance, shown by `E` or the menu, doing nothing. **Small**, in `interact.js`.
    The label is drawn on every box; the prompt-only action stands open.
13. **Authored decals.** A `decals` list on a set or a feature (`[file, x, y, flip]`), drawn by the ground bake with the rule decals (`15`, layer 5). Ruts, straw, soot, rushes, the scorched circle, mist at the mere, windfalls. **Small**, in `ground.js`. And **decal rules per rect** (flowers in a clearing: `"where": "any"` over a rect) are data today if a scatter-like rect can carry a decal override; if not, small.
14. **Tall animated props against a wall** (the mill wheel, 1 by 2 standing): the one-tile animation path extended to a sliced prop. Falls out of item 6.

Step 6, the forest places and the loop:

15. **The dead placed with a pose and a facing**, and **rising when approached**: a `zombies` list per set with `[x, y, { wardrobe, down: true, face: [x, y] }]`, and a `down` zombie that stands when the player is within some tiles (a timer the idle state already has). **Small**, in `map.js`'s loading and `zombie.js`'s idle. The graveyard's rising, the barrow's watchers, the feast's guests at their benches.
16. **Containers on trees and in stacks**: a `container` on a tree definition (the hollow giant) and on a stack prop that also gives its material by `E` (a log stack gives logs). **Small**, the chest's path on a different sprite.

After the pass:

19. **Fishing** (`29/08`'s option, now in `docs/history/29-world-ideation.md`): an action on a water-adjacent tile with a rod in hand, a table per water feature, two items. **Small to medium**, after the big pass's item verbs exist.
20. **NPC routines, follow, stay, lines** (`04`): **large**, planned; the plan places fourteen villagers with a home, a job, and a line each so the pass has its cast.
21. **Records beyond the active region** (`03`): alarm, lure, trickle. **Large**, its own milestone; the plan's dead are authored where they stand and the wild's per-chunk rule covers the rest, so nothing here waits for it; the mine mouth's "something comes out at night" and the castle's lure across the water are what it will make true.

## 13. Art, and the rule that nothing waits for it

`29/09` is the request list, unchanged in content, with these additions: the bucket (a carried prop, world picture only), the tools as trios (hoe, scythe, pickaxe, shovel, knife, hammer; the hatchet exists), the station output slot (none: UI), the chicken and the deer as eight-facing sheets with walk and idle (and the deer's flee), a nest, an egg, raw and smoked meat, leather and the jerkin, the cooked foods' icons. Every piece has a placeholder from boot: furniture and stations as the box generator with the definition's footprint and a label; items as coloured blocks; crops as the five that exist; animals as the villagers' sheet recoloured until drawn (a chicken as a small box that walks is fine for a week). The art lands through `27`'s checklist in `09`'s tiers, and the build order above follows the tiers, so the village is drawn before the castle is needed.

## 14. Verify, per step

Each step's acceptance is a check under `tools/checks/` where the sim can prove it and a screenshot where only eyes can: step 0, the dead cannot cross the river and do cross the ford (`check("water")`); step 2, a night slept passes eight hours with the fire burned down the right number of logs (`check("sleep")`); step 3, a recipe made from a chest's ingredients with the station's fire lit and paused when it dies (`check("craft")`), a stick evaporating on its sixth kill (`check("wear")`); step 4, a potato planted and harvested with seeds back over its days, dry and watered (`check("farm")`, to write with the step); the determinism hash before and after every step. From step 4 on, each step's new verbs are also done by a guest in two tabs with `check("sync")` passing and the frame's added bytes read from `net.status().wire` (`31/08`, rule 6).

## 15. Open: the one open-questions list

**The names, the crops, how many villagers, and the gloom's door are tabled** (Michael, 2026-10-16) to the "finish the valley" session, since they depend on the game's overall shape, its own open question (#123, blocked on Michael). The questions only Michael can answer, from `29/11` (its answered ones are in `docs/history/29-world-ideation.md`, with `02`'s rulings beside them) and from this pass; each is `needs-michael` for the sweep's wave 4, where it becomes an issue. The plan's defaults are in brackets, as `29/11` had them.

- **Names** (`29/11` Q4): the village, the river, the castle, the farms, the mere, the villagers. [Michael's; the docs and the valley carry role names until then.]
- **Which new crops first** (Q10). [Turnip, wheat, beans, hops; flax, onion, carrot after; the four herbs with the cure.]
- **How many villagers** (Q8): `04` says six to ten; `29/08` places fourteen with six core; the village of step 1 placed seven, with lines. [Fourteen placed, six given lines and jobs first; the atlas allows it.]
- **The gloom's door: east, by the old road past the woodcutters?** (Q12). It decides which edge of the map the zone system opens first; nothing built depends on it yet. [East.]
- ~~**Does "every building has rooms" hold for sheds, huts, and the forest cabins?** (Q15).~~ **Ruled by Michael, 2026-10-16 (#92):** "A shed, hut, or forest cabin is one room; the two-rooms rule is for houses."
- The rates and the regeneration numbers (sections 3 and 7) are defaults to feel out in play.
