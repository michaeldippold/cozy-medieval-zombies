// Characters and what flies (docs/12, 14, 20): the arrows and the landing marker, the swing's outline, the
// burning's particles, the figures with their held things and the shield's flash, and where they stand beside walls.
// Cut from src/render.js on 2026-10-12 (docs/23a, D5): a move, no rule changed; the frame check proves the pixels.

import { tunables as archeryTunables } from "../archery.js";
import * as iso from "../iso.js";
import { getSheet, getDef, idleFrame } from "../assets.js";
import { resolveFacing, frameName } from "../sprites.js";
import * as map from "../map.js";
import { tileKey } from "../visibility.js";
import { getItem } from "../items.js";
import * as gl from "../gl.js";
import { flameFrame, frameQuad } from "./scene.js";
import { postAt } from "./walls.js";
import { seenAlpha } from "../sight.js";
import { sight as sightTuning } from "../tuning.js";

export function projectileSheet(id) {
  try {
    return getSheet(id);
  } catch {
    return null;
  }
}

// The arrows in flight (docs/20): the arrow, drawn above its ground point by its
// height, and a shadow at the ground point that shrinks and fades as it rises.
// Both sort by the ground point, as the figures do, so a high arrow is drawn over
// what it flies above and behind what is in front of its ground point.
export function arrowDrawables(arrows, visible, out) {
  if (!arrows || !arrows.length) return;
  for (const a of arrows) {
    const sheet = projectileSheet(a.projectile || "arrow");
    if (!sheet) continue;
    if (!visible.has(tileKey(Math.round(a.gx), Math.round(a.gy)))) continue;
    const p = iso.toScreen(a.gx, a.gy);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const h = Math.min(1, a.z / 160);
    const rx = Math.max(2, Math.round(archeryTunables.shadowRx * (1 - 0.4 * h)));
    const ry = Math.max(1, Math.round(archeryTunables.shadowRy * (1 - 0.4 * h)));
    const alpha = archeryTunables.shadowAlpha * (1 - 0.6 * h);
    const world = [a.gx, a.gy];
    const key = (a.gx + a.gy) * 1000;
    out.push({
      key: key + 0.2,
      kind: "arrowShadow",
      emit() {
        gl.poly([[x - rx, y], [x - rx / 2, y - ry], [x + rx / 2, y - ry], [x + rx, y], [x + rx / 2, y + ry], [x - rx / 2, y + ry]], gl.rgb("#000000", alpha), { world, flags: gl.FLAG_UNLIT | gl.FLAG_NOFOG });
      },
    });
    out.push({
      key: key + 3,
      kind: "arrow",
      emit() {
        // A projectile drawn to flicker (the fireball: three frames a direction) loops them by the wall clock, as flames do.
        const fl = sheet.flicker ? `_${Math.floor(performance.now() / 90) % sheet.flicker}` : "";
        const name = `${a.projectile || "arrow"}_${a.frame}${fl}`;
        const flags = sheet.flicker ? gl.FLAG_STANDING | gl.FLAG_NOFOG | gl.FLAG_UNLIT : gl.FLAG_STANDING | gl.FLAG_NOFOG;
        const k = sheet.scale | 0;
        if (k > 1) {
          // A projectile drawn larger than painted (the fireball, a whole-number scale so its pixels stay square).
          const f = sheet.frames[name];
          if (f) gl.quad(x - sheet.anchor[0] * k, y - Math.round(a.z) - sheet.anchor[1] * k, f[2] * k, f[3] * k, gl.frameUV(sheet, name), { world, heights: 0, flags });
        } else frameQuad(sheet, name, x, y - Math.round(a.z), { world, heights: 0, flags });
      },
    });
  }
}

// The landing marker (docs/20): a ring on the ground where the current draw
// would come down, a fainter one where a full draw would, and a dotted line out
// to it, unlit and unfogged so it reads at night.
export function emitMarker(m) {
  const flags = gl.FLAG_NOFOG | gl.FLAG_UNLIT;
  const ring = (g, rx, ry, k, color) => {
    const p = iso.toScreen(g[0], g[1]);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const O = [[x, y - ry], [x + rx, y], [x, y + ry], [x - rx, y]];
    const I = O.map(([px, py]) => [Math.round(x + (px - x) * k), Math.round(y + (py - y) * k)]);
    for (let i = 0; i < 4; i++) gl.poly([O[i], O[(i + 1) % 4], I[(i + 1) % 4], I[i]], color, { world: g, flags });
  };
  if (m.from && m.full) {
    const a = iso.toScreen(m.from[0], m.from[1]);
    const b = iso.toScreen(m.full[0], m.full[1]);
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.floor(len / 10);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const gx = m.from[0] + (m.full[0] - m.from[0]) * t;
      const gy = m.from[1] + (m.full[1] - m.from[1]) * t;
      const px = Math.round(a.x + (b.x - a.x) * t);
      const py = Math.round(a.y + (b.y - a.y) * t);
      gl.poly([[px - 1, py - 1], [px + 1, py - 1], [px + 1, py + 1], [px - 1, py + 1]], gl.rgb("#ffffff", 0.35), { world: [gx, gy], flags });
    }
  }
  if (m.full) ring(m.full, 8, 4, 0.55, gl.rgb("#ffffff", 0.35));
  if (m.land) ring(m.land, 11, 5.5, 0.6, gl.rgb("#ffffff", 0.95));
}

const SWING_OUTLINE = [0.38, 1, 0.38, 1];
const SWING_OUTLINE_OFFSETS = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];

// A figure's sort sum, kept on the right side of the walls and posts beside
// it (Michael, 2026-10-12: standing against a wall's outer face near the top
// end of a segment, or just round a corner, the wall or the post drew over
// him). A wall sorts by its midpoint, a post by its vertex, a figure by where
// it stands, and near a segment's end those disagree with what is in front.
// Each wall segment and post is a box on the ground (the thickness either side
// of its line); a figure past the box's near side on either axis stands in
// front of it and sorts just after it, one past its far side on either axis
// stands behind it and sorts just before, and one that is both (beyond a
// segment's end, round a corner) or neither leaves it out.
const WALL_HALF = 0.28; // tiles: half the thickest wall (18 px), a little over
function besideWalls(gx, gy) {
  const s = gx + gy;
  let lo = -Infinity;
  let hi = Infinity;
  const side = (x0, x1, y0, y1, k) => {
    if (gx < x0 - 1 || gx > x1 + 1 || gy < y0 - 1 || gy > y1 + 1) return; // too far to overlap on screen
    const front = gx >= x1 || gy >= y1;
    const behind = gx <= x0 || gy <= y0;
    if (front && !behind) lo = Math.max(lo, k);
    else if (behind && !front) hi = Math.min(hi, k);
  };
  const x0 = Math.round(gx);
  const y0 = Math.round(gy);
  for (let ty = y0 - 1; ty <= y0 + 2; ty++) {
    for (let tx = x0 - 1; tx <= x0 + 2; tx++) {
      const t = map.tileAt(tx, ty);
      // A west wall lies on x = tx - 0.5 over y in [ty - 0.5, ty + 0.5], a north
      // wall on y = ty - 0.5 over x in [tx - 0.5, tx + 0.5]; both sort at
      // tx + ty - 0.5. The post at the tile's top vertex sorts at tx + ty - 1.
      if (t.w) side(tx - 0.5 - WALL_HALF, tx - 0.5 + WALL_HALF, ty - 0.5, ty + 0.5, tx + ty - 0.5);
      if (t.n) side(tx - 0.5, tx + 0.5, ty - 0.5 - WALL_HALF, ty - 0.5 + WALL_HALF, tx + ty - 0.5);
      if (postAt(tx, ty, 0)) side(tx - 0.5 - WALL_HALF, tx - 0.5 + WALL_HALF, ty - 0.5 - WALL_HALF, ty - 0.5 + WALL_HALF, tx + ty - 1 + 0.0005);
    }
  }
  if (lo > hi) return s; // between things that disagree: where it stands
  if (s <= lo) return lo + 0.01;
  if (s >= hi) return hi - 0.01;
  return s;
}

// A burning figure's flames, embers, and smoke (fire.js): each a small sprite at
// a height above a world point, unlit (fire is its own light) and unfogged,
// sorted just after the figure. The flames ride the figure; the rest stay put.
export function fireDrawables(particles, visible, out) {
  if (!particles || !particles.length) return;
  for (const p of particles) {
    const gx = p.ch ? p.ch.gx : p.gx;
    const gy = p.ch ? p.ch.gy : p.gy;
    if (!visible.has(tileKey(Math.round(gx), Math.round(gy)))) continue;
    const s = iso.toScreen(gx, gy);
    const x = Math.round(s.x + p.ox);
    const y = Math.round(s.y - p.z);
    const u = p.t / p.life;
    let name;
    let color;
    if (p.kind === "flame") {
      name = `flame_${Math.min(3, Math.floor(u * 4))}`;
    } else if (p.kind === "splinter") {
      name = `splinter_${(Math.floor(p.t * 14) + p.f) % 4}`; // tumbling as it falls
      color = [1, 1, 1, u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3];
    } else if (p.kind === "ember" || p.kind === "spark") {
      name = "ember";
      color = [1, 1, 1, u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4];
    } else {
      name = u < 0.5 ? "smoke_0" : "smoke_1";
      color = [1, 1, 1, 0.8 * (1 - u)];
    }
    const world = [gx, gy];
    out.push({
      key: besideWalls(gx, gy) * 1000 + 2.5,
      kind: "fire",
      emit() {
        frameQuad(getSheet("burn"), name, x, y, { world, heights: 0, color, flags: gl.FLAG_UNLIT | gl.FLAG_NOFOG });
      },
    });
  }
}

// The wash on a burning figure: an orange pulse, multiplied in (fire.js).
function burnTint() {
  const t = performance.now() / 1000;
  const a = Math.sin(t * 11) * 0.5 + 0.5;
  const b = Math.sin(t * 17.3 + 1.1) * 0.5 + 0.5;
  const k = 0.35 + 0.65 * a * b;
  return [1, 0.72 + 0.16 * k, 0.4 + 0.2 * k, 1];
}

const SHIELD_FLASH = [1, 0.95, 0.7, 1]; // a blow blocked
const SHIELD_BROKEN = [1, 0.3, 0.25, 1]; // the guard broken

export function entityDrawables(entities, visible, out, drawAll, me = null) {
  for (const e of entities) {
    const vis = e === me || drawAll || visible.has(tileKey(Math.round(e.gx), Math.round(e.gy))); // another player is seen like anyone, never through a wall (docs/31/03)
    if (!vis) continue; // the dead you cannot see are not drawn, full stop
    // In the dark the dead fade to hidden past a short radius unless they stand in light (sight.js, #88): premultiplied, so
    // the whole picture, held things and all, goes down together. Not for a debug draw-all, your own player, or a fallen body.
    const fade = me && !drawAll && e.kind === "zombie" && !e.dead ? seenAlpha(me, e) : 1;
    if (fade < sightTuning.drawCutoff) continue; // too faint to draw (data/tuning.json sight, #158)
    const dim = fade < 1 ? [fade, fade, fade, fade] : null;
    const sheet = getSheet(e.sprite);
    const p = iso.toScreen(e.gx, e.gy);
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const r = resolveFacing(sheet, e.facing);
    let name = frameName(sheet, e.anim.name, r.facing, e.anim.frame);
    if (!sheet.frames[name]) name = frameName(sheet, "idle", r.facing, 0); // a sheet one rebake behind the animation (docs/32)
    const f = sheet.frames[name];
    const rect = f ? { x: x - sheet.anchor[0], y: y - sheet.anchor[1], w: f[2], h: f[3] } : null;
    // Held items sit at the hand joints the figure's sheet reports (docs/12):
    // a far hand draws before the body, a near hand after; an item with fire
    // gets the flame at its tip.
    const joints = sheet.joints ? sheet.joints[name] : null;
    const held = [];
    if (e.hands && joints) {
      const seen = new Set();
      for (const slot of ["main", "off"]) {
        const entry = e.hands[slot];
        if (!entry || seen.has(entry)) continue;
        seen.add(entry);
        const def = getItem(entry.id);
        if (!def.held) continue;
        // A raised guard (docs/21): the shield comes up before the chest, toward where the player
        // aims, in front of the body when that is toward the camera and behind it when away.
        if (slot === "off" && def.shield && e.blocking && e.aim) {
          let gs = null;
          try { gs = getSheet("held_shield_guard"); } catch { gs = null; }
          if (gs) {
            const n = Math.hypot(e.aim.sx, e.aim.sy) || 1;
            const ax = e.aim.sx / n;
            const ay = e.aim.sy / n;
            // Facing away, the shield is behind the body; it is pushed out to the side so its rim still shows.
            const sx = ay > 0 ? Math.round(ax * 9) : (ax >= 0 ? 12 : -12);
            held.push({ sheet: gs, k: 0, x: x + sx, y: y - 24 + Math.round(ay * 5), near: ay > 0, tip: null, flash: e.blockFlash > 0 ? (e.flashBroken ? SHIELD_BROKEN : SHIELD_FLASH) : null });
            continue;
          }
        }
        let hs = null;
        try { hs = getSheet(`held_${entry.id}`); } catch { continue; }
        const j = joints[slot];
        const along = (e.anim.name === "attack" || e.anim.name === "attack_alt") && slot === "main" && def.held.swing !== false;
        const k = hs.byFacing ? (j.angFace ?? j.ang) : along ? j.angSwing : j.ang; // a bow is upright by the facing (held.js)
        held.push({ sheet: hs, k, x: x + j.x, y: y + j.y, near: j.near, tip: def.fire && (!def.fire.burnsDown || entry.lit) ? hs.tips[k] : null }); // the flame only on a lit torch
      }
    }
    const carried = e.carrying || null;
    const carrySheet = carried ? getSheet(carried.sprite, carried.tiles.length) : null;
    const lift = joints && joints.main ? Math.max(24, -joints.main.y + 2) : 30;
    out.push({
      key: besideWalls(e.gx, e.gy) * 1000 + (e.dead ? 0 : 2),
      kind: "entity",
      entity: e,
      rect,
      vis: true,
      occluded: false,
      emit() {
        const world = [e.gx, e.gy];
        if (e.swingTarget && fade >= sightTuning.seenAt) {
          // The next swing would hit this one (docs/14): a one-pixel outline, eight copies of the
          // sprite flat green just behind it, unlit and unfogged so it reads at night.
          for (const [ox, oy] of SWING_OUTLINE_OFFSETS) {
            frameQuad(sheet, name, x + ox, y + oy, { world, heights: f ? [f[3], f[3], 0, 0] : 0, color: SWING_OUTLINE, flags: gl.FLAG_NOFOG | gl.FLAG_UNLIT | gl.FLAG_SOLID }, r.flip);
          }
        }
        const drawHeld = (h) => {
          // A shield that just met a blow is flat bright for a moment (docs/21).
          frameQuad(h.sheet, `held_${h.k}`, h.x, h.y, h.flash ? { world, heights: 40, color: h.flash, flags: gl.FLAG_NOFOG | gl.FLAG_UNLIT | gl.FLAG_SOLID } : { world, heights: 40, color: dim || undefined, flags: gl.FLAG_NOFOG | gl.FLAG_STANDING });
          if (h.tip) frameQuad(getSheet("flame"), `flame_${flameFrame(1)}`, h.x + h.tip[0], h.y + h.tip[1] - 2, { world, flags: gl.FLAG_UNLIT | gl.FLAG_NOFOG });
        };
        for (const h of held) if (!h.near) drawHeld(h);
        frameQuad(sheet, name, x, y, { world, heights: f ? [f[3], f[3], 0, 0] : 0, color: e.burning ? burnTint() : dim || undefined, flags: gl.FLAG_NOFOG | gl.FLAG_STANDING }, r.flip);
        for (const h of held) if (h.near) drawHeld(h);
        if (carried) {
          // Each footprint slice at its offset from the anchor, lifted over the head.
          const [cw, ch] = carried.footprint;
          let i = 0;
          for (let dy = 0; dy < ch; dy++) {
            for (let dx = 0; dx < cw; dx++, i++) {
              const o = iso.toScreen(e.gx + dx - (cw - 1) / 2, e.gy + dy - (ch - 1) / 2);
              const cn = idleFrame(carrySheet, carried, i);
              const cf = carrySheet.frames[cn];
              frameQuad(carrySheet, cn, Math.round(o.x), Math.round(o.y) - lift, { world, heights: cf ? [cf[3] + lift, cf[3] + lift, lift, lift] : lift, flags: gl.FLAG_NOFOG | gl.FLAG_STANDING });
            }
          }
        }
      },
    });
  }
}
