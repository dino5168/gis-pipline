// 命令列 MEASUREGEOM（MEA）：幾何量測（仿 AutoCAD），只量不畫，結果寫在命令列並暫時標在地圖上（命令結束清除）。
//   距離（D）  兩點：距離、XY 平面角度、方位角、ΔX、ΔY；多點（M）累計總長
//   半徑（R）  選取圓：半徑、直徑、周長、面積
//   角度（A）  選取兩條線（直線、聚合線或多邊形的邊）的夾角；Enter 改為「頂點＋兩端點」
//   面積（AR） 點選角點圍出面積，或物件（O）選取多邊形／圓；加入（A）／減去（S）累計總面積
// 每量完一次回到選項提示，Enter／X 結束。坐標一律 TWD97 平面坐標（公尺）。
import type { XY } from './commandInput';
import { CommandSession, type Preview, type ShapeXY, type Step } from './commandSessions';
import { formatArea, formatDistance } from './measure';
import type { CommandOption } from '../types/commandLine';

const EPS = 1e-6;
/** 視為圓：頂點數下限、各頂點到中心距離的容許誤差（相對、絕對） */
const CIRCLE_MIN_VERTICES = 32;
const CIRCLE_REL_TOL = 1e-3;
const CIRCLE_ABS_TOL = 0.05;
const ARC_SEGMENTS = 24;

const opt = (key: string, label: string): CommandOption => ({ key, label });
const OPT_DIST = opt('D', '距離');
const OPT_RADIUS = opt('R', '半徑');
const OPT_ANGLE = opt('A', '角度');
const OPT_AREA = opt('AR', '面積');
const OPT_EXIT = opt('X', '結束');
const OPT_MULTI = opt('M', '多點');
const OPT_UNDO = opt('U', '復原');
const OPT_OBJECT = opt('O', '物件');
const OPT_ADD = opt('A', '加入面積');
const OPT_SUB = opt('S', '減去面積');
const MENU_OPTIONS = [OPT_DIST, OPT_RADIUS, OPT_ANGLE, OPT_AREA, OPT_EXIT];

const dist = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1];
const crossZ = (a: XY, b: XY) => a[0] * b[1] - a[1] * b[0];
const norm = (v: XY): XY => {
  const l = Math.hypot(v[0], v[1]);
  return [v[0] / l, v[1] / l];
};
const mid = (a: XY, b: XY): XY => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const deg = (rad: number) => (rad * 180) / Math.PI;
const f3 = (v: number) => v.toFixed(3);
const fDeg = (v: number) => `${v.toFixed(2)}°`;

/** 0°＝東、逆時針為正（0～360） */
const xyAngle = (a: XY, b: XY) => (deg(Math.atan2(b[1] - a[1], b[0] - a[0])) + 360) % 360;
/** 方位角：北起順時針（0～360） */
const azimuth = (a: XY, b: XY) => (deg(Math.atan2(b[0] - a[0], b[1] - a[1])) + 360) % 360;

function polylineLength(pts: XY[], closed: boolean): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return closed && pts.length > 2 ? s + dist(pts[pts.length - 1], pts[0]) : s;
}

/** 環的面積（絕對值，以第一點為原點減少大數誤差） */
function ringArea(ring: XY[]): number {
  if (ring.length < 3) return 0;
  const [ox, oy] = ring[0];
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += (a[0] - ox) * (b[1] - oy) - (b[0] - ox) * (a[1] - oy);
  }
  return Math.abs(s) / 2;
}

function centroid(pts: XY[]): XY {
  const s = pts.reduce<XY>((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
  return [s[0] / pts.length, s[1] / pts.length];
}

/** 去掉封閉環最後重複的那一點 */
function openRing(r: XY[]): XY[] {
  return r.length > 1 && dist(r[0], r[r.length - 1]) < EPS ? r.slice(0, -1) : r;
}

const closeRing = (r: XY[]) => (r.length ? [...r, r[0]] : r);

/** 多邊形是不是圓（繪圖工具、CIRCLE 畫的圓都是多頂點近似多邊形） */
function asCircle(g: ShapeXY): { c: XY; r: number } | null {
  if (g.type !== 'Polygon' || g.rings.length !== 1) return null;
  const ring = openRing(g.rings[0]);
  if (ring.length < CIRCLE_MIN_VERTICES) return null;
  const c = centroid(ring);
  const rs = ring.map((p) => dist(c, p));
  const r = rs.reduce((a, b) => a + b, 0) / rs.length;
  const tol = Math.max(r * CIRCLE_REL_TOL, CIRCLE_ABS_TOL);
  return r > EPS && rs.every((v) => Math.abs(v - r) <= tol) ? { c, r } : null;
}

function nearestOnSegment(p: XY, a: XY, b: XY): { q: XY; d: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
  const q: XY = [a[0] + t * ab[0], a[1] + t * ab[1]];
  return { q, d: dist(p, q) };
}

/** 選取的圖形中離點選位置最近的一段（直線、聚合線、多邊形的邊）；點選位置投影到該段 */
function nearestSegment(g: ShapeXY, p: XY): { a: XY; b: XY; q: XY } | null {
  const chains = g.type === 'LineString' ? [g.coords] : g.type === 'Polygon' ? g.rings : [];
  let best: { a: XY; b: XY; q: XY; d: number } | null = null;
  for (const pts of chains) {
    for (let i = 1; i < pts.length; i++) {
      if (dist(pts[i - 1], pts[i]) < EPS) continue;
      const n = nearestOnSegment(p, pts[i - 1], pts[i]);
      if (!best || n.d < best.d) best = { a: pts[i - 1], b: pts[i], q: n.q, d: n.d };
    }
  }
  return best;
}

/** 兩條直線（無限延伸）的交點；平行回傳 null */
function lineIntersection(a: XY, b: XY, c: XY, d: XY): XY | null {
  const r = sub(b, a);
  const s = sub(d, c);
  const den = crossZ(r, s);
  if (Math.abs(den) < EPS * Math.hypot(r[0], r[1]) * Math.hypot(s[0], s[1])) return null;
  const t = crossZ(sub(c, a), s) / den;
  return [a[0] + t * r[0], a[1] + t * r[1]];
}

/** 頂點 v 到 p1、p2 兩射線的夾角（0～180°）與圖示（兩邊＋圓弧） */
function angleFigure(v: XY, p1: XY, p2: XY): { angle: number; lines: XY[][]; labelAt: XY } {
  const u1 = norm(sub(p1, v));
  const u2 = norm(sub(p2, v));
  const a1 = Math.atan2(u1[1], u1[0]);
  let sweep = Math.atan2(crossZ(u1, u2), dot(u1, u2)); // -π～π，帶方向
  const angle = Math.abs(deg(sweep));
  const r = 0.35 * Math.min(dist(v, p1), dist(v, p2));
  const arc: XY[] = [];
  for (let i = 0; i <= ARC_SEGMENTS; i++) {
    const t = a1 + (sweep * i) / ARC_SEGMENTS;
    arc.push([v[0] + r * Math.cos(t), v[1] + r * Math.sin(t)]);
  }
  sweep = a1 + sweep / 2;
  return {
    angle,
    lines: [[p1, v, p2], arc],
    labelAt: [v[0] + r * 1.3 * Math.cos(sweep), v[1] + r * 1.3 * Math.sin(sweep)],
  };
}

type Stage =
  | 'menu'
  | 'd1'
  | 'd2'
  | 'dm'
  | 'r'
  | 'a1'
  | 'a2'
  | 'av'
  | 'ae1'
  | 'ae2'
  | 'ar0'
  | 'arp'
  | 'aro';

type AreaAccum = 'add' | 'sub' | null;

export class MeasureGeomSession extends CommandSession {
  readonly name = 'MEASUREGEOM';
  private stage: Stage = 'menu';
  /** 還沒量過：選項提示的預設為「距離」，量過之後為「結束」 */
  private first = true;
  private pts: XY[] = [];
  /** 角度：第一條線（交點計算用的兩端點＋點選位置） */
  private line1: { a: XY; b: XY; q: XY } | null = null;
  private accum: AreaAccum = null;
  private total = 0;
  /** 上一次的量測結果（地圖上保留到下一次量測開始） */
  private shown: Preview = { lines: [], points: [] };

  step(): Step {
    const c = this.name;
    const base = this.pts[this.pts.length - 1] ?? null;
    const mode = this.accum === 'add' ? '（加入模式）' : this.accum === 'sub' ? '（減去模式）' : '';
    switch (this.stage) {
      case 'menu':
        return { command: c, text: '輸入選項', options: MENU_OPTIONS, def: this.first ? '距離' : '結束', input: 'keyword', base: null };
      case 'd1':
        return { command: c, text: '指定第一點', options: [], input: 'point', base: null };
      case 'd2':
        return { command: c, text: '指定第二點或', options: [OPT_MULTI], input: 'point', base };
      case 'dm':
        return { command: c, text: '指定下一點或（Enter 結束）', options: this.pts.length > 1 ? [OPT_UNDO] : [], input: 'point', base };
      case 'r':
        return { command: c, text: '選取圓', options: [], input: 'point', base: null };
      case 'a1':
        return { command: c, text: '選取第一條線或', options: [], def: '指定頂點', input: 'point', base: null };
      case 'a2':
        return { command: c, text: '選取第二條線', options: [], input: 'point', base: null };
      case 'av':
        return { command: c, text: '指定角的頂點', options: [], input: 'point', base: null };
      case 'ae1':
        return { command: c, text: '指定角的第一個端點', options: [], input: 'point', base };
      case 'ae2':
        return { command: c, text: '指定角的第二個端點', options: [], input: 'point', base: this.pts[0] };
      case 'ar0': {
        const options = [OPT_OBJECT];
        if (this.accum !== 'add') options.push(OPT_ADD);
        if (this.accum !== 'sub') options.push(OPT_SUB);
        options.push(OPT_EXIT);
        return { command: c, text: `${mode}指定第一個角點或`, options, def: '物件', input: 'point', base: null };
      }
      case 'arp':
        return {
          command: c,
          text: `${mode}指定下一點或（Enter 完成）`,
          options: this.pts.length > 1 ? [OPT_UNDO] : [],
          input: 'point',
          base,
        };
      case 'aro':
        return { command: c, text: `${mode}選取多邊形或圓${this.accum ? '（Enter 結束選取）' : ''}`, options: [], input: 'point', base: null };
    }
  }

  onKeyword(key: string) {
    switch (this.stage) {
      case 'menu':
        if (key === 'X') this.done = true;
        else this.startMode(key);
        return;
      case 'd2':
        if (key === 'M') this.stage = 'dm';
        return;
      case 'dm':
      case 'arp':
        if (key === 'U' && this.pts.length > 1) this.pts.pop();
        return;
      case 'ar0':
        if (key === 'O') this.stage = 'aro';
        else if (key === 'A' || key === 'S') {
          this.accum = key === 'A' ? 'add' : 'sub';
          if (!this.total) this.shown = { lines: [], points: [] };
          this.ctx.log('info', `${key === 'A' ? '加入' : '減去'}模式，目前總面積 ${this.areaText(this.total)}`);
        } else if (key === 'X') this.toMenu();
        return;
    }
  }

  onEnter() {
    switch (this.stage) {
      case 'menu':
        if (this.first) this.startMode('D');
        else this.done = true;
        return;
      case 'dm':
        if (this.pts.length < 2) return this.error('至少要兩點');
        this.finishMulti();
        return;
      case 'a1':
        this.stage = 'av';
        return;
      case 'ar0':
        this.stage = 'aro';
        return;
      case 'arp':
        if (this.pts.length < 3) return this.error('至少要三點才能圍出面積');
        this.finishArea(this.pts, null);
        return;
      case 'aro':
        if (this.accum) this.stage = 'ar0';
        else this.toMenu();
        return;
      default:
        this.toMenu();
    }
  }

  onPoint(xy: XY) {
    switch (this.stage) {
      case 'menu':
        return this.error('請先選擇量測項目');
      case 'd1':
      case 'av':
        this.shown = { lines: [], points: [] };
        this.pts = [xy];
        this.stage = this.stage === 'd1' ? 'd2' : 'ae1';
        return;
      case 'd2':
        if (dist(this.pts[0], xy) < EPS) return this.error('兩點相同');
        this.reportDistance(this.pts[0], xy);
        return this.toMenu();
      case 'dm': {
        const last = this.pts[this.pts.length - 1];
        if (dist(last, xy) < EPS) return this.error('與上一點相同');
        this.pts.push(xy);
        this.ctx.log('info', `此段 ${f3(dist(last, xy))} m，累計 ${f3(polylineLength(this.pts, false))} m`);
        return;
      }
      case 'r':
        return this.pickCircle(xy);
      case 'a1':
      case 'a2':
        return this.pickLine(xy);
      case 'ae1':
        if (dist(this.pts[0], xy) < EPS) return this.error('端點不可與頂點相同');
        this.pts.push(xy);
        this.stage = 'ae2';
        return;
      case 'ae2': {
        if (dist(this.pts[0], xy) < EPS) return this.error('端點不可與頂點相同');
        const fig = angleFigure(this.pts[0], this.pts[1], xy);
        this.reportAngle(fig);
        return this.toMenu();
      }
      case 'ar0':
        if (!this.accum) this.shown = { lines: [], points: [] };
        this.pts = [xy];
        this.stage = 'arp';
        return;
      case 'arp': {
        if (dist(this.pts[this.pts.length - 1], xy) < EPS) return this.error('與上一點相同');
        this.pts.push(xy);
        return;
      }
      case 'aro':
        return this.pickArea(xy);
    }
  }

  preview(cursor: XY | null): Preview {
    const sh = this.shown;
    const out: Preview = { lines: [...sh.lines], points: [...sh.points], labels: [...(sh.labels ?? [])], fills: [...(sh.fills ?? [])] };
    const p = this.pts;
    const last = p[p.length - 1];
    switch (this.stage) {
      case 'd2':
      case 'dm':
      case 'ae1':
        out.points.push(...p);
        out.lines.push(cursor ? [...p, cursor] : p);
        if (cursor && this.stage !== 'ae1' && dist(last, cursor) > EPS) {
          const total = polylineLength([...p, cursor], false);
          out.labels!.push({ at: cursor, text: this.stage === 'dm' ? `${formatDistance(dist(last, cursor))}\n累計 ${formatDistance(total)}` : formatDistance(total), anchor: 'left' });
        }
        break;
      case 'ae2':
        out.points.push(...p);
        if (cursor && dist(p[0], cursor) > EPS) {
          const fig = angleFigure(p[0], p[1], cursor);
          out.lines.push(...fig.lines);
          out.labels!.push({ at: fig.labelAt, text: fDeg(fig.angle) });
        } else out.lines.push([p[1], p[0]]);
        break;
      case 'a2':
        if (this.line1) {
          out.lines.push([this.line1.a, this.line1.b]);
          out.points.push(this.line1.q);
        }
        break;
      case 'arp': {
        const ring = cursor ? [...p, cursor] : p;
        out.points.push(...p);
        out.lines.push(ring.length > 2 ? closeRing(ring) : ring);
        if (ring.length > 2) {
          out.fills!.push(ring);
          out.labels!.push({ at: centroid(ring), text: formatArea(ringArea(ring)) });
        }
        break;
      }
    }
    return out;
  }

  // ---- 流程
  private startMode(key: string) {
    this.pts = [];
    this.line1 = null;
    if (key === 'D') this.stage = 'd1';
    else if (key === 'R') this.stage = 'r';
    else if (key === 'A') this.stage = 'a1';
    else if (key === 'AR') {
      this.accum = null;
      this.total = 0;
      this.stage = 'ar0';
    }
  }

  private toMenu() {
    this.first = false;
    this.pts = [];
    this.line1 = null;
    this.accum = null;
    this.total = 0;
    this.stage = 'menu';
  }

  // ---- 距離
  private reportDistance(a: XY, b: XY) {
    const d = dist(a, b);
    this.ctx.log(
      'info',
      `距離 = ${f3(d)} m，XY 平面中的角度 = ${fDeg(xyAngle(a, b))}，方位角 = ${fDeg(azimuth(a, b))}，ΔX = ${f3(b[0] - a[0])}，ΔY = ${f3(b[1] - a[1])}`,
    );
    this.shown = {
      lines: [[a, b]],
      points: [a, b],
      labels: [{ at: b, text: `${formatDistance(d)}\n角度 ${fDeg(xyAngle(a, b))}`, anchor: 'left', strong: true }],
    };
  }

  private finishMulti() {
    const p = this.pts;
    const total = polylineLength(p, false);
    this.ctx.log('info', `距離 = ${f3(total)} m（${p.length - 1} 段）`);
    this.shown = {
      lines: [p],
      points: [...p],
      labels: [
        ...p.slice(1).map((b, i) => ({ at: mid(p[i], b), text: formatDistance(dist(p[i], b)) })),
        { at: p[p.length - 1], text: `總長 ${formatDistance(total)}`, anchor: 'left' as const, strong: true },
      ],
    };
    this.toMenu();
  }

  // ---- 半徑
  private pickCircle(xy: XY) {
    const g = this.ctx.pickGeometry(xy);
    if (!g) return this.error('沒有選到圖形');
    const c = asCircle(g);
    if (!c) return this.error('選到的不是圓，請選取圓');
    const { c: center, r } = c;
    this.ctx.log('info', `半徑 = ${f3(r)} m，直徑 = ${f3(r * 2)} m，周長 = ${f3(2 * Math.PI * r)} m，面積 = ${this.areaText(Math.PI * r * r)}`);
    const d = dist(center, xy);
    const edge: XY = d > EPS ? [center[0] + ((xy[0] - center[0]) * r) / d, center[1] + ((xy[1] - center[1]) * r) / d] : [center[0] + r, center[1]];
    this.shown = {
      lines: [[center, edge], closeRing(openRing((g as Extract<ShapeXY, { type: 'Polygon' }>).rings[0]))],
      points: [center],
      labels: [{ at: mid(center, edge), text: `R = ${formatDistance(r)}\nD = ${formatDistance(r * 2)}`, strong: true }],
    };
    this.toMenu();
  }

  // ---- 角度
  private pickLine(xy: XY) {
    const g = this.ctx.pickGeometry(xy);
    if (!g) return this.error('沒有選到圖形');
    if (g.type === 'Point' || asCircle(g)) return this.error('請選取直線、聚合線或多邊形的邊');
    const seg = nearestSegment(g, xy);
    if (!seg) return this.error('請選取直線、聚合線或多邊形的邊');
    if (this.stage === 'a1') {
      this.shown = { lines: [], points: [] };
      this.line1 = seg;
      this.stage = 'a2';
      return;
    }
    const l1 = this.line1!;
    const v = lineIntersection(l1.a, l1.b, seg.a, seg.b);
    if (!v) {
      this.ctx.log('info', '角度 = 0.00°（兩線平行）');
      this.shown = { lines: [[l1.a, l1.b], [seg.a, seg.b]], points: [] };
      return this.toMenu();
    }
    this.reportAngle(angleFigure(v, this.rayPoint(v, l1), this.rayPoint(v, seg)));
    this.toMenu();
  }

  /** 線上往點選位置那一側的一點（點選位置剛好在交點時取較遠的端點） */
  private rayPoint(v: XY, s: { a: XY; b: XY; q: XY }): XY {
    if (dist(v, s.q) > EPS) return s.q;
    return dist(v, s.a) > dist(v, s.b) ? s.a : s.b;
  }

  private reportAngle(fig: { angle: number; lines: XY[][]; labelAt: XY }) {
    this.ctx.log('info', `角度 = ${fDeg(fig.angle)}`);
    this.shown = { lines: fig.lines, points: [], labels: [{ at: fig.labelAt, text: fDeg(fig.angle), strong: true }] };
  }

  // ---- 面積
  private pickArea(xy: XY) {
    const g = this.ctx.pickGeometry(xy);
    if (!g) return this.error('沒有選到圖形');
    if (g.type === 'Point') return this.error('點沒有面積，請選取多邊形或圓');
    if (g.type === 'LineString') {
      const ring = openRing(g.coords);
      if (ring.length < 3) return this.error('直線沒有面積，請選取多邊形或圓');
      this.ctx.log('info', '開放的線以首尾相連計算');
      return this.finishArea(ring, null);
    }
    const rings = g.rings.map(openRing);
    // 圓以 πr² 計算（與半徑 R 一致），不用近似多邊形的面積
    const c = asCircle(g);
    this.finishArea(rings[0], rings.slice(1), c ? { area: Math.PI * c.r * c.r, perim: 2 * Math.PI * c.r } : undefined);
  }

  /** holes：多邊形的洞（面積扣除、周長併計）；exact：圓的精確值 */
  private finishArea(outer: XY[], holes: XY[][] | null, exact?: { area: number; perim: number }) {
    const area = exact?.area ?? ringArea(outer) - (holes ?? []).reduce((s, h) => s + ringArea(h), 0);
    const perim = exact?.perim ?? [outer, ...(holes ?? [])].reduce((s, r) => s + polylineLength(r, true), 0);
    this.ctx.log('info', `面積 = ${this.areaText(area)}，周長 = ${f3(perim)} m${holes?.length ? `（含 ${holes.length} 個洞）` : ''}`);
    const outline = [outer, ...(holes ?? [])].map(closeRing);
    const label = { at: centroid(outer), text: `${formatArea(area)}\n周長 ${formatDistance(perim)}`, strong: true };

    if (!this.accum) {
      this.shown = { lines: outline, points: [], fills: [outer], labels: [label] };
      return this.toMenu();
    }
    this.total += this.accum === 'add' ? area : -area;
    this.ctx.log('info', `總面積 = ${this.areaText(this.total)}`);
    const sh = this.shown;
    this.shown = {
      lines: [...sh.lines, ...outline],
      points: [],
      // 減去的區域只畫外框不填色
      fills: this.accum === 'add' ? [...(sh.fills ?? []), outer] : sh.fills,
      labels: [...(sh.labels ?? []), { ...label, text: `${this.accum === 'add' ? '＋' : '－'}${formatArea(area)}` }],
    };
    this.pts = [];
    if (this.stage === 'arp') this.stage = 'ar0';
  }

  private areaText(m2: number): string {
    return `${f3(m2)} m²${Math.abs(m2) >= 10_000 ? `（${(m2 / 10_000).toFixed(4)} 公頃）` : ''}`;
  }
}
