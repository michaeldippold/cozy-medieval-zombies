# 29.05 — The farms

**Status, 2026-10-18: the orchard is built (#190: twenty apple trees in staggered rows at (38, 232), and one in each of three cottage gardens; apples picked by hand, bearing again in three days); the rest is not built;** `30`'s step 4, the next step, held by Michael since 2026-10-13. The farms' ground is reserved in the valley (Hollow Farm's shifted to (36, 230) to clear the cottages, Long Acre and the mill at (64, 24)); the mill is step 4's too. The rules of farming are `30`'s, not this page's: section 8 (the hoe, soil, growth in days, dryness, seeds, the scythe), section 9 (the bucket, in place of the watering can named below), section 10 (the tools' verbs), and their guest side; how the places go into the generator is a default under `30`'s section 11. Animals are no longer none: two, chickens and deer, as `30`'s last step (step 8), so the pens, coops, and stalls below stand empty for now, not for good.

Farming is load-bearing (`00`, pillar 3: "if it is not fun the game probably is not either"), so the farms are where the map spends its warmth. Two real farms and a croft, each a different size and a different crop, and every field already planted at mixed stages so the first harvest is waiting when the player arrives.

## Hollow Farm (south-west, the big one)

The map's postcard: the pumpkin field with jack-o'-lanterns on its fence posts, the orchard turning, the barn's long wall, the pond. About 60 by 50 tiles.

One character is two by two tiles; the top-left is world (40, 168). `H` the farmhouse, `B` the great barn, `Y` the byre, `s` the pigsty, `n` the hen house, `G` the granary, `A` the orchard, `o` the pond, `F` fields, `P` the pumpkin field, `-` the lane and the drove, `W` the well, `b` beehives, `x` the scarecrow.

```
     0       16      32      48
   0 .........................-......
     ..........................-.....
     ...........................-....
     ..................BBBBBBBB.-....
     .AAAAAAAHHHHHHHH..BBBBBBBB.-....
     .AAAAAAAHHHHHHHH..BBBBBBBB.-....
     .AAAAAAAHHHHHHHH..BBBBBBBB.-....
     .AAAAAAAHHHHHHHH..BBBBBBBB.-....
  16 .AAAAAAAHHHHHHHH..BBBBBBBB.-....
     .AAAAAAAHHHHHHHH...........-....
     .AAAAAAAHHHHHHHH.-----------....
     .AAAAAAA.........-YYYYYY.sss....
     .............nn.G-YYYYYY.sss....
     ....b....W...nn.G-YYYYYY.sss....
     ..FFFFFFFF.......-YYYYYY.......-
     ..FFFFFFFF.......-..........---.
  32 ..FFFFFFFF.oooo.P-----------FFFF
     ..FFFFFFFF.oooo.PPPPPPPPPP.FFFFF
     ..FFFFFFFF.oooo.PPPPPPPPPP.FFFFF
     ................PPPPPPxPPP.FFFFF
     ..FFFFFFFF......PPPPPPPPPP.FFFFF
     ..FFFFFFFF..FFF.PPPPPPPPPP.FFFFF
     ..FFFFFFFF..FFF............FFFFF
     ..FFFFFFFF..FFF...FFFFFFFF.FFFFF
  48 ..FFFFFFFF..FFF...FFFFFFFF.FFFFF
     ..................FFFFFFFF.FFFFF
     ..................FFFFFFFF......
     ................................
```

- **The farmhouse**: L-shaped, stone below and timber above (the material-change posts), five rooms: a **kitchen** with the big hearth, a table, a dresser of plates, a flitch of bacon on a hook; a **parlour** with the good chairs and a rug; two **bedrooms**; a **dairy** (a cool room: a churn, cheese on shelves, crocks). The farmer's family turned; they are in the yard. The dog's bowl by the door (no dog).
- **The great barn**: sixteen by twelve, one room, the biggest wooden building on the map: a cart (2 by 3) in the middle, hay (haystacks, 2 by 2 props, containers of straw), a tool rack (hoe, scythe, pitchfork, flail: `22`'s tools), sacks, a ladder to a loft that is not there, swallows' nests (a decal). Its double door (two door edges) on the yard side. **Earns its place:** the tools of farming come from here; the cart; the biggest room to board up.
- **The byre**: stalls (`wall_fence_low`), a manger, straw, a milking stool; empty of beasts. **The pigsty**: a stone pen with a hut, mud underfoot (the mud kind), a trough. **The hen house**: a 2 by 2 hut on legs with a ramp, a nesting box (a container: eggs, the one animal product that needs no animal, found and never replenished until there are hens). **The granary**: 3 by 3 on staddle stones (a prop-building: a hut you open as a container, or a small room; a room is simpler), sacks of rye and seed of every crop. **The dovecote**: a round tower prop, 1 by 1, 96 px tall, the vertical accent of the yard.
- **The orchard**: fourteen by sixteen of grass with **apple trees** in rows (a new tree: short, round, gatherable, outlined, with fruit in its `ready` stage and bare in its `picked` one; apples exist as an item), a cider press under a lean-to, barrels, a ladder, windfalls as decals. **Earns its place:** apples by the basket, the only orchard.
- **The pond**: eight by six, a dirt bank, reeds, a duck house on a post, the trough where the lane meets it.
- **Fields** (farm soil, both furrow directions in use so the two drawn soils both show): potatoes (10 by 8), cabbages (10 by 8), **the pumpkin field** (20 by 12, the biggest field on the map, pumpkins at every stage and a dozen ripe ones lying loose, the scarecrow in its middle, jack-o'-lanterns on the fence posts at its corners), garlic (6 by 8), **turnips** (new crop; 10 by 6), **beans** on poles (new crop, tall: 8 by 6), and **the hop garden** by the drove (new crop, tall on strings: the inn's reason; 10 by 10). Every field inside a **fence** (`wall_fence`: sight passes, bodies do not, a gate as its door; the dead break a fence gate like any leaf) or a hedge, with a gate on the lane. A **hay meadow** (grass, no scatter, with haycocks as props) east of the barn.
- **The yard**: dirt and mud, the well, a woodpile, a midden (a flat prop with flies as a decal; a container of nothing), beehives by the orchard, a cart, the dead family.
- **The lane** comes in from the village, through the yard, and leaves as the drove past the pumpkins to the ford.

**Earns its place:** the biggest fields, the orchard, the tools, the seeds in the granary, the second well; a day's work and two screens of it. The cost: the family in the yard, and the open ground: nowhere to hide between the lane and the barn.

## Long Acre (north-west, the grain farm)

About 44 by 34 tiles between the brook and the mill. Rye is the crop that reads gold from a distance (`docs/art/04`); this farm is where the gold is.

- **The farmhouse**: timber, three rooms (kitchen, bedroom, a store), a porch.
- **The barn** with a **threshing floor** (a laid wooden floor in the middle of a stone-flagged room, a flail on the wall), sacks, a winnowing basket; the **cart shed** (three walls, open front, a cart in it).
- **A haystack** in the yard (2 by 2), a **rick** of sheaves (2 by 2), a well, a woodpile.
- **Fields**: two **rye** fields (12 by 8 each, furrows along y so the drawn `floor_farm_y` is used at scale), one **wheat** field (new crop, 12 by 8), one of **oats**? (cut: two grains are plenty), a strip of **flax** (new crop, for the loom: 6 by 8), a kitchen garden by the house (cabbages, onions as a new crop).
- **The brook** along the north edge with the **footbridge**; the mill's **granary** at the farm's east end so grain goes thirty tiles to be ground.
- **Dead**: two in the rye, one in the barn. **Alive**: nobody at the farm; the miller next door.

**Earns its place:** rye and wheat in quantity, flax for cloth, the mill beside it, the quietest farm (the brook on one side, the river on another, the village road on the third).

## The croft (south-east, across the ford)

A shepherd's holding, about 24 by 20 tiles, reached only by the ford: a two-room **cottage** (stone, a hearth, a bed, a loom? no: a spinning wheel), a **stone sheepfold** (`wall_stone_low`, a gate; empty), a **lambing shed** (a three-walled lean-to), a tiny plot (potatoes and garlic, 4 by 4), a spring with a trough (a 1 by 1 water prop in stone), a woodpile, a rowan tree by the door (the red oak stands in), a **cairn** on the rise behind (a prop). **The shepherd is alive**, with a crook (a staff item, no magic) and a dog's grave by the fold. The croft is the plan's answer to "where would I move to": across water, one gate, two rooms, a well of sorts, and a field; small enough to seal, far enough that nothing comes by accident. **Earns its place:** the base you earn by crossing the ford; the shepherd who "stays"; wool scraps for the loom.

## What farming needs from the map (and the map gives it)

- **Fields already planted at mixed stages**, so the first harvest is there on day one and the growth system (`22`, Q6) has something to show at once; the current square does this on two plots.
- **Both furrow directions** in use (Michael, `02`: farms either way).
- **Seeds somewhere**: the granaries (Hollow's and the mill's), the merchant's storehouse, the gardener's shed at the castle, the witch's jars. Seeds per crop are `22`'s; the map just puts them where they would be.
- **Water near every field**: Hollow's pond and well, Long Acre's brook, the croft's spring, the castle's well. If watering comes (`02` question 16: decided with farming), nothing is more than fifteen tiles from water.
- **Tools near every farm**: the barns. The hoe, the scythe, the watering can, the pitchfork, the flail, the sickle are `22`'s Q8; the barns are where they lie.
- **Fences and gates** round fields: a wall material that passes sight (`10-engine-asks`), so a field reads as a field from the road and a wandering zombie goes round it or through its gate. Fields with no fence are also fine and cheaper; hedges (opaque) make a field a room, which is wrong.
- **New crops**, in the order they pay off: turnip (a root, the poor crop), wheat (bread), beans (tall, a pole crop, a different silhouette), hops (the inn), flax (the loom), onion (a kitchen crop), carrots. Five exist; four more would make every field different. Herbs are their own set (`03`, the herb garden).
- **Fruit trees** as a tree kind with stages: apple first; plum, pear, cherry if the orchard wants variety; a nut tree (walnut) in the manor's garden.
- **The scarecrow**: a prop, outlined, interactable (it wobbles, obviously), and the cousin of the scarecrow men `00` mentions for the gloom: in 1.0 it just stands there, and that is enough to make a player look twice at night.
