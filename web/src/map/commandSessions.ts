// 命令列的各個命令（仿 AutoCAD）：每個命令是一個 Session，一步一步提示使用者輸入。
// 坐標一律是 TWD97 TM2 平面坐標（公尺）；交給繪圖工具前才由引擎轉經緯度。
//   LINE（L）     直線：每段獨立的兩點線
//   PLINE（PL）   聚合線：一條多點線；封閉（C）時成為多邊形
//   POLYGON（POL）正多邊形：邊數 → 中心 → 內接／外切 → 半徑；或 邊（E）指定一邊兩端點
//   RECTANG（REC）矩形：兩角點；或 尺寸（D）長、寬，再點方向
//   CIRCLE（C）   圓：中心＋半徑／直徑（D）、兩點（2P）、三點（3P）
//   POINT（PO）   點：連續放置，Enter 結束
import type { XY } from './commandInput';
import type { CommandMessage, CommandOption, CommandPrompt, CommandShapeMode } from '../types/commandLine';

type FeatureId = string | number;

/** 這一步接受的輸入：點位、數值、點位或數值（距離）、只接受選項 */
export type StepInput = 'point' | 'number' | 'pointOrNumber' | 'keyword';

export interface Step extends CommandPrompt {
  input: StepInput;
  /** 相對坐標（@）與直接距離的基準點 */
  base: XY | null;
}

export interface SessionContext {
  log(kind: CommandMessage['kind'], text: string): void;
  /** 加入圖形：point 為一點、linestring 為點串、其他為多邊形外環（不必封閉），失敗回傳 null（已記錄錯誤） */
  add(mode: CommandShapeMode, coords: XY | XY[]): FeatureId | null;
  remove(id: FeatureId): void;
}

/** 預覽：虛線（點串）與小圓點 */
export interface Preview {
  lines: XY[][];
  points: XY[];
}

const EPS = 1e-6;
const CIRCLE_SEGMENTS = 64;
const MAX_SIDES = 1024;

const opt = (key: string, label: string): CommandOption => ({ key, label });
const OPT_UNDO = opt('U', '復原');
const OPT_CLOSE = opt('C', '封閉');

const dist = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const angle = (a: XY, b: XY) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const polar = (c: XY, r: number, t: number): XY => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)];
const fmt = (v: number) => v.toFixed(3);
const fmtNum = (v: number) => String(Number(v.toFixed(4)));

/** 有號面積（逆時針為正） */
function signedArea(ring: XY[]): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

function perimeter(pts: XY[], closed: boolean): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return closed && pts.length > 2 ? s + dist(pts[pts.length - 1], pts[0]) : s;
}

const closeRing = (r: XY[]) => (r.length ? [...r, r[0]] : r);

function regularPolygon(c: XY, circumR: number, start: number, n: number): XY[] {
  return Array.from({ length: n }, (_, k) => polar(c, circumR, start + (2 * Math.PI * k) / n));
}

/** 由一邊（a → b）逆時針建正多邊形 */
function polygonFromEdge(a: XY, b: XY, n: number): XY[] {
  const pts: XY[] = [a, b];
  const len = dist(a, b);
  let t = angle(a, b);
  for (let k = 2; k < n; k++) {
    t += (2 * Math.PI) / n;
    pts.push(polar(pts[k - 1], len, t));
  }
  return pts;
}

const circleRing = (c: XY, r: number) => regularPolygon(c, r, 0, CIRCLE_SEGMENTS);

/** 三點外接圓；共線回傳 null */
function circumcircle(a: XY, b: XY, c: XY): { c: XY; r: number } | null {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < EPS) return null;
  const a2 = a[0] ** 2 + a[1] ** 2;
  const b2 = b[0] ** 2 + b[1] ** 2;
  const c2 = c[0] ** 2 + c[1] ** 2;
  const center: XY = [
    (a2 * (b[1] - c[1]) + b2 * (c[1] - a[1]) + c2 * (a[1] - b[1])) / d,
    (a2 * (c[0] - b[0]) + b2 * (a[0] - c[0]) + c2 * (b[0] - a[0])) / d,
  ];
  return { c: center, r: dist(center, a) };
}

function rectRing(a: XY, b: XY): XY[] {
  return [a, [b[0], a[1]], b, [a[0], b[1]]];
}

export abstract class CommandSession {
  abstract readonly name: string;
  done = false;
  protected readonly ctx: SessionContext;

  constructor(ctx: SessionContext) {
    this.ctx = ctx;
  }

  abstract step(): Step;
  onPoint(_xy: XY): void {}
  onNumber(_n: number): void {}
  onKeyword(_key: string): void {}
  /** Enter／空白：預設為結束命令 */
  onEnter(): void {
    this.done = true;
  }
  /** Esc */
  onCancel(): void {
    this.done = true;
  }
  abstract preview(cursor: XY | null): Preview;

  protected error(text: string) {
    this.ctx.log('error', text);
  }
}

const NO_PREVIEW: Preview = { lines: [], points: [] };

// ---- LINE
export class LineSession extends CommandSession {
  readonly name = 'LINE';
  private points: XY[] = [];
  /** 第 i 段（points[i] → points[i+1]）的圖形 id */
  private segIds: FeatureId[] = [];
  private readonly resume: XY | null;

  /** resume：上一次 LINE 的終點（第一點直接按 Enter 時接續） */
  constructor(ctx: SessionContext, resume: XY | null) {
    super(ctx);
    this.resume = resume;
  }

  /** 結束時的終點（沒畫任何段回傳 null） */
  get endPoint(): XY | null {
    return this.segIds.length ? this.points[this.points.length - 1] : null;
  }

  step(): Step {
    if (!this.points.length) return { command: this.name, text: '指定第一點', options: [], input: 'point', base: null };
    return {
      command: this.name,
      text: '指定下一點或',
      options: this.segIds.length >= 2 ? [OPT_CLOSE, OPT_UNDO] : [OPT_UNDO],
      input: 'point',
      base: this.points[this.points.length - 1],
    };
  }

  onEnter() {
    if (this.points.length) this.done = true;
    else if (this.resume) this.onPoint(this.resume);
    else this.error('沒有可接續的線，請指定第一點');
  }

  onKeyword(key: string) {
    if (key === 'U') {
      const id = this.segIds.pop();
      if (id !== undefined) this.ctx.remove(id);
      this.points.pop();
    } else if (key === 'C' && this.addSegment(this.points[this.points.length - 1], this.points[0])) {
      this.points.push(this.points[0]);
      this.done = true;
    }
  }

  onPoint(xy: XY) {
    const last = this.points[this.points.length - 1];
    if (last) {
      if (dist(last, xy) < EPS) return this.error('與上一點相同，請指定其他點');
      if (!this.addSegment(last, xy)) return;
    }
    this.points.push(xy);
  }

  private addSegment(a: XY, b: XY): boolean {
    const id = this.ctx.add('linestring', [a, b]);
    if (id === null) return false;
    this.segIds.push(id);
    this.ctx.log('info', `長度 ${fmt(dist(a, b))} m`);
    return true;
  }

  preview(cursor: XY | null): Preview {
    const last = this.points[this.points.length - 1];
    if (!last) return NO_PREVIEW;
    return { points: [last], lines: cursor ? [[last, cursor]] : [] };
  }
}

// ---- PLINE
export class PlineSession extends CommandSession {
  readonly name = 'PLINE';
  private points: XY[] = [];

  step(): Step {
    const n = this.points.length;
    if (!n) return { command: this.name, text: '指定起點', options: [], input: 'point', base: null };
    return {
      command: this.name,
      text: '指定下一點或',
      options: n >= 3 ? [OPT_CLOSE, OPT_UNDO] : [OPT_UNDO],
      input: 'point',
      base: this.points[n - 1],
    };
  }

  onPoint(xy: XY) {
    const last = this.points[this.points.length - 1];
    if (last) {
      if (dist(last, xy) < EPS) return this.error('與上一點相同，請指定其他點');
      this.ctx.log('info', `長度 ${fmt(dist(last, xy))} m`);
    }
    this.points.push(xy);
  }

  onKeyword(key: string) {
    if (key === 'U') this.points.pop();
    else if (key === 'C') {
      const pts = this.points;
      if (this.ctx.add('polygon', pts) === null) return;
      this.ctx.log(
        'info',
        `已建立封閉聚合線（多邊形）：${pts.length} 個頂點、周長 ${fmt(perimeter(pts, true))} m、面積 ${fmt(Math.abs(signedArea(pts)))} m²`,
      );
      this.done = true;
    }
  }

  onEnter() {
    this.finish();
    this.done = true;
  }

  /** Esc 也保留已畫的部分（同 AutoCAD） */
  onCancel() {
    this.finish();
    this.done = true;
  }

  private finish() {
    const pts = this.points;
    if (pts.length < 2) return;
    if (this.ctx.add('linestring', pts) === null) return;
    this.ctx.log('info', `已建立聚合線：${pts.length} 個頂點、總長 ${fmt(perimeter(pts, false))} m`);
  }

  preview(cursor: XY | null): Preview {
    const pts = this.points;
    if (!pts.length) return NO_PREVIEW;
    return { points: [pts[0]], lines: [cursor ? [...pts, cursor] : pts] };
  }
}

// ---- POLYGON（正多邊形）
type PolygonStage = 'sides' | 'center' | 'io' | 'radius' | 'edge1' | 'edge2';

export class PolygonSession extends CommandSession {
  readonly name = 'POLYGON';
  /** 上次的邊數與內接／外切（下次當預設值） */
  private static lastSides = 4;
  private static lastInscribed = true;
  private stage: PolygonStage = 'sides';
  private sides = PolygonSession.lastSides;
  private inscribed = PolygonSession.lastInscribed;
  private center: XY | null = null;
  private edgeStart: XY | null = null;

  step(): Step {
    const c = this.name;
    switch (this.stage) {
      case 'sides':
        return { command: c, text: '輸入邊數', options: [], def: String(this.sides), input: 'number', base: null };
      case 'center':
        return { command: c, text: '指定多邊形的中心點或', options: [opt('E', '邊')], input: 'point', base: null };
      case 'io':
        return {
          command: c,
          text: '輸入選項',
          options: [opt('I', '內接於圓'), opt('C', '外切於圓')],
          def: this.inscribed ? 'I' : 'C',
          input: 'keyword',
          base: null,
        };
      case 'radius':
        return { command: c, text: '指定圓的半徑', options: [], input: 'pointOrNumber', base: this.center };
      case 'edge1':
        return { command: c, text: '指定邊的第一個端點', options: [], input: 'point', base: null };
      case 'edge2':
        return { command: c, text: '指定邊的第二個端點', options: [], input: 'point', base: this.edgeStart };
    }
  }

  onNumber(n: number) {
    if (this.stage === 'sides') {
      if (!Number.isInteger(n) || n < 3 || n > MAX_SIDES) return this.error(`邊數須為 3～${MAX_SIDES} 的整數`);
      this.sides = n;
      this.stage = 'center';
    } else if (this.stage === 'radius') {
      if (n <= 0) return this.error('半徑須大於 0');
      // 直接輸入半徑：底邊水平
      this.create(this.ring(n, -Math.PI / 2, true));
    }
  }

  onEnter() {
    if (this.stage === 'sides') this.stage = 'center';
    else if (this.stage === 'io') this.stage = 'radius';
    else this.done = true;
  }

  onKeyword(key: string) {
    if (this.stage === 'center' && key === 'E') this.stage = 'edge1';
    else if (this.stage === 'io') {
      this.inscribed = key === 'I';
      this.stage = 'radius';
    }
  }

  onPoint(xy: XY) {
    switch (this.stage) {
      case 'center':
        this.center = xy;
        this.stage = 'io';
        break;
      case 'radius': {
        const r = dist(this.center!, xy);
        if (r < EPS) return this.error('半徑須大於 0');
        this.create(this.ring(r, angle(this.center!, xy)));
        break;
      }
      case 'edge1':
        this.edgeStart = xy;
        this.stage = 'edge2';
        break;
      case 'edge2':
        if (dist(this.edgeStart!, xy) < EPS) return this.error('邊長須大於 0');
        this.create(polygonFromEdge(this.edgeStart!, xy, this.sides));
        break;
    }
  }

  /**
   * r：內接＝中心到頂點、外切＝中心到邊中點。
   * t 為方向；edgeMid＝t 指向邊中點（否則指向頂點）。
   * 直接輸入半徑時底邊水平（t＝-90°、edgeMid）；點選時內接以該點為頂點、外切以該點為邊中點（同 AutoCAD）。
   */
  private ring(r: number, t: number, edgeMid = !this.inscribed): XY[] {
    const half = Math.PI / this.sides;
    const circumR = this.inscribed ? r : r / Math.cos(half);
    return regularPolygon(this.center!, circumR, edgeMid ? t + half : t, this.sides);
  }

  private create(pts: XY[]) {
    if (this.ctx.add('polygon', pts) === null) return;
    PolygonSession.lastSides = this.sides;
    PolygonSession.lastInscribed = this.inscribed;
    this.ctx.log(
      'info',
      `已建立正 ${this.sides} 邊形：邊長 ${fmt(dist(pts[0], pts[1]))} m、面積 ${fmt(Math.abs(signedArea(pts)))} m²`,
    );
    this.done = true;
  }

  preview(cursor: XY | null): Preview {
    if (this.stage === 'radius' && this.center) {
      if (!cursor || dist(this.center, cursor) < EPS) return { points: [this.center], lines: [] };
      return {
        points: [this.center],
        lines: [closeRing(this.ring(dist(this.center, cursor), angle(this.center, cursor))), [this.center, cursor]],
      };
    }
    if (this.stage === 'io' && this.center) return { points: [this.center], lines: [] };
    if (this.stage === 'edge2' && this.edgeStart) {
      if (!cursor || dist(this.edgeStart, cursor) < EPS) return { points: [this.edgeStart], lines: [] };
      return { points: [this.edgeStart], lines: [closeRing(polygonFromEdge(this.edgeStart, cursor, this.sides))] };
    }
    return NO_PREVIEW;
  }
}

// ---- RECTANG
type RectStage = 'first' | 'other' | 'length' | 'width' | 'direction';

export class RectangSession extends CommandSession {
  readonly name = 'RECTANG';
  private static lastLength = 10;
  private static lastWidth = 10;
  private stage: RectStage = 'first';
  private first: XY | null = null;
  private length = RectangSession.lastLength;
  private width = RectangSession.lastWidth;

  step(): Step {
    const c = this.name;
    const D = opt('D', '尺寸');
    switch (this.stage) {
      case 'first':
        return { command: c, text: '指定第一個角點', options: [], input: 'point', base: null };
      case 'other':
        return { command: c, text: '指定另一個角點或', options: [D], input: 'point', base: this.first };
      case 'length':
        return { command: c, text: '指定矩形的長度（東西向，m）', options: [], def: fmtNum(this.length), input: 'number', base: null };
      case 'width':
        return { command: c, text: '指定矩形的寬度（南北向，m）', options: [], def: fmtNum(this.width), input: 'number', base: null };
      case 'direction':
        return { command: c, text: '指定另一個角點的方向或', options: [D], input: 'point', base: this.first };
    }
  }

  onKeyword(key: string) {
    if (key === 'D') this.stage = 'length';
  }

  onNumber(n: number) {
    if (this.stage !== 'length' && this.stage !== 'width') return;
    if (n <= 0) return this.error('長度、寬度須大於 0');
    if (this.stage === 'length') {
      this.length = n;
      this.stage = 'width';
    } else {
      this.width = n;
      this.stage = 'direction';
    }
  }

  onEnter() {
    if (this.stage === 'length') this.stage = 'width';
    else if (this.stage === 'width') this.stage = 'direction';
    else this.done = true;
  }

  onPoint(xy: XY) {
    if (this.stage === 'first') {
      this.first = xy;
      this.stage = 'other';
    } else if (this.stage === 'other') {
      const a = this.first!;
      if (Math.abs(xy[0] - a[0]) < EPS || Math.abs(xy[1] - a[1]) < EPS) return this.error('長度、寬度須大於 0');
      this.create(a, xy);
    } else if (this.stage === 'direction') {
      this.create(this.first!, this.sizedCorner(xy));
    }
  }

  /** 依長寬與點的方向（象限）算出對角 */
  private sizedCorner(p: XY): XY {
    const a = this.first!;
    return [a[0] + (p[0] < a[0] ? -this.length : this.length), a[1] + (p[1] < a[1] ? -this.width : this.width)];
  }

  private create(a: XY, b: XY) {
    if (this.ctx.add('rectangle', rectRing(a, b)) === null) return;
    const w = Math.abs(b[0] - a[0]);
    const h = Math.abs(b[1] - a[1]);
    RectangSession.lastLength = w;
    RectangSession.lastWidth = h;
    this.ctx.log('info', `已建立矩形：長 ${fmt(w)} m × 寬 ${fmt(h)} m、面積 ${fmt(w * h)} m²`);
    this.done = true;
  }

  preview(cursor: XY | null): Preview {
    const a = this.first;
    if (!a || this.stage === 'first') return NO_PREVIEW;
    if (!cursor || (this.stage !== 'other' && this.stage !== 'direction')) return { points: [a], lines: [] };
    const b = this.stage === 'other' ? cursor : this.sizedCorner(cursor);
    return { points: [a], lines: [closeRing(rectRing(a, b))] };
  }
}

// ---- CIRCLE
type CircleStage = 'center' | 'radius' | 'diameter' | '2p1' | '2p2' | '3p1' | '3p2' | '3p3';

export class CircleSession extends CommandSession {
  readonly name = 'CIRCLE';
  private static lastRadius: number | null = null;
  private stage: CircleStage = 'center';
  private pts: XY[] = [];

  step(): Step {
    const c = this.name;
    const last = CircleSession.lastRadius;
    const center = this.pts[0] ?? null;
    switch (this.stage) {
      case 'center':
        return { command: c, text: '指定圓的中心點或', options: [opt('3P', '三點'), opt('2P', '兩點')], input: 'point', base: null };
      case 'radius':
        return {
          command: c,
          text: '指定圓的半徑或',
          options: [opt('D', '直徑')],
          def: last !== null ? fmtNum(last) : undefined,
          input: 'pointOrNumber',
          base: center,
        };
      case 'diameter':
        return {
          command: c,
          text: '指定圓的直徑',
          options: [],
          def: last !== null ? fmtNum(last * 2) : undefined,
          input: 'pointOrNumber',
          base: center,
        };
      case '2p1':
        return { command: c, text: '指定圓直徑的第一個端點', options: [], input: 'point', base: null };
      case '2p2':
        return { command: c, text: '指定圓直徑的第二個端點', options: [], input: 'point', base: center };
      case '3p1':
        return { command: c, text: '指定圓上的第一點', options: [], input: 'point', base: null };
      case '3p2':
        return { command: c, text: '指定圓上的第二點', options: [], input: 'point', base: this.pts[0] };
      case '3p3':
        return { command: c, text: '指定圓上的第三點', options: [], input: 'point', base: this.pts[1] };
    }
  }

  onKeyword(key: string) {
    if (this.stage === 'center' && key === '2P') this.stage = '2p1';
    else if (this.stage === 'center' && key === '3P') this.stage = '3p1';
    else if (this.stage === 'radius' && key === 'D') this.stage = 'diameter';
  }

  onNumber(n: number) {
    if (n <= 0) return this.error(this.stage === 'diameter' ? '直徑須大於 0' : '半徑須大於 0');
    this.create(this.pts[0], this.stage === 'diameter' ? n / 2 : n);
  }

  onEnter() {
    const last = CircleSession.lastRadius;
    if ((this.stage === 'radius' || this.stage === 'diameter') && last !== null) this.create(this.pts[0], last);
    else this.done = true;
  }

  onPoint(xy: XY) {
    const p = this.pts;
    switch (this.stage) {
      case 'center':
        p.push(xy);
        this.stage = 'radius';
        return;
      case 'radius':
      case 'diameter': {
        const d = dist(p[0], xy);
        if (d < EPS) return this.error('半徑須大於 0');
        // 直徑：點到中心的距離即直徑（同 AutoCAD）
        return this.create(p[0], this.stage === 'diameter' ? d / 2 : d);
      }
      case '2p1':
      case '3p1':
        p.push(xy);
        this.stage = this.stage === '2p1' ? '2p2' : '3p2';
        return;
      case '2p2':
        if (dist(p[0], xy) < EPS) return this.error('兩點不可相同');
        return this.create([(p[0][0] + xy[0]) / 2, (p[0][1] + xy[1]) / 2], dist(p[0], xy) / 2);
      case '3p2':
        if (dist(p[0], xy) < EPS) return this.error('兩點不可相同');
        p.push(xy);
        this.stage = '3p3';
        return;
      case '3p3': {
        const cc = circumcircle(p[0], p[1], xy);
        if (!cc) return this.error('三點共線，無法決定圓');
        return this.create(cc.c, cc.r);
      }
    }
  }

  private create(c: XY, r: number) {
    if (this.ctx.add('circle', circleRing(c, r)) === null) return;
    CircleSession.lastRadius = r;
    this.ctx.log('info', `已建立圓：半徑 ${fmt(r)} m、面積 ${fmt(Math.PI * r * r)} m²`);
    this.done = true;
  }

  preview(cursor: XY | null): Preview {
    const p = this.pts;
    if (!p.length) return NO_PREVIEW;
    if (!cursor) return { points: p, lines: [] };
    let circle: { c: XY; r: number } | null = null;
    if (this.stage === 'radius') circle = { c: p[0], r: dist(p[0], cursor) };
    else if (this.stage === 'diameter') circle = { c: p[0], r: dist(p[0], cursor) / 2 };
    else if (this.stage === '2p2') circle = { c: [(p[0][0] + cursor[0]) / 2, (p[0][1] + cursor[1]) / 2], r: dist(p[0], cursor) / 2 };
    else if (this.stage === '3p3') circle = circumcircle(p[0], p[1], cursor);
    const lines: XY[][] = [[p[p.length - 1], cursor]];
    if (circle && circle.r > EPS) lines.push(closeRing(circleRing(circle.c, circle.r)));
    return { points: p, lines };
  }
}

// ---- POINT
export class PointSession extends CommandSession {
  readonly name = 'POINT';
  private last: XY | null = null;

  step(): Step {
    return { command: this.name, text: '指定點（Enter 結束）', options: [], input: 'point', base: this.last };
  }

  onPoint(xy: XY) {
    if (this.ctx.add('point', xy) !== null) this.last = xy;
  }

  preview(): Preview {
    return NO_PREVIEW;
  }
}
