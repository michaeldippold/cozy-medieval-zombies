"""The valley: the 1.0 map (docs/29-world, ruled in docs/30), built place by
place. Step 0 laid the bones: the bounds, the river with its bridge and ford,
the roads' skeleton, the forest, and the home cottage at the end of the south
lane. Step 1 adds the village from docs/29/04's plan: the square and the green,
the inn, the chapel with its graveyard and crypt, the trades, the nobles, the
cottages, the toll house. Furniture without art is a labelled dev box (docs/30,
law 7). Steps 4, 5, and 6 add the farms, the castle, and the forest places.

Coordinates follow docs/29/04's village plan (two tiles a character, its corner
at world (56, 84)) and 29/01's overview for the river. A set's contents are
relative to its corner; a building's props to its own corner.

Run from the repo root: python -I tools/mapgen/valley.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from mapgen import MapGen  # noqa: E402

SIZE = 256
HARVEST = {
    "tree_oak_m": 1, "tree_oak_l": 1, "tree_oak_old": 0.5,
    "tree_yellow_m": 1, "tree_yellow_l": 1, "tree_yellow_old": 0.5,
    "tree_orange_m": 1, "tree_orange_l": 1, "tree_orange_old": 0.5,
    "tree_red_m": 1, "tree_red_l": 1, "tree_red_old": 0.5,
    "tree_spire_green_m": 0.5, "tree_spire_green_l": 0.5, "tree_spire_green_old": 0.25,
    "tree_spire_yellow_m": 0.5, "tree_spire_yellow_l": 0.5, "tree_spire_yellow_old": 0.25,
    "tree_spire_orange_m": 0.5, "tree_spire_orange_l": 0.5, "tree_spire_orange_old": 0.25,
    "tree_spire_red_m": 0.5, "tree_spire_red_l": 0.5, "tree_spire_red_old": 0.25,
}

# The village plan's corner (29/04); a plan character is two tiles.
VX, VY = 56, 84


def P(c, r):
    """A plan character (column, row) as a world tile."""
    return (VX + 2 * c, VY + 2 * r)


HIGH_Y = P(0, 37)[1]  # 158: the high street, the square's middle row, the bridge

# ---- furniture shorthands (facings follow docs/17: a 2 by 1 footprint lies along x, 1 by 2 along y) ----
def along_x(sprite, x, y):
    return {"sprite": sprite, "tile": [x, y], "footprint": [2, 1]}


def along_y(sprite, x, y):
    return {"sprite": sprite, "tile": [x, y], "footprint": [1, 2]}


def one(sprite, x, y, **extra):
    return {"sprite": sprite, "tile": [x, y], **extra}


def chair(x, y, facing):
    return {"sprite": "chair", "tile": [x, y], "facing": facing}


def hearth_w(x, y, lit=False):
    """A fireplace backing onto a west wall: the tile and the one below it."""
    p = along_y("fireplace", x, y)
    if lit:
        p.update({"lit": True, "fuel": 3})
    return p


def hearth_n(x, y, lit=False):
    """A fireplace backing onto a north wall: the tile and the one east of it."""
    p = along_x("fireplace", x, y)
    if lit:
        p.update({"lit": True, "fuel": 3})
    return p


def door(side, at, **extra):
    return {"side": side, "at": at, "kind": "door", **extra}


def window(side, at, **extra):
    return {"side": side, "at": at, "kind": "window", **extra}


def part_w(x, y0, n, door_at=None, wall=None):
    p = {"edge": "w", "at": [x, y0], "len": n, "openings": [] if door_at is None else [{"at": door_at, "kind": "door"}]}
    if wall:
        p["wall"] = wall
    return p


def part_n(x0, y, n, door_at=None, wall=None):
    p = {"edge": "n", "at": [x0, y], "len": n, "openings": [] if door_at is None else [{"at": door_at, "kind": "door"}]}
    if wall:
        p["wall"] = wall
    return p


# ---- the cottages (29/04, three plans so they do not repeat) ----
def cottage_a(g, x, y, name, door_side="s", broken=False, torch=True, apple=False):
    """Plan A, the two-room: a living room with the hearth, a bedroom. An 8 by 6 block."""
    s = g.place(name, [x, y, 8, 6])
    openings = [door("s", 1, broken=broken) if door_side == "s" else door("n", 1, broken=broken), window("s" if door_side == "n" else "n", 4), window("e", 1)]
    s.building(
        [1, 1, 6, 4], "wall_wood", "floor_wood",
        openings=openings,
        partitions=[part_w(3, 0, 4, door_at=2)],
        # The living room keeps a way from its door to the partition door at row 2 (the dead must be able to stand there,
        # #134): the table lies across row 1 from the south door's side, and across row 3 from the north door's.
        props=([hearth_w(0, 1), along_x("table", 1, 1), chair(1, 2, "n"), one("chest", 0, 3)] if door_side == "s"
               else [hearth_w(0, 1), along_x("table", 1, 3), chair(1, 2, "s"), one("chest", 0, 3)]) + [along_x("bed", 3, 0), one("chest", 5, 3)],
        brackets=[{"side": "w", "at": 0, "facing": "in", **({"lantern": True} if torch else {"torch": False})}],
    )
    s.prop("woodpile", (7, 4))
    if apple:
        s.prop("tree_apple", (7, 5))  # a tree in the garden, reachable early (#190; Michael, 2026-10-18: apples are part of production)
    return s


def cottage_b(g, x, y, name):
    """Plan B, the long house: one long room, the hearth at one end and the byre
    at the other behind a low rail (a see-through wall splits no room). 8 by 8."""
    s = g.place(name, [x, y, 8, 8])
    s.building(
        [1, 1, 6, 6], "wall_wood", "floor_wood",
        openings=[door("s", 1), window("w", 1), window("e", 4)],
        partitions=[part_n(0, 4, 6, door_at=2, wall="wall_fence")],
        props=[hearth_n(1, 0), along_x("bed", 3, 0), one("chest", 5, 1), along_y("table", 0, 1), chair(1, 2, "w"), one("barrel", 0, 5), one("barrel", 2, 5), one("haystack", 5, 5)],
        brackets=[{"side": "n", "at": 4, "facing": "in", "lantern": True}],
    )
    return s


def cottage_c(g, x, y, name, trade):
    """Plan C, the L-shape: two rooms and a lean-to workshop at the back. 10 by 10."""
    s = g.place(name, [x, y, 10, 10])
    s.building(
        [1, 1, 6, 4], "wall_wood", "floor_wood",
        openings=[door("s", 1), window("n", 1), window("n", 4)],
        partitions=[part_w(3, 0, 4, door_at=2)],
        props=[hearth_w(0, 1), along_x("table", 1, 1), chair(1, 2, "n"), along_x("bed", 3, 0), one("chest", 5, 3)],
        brackets=[{"side": "w", "at": 0, "facing": "in", "lantern": True}],
    )
    # The lean-to shares the main room's east wall; its door is on its own west side (laid after, so it wins the edge).
    s.building(
        [7, 1, 2, 4], "wall_wood", "floor_wood",
        openings=[door("w", 1), window("e", 2)],
        props=[one("shelf", 1, 0), one("barrel", 0, 3)] if trade == "cooper" else [one("shelf", 1, 0), one("workbench", 0, 3)],
    )
    return s


def build():
    g = MapGen("The valley", SIZE, spawn=(104, 216))
    g.biome("harvest", HARVEST, scale=9)

    # ================= step 0: the bones =================
    # The river (29/01, 29/02): top to bottom, a little east of centre, bulging west by the mill.
    river = [(120, 0), (118, 36), (112, 56), (118, 80), (122, 110), (124, 170), (130, 190), (136, 212), (140, 256)]
    g.river(river, width=5, bank=1)
    g.floor_rect([116, HIGH_Y - 1, 18, 3], "floor_stone", kind="bridge", note="the stone bridge (29/02); floor_bridge_stone when drawn")
    g.shallow([132, 206, 7, 3], note="the ford (29/02): the drove crosses here; the water and its banks, nothing wider")

    # The roads' skeleton (29/02).
    g.road([(P(14, 37)[0], HIGH_Y), (116, HIGH_Y)], 3, "floor_cobble", group="high street")
    g.road([(0, HIGH_Y), (P(14, 37)[0], HIGH_Y)], 3, "floor_dirt", group="west road")
    g.road([(134, HIGH_Y), (140, HIGH_Y)], 3, "floor_cobble", group="bridge road")
    sq = P(14, 34)
    g.floor_rect([sq[0], sq[1], 12, 12], "floor_cobble", group="square")
    g.road([P(17, 8), P(17, 34)], 3, "floor_cobble", group="nobles street")
    g.road([P(17, 49), P(17, 71)], 2, "floor_dirt", group="south lane")
    g.road([P(4, 64), P(26, 64)], 2, "floor_dirt", group="the lane")
    g.road([P(26, 64), (131, 207)], 2, "floor_dirt", group="drove")
    g.road([(141, 207), (160, 207)], 2, "floor_dirt", group="drove")
    # The square's two lanes off it (29/04): the baker's corner and the smithy's.
    g.road([P(10, 40), P(14, 40)], 2, "floor_dirt", group="lane")
    g.road([P(20, 49), P(20, 53)], 2, "floor_dirt", group="lane")

    # The home: the end cottage on the south lane (29/07, option A; ruled in 30).
    home = g.place("your cottage", [98, 212, 16, 12], padding=1)
    home.building(
        [1, 1, 7, 5], "wall_wood", "floor_wood",
        openings=[door("s", 1), window("s", 5), window("n", 2), window("e", 2)],
        partitions=[part_w(4, 0, 5, door_at=3)],
        props=[hearth_w(0, 1), along_x("table", 1, 2), chair(1, 1, "s"), chair(1, 3, "n"), one("chest", 3, 4),
               along_x("bed", 5, 0), one("chest", 6, 4), one("shelf", 4, 4)],
        brackets=[{"side": "w", "at": 0, "facing": "in", "lantern": True}],
    )
    home.crops([9, 1, 6, 6], ["potato", "cabbage"], stages=(1, 2, 2), seed=3)
    home.prop("well", (9, 9))
    home.prop("barrel", (11, 9))
    home.prop("woodpile", (13, 9))
    home.fence([0, 0, 16, 12], gates=[{"side": "s", "at": 4}, {"side": "w", "at": 9}])

    # ================= step 1: the village (29/04) =================
    # ---- the square: the well, the cross, the stalls, the trough, the board, the stocks, lamps ----
    g.prop("well", (sq[0] + 5, sq[1] + 5), note="the square's well (29/04)")
    g.prop("marketcross", (sq[0] + 6, sq[1]))
    for i, x in enumerate([sq[0], sq[0] + 3, sq[0] + 8, sq[0] + 10]):
        g.prop("stall", (x, sq[1]), footprint=[2, 1], note=["vegetables", "cloth", "pots", "knives"][i])
    g.prop("trough", (sq[0] + 2, sq[1] + 8), footprint=[2, 1])
    g.prop("noticeboard", (sq[0] + 11, sq[1] + 7), note="by the inn's door; the quest board of 1.1")
    g.prop("stocks", (sq[0] + 11, sq[1] + 11))
    for x, y in [(sq[0], sq[1] + 11), (sq[0] + 11, sq[1] + 2), (sq[0], sq[1] + 2)]:
        g.prop("lantern_post", (x, y))  # the square's lamps: lanterns, steady and never out (they were torches until #156)

    # ---- the green: the pond with its dirt bank, benches, the maypole, a woodpile ----
    pond = P(15, 53)
    g.floor_rect([pond[0] - 1, pond[1] - 1, 8, 8], "floor_dirt", kind="bank")
    g.floor_rect([pond[0], pond[1], 6, 6], "floor_water", kind="water", note="the duck pond (29/04)")
    g.prop("maypole", P(13, 51))
    g.prop("bench", (pond[0] - 2, pond[1] + 2), facing="e")
    g.prop("bench", (pond[0] + 7, pond[1] + 3), facing="w")
    g.prop("woodpile", P(19, 62))

    # ---- the inn (the square's east side): the taproom and kitchen, the guest wing, the yard ----
    inn = g.place("the inn", [P(21, 33)[0], P(21, 33)[1], 18, 30])
    inn.building(
        [1, 1, 12, 10], "wall_wood", "floor_wood",
        openings=[door("w", 4), window("w", 1, boards={"in": 3}), window("w", 7, boards={"in": 3}), window("n", 2, boards={"in": 3}), window("n", 9), door("e", 8)],
        partitions=[part_w(8, 0, 10, door_at=3)],
        props=[
            one("counter", 5, 0, footprint=[3, 1]), one("barrel", 7, 1), one("barrel", 7, 2),
            along_x("table", 1, 2), chair(1, 1, "s"), chair(2, 1, "s"), chair(1, 3, "n"), chair(2, 3, "n"),
            along_x("table", 1, 6), chair(1, 5, "s"), chair(2, 5, "s"), chair(1, 7, "n"), chair(2, 7, "n"),
            along_y("table", 5, 4), chair(4, 4, "e"), chair(6, 5, "w"),
            hearth_w(0, 8, lit=True),
            # the kitchen
            hearth_n(9, 0, lit=True), along_x("table", 9, 3), one("shelf", 11, 2), one("barrel", 11, 4), one("cupboard", 8, 6), one("barrel", 11, 9),
        ],
        brackets=[{"side": "n", "at": 5, "facing": "in", "lantern": True}, {"side": "w", "at": 4, "facing": "out", "lantern": True}],
    )
    # The guest wing: three rooms off the taproom's south wall, each with a door into it.
    inn.building(
        [1, 11, 12, 5], "wall_wood", "floor_wood",
        openings=[door("n", 1), door("n", 5), door("n", 9), window("s", 2), window("s", 6), window("s", 10)],
        partitions=[part_w(4, 0, 5), part_w(8, 0, 5)],
        props=[along_x("bed", 0, 2), one("chest", 3, 0), along_x("bed", 4, 2), one("chest", 7, 0), along_x("bed", 8, 2), one("chest", 11, 0)],
        brackets=[{"side": "s", "at": 0, "facing": "in", "lantern": True}, {"side": "s", "at": 8, "facing": "in", "lantern": True}],
    )
    inn.fence([0, 17, 18, 12], gates=[{"side": "w", "at": 6}])
    inn.prop("well", (3, 20))
    inn.prop("woodpile", (6, 19))
    inn.prop("privy", (16, 27))
    inn.prop("cart", (10, 22), footprint=[2, 3])
    inn.prop("trough", (13, 19), footprint=[2, 1])

    # ---- the chapel, the graveyard, the crypt (the top of the nobles' street) ----
    gy = P(9, 0)
    g.fence([gy[0], gy[1], 32, 14], gates=[{"side": "s", "at": 17}], note="the graveyard's wall (a low stone wall when drawn); the lychgate on the street")
    chapel = g.place("the chapel", [P(14, 1)[0], P(14, 1)[1], 12, 12])
    chapel.building(
        [1, 1, 10, 10], "wall_stone", "floor_stone",
        openings=[door("s", 4), window("w", 2), window("w", 6), window("e", 6)],
        partitions=[part_w(8, 0, 4, door_at=2)],
        props=[
            along_x("altar", 4, 0), one("lectern", 6, 1), one("font", 1, 8),
            along_x("pew", 1, 3), along_x("pew", 1, 5), along_x("pew", 1, 7), along_x("pew", 5, 3), along_x("pew", 5, 5), along_x("pew", 5, 7),
            one("chest", 9, 0), one("cupboard", 9, 3),
        ],
        brackets=[{"side": "n", "at": 2, "facing": "in", "torch": False}, {"side": "n", "at": 7, "facing": "in", "torch": False}],
    )
    # Headstones in rows either side of the chapel, and the crypt in the north-east corner.
    pr = P(21, 2)  # the priest's house stands among the stones' rows; no stone stands in it (one did, in its walkway)
    for x in range(gy[0] + 2, gy[0] + 9, 2):
        for y in range(gy[1] + 2, gy[1] + 12, 3):
            if not (pr[0] <= x < pr[0] + 8 and pr[1] <= y < pr[1] + 8):
                g.prop("headstone", (x, y))
    for x in range(gy[0] + 23, gy[0] + 30, 2):
        for y in range(gy[1] + 7, gy[1] + 12, 3):
            if not (pr[0] <= x < pr[0] + 8 and pr[1] <= y < pr[1] + 8):
                g.prop("headstone", (x, y))
    crypt = g.place("the crypt", [gy[0] + 25, gy[1] + 1, 6, 6])
    crypt.building([1, 1, 4, 4], "wall_stone", "floor_stone", openings=[door("w", 2)],
                   props=[along_y("coffin", 0, 0), along_y("coffin", 3, 0), one("chest", 3, 3)],
                   brackets=[{"side": "n", "at": 1, "facing": "in", "torch": False}])

    # ---- the priest's house, east of the chapel ----
    priest = g.place("the priest's house", [P(21, 2)[0], P(21, 2)[1], 8, 8])
    priest.building([1, 1, 6, 6], "wall_wood", "floor_wood",
                    openings=[door("s", 1, boards={"in": 2}), window("e", 2)],
                    partitions=[part_w(3, 0, 6, door_at=3)],
                    props=[hearth_w(0, 1), along_x("table", 1, 4), chair(2, 5, "n"), one("bookcase", 2, 0), along_y("bed", 5, 0), one("chest", 5, 5)],
                    brackets=[{"side": "n", "at": 4, "facing": "in", "lantern": True}])

    # ---- the manor: a stone house in a walled garden, east of the nobles' street ----
    man = g.place("the manor", [P(19, 16)[0], P(19, 16)[1], 16, 34])
    man.building(
        [1, 1, 12, 10], "wall_stone", "floor_stone",
        openings=[door("w", 3), window("w", 7), window("n", 3), window("n", 9), window("e", 2), window("e", 7), door("s", 9)],
        partitions=[part_w(7, 0, 10, door_at=5), part_n(0, 6, 7, door_at=3)],
        props=[
            # the hall
            hearth_n(2, 0), along_y("table", 3, 2), chair(2, 2, "e"), chair(2, 3, "e"), chair(4, 2, "w"), chair(4, 3, "w"), one("cupboard", 6, 0), one("chest", 0, 5),
            # the kitchen (south of the hall)
            hearth_w(0, 7), along_x("table", 2, 7), one("barrel", 5, 9), one("shelf", 6, 6), one("cupboard", 6, 9),
            # the solar and bedroom (east)
            along_x("bed", 8, 1), one("chest", 11, 0), one("bookcase", 7, 0), one("desk", 10, 4), chair(10, 5, "n"), one("strongbox", 11, 9), one("cupboard", 8, 9),
        ],
        brackets=[{"side": "n", "at": 6, "facing": "in", "lantern": True}, {"side": "e", "at": 5, "facing": "in", "lantern": True}],
    )
    man.fence([0, 12, 16, 22], gates=[{"side": "w", "at": 6}, {"side": "e", "at": 14}], wall="wall_fence")
    man.floor_rect([2, 14, 12, 8], "floor_grass")
    man.prop("bench", (4, 16), facing="s")
    man.prop("bench", (10, 16), facing="s")
    for i in range(3):
        man.prop("beehive", (3 + i * 3, 24))
    man.floor_rect([9, 26, 4, 4], "floor_dirt")
    man.floor_rect([10, 27, 2, 2], "floor_water")
    man.prop("trough", (2, 30), footprint=[2, 1])

    # ---- the merchant's house, west of the nobles' street: the house, the yard, the storehouse ----
    mer = g.place("the merchant's house", [P(8, 20)[0], P(8, 20)[1], 12, 24])
    mer.building(
        [1, 1, 10, 10], "wall_stone", "floor_stone",
        openings=[door("e", 2), window("e", 7), window("n", 2), window("w", 2), window("w", 7), door("s", 7)],
        partitions=[part_w(5, 0, 10, door_at=2), part_n(5, 5, 5, door_at=2)],
        props=[
            hearth_w(0, 1), along_y("table", 2, 3), chair(1, 3, "e"), chair(3, 4, "w"), one("cupboard", 4, 0), one("shelf", 0, 8), one("chest", 4, 9),
            one("desk", 6, 1), chair(6, 2, "n"), one("strongbox", 9, 0), one("bookcase", 9, 3),
            along_x("bed", 6, 7), one("chest", 9, 9), one("cupboard", 9, 6),
        ],
        brackets=[{"side": "n", "at": 7, "facing": "in", "lantern": True}, {"side": "w", "at": 5, "facing": "in", "lantern": True}],
    )
    mer.fence([0, 12, 12, 12], gates=[{"side": "e", "at": 5}])
    mer.building([1, 13, 8, 6], "wall_wood", "floor_wood", openings=[door("e", 2)],
                 props=[one("shelf", 0, 0), one("shelf", 2, 0), one("shelf", 4, 0), one("chest", 7, 0), one("barrel", 0, 5), one("barrel", 1, 5), one("chest", 7, 5), one("cupboard", 4, 5)],
                 brackets=[{"side": "n", "at": 6, "facing": "in", "lantern": True}])
    mer.prop("cart", (10, 20), footprint=[2, 3])

    # ---- the trades round the square ----
    # The baker, the square's north-west corner: the oven in the shop wall, a room behind.
    bak = g.place("the baker", [P(9, 46)[0], P(9, 46)[1], 8, 6])
    bak.building([1, 1, 6, 4], "wall_wood", "floor_wood",
                 openings=[door("n", 2), window("n", 3)],
                 partitions=[part_w(4, 0, 4, door_at=2)],
                 props=[one("oven", 0, 0, footprint=[2, 1], lit=True, fuel=2), along_x("table", 1, 2), one("shelf", 3, 0), one("barrel", 0, 3), along_y("bed", 5, 0), one("chest", 4, 3)],
                 brackets=[{"side": "n", "at": 5, "facing": "in", "lantern": True}])
    # The joiner, south-west of the square: the workshop, the home behind, the lumber yard.
    joi = g.place("the joiner", [P(7, 49)[0], P(7, 49)[1], 10, 14])
    joi.building([1, 1, 8, 5], "wall_wood", "floor_wood",
                 openings=[door("e", 2), window("n", 2), window("n", 5)],
                 props=[one("workbench", 1, 1, footprint=[2, 1]), along_x("table", 4, 1), one("shelf", 7, 0), one("shelf", 0, 0), one("barrel", 7, 4), one("chest", 0, 4)],
                 brackets=[{"side": "n", "at": 4, "facing": "in", "lantern": True}])
    joi.building([1, 6, 8, 5], "wall_wood", "floor_wood",
                 openings=[door("n", 3), window("w", 2), window("e", 3)],
                 partitions=[part_w(4, 0, 5, door_at=2)],
                 props=[hearth_w(0, 1), along_x("table", 1, 3), chair(2, 4, "n"), along_x("bed", 5, 0), one("chest", 7, 4)])
    joi.prop("sawpit", (2, 12), footprint=[2, 1])
    joi.prop("woodpile", (6, 12))
    joi.prop("woodpile", (7, 12))
    joi.prop("wheelbarrow", (0, 12), note="the joiner's wheelbarrow (docs/30 section 9.1)")
    # The weaver, west of the square on the west road: the loom, the vats in the yard.
    wea = g.place("the weaver", [P(5, 32)[0], P(5, 32)[1], 14, 10])
    wea.building([1, 1, 8, 6], "wall_wood", "floor_wood",
                 openings=[door("s", 2), window("s", 6), window("n", 2)],
                 partitions=[part_w(5, 0, 6, door_at=2)],
                 props=[one("loom", 1, 1, footprint=[2, 2]), one("spinningwheel", 4, 1), one("shelf", 0, 0), one("cupboard", 4, 5), along_x("bed", 6, 0), one("chest", 7, 5), hearth_w(5, 3)],
                 brackets=[{"side": "n", "at": 6, "facing": "in", "lantern": True}])
    for i in range(3):
        wea.prop("dyevat", (10 + i, 3))
    wea.prop("woodpile", (12, 7))
    # The smithy, south-east of the square by the river: the open forge, the home beside it.
    smi = g.place("the smithy", [P(21, 50)[0], P(21, 50)[1], 12, 12])
    smi.building([1, 1, 6, 5], "wall_wood", "floor_stone",
                 openings=[door("s", 1, open=True), door("s", 4, open=True), window("n", 3)],
                 props=[one("forge", 1, 0, footprint=[2, 1]), one("anvil", 2, 2), one("barrel", 4, 2), one("grindstone", 3, 4), one("shelf", 0, 0), one("chest", 0, 4)],
                 brackets=[{"side": "n", "at": 5, "facing": "in", "lantern": True}])
    smi.building([7, 1, 4, 5], "wall_wood", "floor_wood", openings=[door("w", 2), window("e", 1)],
                 props=[along_y("bed", 3, 0), one("chest", 3, 4), one("cupboard", 0, 4)])
    smi.prop("woodpile", (1, 8))
    smi.prop("cart", (6, 7), footprint=[2, 3])

    # ---- the toll house by the bridge ----
    toll = g.place("the toll house", [P(28, 45)[0], P(28, 45)[1], 6, 8])
    toll.building([1, 1, 4, 4], "wall_wood", "floor_wood", openings=[door("w", 1), window("n", 2)],
                  props=[one("strongbox", 3, 0), along_y("bed", 0, 2), one("chest", 3, 3), one("shelf", 2, 0)],
                  brackets=[{"side": "w", "at": 3, "facing": "out", "lantern": True}])

    # ---- the cottages: two plans by the nobles' street, two by the green, four on the lane ----
    cottage_a(g, *P(1, 23), "a cottage by the merchant's", apple=True)
    cottage_b(g, *P(1, 27), "the cooper's long house")
    cottage_a(g, *P(1, 47), "a cottage by the baker's", door_side="n", apple=True)
    cottage_c(g, *P(1, 52), "the chandler's house", trade="chandler")
    cottage_a(g, *P(2, 65), "the first cottage on the lane", door_side="n", broken=True, apple=True)   # the door kicked in
    cottage_b(g, *P(7, 65), "the second cottage on the lane")
    cottage_a(g, *P(12, 65), "the shut cottage", door_side="n", torch=False)             # a neighbour inside who will not open
    # The reeve's house at the row's end by the green: stone at the back, wood at the front.
    reeve = g.place("the reeve's house", [P(17, 65)[0], P(17, 65)[1], 8, 6])
    reeve.building([1, 1, 6, 4], {"n": "wall_stone", "w": "wall_stone", "s": "wall_wood", "e": "wall_wood"}, "floor_wood",
                   openings=[door("n", 1), window("n", 4), window("e", 1)],
                   partitions=[part_w(3, 0, 4, door_at=2)],
                   props=[hearth_w(0, 1), along_x("table", 1, 3), chair(1, 2, "s"), one("desk", 0, 3), along_x("bed", 3, 0), one("chest", 5, 3), one("bookcase", 3, 3)],
                   brackets=[{"side": "n", "at": 5, "facing": "in", "lantern": True}])

    # ---- Hollow Farm's orchard (29/05, "the orchard"; #190): apple trees in staggered rows on grass, a barrel or two. The rest of the farm is step 4's. ----
    orchard = g.place("the orchard", [38, 232, 16, 18])
    for j in range(5):
        for i in range(4):
            x = 2 + 3 * i + (1 if j % 2 else 0)
            orchard.prop("tree_apple", (x, 2 + 3 * j))
    orchard.prop("barrel", (1, 16))
    orchard.prop("barrel", (3, 16))

    # ---- reserves: the castle (step 5) and the farms (step 4) take no forest yet ----
    g.reserve([VX, VY, 64, 144])      # the village block, 29/04's plan
    g.reserve([136, 126, 66, 64])     # the castle's compound (29/03 at (140, 130)) with its moat
    g.reserve([36, 230, 64, 26])      # Hollow Farm's ground south of the lane (29/05), shifted clear of the cottages
    g.reserve([64, 24, 56, 44])       # Long Acre and the mill (29/05)

    # ---- the forest: everywhere else, thicker than the proving ground's ----
    g.scatter([0, 0, SIZE, SIZE], "harvest", (0.05, 0.16), seed=11)
    g.wild("harvest", (0.0405, 0.1305), seed=21, zombies_per_chunk=(0, 2),
           rocks={"kinds": {"rock_0": 1, "rock_1": 1, "rock_2": 1, "rock_3": 1}, "cell": 40, "chance": 0.6, "seed": 51})
    g.forage({"mushroom_0": 1, "mushroom_1": 1, "mushroom_2": 1, "mushroom_3": 1, "mushroom_4": 1}, chance=0.021, near=2, seed=41)

    # ---- the dead (29/08): the streets and the square, the bridge's two ends, the graveyard, the trades, the nobles, the cottages ----
    dead = []
    dead += [(sq[0] + 3, sq[1] + 3), (sq[0] + 9, sq[1] + 9), (sq[0] + 8, sq[1] + 4), (sq[0] + 2, sq[1] + 10)]          # the square
    dead += [P(17, 12), P(17, 26), P(16, 30)]                                                                         # the nobles' street
    dead += [P(17, 52), P(17, 58), P(10, 64), P(22, 64), P(12, 40)]                                                     # the lanes
    dead += [(114, HIGH_Y + 2), (115, HIGH_Y - 2), (113, HIGH_Y + 3), (117, HIGH_Y - 3), (112, HIGH_Y), (116, HIGH_Y + 1)]  # the toll gate's knot
    dead += [(135, HIGH_Y + 1), (136, HIGH_Y - 2), (137, HIGH_Y + 2), (138, HIGH_Y)]                                  # the castle end
    dead += [(gy[0] + 3, gy[1] + 4), (gy[0] + 7, gy[1] + 10), (gy[0] + 5, gy[1] + 7), (gy[0] + 24, gy[1] + 9), (gy[0] + 28, gy[1] + 12), (gy[0] + 13, gy[1] + 12), (gy[0] + 20, gy[1] + 12), (gy[0] + 10, gy[1] + 1)]  # the graveyard, rising
    dead += [(smi.x + 2, smi.y + 7), (bak.x + 3, bak.y + 0), (joi.x + 9, joi.y + 3), (wea.x + 9, wea.y + 8)]           # the trades, at their work
    dead += [(mer.x + 4, mer.y + 4), (mer.x + 2, mer.y + 15), (man.x + 8, man.y + 18)]                                 # the nobles
    dead += [P(5, 24), P(9, 63), P(3, 50)]                                                                             # the cottages
    for x, y in dead:
        g.zombie(x, y)

    # ---- the living (29/08's cast; names are Michael's to give, placeholders until then) ----
    g.villager((inn.x + 6, inn.y + 3), "Innkeeper", 0, "Shut that behind you.", immune=True)  # the steady ones: they will teach, so they cannot die (#180)
    g.villager((inn.x + 3, inn.y + 12), "Guest", 1, "I only stopped for the night.")
    g.villager((inn.x + 4, inn.y + 6), "Child", 5)
    g.villager((chapel.x + 9, chapel.y + 2), "Priest", 2, "The bell stopped on the third day.", immune=True)
    g.villager((reeve.x + 2, reeve.y + 3), "Reeve", 3, "I have the keys and no one to give them to.")
    g.villager((mer.x + 4, mer.y + 16), "Apprentice", 4, "It is all here. Every bale. Nobody to buy it.")
    g.villager((P(12, 65)[0] + 2, P(12, 65)[1] + 3), "Neighbour", 1, "Go away.")

    return g


if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    out = os.path.join(root, "data", "maps", "valley.json")
    build().write(out)
    print("wrote", out)
