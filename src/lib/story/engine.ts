/* The landing page's scroll story, ported from the DCLogic class in
   design/Legible Nocturne v2.dc.html. The maths and constants are the
   design's own; do not re-tune them here without comparing against it.

   Differences from the design file (see docs/…/2026-09-19-legible-design.md §5.2):
   - the document scrolls, so positions come from window.scrollY and
     getBoundingClientRect() instead of a scrolling div;
   - the design-tool knobs are fixed: palette Aurora, glide 1, score 68, and
     the AA marker is the "0 failures" line at the end of the rail (100);
   - blob code for elements not in the markup is removed, and the preview-host
     watchdog is replaced by a plain requestAnimationFrame loop;
   - the server renders every value in its final state (so the page reads
     correctly without JavaScript); the engine rewinds them on start;
   - under prefers-reduced-motion nothing animates: all content shows in its
     final state and the canvas only redraws on scroll and resize;
   - the ambient drift (stars, twinkle, the light's bob) stops AMBIENT_MS after
     the last scroll or resize and resumes on the next one, so a page left
     open does not redraw 60 times a second. */

type Ctx = CanvasRenderingContext2D;

// How long the ambient drift keeps running after the reader stops.
const AMBIENT_MS = 10_000;
// Widths below this (CSS pixels) get the phone layout in landing.module.css.
const PHONE_MAX = 641;
// Brightness above the design's values, asked for by the owner (30 Sept):
// the moon, the starfield and the sky's ground. The luminance ceiling behind
// large type still applies and the type scrim still deepens with the lit
// area; the e2e test "landing page text over the moon" measures every text
// box at 320 to 1440px, so raise these only with that test passing.
const MOON_LIGHT = 1.5;
const STAR_LIGHT = 1.7;
const SKY_LIGHT = 1.7;
// The moon photo's own brightness: drawn once more on top, additively, at
// this strength minus one (x1.25 = +25%, clipped at white).
const MOON_TEX_GAIN = 1.25;
// How much the moon darkens as it fills the frame (the design used 0.56).
const MOON_SHADE = 0.32;
// Phones: the ink under full-width text (the design used 0.78).
const PHONE_INK = 0.72;

const HUES = [265, 263, 268, 260, 265]; // Aurora
const GND = {
  L: [
    [0.128, 0.1, 0.074],
    [0.122, 0.094, 0.07],
    [0.114, 0.088, 0.064],
    [0.102, 0.078, 0.056],
    [0.078, 0.058, 0.042],
  ],
  C: [
    [0.022, 0.016, 0.01],
    [0.022, 0.016, 0.01],
    [0.02, 0.015, 0.009],
    [0.018, 0.013, 0.008],
    [0.013, 0.009, 0.005],
  ],
  H: [
    [266, 264, 262],
    [264, 262, 260],
    [267, 265, 263],
    [264, 262, 260],
    [266, 264, 262],
  ],
};
export const SEVERITY = [12, 41, 90];
export const SCORE = 68;
export const AA_LINE = 100;
const CHAPTERS = ["Launch", "The mission", "The read", "The survey", "The count", "The line", "Landing"];

interface Star { a: number; r0: number; sp: number; ph: number; r: number; big: boolean; h: number }
interface Node { x: number; y: number; ph: number; sp: number; d: number; r: number; big: boolean }
interface Pit { x: number; t: number; s: number }
interface SkyStar { x: number; y: number; r: number; a: number }
interface Crater { u: number; v: number; r: number }
interface InkWord { solid: HTMLElement; line: HTMLElement }

const cl = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const ez = (t: number) => 1 - Math.pow(1 - t, 3);
const sm = (t: number) => t * t * (3 - 2 * t);

export class StoryEngine {
  private root: HTMLElement;
  private cache = new Map<string, HTMLElement>();
  private vals = new WeakMap<object, Record<string, number>>();
  private raf = 0;
  private idle = 0;
  private ts = 0;
  private dt = 1;
  private lastInput = 0;
  private moving = false;
  private reduced = false;
  private stopped = false;
  private gateDone = false;
  private gt = 0;
  private ht = 0;
  private amb = 0;
  private bandVals: Record<string, string> = {};
  private pp: number | null = null;
  private vel = 0;
  private mrn = 0;
  private hzn: number | null = null;
  private dpr = 1;
  private ctx: Ctx | null = null;
  private cvEl: HTMLCanvasElement | null = null;
  private moonTex: HTMLCanvasElement | null = null;
  private moonReq = false;
  private spr: HTMLCanvasElement[] | null = null;
  private sprDpr = 0;
  private stars: Star[] = [];
  private nodes: Node[] = [];
  private pits: Pit[] = [];
  private sky: SkyStar[] = [];
  private cra: Crater[] = [];
  private words: HTMLElement[] = [];
  private inks = new Map<string, InkWord[]>();
  private ro: ResizeObserver | null = null;
  private mq: MediaQueryList | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
  }

  // ── lifecycle ─────────────────────────────────────────────────────

  start(): void {
    this.stopped = false;
    this.mq = matchMedia("(prefers-reduced-motion: reduce)");
    this.reduced = this.mq.matches;
    this.mq.addEventListener("change", this.onMotionChange);
    addEventListener("scroll", this.onInput, { passive: true });
    addEventListener("resize", this.onInput);
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => this.onInput());
      this.ro.observe(this.root);
    }
    this.seed();
    this.splitSpeech();
    this.rewind();
    this.frame();
    this.onInput();
  }

  stop(): void {
    this.stopped = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    removeEventListener("scroll", this.onInput);
    removeEventListener("resize", this.onInput);
    this.mq?.removeEventListener("change", this.onMotionChange);
    this.ro?.disconnect();
  }

  private onMotionChange = () => {
    this.reduced = !!this.mq?.matches;
    this.onInput();
  };

  // Scroll and resize: the reader is active, so the drift runs again.
  private onInput = () => {
    this.lastInput = performance.now();
    this.kick();
  };

  private kick = () => {
    if (this.stopped || this.raf) return;
    this.raf = requestAnimationFrame(this.tick);
  };

  private tick = (now: number) => {
    this.raf = 0;
    if (this.stopped) return;
    this.dt = this.ts ? Math.min(Math.max((now - this.ts) / 16.67, 0.35), 3) : 1;
    this.ts = now;
    this.moving = false;
    try {
      this.frame();
    } catch (e) {
      console.error("story frame", e);
    }
    if (this.moving) {
      this.idle = 0;
      this.kick();
    } else if (++this.idle < 3) {
      this.kick();
    } else {
      this.ts = 0;
    }
  };

  // ── helpers ───────────────────────────────────────────────────────

  // The header's fade band follows the sky. Set on the header only, and only
  // when a value changes: a custom property changed on the page root every
  // frame restyles the whole page every frame.
  private setBand(name: string, value: string): void {
    if (this.bandVals[name] === value) return;
    const hdr = this.q("hdr");
    if (!hdr) return;
    this.bandVals[name] = value;
    hdr.style.setProperty(name, value);
  }

  private q(n: string): HTMLElement | null {
    const hit = this.cache.get(n);
    if (hit && hit.isConnected) return hit;
    const el = this.root.querySelector<HTMLElement>(`[data-a="${n}"]`);
    if (el) this.cache.set(n, el);
    else this.cache.delete(n);
    return el;
  }

  private txt(n: string, v: string): void {
    const e = this.q(n);
    if (e && e.textContent !== v) e.textContent = v;
  }

  private v(el: object): Record<string, number> {
    let rec = this.vals.get(el);
    if (!rec) {
      rec = {};
      this.vals.set(el, rec);
    }
    return rec;
  }

  // Damped scrub: every value chases its scroll-derived target instead of
  // snapping to it.
  private d(el: object, k: string, target: number, rate: number): number {
    const rec = this.v(el);
    if (this.reduced) {
      rec[k] = target;
      return target;
    }
    const cur = rec[k];
    if (cur == null) {
      rec[k] = target;
      return target;
    }
    const next = cur + (target - cur) * (1 - Math.pow(1 - Math.min(0.94, rate), this.dt));
    if (Math.abs(target - next) < 0.0006) {
      rec[k] = target;
      return target;
    }
    rec[k] = next;
    this.moving = true;
    return next;
  }

  // Monotonic progress: once revealed, stays revealed.
  private m(el: object, raw: number): number {
    const rec = this.v(el);
    rec.m = Math.max(rec.m || 0, raw);
    return rec.m;
  }

  // Puts the server-rendered final state back to the story's opening state.
  private rewind(): void {
    const mark = this.q("mark");
    if (mark) mark.style.left = "0px";
    if (this.reduced) return;
    for (let i = 0; i < 3; i++) {
      const ln = this.q("ln" + i);
      const lb = this.q("lb" + i);
      if (ln) ln.style.transform = "scaleX(0)";
      if (lb) lb.style.opacity = "0";
    }
  }

  // ── split text ────────────────────────────────────────────────────

  private splitSpeech(): void {
    const el = this.q("speech")?.querySelector<HTMLElement>("[data-split]");
    if (!el || (this.words.length && this.words[0].isConnected)) return;
    const src = el.dataset.src || (el.textContent || "").trim();
    el.dataset.src = src;
    el.textContent = "";
    this.words = src.split(/\s+/).map((w) => {
      const outer = document.createElement("span");
      outer.style.cssText = "display:inline-block;overflow:hidden;vertical-align:bottom;padding-bottom:0.08em";
      const inner = document.createElement("span");
      inner.textContent = w;
      inner.style.cssText = "display:inline-block;transform:translateY(0);transition:none;will-change:transform";
      outer.appendChild(inner);
      el.appendChild(outer);
      el.appendChild(document.createTextNode(" "));
      return inner;
    });
  }

  // Outline type that inks in: a solid copy revealed left to right while the
  // stroked copy retreats ahead of it, word by word.
  private inkBuild(n: string): InkWord[] | null {
    const cur = this.inks.get(n);
    if (cur && cur.length && cur[0].solid.isConnected) return cur;
    const el = this.q(n)?.querySelector<HTMLElement>("[data-split]");
    if (!el) return null;
    const src = el.dataset.src || (el.textContent || "").trim();
    el.dataset.src = src;
    el.textContent = "";
    const words = src.split(/\s+/).map((w) => {
      const outer = document.createElement("span");
      outer.style.cssText = "position:relative;display:inline-block";
      const solid = document.createElement("span");
      solid.textContent = w;
      solid.style.cssText = "display:inline-block;clip-path:inset(0 100% 0 0);transition:none";
      const line = document.createElement("span");
      line.textContent = w;
      line.style.cssText =
        "position:absolute;left:0;top:0;white-space:pre;color:transparent;-webkit-text-stroke:1px var(--color-neutral-400);clip-path:inset(0 0 0 0);transition:none";
      outer.appendChild(solid);
      outer.appendChild(line);
      el.appendChild(outer);
      el.appendChild(document.createTextNode(" "));
      return { solid, line };
    });
    this.inks.set(n, words);
    return words;
  }

  private inkDraw(n: string, q: number, rate: number): void {
    const words = this.inkBuild(n);
    if (!words) return;
    words.forEach((w, i) => {
      const raw = this.reduced ? 1 : cl((q - i * 0.05) / 0.3);
      const e = this.d(w.solid, "d", ez(this.m(w.solid, raw)), rate);
      w.solid.style.clipPath = "inset(0 " + ((1 - e) * 100).toFixed(2) + "% 0 0)";
      w.line.style.clipPath = "inset(0 0 0 " + (e * 100).toFixed(2) + "%)";
    });
  }

  // ── loading gate ──────────────────────────────────────────────────

  private gateStep(): void {
    if (this.gateDone) return;
    const g = this.q("gate");
    if (!g) {
      this.gateDone = true;
      return;
    }
    if (this.reduced) {
      g.style.display = "none";
      this.gateDone = true;
      this.ht = 9999;
      return;
    }
    // Shown once per browser: a return visit goes straight to the story, and
    // the headline inks in as it does after the gate.
    if (document.documentElement.classList.contains("gate-seen")) {
      g.style.display = "none";
      this.gateDone = true;
      return;
    }
    this.gt += this.dt * 16.67;
    const pct = Math.min(1, this.gt / 1150);
    this.txt("gpct", Math.round(pct * 100) + "%");
    const bar = this.q("gbar");
    if (bar) bar.style.transform = "scaleX(" + pct.toFixed(3) + ")";
    const fade = cl((this.gt - 1340) / 460);
    g.style.opacity = (1 - fade).toFixed(3);
    if (fade >= 1) {
      g.style.display = "none";
      this.gateDone = true;
      try {
        localStorage.setItem("legible-gate-seen", "1");
      } catch {
        // Storage blocked (private mode): the gate simply shows again next time.
      }
    }
    this.moving = true;
  }

  // ── canvas: textures and seeds ────────────────────────────────────

  // The photographic plate becomes a texture: the photograph carries the real
  // maria and ray systems, and a micro-relief pass keeps it from reading as a
  // blurred photo once the moon fills the frame.
  private moonBuild(img: HTMLImageElement): HTMLCanvasElement {
    const S = 1500;
    const c = document.createElement("canvas");
    c.width = S;
    c.height = S;
    const g = c.getContext("2d")!;
    g.imageSmoothingQuality = "high";
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    const r = Math.min(iw, ih) * 0.4315;
    const cx = iw * 0.4985;
    const cy = ih * 0.5064;
    g.drawImage(img, cx - r, cy - r, r * 2, r * 2, 0, 0, S, S);
    g.globalCompositeOperation = "overlay";
    g.globalAlpha = 0.32;
    g.drawImage(img, cx - r, cy - r, r * 2, r * 2, 0, 0, S, S);
    g.globalAlpha = 1;
    let s = 20260913;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    const pt = (lim: number): [number, number, number] => {
      let u: number, v: number, q: number;
      do {
        u = rnd() * 2 - 1;
        v = rnd() * 2 - 1;
        q = u * u + v * v;
      } while (q > lim);
      return [u, v, Math.sqrt(1 - q)];
    };
    for (let i = 0; i < 1600; i++) {
      const p = pt(0.993);
      const z = Math.max(0.16, p[2]);
      const rr = (1.1 + Math.pow(rnd(), 3.2) * 15) * (S / 1200);
      const x = (p[0] * 0.5 + 0.5) * S;
      const y = (p[1] * 0.5 + 0.5) * S;
      const rot = Math.atan2(p[1], p[0]);
      const a = 0.05 + rnd() * 0.13;
      g.globalCompositeOperation = "multiply";
      g.fillStyle = "rgba(126,128,142," + a.toFixed(3) + ")";
      g.beginPath();
      g.ellipse(x, y, Math.max(0.5, rr * z), rr, rot, 0, 6.2832);
      g.fill();
      g.globalCompositeOperation = "lighter";
      g.strokeStyle = "rgba(188,190,202," + (a * 0.5).toFixed(3) + ")";
      g.lineWidth = Math.max(0.6, rr * 0.16);
      g.beginPath();
      g.ellipse(x, y, Math.max(0.5, rr * z), rr, rot, -2.5, -0.4);
      g.stroke();
    }
    for (let i = 0; i < 7000; i++) {
      const p = pt(0.995);
      const x = (p[0] * 0.5 + 0.5) * S;
      const y = (p[1] * 0.5 + 0.5) * S;
      const up = rnd() > 0.5;
      g.globalCompositeOperation = up ? "lighter" : "multiply";
      g.fillStyle = up ? "rgba(200,202,214,0.05)" : "rgba(148,148,160,0.06)";
      g.fillRect(x, y, 1 + rnd() * 2.6, 1 + rnd() * 2.6);
    }
    g.globalCompositeOperation = "source-over";
    return c;
  }

  private seed(): void {
    let s = 20260911;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    this.nodes = [];
    for (let i = 0; i < 132; i++) {
      this.nodes.push({ x: rnd(), y: rnd(), ph: rnd() * 6.283, sp: 0.2 + rnd() * 1.1, d: rnd(), r: 0.45 + rnd() * 1.4, big: i % 19 === 5 });
    }
    // Bokeh discs and boulders: the design seeds them but never draws them.
    // The draws are kept so every later value matches the design exactly.
    for (let i = 0; i < 14 * 4; i++) rnd();
    this.stars = [];
    for (let i = 0; i < 240; i++) {
      this.stars.push({ a: rnd() * 6.283, r0: rnd(), sp: 0.55 + rnd() * 1.1, ph: rnd() * 6.283, r: 0.5 + rnd() * 1.3, big: i % 23 === 7, h: i % 3 });
    }
    for (let i = 0; i < 30; i++) {
      const n = 6 + ((i * 7) % 3);
      for (let k = 0; k < n; k++) rnd();
      rnd();
      rnd();
      rnd();
      rnd();
    }
    this.pits = [];
    for (let i = 0; i < 26; i++) this.pits.push({ x: rnd(), t: Math.pow(rnd(), 0.5), s: 0.6 + rnd() * 2.2 });
    this.sky = [];
    for (let i = 0; i < 150; i++) this.sky.push({ x: rnd(), y: rnd(), r: 0.4 + rnd() * 1.1, a: 0.16 + rnd() * 0.66 });
    this.cra = [];
    for (let i = 0; i < 54; i++) {
      let u: number, v: number, qq: number;
      do {
        u = rnd() * 2 - 1;
        v = rnd() * 2 - 1;
        qq = u * u + v * v;
      } while (qq > 0.94);
      this.cra.push({ u, v, r: 0.012 + Math.pow(rnd(), 2.6) * 0.15 });
    }
  }

  private cvSetup(): HTMLCanvasElement | null {
    const cv = this.q("cv") as HTMLCanvasElement | null;
    if (!cv) return null;
    const dpr = Math.min(1.5, devicePixelRatio || 1);
    const w = cv.clientWidth || 1;
    const h = cv.clientHeight || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      this.ctx = null;
    }
    if (!this.ctx || this.cvEl !== cv) {
      this.ctx = cv.getContext("2d");
      this.cvEl = cv;
    }
    this.dpr = dpr;
    if (!this.moonReq) {
      this.moonReq = true;
      const img = new Image();
      img.onload = () => {
        try {
          this.moonTex = this.moonBuild(img);
        } catch (e) {
          console.error("moon plate", e);
        }
        this.kick();
      };
      img.src = "/moon-plate.webp";
    }
    // One soft-disc sprite per hue, blitted per frame.
    if (this.sprDpr !== dpr || !this.spr) {
      this.sprDpr = dpr;
      this.spr = [0, 1, 2].map((n) => {
        const sc = document.createElement("canvas");
        const S = 128;
        sc.width = S;
        sc.height = S;
        const g2 = sc.getContext("2d")!;
        const rg = g2.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
        rg.addColorStop(0, "oklch(0.82 0.1 " + HUES[n] + " / 0.6)");
        rg.addColorStop(0.42, "oklch(0.78 0.1 " + HUES[n] + " / 0.22)");
        rg.addColorStop(0.78, "oklch(0.74 0.1 " + HUES[n] + " / 0.05)");
        rg.addColorStop(1, "oklch(0.72 0.1 " + HUES[n] + " / 0)");
        g2.fillStyle = rg;
        g2.fillRect(0, 0, S, S);
        return sc;
      });
    }
    return cv;
  }

  // ── canvas: the voyage ────────────────────────────────────────────

  // A voyage, not a diagram: the starfield streams past the direction of
  // travel, and the moon grows from a far disc into the ground you land on.
  private cvDraw(pd: number, sel: number): void {
    const cv = this.cvSetup();
    if (!cv || !this.ctx) return;
    const ctx = this.ctx;
    const W = cv.width;
    const H = cv.height;
    const dpr = this.dpr;
    const hues = HUES;
    // Phones draw half of the small stars and dust flecks: the sky looks as
    // full on the smaller screen, and each frame costs less battery.
    const thin = W / dpr < PHONE_MAX;
    if (!this.reduced) this.amb += (this.dt || 1) * 0.0167;
    const amb = this.amb;
    const t = pd * 5.5 + amb * 0.2;
    const col = (i: number, l: number, c: number, a: number | string) =>
      "oklch(" + l + " " + c + " " + hues[i] + " / " + a + ")";
    ctx.clearRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";

    const dp = Math.abs(pd - (this.pp == null ? pd : this.pp));
    this.pp = pd;
    const inst = this.reduced ? 0 : Math.min(1, dp / (0.0045 * Math.max(0.5, this.dt || 1)));
    this.vel = this.vel + (inst - this.vel) * 0.1;
    const vel = this.vel;
    if (vel > 0.005) this.moving = true;

    const vmin = Math.min(W, H);
    const hx = W * 0.58;
    const hy = H * (0.15 + Math.sin(amb * 0.26) * 0.008);
    const R = vmin * 0.05;
    const vpx = W * 0.7;
    const vpy = H * 0.36;
    const kf = (arr: number[]) => {
      const f = cl(pd) * (arr.length - 1);
      const i = Math.min(arr.length - 2, Math.floor(f));
      const tt = f - i;
      const s = tt * tt * (3 - 2 * tt);
      return arr[i] + (arr[i + 1] - arr[i]) * s;
    };
    const mR = Math.min(vmin * 1.5, vmin * kf([0.055, 0.075, 0.14, 0.34, 0.78, 1.2, 1.5]));
    this.mrn = mR / vmin;
    const gq = cl((pd - 0.8) / 0.13);
    const mx = Math.max(W * kf([0.8, 0.79, 0.77, 0.75, 0.72, 0.7, 0.68]), W * 0.54 + mR);
    const my = H * kf([0.3, 0.27, 0.22, 0.17, 0.26, 0.46, 0.58]) + mR * 0.62;
    let ldx = hx - mx;
    let ldy = hy - my;
    const lnorm = Math.hypot(ldx, ldy) || 1;
    ldx /= lnorm;
    ldy /= lnorm;

    // Starfield: polar advance away from the heading, streaked by speed.
    const maxR = Math.hypot(W, H) * 0.82;
    ctx.lineCap = "round";
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      if (thin && i % 2 && !s.big) continue;
      const adv = (((s.r0 + pd * 1.15 * s.sp + amb * 0.009 * s.sp) % 1) + 1) % 1;
      const rad = Math.pow(adv, 2.1) * maxR;
      const ca = Math.cos(s.a);
      const sa = Math.sin(s.a);
      const x = vpx + ca * rad * 1.15;
      const y = vpy + sa * rad;
      if (x < -60 || x > W + 60 || y < -60 || y > H + 60) continue;
      const near = Math.pow(adv, 1.4);
      const a = Math.min(1, cl(adv * 7) * (0.18 + 0.82 * near) * STAR_LIGHT);
      const w = (0.45 + near * 1.5) * s.r * dpr;
      const len = Math.min(rad * 0.5, (1.5 + vel * 72 * s.sp) * dpr * (0.35 + near));
      if (len > 3 * dpr) {
        ctx.strokeStyle = "rgba(240,242,255," + (a * 0.85).toFixed(3) + ")";
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(x - ca * len * 1.15, y - sa * len);
        ctx.lineTo(x, y);
        ctx.stroke();
      } else {
        ctx.fillStyle = "rgba(240,242,255," + a.toFixed(3) + ")";
        ctx.beginPath();
        ctx.arc(x, y, w * 0.62, 0, 6.2832);
        ctx.fill();
      }
      if (s.big) {
        const br = w * 6;
        const g = ctx.createRadialGradient(x, y, 0, x, y, br);
        g.addColorStop(0, "rgba(247,248,255," + (a * 0.5).toFixed(3) + ")");
        g.addColorStop(0.34, "rgba(232,234,252," + (a * 0.11).toFixed(3) + ")");
        g.addColorStop(1, "rgba(226,228,250,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, br, 0, 6.2832);
        ctx.fill();
      }
    }

    // The sun: a small white disc with only the optics' own bloom.
    const SR = Math.max(1.6 * dpr, R * 0.3);
    const bloom = ctx.createRadialGradient(hx, hy, SR * 0.7, hx, hy, SR * 8);
    bloom.addColorStop(0, "rgba(255,255,251,0.46)");
    bloom.addColorStop(0.2, "rgba(248,249,255,0.09)");
    bloom.addColorStop(1, "rgba(244,246,255,0)");
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(hx, hy, SR * 8, 0, 6.2832);
    ctx.fill();
    ctx.fillStyle = "rgb(255,255,252)";
    ctx.beginPath();
    ctx.arc(hx, hy, SR, 0, 6.2832);
    ctx.fill();

    // The moon: opaque, so it occludes the stars behind it.
    ctx.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.beginPath();
    ctx.arc(mx, my, mR, 0, 6.2832);
    ctx.clip();
    const lo = Math.min(mR * 0.6, vmin * 0.42);
    const lgx = mx + ldx * lo;
    const lgy = my + ldy * lo;
    const dim = cl((mR / vmin - 0.3) / 0.55);
    const tex = this.moonTex;
    if (tex) {
      ctx.drawImage(tex, mx - mR, my - mR, mR * 2, mR * 2);
      if (MOON_TEX_GAIN > 1) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = MOON_TEX_GAIN - 1;
        ctx.drawImage(tex, mx - mR, my - mR, mR * 2, mR * 2);
        ctx.globalAlpha = 1;
      }
      const b = MOON_LIGHT * (1 - MOON_SHADE * dim);
      const sv = (k: number, bl: number) => {
        const l = Math.min(255, k * b * 255);
        return (
          "rgb(" +
          Math.round(l * (1 - bl * 0.07)) +
          "," +
          Math.round(l * (1 - bl * 0.02)) +
          "," +
          Math.round(Math.min(255, l * (1 + bl * 0.12))) +
          ")"
        );
      };
      ctx.globalCompositeOperation = "multiply";
      const sg = ctx.createRadialGradient(lgx, lgy, mR * 0.04, lgx, lgy, mR * (1.72 - dim * 0.42));
      sg.addColorStop(0, sv(1, 0));
      sg.addColorStop(0.28, sv(0.93, 0.2));
      sg.addColorStop(0.56, sv(0.7, 0.6));
      sg.addColorStop(0.82, sv(0.4, 1));
      sg.addColorStop(1, sv(0.22, 1));
      ctx.fillStyle = sg;
      ctx.fillRect(mx - mR, my - mR, mR * 2, mR * 2);
      const lb = ctx.createRadialGradient(mx, my, mR * 0.55, mx, my, mR);
      lb.addColorStop(0, "rgb(255,255,255)");
      lb.addColorStop(0.88, "rgb(238,238,246)");
      lb.addColorStop(1, "rgb(168,170,190)");
      ctx.fillStyle = lb;
      ctx.fillRect(mx - mR, my - mR, mR * 2, mR * 2);
      // Luminance ceiling: a clipped highlight behind headline-scale type is
      // a contrast failure.
      const ceil = Math.round(252 - 54 * cl((this.mrn - 0.45) / 0.5));
      if (ceil < 250) {
        ctx.globalCompositeOperation = "darken";
        ctx.fillStyle = "rgb(" + ceil + "," + ceil + "," + (ceil + 6) + ")";
        ctx.fillRect(mx - mR, my - mR, mR * 2, mR * 2);
      }
      ctx.globalCompositeOperation = "source-over";
    } else {
      const lv = (hi: number, lo2: number) => (hi + (lo2 - hi) * dim).toFixed(3);
      const reg = ctx.createRadialGradient(lgx, lgy, mR * 0.02, lgx, lgy, mR * (1.85 - dim * 0.5));
      reg.addColorStop(0, "oklch(" + lv(0.955, 0.78) + " 0.008 92)");
      reg.addColorStop(0.16, "oklch(" + lv(0.87, 0.6) + " 0.009 88)");
      reg.addColorStop(0.4, "oklch(" + lv(0.63, 0.38) + " 0.016 252)");
      reg.addColorStop(0.7, "oklch(" + lv(0.37, 0.25) + " 0.024 258)");
      reg.addColorStop(1, "oklch(" + lv(0.245, 0.185) + " 0.03 262)");
      ctx.fillStyle = reg;
      ctx.fillRect(mx - mR, my - mR, mR * 2, mR * 2);
      for (const c of this.cra) {
        const q = c.u * c.u + c.v * c.v;
        if (q > 0.985) continue;
        const z = Math.sqrt(1 - q);
        const cr = Math.min(c.r * mR, vmin * 0.075);
        if (cr < 1.1 * dpr) continue;
        const cxp = mx + c.u * mR;
        const cyp = my + c.v * mR;
        if (cxp < -cr || cxp > W + cr || cyp < -cr || cyp > H + cr) continue;
        const rot = Math.atan2(c.v, c.u);
        const sh = cl(c.u * ldx + c.v * ldy + z * 0.6);
        ctx.fillStyle =
          "oklch(" + (0.2 + (0.52 - 0.16 * dim) * sh).toFixed(3) + " 0.014 " + (252 - 160 * sh).toFixed(0) + " / 0.5)";
        ctx.beginPath();
        ctx.ellipse(cxp, cyp, Math.max(0.5, cr * z), cr, rot, 0, 6.2832);
        ctx.fill();
        ctx.strokeStyle = "oklch(" + (0.5 + 0.34 * sh).toFixed(3) + " 0.012 92 / " + (0.1 + 0.34 * sh).toFixed(3) + ")";
        ctx.lineWidth = Math.max(0.6, Math.min(2.6 * dpr, cr * 0.1));
        ctx.beginPath();
        ctx.ellipse(
          cxp,
          cyp,
          Math.max(0.5, cr * z),
          cr,
          rot,
          Math.atan2(ldy, ldx) - rot - 1.5,
          Math.atan2(ldy, ldx) - rot + 1.5,
        );
        ctx.stroke();
      }
    }
    // Earthshine: the dark limb never goes fully black.
    ctx.globalCompositeOperation = "lighter";
    const esx = mx - ldx * mR * 0.75;
    const esy = my - ldy * mR * 0.75;
    const esg = ctx.createRadialGradient(esx, esy, 0, esx, esy, mR * 1.25);
    esg.addColorStop(0, col(1, 0.55, 0.07, 0.2));
    esg.addColorStop(1, col(1, 0.45, 0.06, 0));
    ctx.fillStyle = esg;
    ctx.fillRect(mx - mR, my - mR, mR * 2, mR * 2);
    ctx.restore();

    // The faint accent cast outside the disc, only while it is still distant.
    ctx.globalCompositeOperation = "lighter";
    if (this.mrn < 0.62) {
      const cast = ctx.createRadialGradient(mx, my, mR * 0.99, mx, my, mR * 1.14);
      cast.addColorStop(0, col(0, 0.62, 0.09, 0.055));
      cast.addColorStop(1, col(0, 0.55, 0.08, 0));
      ctx.fillStyle = cast;
      ctx.beginPath();
      ctx.arc(mx, my, mR * 1.14, 0, 6.2832);
      ctx.fill();
    }

    // The survey chapter puts markers down: a lit point on the regolith with
    // a hairline leader back toward the column of type.
    const an = this.reduced ? (sel > 0.06 ? 1 : 0) : cl((sel - 0.06) / 0.46);
    if (an > 0.01) {
      const dirs = [
        [-0.44, -0.32],
        [0.04, 0.08],
        [-0.62, 0.44],
      ];
      dirs.forEach((d, i) => {
        const e = cl((an - i * 0.2) / 0.34);
        if (e <= 0.01) return;
        const len = vmin * (0.1 + i * 0.028) * (0.45 + 0.55 * e);
        const x0 = mx + d[0] * mR;
        const y0 = my + d[1] * mR;
        const x1 = x0 - len;
        const y1 = y0 - len * 0.42;
        ctx.lineWidth = Math.max(0.5, 0.8 * dpr);
        ctx.strokeStyle = col(1, 0.9, 0.1, (0.5 * e).toFixed(3));
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        const dr = 2.4 * dpr;
        const dg = ctx.createRadialGradient(x1, y1, 0, x1, y1, dr * 6);
        dg.addColorStop(0, col(1, 0.97, 0.09, (0.85 * e).toFixed(3)));
        dg.addColorStop(0.32, col(1, 0.82, 0.14, (0.24 * e).toFixed(3)));
        dg.addColorStop(1, col(1, 0.76, 0.13, 0));
        ctx.fillStyle = dg;
        ctx.beginPath();
        ctx.arc(x1, y1, dr * 6, 0, 6.2832);
        ctx.fill();
      });
    }

    if (gq > 0.002) this.drawGround(ctx, W, H, dpr, gq);

    // Regolith dust: flecks blowing past as you come in low.
    const land = cl((pd - 0.58) / 0.3);
    this.nodes.forEach((n, i) => {
      if (thin && i % 2 && !n.big) return;
      let x = (n.x - pd * (0.9 + 2.4 * n.d) * n.sp - amb * 0.018 * n.sp) % 1;
      let y = (n.y + Math.sin(t * 0.5 + n.ph) * 0.01) % 1;
      if (x < 0) x += 1;
      if (y < 0) y += 1;
      const hzn = this.hzn != null && gq > 0.5 ? this.hzn : Math.max(H * 0.52, my - mR);
      const px = x * W;
      const py = hzn + (0.03 + 0.94 * y) * Math.max(H * 0.1, H - hzn);
      const band = land * cl((py - hzn) / (H * 0.06)) * cl((H * 1.05 - py) / (H * 0.1));
      if (band < 0.02) return;
      const tw = band * (0.35 + 0.65 * Math.abs(Math.sin(amb * 1.2 * n.sp + n.ph)));
      const rr = n.r * dpr * (0.5 + n.d * 1.5);
      const st = (2 + n.d * 26) * dpr * (0.3 + 0.7 * vel);
      if (st > 3 * dpr) {
        ctx.strokeStyle = "rgba(244,242,255," + (tw * (0.2 + 0.6 * n.d)).toFixed(3) + ")";
        ctx.lineWidth = Math.max(0.5, rr * 0.8);
        ctx.beginPath();
        ctx.moveTo(px + st, py);
        ctx.lineTo(px, py);
        ctx.stroke();
      }
      if (n.big) {
        const hue = hues[i % 3];
        const g = ctx.createRadialGradient(px, py, 0, px, py, rr * 9);
        g.addColorStop(0, "oklch(0.99 0.04 " + hue + " / " + tw.toFixed(3) + ")");
        g.addColorStop(0.22, "oklch(0.88 0.12 " + hue + " / " + (0.44 * tw).toFixed(3) + ")");
        g.addColorStop(0.5, "oklch(0.78 0.13 " + hue + " / " + (0.16 * tw).toFixed(3) + ")");
        g.addColorStop(1, "oklch(0.72 0.13 " + hue + " / 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(px, py, rr * 9, 0, 6.2832);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(238,238,255," + ((0.16 + 0.62 * n.d) * tw).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(px, py, n.big ? rr * 1.4 : rr * 0.8, 0, 6.2832);
      ctx.fill();
    });

    ctx.globalCompositeOperation = "source-over";
    if (!this.reduced && performance.now() - this.lastInput < AMBIENT_MS) this.moving = true;
  }

  // The arrival: a flat razor horizon with black down to it, and Earth
  // hanging fixed in the sky.
  private drawGround(ctx: Ctx, W: number, H: number, dpr: number, q: number): void {
    const vmin = Math.min(W, H);
    const hz = H * (0.495 - 0.04 * q);
    this.hzn = hz;
    ctx.save();
    ctx.globalAlpha = q;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "oklch(0.048 0.010 264)";
    ctx.fillRect(0, 0, W, Math.ceil(hz) + 1);

    for (const s of this.sky) {
      const y = s.y * hz * 0.94;
      const x = s.x * W;
      ctx.fillStyle = "rgba(240,242,255," + Math.min(1, s.a * 0.62 * STAR_LIGHT).toFixed(3) + ")";
      ctx.beginPath();
      ctx.arc(x, y, s.r * dpr * 0.7, 0, 6.2832);
      ctx.fill();
    }

    const ex = W * 0.795;
    const ey = hz * 0.3;
    const er = vmin * 0.058 * (0.72 + 0.28 * q);
    const eg = ctx.createRadialGradient(ex - er * 0.45, ey - er * 0.4, er * 0.05, ex, ey, er * 1.05);
    eg.addColorStop(0, "oklch(0.80 0.055 235)");
    eg.addColorStop(0.42, "oklch(0.58 0.075 248)");
    eg.addColorStop(0.72, "oklch(0.34 0.055 256)");
    eg.addColorStop(1, "oklch(0.13 0.024 260)");
    ctx.fillStyle = eg;
    ctx.beginPath();
    ctx.arc(ex, ey, er, 0, 6.2832);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(ex, ey, er, 0, 6.2832);
    ctx.clip();
    ctx.globalCompositeOperation = "multiply";
    const term = ctx.createLinearGradient(ex + er * 0.1, ey, ex + er, ey + er * 0.3);
    term.addColorStop(0, "rgb(255,255,255)");
    term.addColorStop(0.55, "rgb(96,98,120)");
    term.addColorStop(1, "rgb(26,27,38)");
    ctx.fillStyle = term;
    ctx.fillRect(ex - er, ey - er, er * 2, er * 2);
    ctx.restore();

    const tex = this.moonTex;
    const N = 54;
    const depth = H - hz;
    for (let i = 0; i < N; i++) {
      const t0 = i / N;
      const t1 = (i + 1) / N;
      const y0 = hz + Math.pow(t0, 2.15) * depth;
      const y1 = hz + Math.pow(t1, 2.15) * depth;
      const hgt = Math.max(1, y1 - y0 + 1);
      const wid = W * (1 + Math.pow(t0, 1.6) * 2.4);
      if (tex) {
        const sy = (0.1 + 0.8 * t0) * tex.height;
        ctx.drawImage(tex, tex.width * 0.16, sy, tex.width * 0.68, Math.max(2, (tex.height / N) * 0.9), (W - wid) / 2, y0, wid, hgt);
      } else {
        ctx.fillStyle = "oklch(" + (0.34 + 0.16 * t0).toFixed(3) + " 0.008 92)";
        ctx.fillRect(0, y0, W, hgt);
      }
    }
    ctx.globalCompositeOperation = "multiply";
    const vr = ctx.createLinearGradient(0, hz, 0, H);
    vr.addColorStop(0, "rgb(56,58,74)");
    vr.addColorStop(0.16, "rgb(104,106,124)");
    vr.addColorStop(0.58, "rgb(198,199,208)");
    vr.addColorStop(1, "rgb(216,216,224)");
    ctx.fillStyle = vr;
    ctx.fillRect(0, hz, W, H - hz);
    ctx.globalCompositeOperation = "darken";
    ctx.fillStyle = "rgb(198,199,208)";
    ctx.fillRect(0, hz, W, H - hz);
    ctx.globalCompositeOperation = "source-over";

    for (const p of this.pits) {
      const y = hz + Math.pow(p.t, 2.15) * depth;
      const x = ((p.x * 1.7) % 1) * W;
      const rr = (0.01 + 0.105 * Math.pow(p.t, 2.2)) * vmin * p.s;
      if (rr < 5 * dpr) continue;
      const g = ctx.createLinearGradient(x, y - rr * 0.28, x, y + rr * 0.28);
      g.addColorStop(0, "oklch(0.30 0.010 262 / 0.26)");
      g.addColorStop(1, "oklch(0.58 0.007 92 / 0.10)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, rr, rr * 0.26, 0, 0, 6.2832);
      ctx.fill();
      ctx.strokeStyle = "oklch(0.86 0.006 92 / 0.16)";
      ctx.lineWidth = Math.max(0.8, rr * 0.035);
      ctx.beginPath();
      ctx.ellipse(x, y, rr, rr * 0.26, 0, 3.52, 5.94);
      ctx.stroke();
    }

    for (let i = 0; i < 260; i++) {
      const tt = 0.42 + ((i * 0.0179) % 0.58);
      const y = hz + Math.pow(tt, 2.15) * depth;
      const x = ((((i * 0.0713 + Math.sin(i) * 0.31) % 1) + 1) % 1) * W;
      const g2 = (0.7 + ((i * 13) % 7) * 0.42) * dpr * (0.4 + tt);
      ctx.fillStyle = "oklch(0.06 0.008 264 / 0.7)";
      ctx.fillRect(x - g2 * 2.2, y, g2 * 2.2, g2 * 0.7);
      ctx.fillStyle = "oklch(0.96 0.004 92 / 0.72)";
      ctx.fillRect(x, y - g2 * 0.3, g2, g2 * 0.8);
    }

    ctx.strokeStyle = "oklch(0.72 0.006 92 / 0.44)";
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    ctx.moveTo(0, hz + 0.5);
    ctx.lineTo(W, hz + 0.5);
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ── the frame ─────────────────────────────────────────────────────

  private frame(): void {
    const root = this.root;
    if (!root.isConnected) return;
    const G = 1;
    const r = (x: number) => Math.min(0.94, x / G);
    const expo = ez;
    const reduced = this.reduced;

    const vh = innerHeight || 1;
    const chaps = Array.from(root.querySelectorAll<HTMLElement>("[data-chap]"));
    const chapY = chaps.map((el) => el.getBoundingClientRect().top);
    // The story runs from the top of the page to the end of chapter 07, as in
    // the design; the footer after it is not part of the voyage.
    const last = chaps[chaps.length - 1];
    const storyEnd = last ? last.getBoundingClientRect().bottom + scrollY : document.documentElement.scrollHeight;
    const span = Math.max(1, storyEnd - vh);
    const p = cl(scrollY / span);
    this.gateStep();

    const revs = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const revY = revs.map((el) => el.getBoundingClientRect().top);

    // The design has no footer. When ours scrolls in, chapter 07 rises under
    // the transparent header, so the header steps aside.
    const hdr = this.q("hdr");
    const foot = this.q("foot");
    if (hdr && foot) {
      const o = 1 - cl((vh - foot.getBoundingClientRect().top) / 100);
      hdr.style.opacity = o.toFixed(3);
      hdr.style.visibility = o < 0.02 ? "hidden" : "";
    }
    const scrub = (n: string) => {
      const el = this.q(n);
      if (!el) return 0;
      const b = el.getBoundingClientRect();
      const room = b.height - vh;
      return room > 8 ? cl(-b.top / room) : cl((vh * 0.7 - b.top) / (vh * 0.7));
    };
    const q2 = scrub("s2");
    const qsel = scrub("sel");
    const q3 = scrub("s3");
    const q4 = scrub("s4");
    const q5 = scrub("s5");
    const rail = this.q("rail");
    const gW = rail ? rail.clientWidth : 0;

    const travel = reduced ? 0 : 14;
    revs.forEach((el, i) => {
      const delay = Number(el.dataset.revealDelay || 0);
      const raw = reduced ? 1 : cl((vh * 0.94 - revY[i]) / (vh * 0.26) - delay * 0.06);
      const e = this.d(el, "d", expo(this.m(el, raw)), r(0.14));
      el.style.opacity = e.toFixed(3);
      el.style.transform = "translate3d(0," + ((1 - e) * travel).toFixed(2) + "px,0)";
      if (e > 0.999 && el.style.willChange !== "auto") el.style.willChange = "auto";
    });

    const pd = this.d(this, "p", p, r(0.16));
    const fracs = chapY.map((y) => cl((y + scrollY) / span));
    let idx = 1;
    fracs.forEach((f, i) => {
      if (p >= f - 0.012) idx = i + 1;
    });
    this.txt("idx", "0" + idx + " / 07");
    this.txt("edge", "0" + idx + " — " + CHAPTERS[idx - 1]);
    const cue = this.q("cue");
    if (cue && !reduced) cue.style.opacity = String(Math.min(Number(cue.style.opacity || 1), 1 - cl((p - 0.01) / 0.05)));

    // The ground itself travels: each chapter lands on its own deep stop.
    const base = this.q("base");
    if (base) {
      const f = pd * 4;
      const a = Math.min(3, Math.floor(f));
      const tt = sm(f - a);
      const bx = Math.min(4, a + 1);
      const key = (a * 100 + Math.round(tt * 100)) | 0;
      const rec = this.v(base);
      if (rec.k !== key) {
        rec.k = key;
        const st = [0, 1, 2].map((s) => {
          const l = (GND.L[a][s] + (GND.L[bx][s] - GND.L[a][s]) * tt) * SKY_LIGHT;
          const c = GND.C[a][s] + (GND.C[bx][s] - GND.C[a][s]) * tt;
          const h0 = GND.H[a][s];
          let h1 = GND.H[bx][s];
          if (h1 - h0 > 180) h1 -= 360;
          else if (h0 - h1 > 180) h1 += 360;
          const h = h0 + (h1 - h0) * tt;
          return "oklch(" + l.toFixed(3) + " " + c.toFixed(3) + " " + h.toFixed(1) + ")";
        });
        base.style.background = "linear-gradient(176deg, " + st[0] + " 0%, " + st[1] + " 46%, " + st[2] + " 100%)";
        // The header's fade band takes the sky's top colour.
        this.setBand("--sky-top", st[0]);
      }
    }

    this.cvDraw(pd, qsel);

    // The ink scrim under the type column deepens with how much lit surface
    // the frame holds, so the headline keeps its contrast the whole way in.
    const scrim = this.q("scrim");
    if (scrim && innerWidth < 640) {
      // Phones: the text column spans the whole screen, so the design's
      // left-to-right scrim leaves headlines over the lit moon (measured
      // about 2:1). Here the ink covers the full width instead, deepening as
      // the moon grows, which keeps text above 4.5:1 over the brightest
      // regolith.
      const need = cl((this.mrn - 0.04) / 0.08);
      const e = this.d(scrim, "d", 0.45 + 0.55 * need, r(0.12));
      scrim.style.opacity = e.toFixed(3);
      // The header band sits above the ink, so it carries the ink too, less
      // the share the glow layer (above the ink) gives back.
      this.setBand("--band-ink", Math.round(e * PHONE_INK * 75) + "%");
      const rec = this.v(scrim);
      if (rec.gk !== -1) {
        rec.gk = -1;
        scrim.style.background = "rgba(6,7,13," + PHONE_INK + ")";
      }
    } else if (scrim) {
      this.setBand("--band-ink", "0%");
      const need = cl((this.mrn - 0.2) / 0.62);
      const e = this.d(scrim, "d", 0.34 + 0.66 * need, r(0.12));
      scrim.style.opacity = e.toFixed(3);
      const k = cl((this.mrn - 0.3) / 0.6);
      const gk = Math.round(k * 60);
      const rec = this.v(scrim);
      if (rec.gk !== gk) {
        rec.gk = gk;
        const kk = gk / 60;
        const p1 = 26 + 14 * kk;
        const p2 = 44 + 14 * kk;
        const p3 = 62 + 8 * kk;
        const p4 = 78 + 4 * kk;
        const a2 = 0.74 + 0.14 * kk;
        const a3 = 0.24 + 0.21 * kk;
        scrim.style.background =
          "linear-gradient(90deg, rgba(6,7,13,0.97) 0%, rgba(6,7,13,0.95) " +
          p1.toFixed(1) +
          "%, rgba(6,7,13," +
          a2.toFixed(3) +
          ") " +
          p2.toFixed(1) +
          "%, rgba(6,7,13," +
          a3.toFixed(3) +
          ") " +
          p3.toFixed(1) +
          "%, rgba(6,7,13,0) " +
          p4.toFixed(1) +
          "%)";
      }
    }

    if (this.gateDone) this.ht += this.dt * 16.67;
    const q0 = reduced ? 1 : cl(this.ht / 1000);
    this.inkDraw("ink0", q0, r(0.2));
    if (q0 < 1) this.moving = true;
    this.inkDraw("ink1", cl((q4 - 0.02) / 0.32), r(0.16));
    this.inkDraw("ink2", cl((q5 - 0.05) / 0.4), r(0.16));

    this.words.forEach((w, i) => {
      const raw = reduced ? 1 : cl((q2 - 0.08 - i * 0.028) / 0.26);
      const e = this.d(w, "d", expo(this.m(w, raw)), r(0.18));
      w.style.transform = "translateY(" + ((1 - e) * 112).toFixed(2) + "%)";
      if (e > 0.999 && w.style.willChange !== "auto") w.style.willChange = "auto";
    });

    // Chapter 04: each finding's hairline draws out to its label.
    for (let i = 0; i < 3; i++) {
      const ln = this.q("ln" + i);
      const lb = this.q("lb" + i);
      if (!ln) continue;
      const raw = reduced ? 1 : cl((qsel - 0.12 - i * 0.17) / 0.2);
      const e = this.d(ln, "d", ez(this.m(ln, raw)), r(0.16));
      ln.style.transform = "scaleX(" + e.toFixed(3) + ")";
      if (lb) {
        lb.style.opacity = e.toFixed(3);
        lb.style.transform = "translate3d(" + ((1 - e) * -10).toFixed(2) + "px,0,0)";
      }
    }

    // Chapter 05: the count.
    const total = SEVERITY.reduce((a, b) => a + b, 0);
    const big = this.q("total");
    if (big) {
      const e = this.d(big, "d", reduced ? 1 : expo(cl((q3 - 0.05) / 0.55)), r(0.1));
      this.txt("total", String(Math.round(total * e)));
    }
    for (let i = 0; i < 3; i++) {
      const bar = this.q("bar" + i);
      if (!bar) continue;
      const e = this.d(bar, "d", reduced ? 1 : expo(cl((q3 - 0.12 - i * 0.07) / 0.5)), r(0.1));
      bar.style.transform = "scaleX(" + (e * (SEVERITY[i] / total)).toFixed(4) + ")";
      this.txt("val" + i, String(Math.round(SEVERITY[i] * e)));
    }

    // Chapter 07: you are down on the regolith; the visor closes in.
    const pov = this.q("pov");
    if (pov) {
      const e = this.d(pov, "d", expo(cl((q5 - 0.02) / 0.46)), r(0.13));
      pov.style.opacity = e.toFixed(3);
    }

    // Chapter 06: the score against the line, and the gap between them.
    const mark = this.q("mark");
    if (mark && gW > 0) {
      const e = this.d(mark, "d", reduced ? 1 : expo(cl((q4 - 0.08) / 0.62)), r(0.09));
      mark.style.transform = "translate3d(" + (e * (SCORE / 100) * gW).toFixed(1) + "px,0,0)";
      this.txt("gval", String(Math.round(SCORE * e)));
      const gap = this.q("gap");
      if (gap) {
        const shown = cl((e - 0.82) / 0.18);
        gap.style.opacity = shown.toFixed(3);
        gap.style.transform = "scaleX(" + shown.toFixed(3) + ")";
      }
      const gl = this.q("gaplabel");
      if (gl) gl.style.opacity = cl((e - 0.86) / 0.14).toFixed(3);
    }
  }
}
