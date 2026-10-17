// Copied from cozy-zombie-game src/placeholders.js on 2026-10-09 and re-themed
// the same day for docs/06-art.md: thick patterned walls, windows as shuttered
// holes with no glass, plank doors and leaves with metal strips, brown-trunked
// trees, the jack-o'-lantern, sleeves on the player.
// Placeholder sprite sheet generation. Everything here produces the same sheet
// shape that assets.js builds from a real PNG + JSON, so real art can replace
// any of it without code changes. (The parent's docs/03-rendering.md describes
// the sheet shape; this repo's docs/06 holds the palette.)

import { TW, TH, HW, HH } from "./iso.js";
import { shade, poly } from "./render-util.js";

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  return { canvas: c, ctx };
}

// ---------------------------------------------------------------------------
// Flat floor tile: two frames, base and alternate, for a subtle checker.
// Anchor is the diamond center.
// ---------------------------------------------------------------------------
export function generateFlat(ph) {
  const { canvas, ctx } = makeCanvas(TW * 2, TH);
  const colors = [ph.color, ph.alt || ph.color];
  const frames = {};
  colors.forEach((color, i) => {
    const cx = i * TW + HW;
    const cy = HH;
    poly(ctx, [[cx, 0], [cx + HW, cy], [cx, TH], [cx - HW, cy]]);
    ctx.fillStyle = color;
    ctx.fill();
    // The outline drew the grid on every floor; the earth kinds go without it
    // (`outline: false`) now that the ground is baked (docs/15).
    if (ph.outline !== false) {
      ctx.strokeStyle = shade(ph.color, 0.85);
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    if (ph.lines) {
      // Furrows: lines parallel to the tile's north-east edge, for farm plots.
      ctx.save();
      poly(ctx, [[cx, 0], [cx + HW, cy], [cx, TH], [cx - HW, cy]]);
      ctx.clip();
      ctx.strokeStyle = ph.lines;
      ctx.lineWidth = 2;
      // Each furrow runs parallel to the south-west edge and is offset along
      // the north-west edge direction, so the set sweeps across the diamond.
      for (let k = 1; k <= 5; k++) {
        const ox = k * (HW / 3);
        ctx.beginPath();
        ctx.moveTo(cx - HW + ox, cy - ox / 2);
        ctx.lineTo(cx + ox, TH - ox / 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    frames[`idle_${i}`] = [i * TW, 0, TW, TH];
  });
  return {
    image: canvas,
    frames,
    anchor: [HW, HH],
    animations: { idle: { fps: 0, loop: false, frames: 2 } },
    facings: [],
    mirror: {},
  };
}

// ---------------------------------------------------------------------------
// Wall segment: frames north_0 and west_0, plus door and window variants.
// Anchor is the tile center of the tile the segment belongs to.
// ---------------------------------------------------------------------------
// Wall thickness in screen pixels: the top face and end caps extend this far
// "behind" the wall plane, which sells the diorama look.
// Thicker than the parent's 6 px: thin reads modern, thick reads chonky and
// cosy (Michael, 2026-10-09); thicker again on 2026-10-11.
// 18 since 2026-10-11 (Michael: half again as thick), with 80 px walls.
export const WALL_T = 18;

// Openings in pixels from the floor, the same whatever the wall's height, so a
// taller wall only adds wall above them (Michael, 2026-10-11: the door got
// "comically large" with the walls). Their sizes on the old 64 px walls, the
// door then a hair shorter (51 to 48, Michael, on the 80 px walls).
export const DOOR_TOP = 48;
export const WINDOW_SILL = 22;
export const WINDOW_TOP = 51;
export const BRACKET_UP = 32; // a torch bracket's height on its wall

// Fittings are the same wood everywhere, whatever the wall: doors and shutters
// are vertical planks with dark metal strips across them (Michael, 2026-10-09:
// "I know this is not a thing but I like how it sounds").
export const WOOD = "#5e4028";
export const METAL = "#2b2a32";

// A plank leaf in the quad [p0, p1, p2, p3] (p0 and p3 are the bottom corners,
// p1 and p2 the top), with `strips` metal bands across it.
export function drawPlankLeaf(ctx, quad, strips = 2, shadeF = 1) {
  const [p0, p1, p2, p3] = quad;
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  ctx.fillStyle = shade(WOOD, shadeF);
  poly(ctx, quad);
  ctx.fill();
  ctx.strokeStyle = shade(WOOD, shadeF * 0.7);
  ctx.lineWidth = 1;
  for (const t of [0.33, 0.66]) {
    const a = lerp(p0, p3, t);
    const b = lerp(p1, p2, t);
    ctx.beginPath();
    ctx.moveTo(a[0] + 0.5, a[1]);
    ctx.lineTo(b[0] + 0.5, b[1]);
    ctx.stroke();
  }
  ctx.strokeStyle = METAL;
  ctx.lineWidth = 3;
  const bands = strips === 1 ? [0.5] : [0.3, 0.7];
  for (const t of bands) {
    const a = lerp(p0, p1, t);
    const b = lerp(p3, p2, t);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }
  ctx.strokeStyle = shade(WOOD, shadeF * 0.5);
  ctx.lineWidth = 1;
  poly(ctx, quad);
  ctx.stroke();
}

export function generateWall(ph) {
  const h = ph.height;
  const T = ph.thickness ?? WALL_T;
  const fw = HW + T;
  const fh = HH + h + T / 2;
  // Boards (docs/09): one frame per count, over a shut leaf and over an open
  // or broken one, so one plank looks like one plank (Michael, 2026-10-10).
  const boardVariants = [];
  for (let n = 1; n <= 3; n++) boardVariants.push(`boarded${n}`, `window_shut_boarded${n}`, `door_boarded${n}`, `door_shut_boarded${n}`);
  const variants = ["plain", "door", "door_shut", "window", "window_shut", "window_broken", "stairs", "cap", ...boardVariants];
  const sides = ["north", "west"];
  // Near-edge stubs (south, east): low cutaway walls with their own small frames.
  const nearVariants = ["plain", "door", "door_shut", "window", "window_shut", "window_broken", "boarded", "door_boarded", "stairs"];
  const nearSides = ["south", "east"];
  const nfw = HW;
  const nfh = NEAR_FRAME_H + HH;
  const { canvas, ctx } = makeCanvas(
    Math.max(fw * variants.length, nfw * nearVariants.length),
    fh * sides.length + nfh * nearSides.length,
  );
  const frames = {};
  nearSides.forEach((side, row) => {
    nearVariants.forEach((variant, col) => {
      const ox = col * nfw;
      const oy = fh * sides.length + row * nfh;
      drawNearVariant(ctx, ox, oy, side, variant, ph);
      frames[`${side}_${variant}_0`] = [ox, oy, nfw, nfh];
    });
  });
  sides.forEach((side, row) => {
    variants.forEach((variant, col) => {
      const ox = col * fw;
      const oy = row * fh;
      drawWallVariant(ctx, ox, oy, side, variant, ph, T);
      frames[`${side}_${variant}_0`] = [ox, oy, fw, fh];
    });
  });
  return {
    image: canvas,
    frames,
    // North frames extend T px to the right of the segment; west frames T px to the left.
    // Anchor is the tile's top vertex column for north, its left vertex column for west.
    anchor: [0, fh],
    anchorWest: [fw, fh],
    anchorSouth: [HW, NEAR_FRAME_H],
    anchorEast: [0, NEAR_FRAME_H],
    wallHeight: h,
    thickness: T, // per material (data/sprites/wall_*.json), WALL_T if unset
    color: ph.color,
    pattern: ph.pattern || null,
    animations: {},
    facings: [],
    mirror: {},
  };
}

// Near-edge stub: a low wall along a near edge of an interior. Doors are gaps,
// windows are short frames standing on the stub.
export const NEAR_STUB = 8; // px, height of the stub
const NEAR_FRAME_H = 30; // px of headroom in a near frame, for window posts
const NEAR_WINDOW_H = 26;

function drawNearVariant(ctx, ox, oy, side, variant, ph) {
  if ((variant.startsWith("door") && variant !== "door_shut") || variant === "stairs") return; // a gap
  const color = ph.color;
  // South edge runs from the left vertex to the bottom vertex of the tile;
  // east edge from the bottom vertex to the right vertex.
  const a = side === "south" ? [0, NEAR_FRAME_H] : [0, NEAR_FRAME_H + HH];
  const b = side === "south" ? [HW, NEAR_FRAME_H + HH] : [HW, NEAR_FRAME_H];
  const lerp = (t, y) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - y];
  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = shade(color, side === "south" ? 0.62 : 0.5);
  poly(ctx, [a, b, [b[0], b[1] - NEAR_STUB], [a[0], a[1] - NEAR_STUB]]);
  ctx.fill();
  ctx.strokeStyle = shade(color, 1.1);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1] - NEAR_STUB);
  ctx.lineTo(b[0], b[1] - NEAR_STUB);
  ctx.stroke();

  if (variant === "door_shut") {
    // A closed door on a stub: a short plank panel standing in the gap.
    const lerpD = (t, y) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - y];
    drawPlankLeaf(ctx, [lerpD(0.18, 0), lerpD(0.18, NEAR_WINDOW_H), lerpD(0.82, NEAR_WINDOW_H), lerpD(0.82, 0)], 2);
    ctx.restore();
    return;
  }
  if (variant.startsWith("window") || variant === "boarded") {
    const t0 = 0.2;
    const t1 = 0.8;
    if (variant === "window_shut") {
      drawPlankLeaf(ctx, [lerp(t0, NEAR_STUB), lerp(t0, NEAR_WINDOW_H), lerp(t1, NEAR_WINDOW_H), lerp(t1, NEAR_STUB)], 1);
    } else if (variant !== "window_broken") {
      // Open: nothing in the frame.
    } else {
      ctx.strokeStyle = "#cfe6f0";
      ctx.lineWidth = 1;
      const s0 = lerp(t0 + 0.05, NEAR_STUB);
      const s1 = lerp(t0 + 0.18, NEAR_STUB + 9);
      const s2 = lerp(t1 - 0.05, NEAR_STUB);
      const s3 = lerp(t1 - 0.2, NEAR_STUB + 7);
      ctx.beginPath();
      ctx.moveTo(s0[0], s0[1]);
      ctx.lineTo(s1[0], s1[1]);
      ctx.moveTo(s2[0], s2[1]);
      ctx.lineTo(s3[0], s3[1]);
      ctx.stroke();
    }
    // Frame: two posts and a top bar.
    ctx.strokeStyle = shade(color, 0.45);
    ctx.lineWidth = 2;
    ctx.beginPath();
    const p0 = lerp(t0, NEAR_STUB);
    const p1 = lerp(t0, NEAR_WINDOW_H);
    const p2 = lerp(t1, NEAR_WINDOW_H);
    const p3 = lerp(t1, NEAR_STUB);
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
    ctx.lineTo(p3[0], p3[1]);
    ctx.stroke();
    if (variant === "boarded") {
      ctx.strokeStyle = "#8a6a3a";
      ctx.lineWidth = 4;
      for (const yy of [NEAR_STUB + 4, NEAR_STUB + 11, NEAR_STUB + 18]) {
        const q0 = lerp(t0 - 0.06, yy);
        const q1 = lerp(t1 + 0.06, yy);
        ctx.beginPath();
        ctx.moveTo(q0[0], q0[1]);
        ctx.lineTo(q1[0], q1[1]);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function drawWallVariant(ctx, ox, oy, side, variantName, ph, T) {
  const h = ph.height;
  const color = ph.color;
  // "door_shut_boarded2": the base variant and how many boards cross it.
  const boards = /\d$/.test(variantName) ? Number(variantName.slice(-1)) : 0;
  const variant = boards ? variantName.slice(0, -1) : variantName;
  // Planks nailed across an opening, outermost first: a few slots, the first
  // `n` filled.
  const drawBoards = (lerp, t0, t1, y0, y1, n) => {
    ctx.strokeStyle = "#8a6a3a";
    ctx.lineWidth = 4;
    for (const yy of [0.5, 0.22, 0.78].slice(0, n)) {
      const p0 = lerp(t0 - 0.05, y0 + (y1 - y0) * yy);
      const p1 = lerp(t1 + 0.05, y0 + (y1 - y0) * yy);
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]);
      ctx.lineTo(p1[0], p1[1]);
      ctx.stroke();
    }
  };
  // Thickness direction on screen: north walls extend up-right, west walls up-left.
  const off = side === "north" ? [T, -T / 2] : [-T, -T / 2];
  const shift = [side === "west" ? T : 0, T / 2];

  if (variant === "cap") {
    // End cap: the visible end face of the wall at its near end.
    ctx.save();
    ctx.translate(ox + shift[0], oy + shift[1]);
    const e = side === "north" ? [HW, h + HH] : [0, h + HH];
    const eTop = [e[0], e[1] - h];
    ctx.fillStyle = shade(color, side === "north" ? 0.62 : 0.5);
    poly(ctx, [eTop, e, [e[0] + off[0], e[1] + off[1]], [eTop[0] + off[0], eTop[1] + off[1]]]);
    ctx.fill();
    ctx.fillStyle = shade(color, 1.18);
    ctx.restore();
    return;
  }
  // Segment quad in local coords. North: from (0, h + HH) up-right to (HW, h + ... )
  // Local frame: width HW, height HH + h. Bottom edge is the tile edge.
  let a, b;
  if (side === "north") {
    // The north edge goes from the tile's top vertex (cx, cy - HH) to right vertex (cx + HW, cy).
    // In the local frame with origin at (cx, cy - HH - h): a = (0, h), b = (HW, h + HH).
    a = [0, h];
    b = [HW, h + HH];
  } else {
    // West edge goes from left vertex (cx - HW, cy) to top vertex (cx, cy - HH).
    // Local origin at (cx - HW, cy - HH - h): a = (0, h + HH), b = (HW, h).
    a = [0, h + HH];
    b = [HW, h];
  }
  const f = side === "north" ? 0.9 : 0.72;
  ctx.save();
  ctx.translate(ox + shift[0], oy + shift[1]);

  ctx.fillStyle = shade(color, f);
  poly(ctx, [a, b, [b[0], b[1] - h], [a[0], a[1] - h]]);
  ctx.fill();

  // Face pattern: planks are courses along the wall; bricks add staggered seams.
  if (ph.pattern) {
    const lerpP = (t, y) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - y];
    const course = ph.pattern === "brick" ? 10 : ph.pattern === "log" ? 12 : 9;
    ctx.strokeStyle = shade(color, f * (ph.pattern === "log" ? 0.66 : 0.82));
    ctx.lineWidth = 1;
    let row = 0;
    for (let y = course; y < h; y += course, row++) {
      const p0 = lerpP(0, y);
      const p1 = lerpP(1, y);
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1] + 0.5);
      ctx.lineTo(p1[0], p1[1] + 0.5);
      ctx.stroke();
      if (ph.pattern === "log") {
        // Each log is round: a lit line a few pixels above its lower seam, and a darker one just under it.
        const hi = [lerpP(0, y - 4), lerpP(1, y - 4)];
        ctx.strokeStyle = shade(color, f * 1.2);
        ctx.beginPath();
        ctx.moveTo(hi[0][0], hi[0][1] + 0.5);
        ctx.lineTo(hi[1][0], hi[1][1] + 0.5);
        ctx.stroke();
        ctx.strokeStyle = shade(color, f * 0.66);
      }
      if (ph.pattern === "brick") {
        for (let t = row % 2 ? 0.25 : 0.5; t < 1; t += 0.5) {
          const q0 = lerpP(t, y);
          const q1 = lerpP(t, Math.min(h, y + course));
          ctx.beginPath();
          ctx.moveTo(q0[0] + 0.5, q0[1]);
          ctx.lineTo(q1[0] + 0.5, q1[1]);
          ctx.stroke();
        }
      }
    }
  }

  const isDoor = variant.startsWith("door") || variant === "stairs";
  const isWindow = variant.startsWith("window") || variant === "boarded";
  const shutLeaf = variant === "window_shut" || variant === "window_shut_boarded" || variant === "door_shut" || variant === "door_shut_boarded";
  if (isDoor || isWindow) {
    // A rectangle-ish opening on the wall plane. Parametrize along the edge: t in [0,1].
    const lerp = (t, y) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - y];
    const t0 = isDoor ? 0.2 : 0.25;
    const t1 = isDoor ? 0.8 : 0.75;
    const y0 = isDoor ? 0 : Math.min(WINDOW_SILL, h * 0.35);
    const y1 = Math.min(isDoor ? DOOR_TOP : WINDOW_TOP, h - 4);
    const quad = [lerp(t0, y0), lerp(t1, y0), lerp(t1, y1), lerp(t0, y1)];
    if (isDoor) {
      // Doors are open doorways: the opening is punched out after the wall is
      // finished (below), so the threshold tile and whatever stands in the
      // doorway show through. Nothing to draw here.
    } else {
      // Windows are open holes with a frame: no glass in this village, shutters
      // later (Michael, 2026-10-09). The hole is punched out after the wall is
      // finished, below, so the room shows through.
    }
  }

  // Top face (wall thickness) and baseboard
  const aTop = [a[0], a[1] - h];
  const bTop = [b[0], b[1] - h];
  ctx.fillStyle = shade(color, 1.18);
  poly(ctx, [aTop, bTop, [bTop[0] + off[0], bTop[1] + off[1]], [aTop[0] + off[0], aTop[1] + off[1]]]);
  ctx.fill();
  ctx.strokeStyle = shade(color, 0.6);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(aTop[0], aTop[1]);
  ctx.lineTo(bTop[0], bTop[1]);
  ctx.stroke();
  ctx.strokeStyle = shade(color, 0.5);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();

  if (isWindow) {
    const lerp = (t, y) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - y];
    const t0 = 0.25;
    const t1 = 0.75;
    const y0 = h * 0.35;
    const y1 = h * 0.8;
    const quad = [lerp(t0, y0), lerp(t1, y0), lerp(t1, y1), lerp(t0, y1)];
    if (shutLeaf) {
      // Closed shutters: two plank leaves meeting in the middle, one band each.
      const tm = (t0 + t1) / 2;
      drawPlankLeaf(ctx, [lerp(t0, y0), lerp(t0, y1), lerp(tm, y1), lerp(tm, y0)], 1);
      drawPlankLeaf(ctx, [lerp(tm, y0), lerp(tm, y1), lerp(t1, y1), lerp(t1, y0)], 1);
    } else {
      // Open: a hole. The swung-out leaves are drawn by the renderer, which
      // knows which side of the wall is outside.
      ctx.globalCompositeOperation = "destination-out";
      poly(ctx, quad);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.strokeStyle = shade(color, 0.45);
    ctx.lineWidth = 2;
    poly(ctx, quad);
    ctx.stroke();
    // Sill: a lighter ledge along the bottom of the opening.
    ctx.strokeStyle = shade(color, 1.15);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(quad[3][0], quad[3][1] - 1);
    ctx.lineTo(quad[2][0], quad[2][1] - 1);
    ctx.stroke();
    if (boards) drawBoards(lerp, t0, t1, y0, y1, boards);
  }
  if (isDoor) {
    // Punch the doorway out of the finished wall, then draw jambs and lintel edge.
    const lerp = (t, y) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - y];
    const t0 = 0.18;
    const t1 = 0.82;
    const y1 = h * 0.82;
    const quad = [lerp(t0, 0), lerp(t1, 0), lerp(t1, y1), lerp(t0, y1)];
    if (shutLeaf) {
      // A closed door: one plank leaf with two metal bands, filling the doorway.
      drawPlankLeaf(ctx, [lerp(t0, 0), lerp(t0, y1), lerp(t1, y1), lerp(t1, 0)], 2);
    } else {
      ctx.globalCompositeOperation = "destination-out";
      poly(ctx, quad);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.strokeStyle = shade(color, 0.45);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(quad[0][0], quad[0][1]);
    ctx.lineTo(quad[3][0], quad[3][1]);
    ctx.lineTo(quad[2][0], quad[2][1]);
    ctx.lineTo(quad[1][0], quad[1][1]);
    ctx.stroke();
    if (variant === "stairs") {
      // Steps climbing into the opening.
      for (let k = 0; k < 5; k++) {
        const yy = y1 * (0.12 + k * 0.16);
        const p0 = lerp(t0 + 0.04, yy);
        const p1 = lerp(t1 - 0.04, yy);
        ctx.strokeStyle = shade(color, 0.85 - k * 0.08);
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
        ctx.stroke();
      }
    }
    if (boards) drawBoards(lerp, t0, t1, 0, y1, boards);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Box prop: one frame per footprint tile (all identical for placeholders).
// Anchor is the tile center.
// ---------------------------------------------------------------------------
export function generateBox(ph, tileCount = 1) {
  const h = ph.height;
  const inset = ph.inset || 0;
  const fw = TW;
  const fh = TH + h;
  const { canvas, ctx } = makeCanvas(fw, fh);
  const cx = HW;
  const cy = h + HH;
  const hw = HW - inset;
  const hh = HH - inset / 2;
  const color = ph.color;
  const top = [[cx, cy - hh - h], [cx + hw, cy - h], [cx, cy + hh - h], [cx - hw, cy - h]];
  const left = [[cx - hw, cy], [cx, cy + hh], [cx, cy + hh - h], [cx - hw, cy - h]];
  const right = [[cx, cy + hh], [cx + hw, cy], [cx + hw, cy - h], [cx, cy + hh - h]];
  ctx.fillStyle = shade(color, 0.72);
  poly(ctx, left);
  ctx.fill();
  ctx.fillStyle = shade(color, 0.55);
  poly(ctx, right);
  ctx.fill();
  ctx.fillStyle = color;
  poly(ctx, top);
  ctx.fill();
  ctx.strokeStyle = shade(color, 0.4);
  ctx.lineWidth = 1;
  poly(ctx, top);
  ctx.stroke();
  // A labelled box says what it is (Michael, 2026-10-12: "make sure I have a
  // way to tell what every random box is"): the name on the top face, and on
  // the front face too when the box is tall enough. Only the first tile of a
  // multi-tile box carries it, so a long counter reads once.
  const frames = {};
  if (ph.label) {
    const plain = ctx.getImageData(0, 0, fw, fh);
    drawBoxLabel(ctx, ph.label, cx, cy - h, h, color);
    if (tileCount > 1) {
      // The labelled picture first, the plain one after it on the same sheet.
      const labelled = ctx.getImageData(0, 0, fw, fh);
      canvas.width = fw * 2;
      const c2 = canvas.getContext("2d");
      c2.imageSmoothingEnabled = false;
      c2.putImageData(labelled, 0, 0);
      c2.putImageData(plain, fw, 0);
      frames.idle_0 = [0, 0, fw, fh];
      for (let i = 1; i < tileCount; i++) frames[`idle_${i}`] = [fw, 0, fw, fh];
    } else frames.idle_0 = [0, 0, fw, fh];
  } else {
    for (let i = 0; i < tileCount; i++) frames[`idle_${i}`] = [0, 0, fw, fh];
  }
  return {
    image: canvas,
    frames,
    anchor: [cx, cy],
    animations: { idle: { fps: 0, loop: false, frames: 1 } },
    facings: [],
    mirror: {},
  };
}

function drawBoxLabel(ctx, label, cx, topY, h, color) {
  ctx.save();
  ctx.font = "bold 9px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const dark = shade(color, 0.3);
  const text = String(label).toUpperCase().slice(0, 9);
  // On the top face, dark on the colour.
  ctx.fillStyle = dark;
  ctx.fillText(text, cx, topY);
  // On the front faces, light, when there is room.
  if (h >= 14) {
    ctx.fillStyle = "#f4ecd9";
    ctx.fillText(text, cx, topY + HH / 2 + h / 2);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Post prop: trunk plus a blob. Trees, lamps, plants. Anchor is the tile center.
// ---------------------------------------------------------------------------
export function generatePost(ph) {
  const h = ph.height;
  const width = ph.width;
  const fw = Math.max(TW, width + 4);
  const fh = h + TH;
  const { canvas, ctx } = makeCanvas(fw, fh);
  const cx = fw / 2;
  const cy = h + HH;
  const color = ph.color;
  const trunkW = Math.max(4, Math.round(width / 4));
  // Trunks are brown, whatever the canopy (Michael, 2026-10-09); a post with no
  // `trunk` keeps the parent's darker-shade rule, which suits barrels and lamps.
  ctx.fillStyle = ph.trunk || shade(color, 0.45);
  ctx.fillRect(cx - trunkW / 2, cy - h + width / 2, trunkW, h - width / 2);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(cx, cy, width / 2, width / 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy - h + width / 2, width / 2, width / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shade(color, 1.2);
  ctx.beginPath();
  ctx.ellipse(cx - width / 6, cy - h + width / 3, width / 5, width / 5, 0, 0, Math.PI * 2);
  ctx.fill();
  return {
    image: canvas,
    frames: { idle_0: [0, 0, fw, fh] },
    anchor: [cx, cy],
    // Visible extent within the frame, for occlusion tests. Posts are narrow.
    bounds: { x: cx - width / 2 - 2, y: 0, w: width + 4, h: fh },
    animations: { idle: { fps: 0, loop: false, frames: 1 } },
    facings: [],
    mirror: {},
  };
}

// ---------------------------------------------------------------------------
// Tree: a split from generatePost (2026-10-11, Michael: the tree variety and
// palette are fine, the models are flat, give the trunk and canopy the pass
// the figure got). Posts stay the round blob-on-a-stick for barrels and lamps,
// where that reads fine; trees get their own shape, still code not art, aimed
// at a halfway point between a drawn treetop and a circle on a pole. The
// canopy is a lumpy polygon, not a ring of perfect circles, on purpose: a
// cartoon-round outline reads "happy", and these palettes have to carry
// Gloomwood's blue and purple canopies later (docs/06) without the shape
// itself fighting that mood. Deterministic per spec (seeded on its own
// height and width), so the same tree looks the same every boot.
// ---------------------------------------------------------------------------

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

// Points jittered around a centre, for an outline that bulges and dents
// rather than running a true circle. Returned separately from the path
// (below) so the same points can be filled, shaded, and stroked as one shape.
function blobPoints(cx, cy, r, rnd, { count = 10, jitter = 0.3, squashY = 0.86 } = {}) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const rr = r * (1 - jitter / 2 + rnd() * jitter);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * squashY]);
  }
  return pts;
}

// A smooth-ish path through jittered points: curves to each point's midpoint
// with its neighbour, so the bulges round off instead of reading as spikes.
function blobPath(ctx, pts) {
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(pts[n - 1], pts[0]);
  ctx.beginPath();
  ctx.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const next = pts[(i + 1) % n];
    const m = mid(pts[i], next);
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
  }
  ctx.closePath();
}

export function generateTree(ph) {
  const h = ph.height;
  const width = ph.width;
  const fw = Math.max(TW, Math.ceil(width * 1.3));
  const fh = h + TH;
  const { canvas, ctx } = makeCanvas(fw, fh);
  const cx = fw / 2;
  const cy = h + HH;
  const color = ph.color;
  const trunkColor = ph.trunk || shade(color, 0.45);
  const rnd = seeded(Math.round(width * 31 + h * 7));

  // Ground shadow, unchanged from the post.
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(cx, cy, width / 2, width / 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // Trunk: a tapered trapezoid with a root flare at the base, not a rectangle,
  // and two bark streaks (one lit, one dark, off-centre) for a smidge of
  // texture. It runs up to the canopy's own centre, same as the post did, so
  // it disappears into the lumps rather than poking out the top.
  const canopyCy = cy - h + width / 2;
  const baseW = Math.max(5, Math.round(width / 3.2));
  const topW = Math.max(3, Math.round(baseW * 0.55));
  const flare = baseW * 0.4;
  const flareH = baseW * 0.45;
  ctx.fillStyle = trunkColor;
  poly(ctx, [
    [cx - baseW / 2 - flare, cy],
    [cx - baseW / 2, cy - flareH],
    [cx - topW / 2, canopyCy],
    [cx + topW / 2, canopyCy],
    [cx + baseW / 2, cy - flareH],
    [cx + baseW / 2 + flare, cy],
  ]);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = shade(trunkColor, 1.3);
  ctx.beginPath();
  ctx.moveTo(cx - baseW / 5, cy - 2);
  ctx.lineTo(cx - topW / 5, canopyCy + 3);
  ctx.stroke();
  ctx.strokeStyle = shade(trunkColor, 0.65);
  ctx.beginPath();
  ctx.moveTo(cx + baseW / 6, cy - 3);
  ctx.lineTo(cx + topW / 6, canopyCy + 4);
  ctx.stroke();

  // Canopy: one lumpy base shape (shaded underside, then the flat colour over
  // it, then an outline in its own hue), plus a small shadow lobe and a small
  // highlight lobe, each its own jittered blob rather than a nested circle.
  const basePts = blobPoints(cx, canopyCy + 2, width / 2, rnd, { count: 11, jitter: 0.32 });
  blobPath(ctx, basePts);
  ctx.fillStyle = shade(color, 0.78);
  ctx.fill();

  const facePts = blobPoints(cx, canopyCy, width * 0.47, rnd, { count: 10, jitter: 0.28 });
  blobPath(ctx, facePts);
  ctx.fillStyle = color;
  ctx.fill();
  blobPath(ctx, facePts);
  ctx.lineWidth = 1;
  ctx.strokeStyle = shade(color, 0.58);
  ctx.stroke();

  const shPts = blobPoints(cx + width * 0.16, canopyCy + width * 0.14, width * 0.26, rnd, { count: 8, jitter: 0.3 });
  blobPath(ctx, shPts);
  ctx.fillStyle = shade(color, 0.68);
  ctx.globalAlpha = 0.5;
  ctx.fill();
  ctx.globalAlpha = 1;

  const hiPts = blobPoints(cx - width * 0.15, canopyCy - width * 0.14, width * 0.22, rnd, { count: 8, jitter: 0.3 });
  blobPath(ctx, hiPts);
  ctx.fillStyle = shade(color, 1.18);
  ctx.fill();

  // Fruit in the canopy (`fruit`: a colour; `fruitCount` of them, default 9): a fruit tree's laden kind. Each is a dark ring and a lit dot.
  if (ph.fruit) {
    for (let i = 0; i < (ph.fruitCount || 9); i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * width * 0.36;
      const fx = Math.round(cx + Math.cos(a) * r);
      const fy = Math.round(canopyCy + Math.sin(a) * r * 0.9);
      ctx.fillStyle = shade(ph.fruit, 0.55);
      ctx.beginPath();
      ctx.arc(fx, fy, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = ph.fruit;
      ctx.beginPath();
      ctx.arc(fx, fy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return {
    image: canvas,
    frames: { idle_0: [0, 0, fw, fh] },
    anchor: [cx, cy],
    bounds: { x: cx - width / 2 - 2, y: 0, w: width + 4, h: fh },
    animations: { idle: { fps: 0, loop: false, frames: 1 } },
    facings: [],
    mirror: {},
  };
}

// ---------------------------------------------------------------------------
// Character: blocky big-headed figure. Facings s, sw, w, nw, n drawn; se, e, ne
// mirrored. Animations idle, walk, attack, hurt, die.
// ---------------------------------------------------------------------------
// Characters are drawn by figure.js (docs/12) since 2026-10-10; the old
// rectangle figure lived here until then.

export function generatePumpkin(ph) {
  const fw = 64;
  const fh = 56;
  const frames = 3;
  const { canvas, ctx } = makeCanvas(fw * frames, fh * 2);
  const glowColors = ["#ffb347", "#ffd37a", "#ff9a2e"];
  const glowAlpha = [0.5, 0.65, 0.42];
  const body = ph.color || "#c8692a";
  const face = (cx, cy, color) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - 8, cy - 1);
    ctx.lineTo(cx - 3, cy - 1);
    ctx.lineTo(cx - 5.5, cy - 6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx + 3, cy - 1);
    ctx.lineTo(cx + 8, cy - 1);
    ctx.lineTo(cx + 5.5, cy - 6);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 1.5, cy + 2.5);
    ctx.lineTo(cx + 1.5, cy + 2.5);
    ctx.lineTo(cx, cy);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy + 4);
    ctx.lineTo(cx - 6, cy + 7);
    ctx.lineTo(cx - 4, cy + 4.5);
    ctx.lineTo(cx - 1, cy + 8);
    ctx.lineTo(cx + 1, cy + 4.5);
    ctx.lineTo(cx + 4, cy + 8);
    ctx.lineTo(cx + 6, cy + 4.5);
    ctx.lineTo(cx + 9, cy + 4);
    ctx.lineTo(cx + 6, cy + 9);
    ctx.lineTo(cx - 6, cy + 9);
    ctx.closePath();
    ctx.fill();
    // A tooth or two left in the grin.
    ctx.fillStyle = body;
    ctx.fillRect(cx - 3, cy + 6, 2, 3);
    ctx.fillRect(cx + 2, cy + 6, 2, 3);
  };
  const w = 26;
  const h = 20;
  const base = fh - 14; // ground point sits at the tile centre, anchor below
  const cy = base - h / 2 - 2;
  for (let i = 0; i < frames; i++) {
    const ox = i * fw;
    const cx = ox + fw / 2;
    // Body: a squat ellipse with ridges, and the carved face unlit.
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = shade(body, 0.7);
    ctx.lineWidth = 1;
    for (const rx of [-8, -3, 3, 8]) {
      ctx.beginPath();
      ctx.ellipse(cx + rx * 0.4, cy, Math.abs(rx) * 0.9 + 3, h / 2 - 1, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Stem.
    ctx.fillStyle = "#5a3d22";
    ctx.fillRect(cx - 2, cy - h / 2 - 5, 4, 6);
    ctx.fillRect(cx - 1, cy - h / 2 - 7, 4, 3);
    face(cx, cy, "#2a1608");
    // Flame frame: a small glow around the face, then the face lit.
    const fy = fh;
    const g = ctx.createRadialGradient(cx, fy + cy, 2, cx, fy + cy, 16);
    g.addColorStop(0, `rgba(255, 170, 60, ${glowAlpha[i]})`);
    g.addColorStop(1, "rgba(255, 170, 60, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - 16, fy + cy - 16, 32, 32);
    face(cx, fy + cy, glowColors[i]);
  }
  const frameMap = {};
  for (let i = 0; i < frames; i++) {
    frameMap[`idle_${i}`] = [i * fw, 0, fw, fh];
    frameMap[`flame_${i}`] = [i * fw, fh, fw, fh];
  }
  return {
    image: canvas,
    frames: frameMap,
    anchor: [fw / 2, fh - 14 + 2],
    animations: { idle: { fps: 5, loop: true, frames } },
    facings: [],
    mirror: {},
    bounds: { x: fw / 2 - 15, y: fh - 14 - 30, w: 30, h: 32 },
  };
}

// ---------------------------------------------------------------------------
// Fires (docs/07-lighting.md). Each has three identical `idle_i` body frames
// (so the renderer's idle animation picks a flame index) and three `flame_i`
// frames of fire and glow, drawn above the night layer while lit.
// ---------------------------------------------------------------------------
const FLAME_COLORS = ["#ffb347", "#ffd37a", "#ff9a2e"];

// A tongue of flame with its base at (x, y), `hgt` tall, `wid` wide, in two
// tones. `k` varies the lean per frame.
function drawFlame(ctx, x, y, wid, hgt, k) {
  const lean = (k - 1) * wid * 0.25;
  ctx.fillStyle = "#e8702a";
  ctx.beginPath();
  ctx.moveTo(x - wid / 2, y);
  ctx.quadraticCurveTo(x - wid / 2 + lean, y - hgt * 0.55, x + lean * 1.5, y - hgt);
  ctx.quadraticCurveTo(x + wid / 2 + lean, y - hgt * 0.55, x + wid / 2, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = FLAME_COLORS[k];
  ctx.beginPath();
  ctx.moveTo(x - wid / 4, y);
  ctx.quadraticCurveTo(x - wid / 4 + lean * 0.6, y - hgt * 0.35, x + lean, y - hgt * 0.6);
  ctx.quadraticCurveTo(x + wid / 4 + lean * 0.6, y - hgt * 0.35, x + wid / 4, y);
  ctx.closePath();
  ctx.fill();
}

function drawGlow(ctx, x, y, r, a) {
  const g = ctx.createRadialGradient(x, y, 1, x, y, r);
  g.addColorStop(0, `rgba(255, 170, 60, ${a})`);
  g.addColorStop(1, "rgba(255, 170, 60, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// Hearth: a stone block against a wall with a dark firebox on its front-left
// face. Anchor is the tile centre.
export function generateHearth(ph) {
  const h = 40;
  const fw = TW;
  const fh = TH + h;
  const frames = 3;
  const { canvas, ctx } = makeCanvas(fw * frames, fh * 2);
  const color = ph.color || "#7b7670";
  const inset = 4;
  const hw = HW - inset;
  const hh = HH - inset / 2;
  const frameMap = {};
  for (let i = 0; i < frames; i++) {
    const ox = i * fw;
    const cx = ox + HW;
    const cy = h + HH;
    // The block.
    const top = [[cx, cy - hh - h], [cx + hw, cy - h], [cx, cy + hh - h], [cx - hw, cy - h]];
    const left = [[cx - hw, cy], [cx, cy + hh], [cx, cy + hh - h], [cx - hw, cy - h]];
    const right = [[cx, cy + hh], [cx + hw, cy], [cx + hw, cy - h], [cx, cy + hh - h]];
    ctx.fillStyle = shade(color, 0.72);
    poly(ctx, left);
    ctx.fill();
    ctx.fillStyle = shade(color, 0.55);
    poly(ctx, right);
    ctx.fill();
    ctx.fillStyle = color;
    poly(ctx, top);
    ctx.fill();
    // Brick seams on the faces.
    ctx.strokeStyle = shade(color, 0.45);
    ctx.lineWidth = 1;
    for (let yy = 8; yy < h; yy += 8) {
      ctx.beginPath();
      ctx.moveTo(cx - hw, cy - yy);
      ctx.lineTo(cx, cy + hh - yy);
      ctx.lineTo(cx + hw, cy - yy);
      ctx.stroke();
    }
    // Firebox: a dark arch on the left face.
    const lerp = (t, up) => [cx - hw + (cx - (cx - hw)) * t, cy + hh * t - up];
    const box = [lerp(0.2, 2), lerp(0.8, 2), lerp(0.8, 24), lerp(0.2, 24)];
    ctx.fillStyle = "#1a1210";
    poly(ctx, box);
    ctx.fill();
    frameMap[`idle_${i}`] = [ox, 0, fw, fh];
    // Flame frame: fire in the firebox and a glow spilling out of it.
    const fy = fh;
    const fc = lerp(0.5, 4);
    drawGlow(ctx, fc[0], fy + fc[1] - 6, 22, 0.45 + 0.1 * (i % 2));
    drawFlame(ctx, fc[0] - 5, fy + fc[1], 9, 14 + i * 2, i);
    drawFlame(ctx, fc[0] + 4, fy + fc[1], 8, 11 + ((i + 1) % 3) * 2, (i + 1) % 3);
    frameMap[`flame_${i}`] = [ox, fy, fw, fh];
  }
  return {
    image: canvas,
    frames: frameMap,
    anchor: [HW, h + HH],
    animations: { idle: { fps: 5, loop: true, frames } },
    facings: [],
    mirror: {},
  };
}

// Campfire: a ring of stones and crossed logs on the ground. Anchor is the
// tile centre; the flames rise above it.
export function generateCampfire(ph) {
  const fw = TW;
  const fh = 56;
  const frames = 3;
  const { canvas, ctx } = makeCanvas(fw * frames, fh * 2);
  const stone = ph.color || "#6a645c";
  const log = "#4a3324";
  const frameMap = {};
  for (let i = 0; i < frames; i++) {
    const ox = i * fw;
    const cx = ox + HW;
    const cy = fh - 10;
    // Scorched ground.
    ctx.fillStyle = "rgba(20, 14, 10, 0.45)";
    ctx.beginPath();
    ctx.ellipse(cx, cy, 15, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    // Logs, crossed.
    ctx.save();
    ctx.translate(cx, cy - 2);
    for (const a of [-0.5, 0.6]) {
      ctx.save();
      ctx.rotate(a);
      ctx.fillStyle = log;
      ctx.fillRect(-11, -2.5, 22, 5);
      ctx.fillStyle = shade(log, 1.3);
      ctx.fillRect(-11, -2.5, 22, 1.5);
      ctx.restore();
    }
    ctx.restore();
    // Stones.
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const sx = cx + Math.cos(a) * 17;
      const sy = cy + Math.sin(a) * 8;
      ctx.fillStyle = shade(stone, 0.85 + 0.2 * (k % 2));
      ctx.beginPath();
      ctx.ellipse(sx, sy, 4, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    frameMap[`idle_${i}`] = [ox, 0, fw, fh];
    // Flame frame: three tongues and a glow.
    const fy = fh;
    drawGlow(ctx, cx, fy + cy - 8, 26, 0.4 + 0.12 * (i % 2));
    drawFlame(ctx, cx - 6, fy + cy - 2, 10, 16 + ((i + 2) % 3) * 3, (i + 2) % 3);
    drawFlame(ctx, cx + 6, fy + cy - 2, 10, 14 + ((i + 1) % 3) * 3, (i + 1) % 3);
    drawFlame(ctx, cx, fy + cy - 3, 12, 22 + i * 3, i);
    frameMap[`flame_${i}`] = [ox, fy, fw, fh];
  }
  return {
    image: canvas,
    frames: frameMap,
    anchor: [HW, fh - 10],
    animations: { idle: { fps: 6, loop: true, frames } },
    facings: [],
    mirror: {},
    bounds: { x: HW - 20, y: fh - 10 - 30, w: 40, h: 40 },
  };
}

// ---------------------------------------------------------------------------
// Torches (docs/07): never burn out, mount in a bracket on a wall or on a
// post. The flame and the bracket are drawn by the renderer at the wall, since
// a bracket is state on an edge rather than a sprite of its own.
// ---------------------------------------------------------------------------

// A torch flame with its base at (x, y). `k` picks the frame, 0..2.
export function drawTorchFlame(ctx, x, y, k) {
  drawGlow(ctx, x, y - 4, 14, 0.45 + 0.1 * (k % 2));
  drawFlame(ctx, x, y, 7, 11 + k * 2, k);
}

// An iron bracket on a wall face at (x, y), and the torch in it if any: a
// stick with a wrapped head, the flame drawn separately above the night layer.
export function drawBracket(ctx, x, y, hasTorch) {
  ctx.fillStyle = METAL;
  ctx.fillRect(x - 2, y - 3, 4, 7);
  ctx.fillRect(x - 4, y - 1, 8, 2);
  if (!hasTorch) return;
  ctx.fillStyle = WOOD;
  ctx.fillRect(x - 1, y - 14, 3, 13);
  ctx.fillStyle = "#3a2a22";
  ctx.fillRect(x - 2, y - 17, 5, 5);
}

// The torch in the player's hand: on the side the figure faces, at chest
// height. Returns where the flame sits so the renderer can place it.
export function drawHandTorch(ctx, x, y) {
  ctx.fillStyle = WOOD;
  ctx.fillRect(x - 1, y, 3, 12);
  ctx.fillStyle = "#3a2a22";
  ctx.fillRect(x - 2, y - 3, 5, 5);
}

// A torch post: a wooden pole with an iron cup. Anchor is the tile centre.
export function generateTorchPost(ph) {
  const h = 46;
  const fw = TW;
  const fh = TH + h;
  const frames = 3;
  const { canvas, ctx } = makeCanvas(fw * frames, fh * 2);
  const wood = ph.color || "#4a3324";
  const frameMap = {};
  for (let i = 0; i < frames; i++) {
    const ox = i * fw;
    const cx = ox + HW;
    const cy = h + HH;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(cx, cy, 7, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = wood;
    ctx.fillRect(cx - 2, cy - h + 6, 5, h - 6);
    ctx.fillStyle = shade(wood, 1.25);
    ctx.fillRect(cx - 2, cy - h + 6, 2, h - 6);
    ctx.fillStyle = METAL;
    ctx.fillRect(cx - 4, cy - h + 2, 9, 5);
    ctx.fillRect(cx - 3, cy - h, 7, 3);
    frameMap[`idle_${i}`] = [ox, 0, fw, fh];
    const fy = fh;
    drawTorchFlame(ctx, cx + 0.5, fy + cy - h + 1, i);
    frameMap[`flame_${i}`] = [ox, fy, fw, fh];
  }
  return {
    image: canvas,
    frames: frameMap,
    anchor: [HW, h + HH],
    animations: { idle: { fps: 5, loop: true, frames } },
    facings: [],
    mirror: {},
    bounds: { x: HW - 8, y: 0, w: 16, h: fh },
  };
}

// A lantern post (#156): the torch post's pole with an iron cage and a lit pane, steady. One frame; the `flame` frame is the
// glow, drawn unlit over it, with no flicker. Anchor is the tile centre.
export function generateLanternPost(ph) {
  const h = 46;
  const fw = TW;
  const fh = TH + h;
  const { canvas, ctx } = makeCanvas(fw, fh * 2);
  const wood = ph.color || "#4a3324";
  const cx = HW;
  const cy = h + HH;
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath();
  ctx.ellipse(cx, cy, 7, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = wood;
  ctx.fillRect(cx - 2, cy - h + 12, 5, h - 12);
  ctx.fillStyle = shade(wood, 1.25);
  ctx.fillRect(cx - 2, cy - h + 12, 2, h - 12);
  drawLanternBody(ctx, cx, cy - h + 12);
  const frameMap = { idle_0: [0, 0, fw, fh], flame_0: [0, fh, fw, fh] };
  // The glow: a soft warm halo about the pane, on its own frame.
  const gy = fh + cy - h + 6;
  drawGlow(ctx, cx + 0.5, gy, 15, 0.5);
  ctx.fillStyle = "#ffd98a";
  ctx.fillRect(cx - 3, gy - 5, 7, 9);
  return {
    image: canvas,
    frames: frameMap,
    anchor: [HW, h + HH],
    animations: { idle: { fps: 0, loop: true, frames: 1 } },
    facings: [],
    mirror: {},
    bounds: { x: HW - 8, y: 0, w: 16, h: fh },
  };
}

// The lantern's iron cage with its pane, hanging from (x, y): the top of the cage there. Shared by the post and the bracket.
export function drawLanternBody(ctx, x, y) {
  ctx.fillStyle = METAL;
  ctx.fillRect(x - 4, y - 2, 9, 3); // the cap
  ctx.fillRect(x - 1, y - 5, 3, 3); // the ring
  ctx.fillRect(x - 4, y + 12, 9, 2); // the foot
  ctx.fillRect(x - 4, y + 1, 1, 11); // the bars
  ctx.fillRect(x + 4, y + 1, 1, 11);
  ctx.fillStyle = "#e6b45a";
  ctx.fillRect(x - 3, y + 1, 7, 11); // the pane
}

// A torch flame as a sheet of its own, three frames with the base at the
// anchor, so the WebGL renderer can draw bracket and hand torches from the
// atlas like every other flame.
export function generateFlame() {
  const fw = 28;
  const fh = 32;
  const frames = 3;
  const { canvas, ctx } = makeCanvas(fw * frames, fh);
  const frameMap = {};
  for (let i = 0; i < frames; i++) {
    drawTorchFlame(ctx, i * fw + fw / 2 + 0.5, fh - 4, i);
    frameMap[`flame_${i}`] = [i * fw, 0, fw, fh];
  }
  return {
    image: canvas,
    frames: frameMap,
    anchor: [fw / 2, fh - 4],
    animations: { idle: { fps: 0, loop: false, frames: 1 } },
    facings: [],
    mirror: {},
  };
}

// ---------------------------------------------------------------------------
// The ground's world textures (docs/15): seamless in world pixels, so the
// left edge continues the right and the top the bottom, read by the ground's
// bake at (world x mod width, world y mod height). Generated until Michael's
// drawn ones replace the definitions' `placeholder` with an `image`.
// ---------------------------------------------------------------------------

// A repeatable 0..1 roll for a pixel and a salt.
function roll2(x, y, salt) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Tileable value noise over a w by h image with lattice cells `cell` pixels
// apart (w and h must be multiples of cell), 0..1, smoothstepped.
function tileNoise(x, y, w, h, cell, salt) {
  const cw = w / cell;
  const ch = h / cell;
  const fx = x / cell;
  const fy = y / cell;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const at = (i, j) => roll2(((i % cw) + cw) % cw, ((j % ch) + ch) % ch, salt);
  const a = at(ix, iy);
  const b = at(ix + 1, iy);
  const c = at(ix, iy + 1);
  const d = at(ix + 1, iy + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

function textureSheet(canvas) {
  return { image: canvas, frames: { idle_0: [0, 0, canvas.width, canvas.height] }, anchor: [0, 0], animations: {}, facings: [], mirror: {} };
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Dirt or cobble, `ph.variant`, ph.width by ph.height (128 by 64 by default).
export function generateGround(ph) {
  const w = ph.width || 128;
  const h = ph.height || 64;
  const { canvas, ctx } = makeCanvas(w, h);
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const put = (x, y, c) => {
    const k = ((((y % h) + h) % h) * w + (((x % w) + w) % w)) * 4;
    d[k] = c[0];
    d[k + 1] = c[1];
    d[k + 2] = c[2];
    d[k + 3] = 255;
  };
  if (ph.variant === "cobble") {
    // Round stones packed at random (Michael, 2026-10-11: the rows read as a
    // brick wall). Stone centres sit on a staggered grid, jittered, and each
    // pixel belongs to the nearest centre, measured on the wrapped image so it
    // tiles. A pixel is stone when it is well inside its cell (the gap to the
    // next centre is wide) and near its centre, which rounds every stone; the
    // rest is the mortar between. Distances count vertical pixels 1.6 times,
    // so the stones are wider than tall, as round stones look from this angle.
    const gap = hexRgb(ph.gap || "#4a433d");
    const stone = hexRgb(ph.color || "#6a6058");
    const lit = hexRgb(ph.top || "#756a61");
    const dark = hexRgb(ph.bottom || "#5c534c");
    const cols = ph.cols || 12;
    const rows = ph.rows || 10;
    const cw = w / cols;
    const ch = h / rows;
    const ASPECT = 1.6;
    const seeds = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const jx = (roll2(c, r, 61) - 0.5) * 0.55;
        const jy = (roll2(c, r, 62) - 0.5) * 0.55;
        seeds.push({
          x: (c + 0.5 + (r % 2) * 0.5 + jx) * cw,
          y: (r + 0.5 + jy) * ch,
          shade: (roll2(c, r, 63) - 0.5) * 18,
          size: 0.5 + roll2(c, r, 64) * 0.16,
        });
      }
    }
    const R = cw; // the stone radius scale, in pixels
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let f1 = Infinity;
        let f2 = Infinity;
        let best = null;
        let bdx = 0;
        let bdy = 0;
        for (const sd of seeds) {
          let dx = x + 0.5 - sd.x;
          let dy = y + 0.5 - sd.y;
          dx -= Math.round(dx / w) * w;
          dy -= Math.round(dy / h) * h;
          const d = Math.hypot(dx, dy * ASPECT);
          if (d < f1) {
            f2 = f1;
            f1 = d;
            best = sd;
            bdx = dx;
            bdy = dy;
          } else if (d < f2) f2 = d;
        }
        const inside = f2 - f1 > 1.7 && f1 < R * best.size;
        if (!inside) {
          put(x, y, gap);
          continue;
        }
        // Lit from the top left: the stone's upper left is lighter, its lower
        // right darker, and its rim against the mortar darkest of all.
        const l = -(bdx * 0.55 + bdy * ASPECT * 0.85) / (R * best.size);
        const rim = f2 - f1 < 2.8 && bdx + bdy * ASPECT > 0;
        let c = l > 0.35 ? lit : l < -0.3 || rim ? dark : stone;
        c = c.map((v) => Math.max(0, Math.min(255, Math.round(v + best.shade))));
        put(x, y, c);
      }
    }
  } else if (ph.variant === "water") {
    // Still water, rough: a dusky teal drifting a little, with short pale
    // ripple dashes and darker troughs, all seamless (docs/15, a trial).
    const base = hexRgb(ph.color || "#2f4a54");
    const ripple = hexRgb(ph.light || "#557880");
    const trough = hexRgb(ph.dark || "#253d46");
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = 0.92 + 0.16 * tileNoise(x, y, w, h, 32, 71);
        put(x, y, base.map((c) => Math.round(c * v)));
      }
    }
    for (let i = 0; i < Math.round((w * h) / 140); i++) {
      const x = Math.floor(roll2(i, 1, 72) * w);
      const y = Math.floor(roll2(i, 2, 72) * h);
      const len = 3 + Math.floor(roll2(i, 3, 72) * 4);
      const c = roll2(i, 4, 72) < 0.55 ? ripple : trough;
      for (let k = 0; k < len; k++) put(x + k, y, c);
    }
  } else {
    // Dirt: the base colour drifting a few percent with soft noise, a low
    // scatter of darker and lighter grains, and a few small stones.
    const base = hexRgb(ph.color || "#6e5a43");
    const darkC = hexRgb(ph.dark || "#5e4c37");
    const lightC = hexRgb(ph.light || "#7a6650");
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = 0.94 + 0.12 * tileNoise(x, y, w, h, 32, 41);
        put(x, y, base.map((c) => Math.round(c * v)));
      }
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const r = roll2(x, y, 42);
        if (r < 0.035) {
          put(x, y, darkC);
          if (roll2(x, y, 43) < 0.4) put(x + 1, y, darkC);
        } else if (r < 0.055) put(x, y, lightC);
      }
    }
    for (let i = 0; i < Math.round((w * h) / 900); i++) {
      const x = Math.floor(roll2(i, 1, 44) * w);
      const y = Math.floor(roll2(i, 2, 44) * h);
      put(x, y, [138, 122, 102]);
      put(x + 1, y, [120, 106, 88]);
      put(x, y + 1, darkC);
      put(x + 1, y + 1, darkC);
    }
  }
  ctx.putImageData(img, 0, 0);
  return textureSheet(canvas);
}

// Grey tileable noise, ph.size square, for the ground's ragged edges: two
// octaves (lattice 16 and 8 pixels, 0.65 and 0.35), its contrast stretched so
// the edge thresholds use the whole range.
export function generateNoise(ph) {
  const n = ph.size || 128;
  const { canvas, ctx } = makeCanvas(n, n);
  const img = ctx.createImageData(n, n);
  const d = img.data;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let v = 0.65 * tileNoise(x, y, n, n, 16, 51) + 0.35 * tileNoise(x, y, n, n, 8, 52);
      v = Math.max(0, Math.min(1, (v - 0.5) * (ph.contrast || 1.6) + 0.5));
      const k = (y * n + x) * 4;
      d[k] = d[k + 1] = d[k + 2] = Math.round(v * 255);
      d[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return textureSheet(canvas);
}

// ---------------------------------------------------------------------------
// The UI kit (docs/23, step 4): the stone frame, the cutout well in two
// weights, the cutout cell the bag's grid is tiled with, the flat plate, and the timber
// button in three states, each a 9-slice (the cell a plain tile) side by side
// on one sheet at the interface's own pixel size (ui/kit.js, K = 1). Michael,
// 2026-10-12, on the first cut: tiled stone like a brick wall, not speckle;
// the slots darker cutouts with Minecraft's inset edge (dark top and left,
// light bottom and right), waiting for an icon. The frame is a flat band
// round a brick field: the band is the border slices, the field the centre,
// and the field's period (16 by 8) divides the centre slice so it repeats
// without a seam. A drawn kit replaces this through the same definition.
// ---------------------------------------------------------------------------
export function generateUiKit(ph) {
  const stone = ph.stone || "#8a8580";
  const cut = ph.cut || "#5a5654"; // a cutout's fill, darker than the stone
  const timber = ph.timber || "#7a5230";
  const OUTLINE = "#241e1c";
  const light = shade(stone, 1.22);
  const dark = shade(stone, 0.72);
  const mortar = shade(stone, 0.58);
  const cutDark = shade(cut, 0.5);
  const cutLight = shade(stone, 1.3);
  const moss = ph.moss || "#6b7a46";
  const F = 64; // the frame tile: the band 8 wide, the brick field 48 square
  const { canvas, ctx } = makeCanvas(F + 15 + 9 + 38 + 18 * 3 + 9 + 9, F);
  const frames = {};
  let x0 = 0;
  const px = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x0 + x, y, w, h); };
  // An outlined, bevelled tile n square: the outline, then `b` pixels of
  // light and dark; `inset` swaps them (a cutout, a pressed button).
  const chrome = (n, b, fill, lt, dk, inset) => {
    px(0, 0, n, n, fill);
    px(0, 0, n, 1, OUTLINE); px(0, n - 1, n, 1, OUTLINE); px(0, 0, 1, n, OUTLINE); px(n - 1, 0, 1, n, OUTLINE);
    const a = inset ? dk : lt;
    const z = inset ? lt : dk;
    px(1, 1, n - 2, b, a); px(1, 1, b, n - 2, a);
    px(1, n - 1 - b, n - 2, b, z); px(n - 1 - b, 1, b, n - 2, z);
  };

  // The frame: the band 8 wide (slice 8), the brick field 48 square (the
  // centre slice), bricks 16 by 8 in staggered rows: the period divides the
  // field, so it repeats without a seam, and a crack and two patches of moss
  // on fixed bricks come round only every 48 pixels (Michael, 2026-10-12:
  // occasional cracks, a mild mossy look).
  const f0 = 8, f1 = F - 8;
  chrome(F, 2, stone, light, dark, false);
  px(f0 - 1, f0 - 1, f1 - f0 + 2, 1, dark); px(f0 - 1, f1, f1 - f0 + 2, 1, dark); px(f0 - 1, f0 - 1, 1, f1 - f0 + 2, dark); px(f1, f0 - 1, 1, f1 - f0 + 2, dark); // the groove round the field
  for (let y = f0; y < f1; y += 8) {
    const off = ((y - f0) / 8) % 2 ? 8 : 0;
    for (let x = off - 16; x < f1; x += 16) {
      // One brick: stone, a light top and left, mortar at the bottom and the right, clipped to the field.
      const bx = Math.max(f0, x), bw = Math.min(f1, x + 16) - bx;
      if (bw <= 0) continue;
      px(bx, y, bw, 8, stone);
      if (x >= f0) px(x, y, 1, 7, light);
      px(bx, y, bw, 1, light);
      px(bx, y + 7, bw, 1, mortar);
      if (x + 15 < f1) px(x + 15, y, 1, 8, mortar);
    }
  }
  // A crack across the second brick of the third row: a one-pixel dark line that steps.
  for (const [cx, cy] of [[26, 25], [27, 26], [28, 26], [29, 27], [30, 28], [31, 28], [32, 29], [33, 30], [34, 30]]) px(cx, cy, 1, 1, mortar);
  // Moss in the mortar at two corners, a few pixels each, two tones.
  const mossDark = shade(moss, 0.75);
  for (const [mx, my, c] of [[15, 14, moss], [16, 14, moss], [14, 15, moss], [15, 15, mossDark], [16, 15, moss], [15, 16, mossDark],
    [39, 46, moss], [40, 46, mossDark], [41, 46, moss], [38, 47, moss], [39, 47, mossDark], [40, 47, moss], [41, 47, moss], [40, 48, mossDark], [42, 47, mossDark]]) px(mx, my, 1, 1, c);
  frames.frame = [x0, 0, F, F];
  x0 += F;

  // The well, a cutout 15 square (slice 5): the outline, two of dark, two of light.
  chrome(15, 2, cut, cutLight, cutDark, true);
  frames.well = [x0, 0, 15, 15];
  x0 += 15;
  // The thin well for the belt (slice 3): one of each.
  chrome(9, 1, cut, cutLight, cutDark, true);
  frames.well_thin = [x0, 0, 9, 9];
  x0 += 9;
  // The cell the bag's grid is tiled with, 38 square: a one-pixel stone
  // separator, then the cutout's edge and fill.
  px(0, 0, 38, 38, stone);
  px(1, 1, 36, 36, cut);
  px(1, 1, 36, 2, cutDark); px(1, 1, 2, 36, cutDark);
  px(1, 36, 36, 1, cutLight); px(36, 1, 1, 36, cutLight);
  frames.cell = [x0, 0, 38, 38];
  x0 += 38;

  // The plate, flat stone with a one-pixel bevel (slice 3): a panel's header
  // strip, and the belt's bar (Michael, 2026-10-12: flat and simple there).
  chrome(9, 1, stone, light, dark, false);
  frames.plate = [x0, 0, 9, 9];
  x0 += 9;

  // The header, flat and dark like a slot's fill with a one-pixel darker edge,
  // no bevel (slice 3; Michael, 2026-10-12: the same dark grey as the slots).
  px(0, 0, 9, 9, cutDark);
  px(1, 1, 7, 7, cut);
  frames.header = [x0, 0, 9, 9];
  x0 += 9;

  // The button, 18 square (slice 6), three states.
  for (const [name, fill, k, inset] of [["button", timber, 1, false], ["button_hover", shade(timber, 1.18), 1.1, false], ["button_down", shade(timber, 0.88), 1, true]]) {
    chrome(18, 2, fill, shade(timber, 1.35 * k), shade(timber, 0.6), inset);
    frames[name] = [x0, 0, 18, 18];
    x0 += 18;
  }
  return { image: canvas, frames, anchor: [0, 0], bounds: { x: 0, y: 0, w: canvas.width, h: canvas.height }, animations: {}, facings: [], mirror: {} };
}
