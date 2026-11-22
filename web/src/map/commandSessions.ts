// 命令列的各個命令（仿 AutoCAD）：每個命令是一個 Session，一步一步提示使用者輸入。
// 坐標一律是 TWD97 TM2 平面坐標（公尺）；交給繪圖工具前才由引擎轉經緯度。
//   LINE（L）     直線：每段獨立的兩點線
//   PLINE（PL）   聚合線：一條多點線；封閉（C）時成為多邊形
//   POLYGON（POL）正多邊形：邊數 → 中心 → 內接／外切 → 半徑；或 邊（E）指定一邊兩端點
//   RECTANG（REC）矩形：兩角點；或 尺寸（D）長、寬，再點方向
//   CIRCLE（C）   圓：中心＋半徑／直徑（D）、兩點（2P）、三點（3P）
//   ARC（A）      圓弧：三點；起點＋圓心（C）／終點（E）組合，或先指定圓心；存成多點線
//   POINT（PO）   點：連續放置，Enter 結束
//   SELECT        選取物件（單擊、框選），結束後保留為目前選取（醒目顯示）
//   MOVE（M）     移動：選取物件（或用目前選取）→ 基準點 → 第二點
//   COPY（CO）    複製：同 MOVE，可連續複製多份
//   ROTATE（RO）  旋轉：基準點 → 角度（或參考 R、複製 C）
//   ERASE（E）    刪除
// MEASUREGEOM（MEA）幾何量測在 commandMeasure.ts；PROFILE（PA）剖面分析在 commandProfile.ts；CLASH（CC）衝突檢核在 commandClash.ts。
import type { XY } from './commandInput';
import type { CommandMessage, CommandOption, CommandPrompt, CommandShapeMode, XYTransform } from '../types/commandLine';

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
  /** 目前選取（引擎保存、醒目顯示） */
  getSelection(): FeatureId[];
  setSelection(ids: FeatureId[]): void;
  /** 上一次命令用過的選取集（P） */
  previousSelection(): FeatureId[];
  allIds(): FeatureId[];
  /** 單擊選取 */
  pick(xy: XY): FeatureId | null;
  /** 框選：依螢幕方向決定視窗或框選穿越 */
  windowSelect(a: XY, b: XY): { ids: FeatureId[]; crossing: boolean };
  /** 螢幕上的矩形框（兩角）換成平面坐標的四個角（地圖旋轉時框仍與螢幕平行） */
  screenRect(a: XY, b: XY): XY[];
  /** 圖形變換後的外形（預覽用） */
  shapePreview(ids: FeatureId[], fn: XYTransform): Preview;
  /** 變換（平移、旋轉）圖形，回傳成功數量 */
  transform(ids: FeatureId[], fn: XYTransform): number;
  /** 複製並變換圖形，回傳新圖形的 id */
  copy(ids: FeatureId[], fn: XYTransform): FeatureId[];
  /** 刪除圖形，回傳數量 */
  erase(ids: FeatureId[]): number;
  /** 單擊選取，回傳圖形的平面坐標幾何（量測用） */
  pickGeometry(xy: XY): ShapeXY | null;
  /** 以 A → B 開啟剖面分析（PROFILE） */
  profile(a: XY, b: XY): void;
  /** 以規劃管線各點開啟衝突檢核（CLASH） */
  clash(pts: XY[]): void;
}

/** 圖形的 TWD97 平面坐標幾何（多邊形環首尾相同） */
export type ShapeXY =
  | { type: 'Point'; coords: XY }
  | { type: 'LineString'; coords: XY[] }
  | { type: 'Polygon'; rings: XY[][] };

/** 預覽上的文字標籤（MEASUREGEOM 量測值） */
export interface PreviewLabel {
  at: XY;
  /** 可用 \n 分行 */
  text: string;
  /** center（預設）：置中；left：標在點的右側 */
  anchor?: 'center' | 'left';
  /** 量測結果（粗體＋外框） */
  strong?: boolean;
}

/** 預覽：虛線（點串）、小圓點，以及半透明填色與文字標籤 */
export interface Preview {
  lines: XY[][];
  points: XY[];
  fills?: XY[][];
  labels?: PreviewLabel[];
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

// ---- ARC
/** 圓弧：圓心、半徑、起始方位角、掃過角（弧度；正＝逆時針） */
export interface Arc {
  c: XY;
  r: number;
  a0: number;
  sweep: number;
}

const TWO_PI = 2 * Math.PI;
/** 正規化到 [0, 2π) */
const wrap2pi = (t: number) => ((t % TWO_PI) + TWO_PI) % TWO_PI;
/** 正規化到 (-π, π] */
const wrapPi = (t: number) => {
  const w = wrap2pi(t);
  return w > Math.PI ? w - TWO_PI : w;
};

/** 圓弧轉點串（密度同 CIRCLE：一整圈 64 段） */
export function arcPoints(a: Arc): XY[] {
  const n = Math.max(4, Math.ceil((Math.abs(a.sweep) / TWO_PI) * CIRCLE_SEGMENTS));
  return Array.from({ length: n + 1 }, (_, k) => polar(a.c, a.r, a.a0 + (a.sweep * k) / n));
}

/** 三點：起點 → 經過第二點 → 終點 */
export function arc3p(s: XY, m: XY, e: XY): Arc | null {
  const cc = circumcircle(s, m, e);
  if (!cc) return null;
  const a0 = angle(cc.c, s);
  const a2 = angle(cc.c, e);
  const ccw = (m[0] - s[0]) * (e[1] - s[1]) - (m[1] - s[1]) * (e[0] - s[0]) > 0;
  return { c: cc.c, r: cc.r, a0, sweep: ccw ? wrap2pi(a2 - a0) : -wrap2pi(a0 - a2) };
}

/** 起點、圓心，逆時針到終點的方向（終點只決定方向） */
export function arcSCE(s: XY, c: XY, e: XY): Arc | null {
  const r = dist(c, s);
  if (r < EPS || dist(c, e) < EPS) return null;
  const a0 = angle(c, s);
  const sweep = wrap2pi(angle(c, e) - a0);
  return sweep < EPS ? null : { c, r, a0, sweep };
}

/** 起點、圓心、弦長（負值＝大弧），逆時針 */
export function arcSCL(s: XY, c: XY, len: number): Arc | null {
  const r = dist(c, s);
  if (r < EPS || Math.abs(len) < EPS || Math.abs(len) > 2 * r + EPS) return null;
  const minor = 2 * Math.asin(Math.min(1, Math.abs(len) / (2 * r)));
  return { c, r, a0: angle(c, s), sweep: len > 0 ? minor : TWO_PI - minor };
}

/** 起點、終點、夾角（正＝逆時針，絕對值 0～360° 不含） */
export function arcSEA(s: XY, e: XY, sweep: number): Arc | null {
  const d = dist(s, e);
  if (d < EPS || Math.abs(sweep) < EPS || Math.abs(sweep) >= TWO_PI - EPS) return null;
  const r = d / (2 * Math.abs(Math.sin(sweep / 2)));
  const h = d / 2 / Math.tan(sweep / 2);
  const ux = (e[0] - s[0]) / d;
  const uy = (e[1] - s[1]) / d;
  // 圓心在弦中點的法線上（逆時針小弧時在弦的左側）
  const c: XY = [(s[0] + e[0]) / 2 - uy * h, (s[1] + e[1]) / 2 + ux * h];
  return { c, r, a0: angle(c, s), sweep };
}

/** 起點、終點、起點的切線方向 */
export function arcSED(s: XY, e: XY, dir: number): Arc | null {
  const half = wrapPi(angle(s, e) - dir);
  if (Math.abs(half) < EPS || Math.abs(Math.abs(half) - Math.PI) < EPS) return null;
  return arcSEA(s, e, 2 * half);
}

/** 起點、終點、半徑（負值＝大弧），逆時針 */
export function arcSER(s: XY, e: XY, r: number): Arc | null {
  const d = dist(s, e);
  if (Math.abs(r) < EPS || Math.abs(r) < d / 2 - EPS) return null;
  const minor = 2 * Math.asin(Math.min(1, d / (2 * Math.abs(r))));
  return arcSEA(s, e, r > 0 ? minor : TWO_PI - minor);
}

type ArcStage =
  | 'start'
  | 'second'
  | 'end3p'
  | 'center0'
  | 'cStart'
  | 'scCenter'
  | 'scEnd'
  | 'scAngle'
  | 'scChord'
  | 'seEnd'
  | 'seHow'
  | 'seAngle'
  | 'seDir'
  | 'seRadius';

const ARC_NEXT: Partial<Record<ArcStage, Record<string, ArcStage>>> = {
  start: { C: 'center0' },
  second: { C: 'scCenter', E: 'seEnd' },
  scEnd: { A: 'scAngle', L: 'scChord' },
  seHow: { A: 'seAngle', D: 'seDir', R: 'seRadius' },
};

export class ArcSession extends CommandSession {
  readonly name = 'ARC';
  private stage: ArcStage = 'start';
  private start: XY | null = null;
  private center: XY | null = null;
  /** 三點的第二點，或「起點、終點」的終點 */
  private mid: XY | null = null;

  step(): Step {
    const s = this.start;
    const ask = (text: string, input: StepInput, base: XY | null, options: CommandOption[] = []): Step => ({
      command: this.name,
      text,
      options,
      input,
      base,
    });
    switch (this.stage) {
      case 'start':
        return ask('指定圓弧的起點或', 'point', null, [opt('C', '圓心')]);
      case 'second':
        return ask('指定圓弧的第二點或', 'point', s, [opt('C', '圓心'), opt('E', '終點')]);
      case 'end3p':
        return ask('指定圓弧的終點', 'point', this.mid);
      case 'center0':
        return ask('指定圓弧的圓心', 'point', null);
      case 'scCenter':
        return ask('指定圓弧的圓心', 'point', s);
      case 'cStart':
        return ask('指定圓弧的起點', 'point', this.center);
      case 'scEnd':
        return ask('指定圓弧的終點（逆時針）或', 'point', this.center, [opt('A', '角度'), opt('L', '弦長')]);
      case 'scAngle':
      case 'seAngle':
        return ask('指定夾角（度，正＝逆時針、負＝順時針）', 'number', s);
      case 'scChord':
        return ask('指定弦長（負值＝大弧）', 'pointOrNumber', s);
      case 'seEnd':
        return ask('指定圓弧的終點', 'point', s);
      case 'seHow':
        return ask('指定圓弧的圓心或', 'point', s, [opt('A', '角度'), opt('D', '方向'), opt('R', '半徑')]);
      case 'seDir':
        return ask('指定起點的切線方向（度，0° 朝東、逆時針為正）', 'pointOrNumber', s);
      case 'seRadius':
        return ask('指定圓弧的半徑（負值＝大弧）', 'pointOrNumber', this.mid);
    }
  }

  onKeyword(key: string) {
    const to = ARC_NEXT[this.stage]?.[key];
    if (to) this.stage = to;
  }

  onPoint(xy: XY) {
    const s = this.start;
    switch (this.stage) {
      case 'start':
        this.start = xy;
        this.stage = 'second';
        return;
      case 'second':
        if (dist(s!, xy) < EPS) return this.error('與起點相同，請指定其他點');
        this.mid = xy;
        this.stage = 'end3p';
        return;
      case 'center0':
        this.center = xy;
        this.stage = 'cStart';
        return;
      case 'cStart':
        if (dist(this.center!, xy) < EPS) return this.error('起點不可與圓心相同');
        this.start = xy;
        this.stage = 'scEnd';
        return;
      case 'scCenter':
        if (dist(s!, xy) < EPS) return this.error('圓心不可與起點相同');
        this.center = xy;
        this.stage = 'scEnd';
        return;
      case 'seEnd':
        if (dist(s!, xy) < EPS) return this.error('終點不可與起點相同');
        this.mid = xy;
        this.stage = 'seHow';
        return;
      // 點選：弦長＝起點到該點、半徑＝終點到該點（同 AutoCAD）
      case 'scChord':
        return this.onNumber(dist(s!, xy));
      case 'seRadius':
        return this.onNumber(dist(this.mid!, xy));
      default: {
        const arc = this.pointArc(xy);
        if (arc) return this.create(arc);
        if (this.stage === 'end3p') return this.error('三點共線，無法決定圓弧');
        if (this.stage === 'seDir') return this.error('切線方向與弦同向或反向，無法決定圓弧');
        return this.error('無法由此點決定圓弧，請指定其他點');
      }
    }
  }

  onNumber(n: number) {
    const s = this.start!;
    const badAngle = n === 0 || Math.abs(n) >= 360;
    switch (this.stage) {
      case 'scAngle': {
        if (badAngle) return this.error('夾角須介於 -360° 與 360° 之間且不為 0');
        const c = this.center!;
        return this.create({ c, r: dist(c, s), a0: angle(c, s), sweep: toRad(n) });
      }
      case 'scChord': {
        const arc = arcSCL(s, this.center!, n);
        return arc ? this.create(arc) : this.error(`弦長須大於 0 且不超過直徑 ${fmt(2 * dist(this.center!, s))} m`);
      }
      case 'seAngle': {
        if (badAngle) return this.error('夾角須介於 -360° 與 360° 之間且不為 0');
        const arc = arcSEA(s, this.mid!, toRad(n));
        return arc ? this.create(arc) : this.error('無法決定圓弧');
      }
      case 'seDir': {
        const arc = arcSED(s, this.mid!, toRad(n));
        return arc ? this.create(arc) : this.error('切線方向與弦同向或反向，無法決定圓弧');
      }
      case 'seRadius': {
        const arc = arcSER(s, this.mid!, n);
        return arc ? this.create(arc) : this.error(`半徑須不小於弦長的一半 ${fmt(dist(s, this.mid!) / 2)} m`);
      }
    }
  }

  /** 以點位決定圓弧（點選與預覽共用） */
  private pointArc(xy: XY): Arc | null {
    const s = this.start;
    if (!s) return null;
    switch (this.stage) {
      case 'end3p':
        return arc3p(s, this.mid!, xy);
      case 'scEnd':
        return arcSCE(s, this.center!, xy);
      case 'seHow':
        return arcSCE(s, xy, this.mid!);
      case 'seDir':
        return dist(s, xy) < EPS ? null : arcSED(s, this.mid!, angle(s, xy));
      case 'scChord':
        return arcSCL(s, this.center!, dist(s, xy));
      case 'seRadius':
        return arcSER(s, this.mid!, dist(this.mid!, xy));
      default:
        return null;
    }
  }

  private create(arc: Arc) {
    if (this.ctx.add('linestring', arcPoints(arc)) === null) return;
    const deg = Math.abs(toDeg(arc.sweep));
    const dir = arc.sweep > 0 ? '逆時針' : '順時針';
    this.ctx.log('info', `已建立圓弧：半徑 ${fmt(arc.r)} m、夾角 ${fmtNum(deg)}°（${dir}）、弧長 ${fmt(arc.r * Math.abs(arc.sweep))} m`);
    this.done = true;
  }

  preview(cursor: XY | null): Preview {
    const pts = [this.start, this.mid, this.center].filter((p): p is XY => p !== null);
    if (!pts.length) return NO_PREVIEW;
    if (!cursor) return { points: pts, lines: [] };
    const lines: XY[][] = [];
    const base = this.step().base;
    if (base) lines.push([base, cursor]);
    const arc = this.pointArc(cursor);
    if (arc && arc.r > EPS) lines.push(arcPoints(arc));
    return { points: pts, lines };
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

// ---- 選取物件（SELECT、MOVE 共用）
class ObjectSelector {
  private readonly ctx: SessionContext;
  private removing = false;
  /** 框選的第一角 */
  private corner: XY | null = null;

  constructor(ctx: SessionContext) {
    this.ctx = ctx;
  }

  step(command: string, withPrevious: boolean): Step {
    if (this.corner) return { command, text: '指定對角點', options: [], input: 'point', base: this.corner };
    const options = [opt('ALL', '全部'), this.removing ? opt('A', '加入') : opt('R', '移除')];
    if (withPrevious) options.push(opt('P', '上一個'));
    return { command, text: this.removing ? '移除物件或' : '選取物件或', options, input: 'point', base: null };
  }

  /** 處理選項；不是選取的選項回傳 false */
  onKeyword(key: string): boolean {
    if (key === 'ALL') this.apply(this.ctx.allIds());
    else if (key === 'A') this.removing = false;
    else if (key === 'R') this.removing = true;
    else if (key === 'P') {
      const prev = this.ctx.previousSelection();
      if (!prev.length) this.ctx.log('error', '沒有上一個選取集');
      else this.apply(prev);
    } else return false;
    return true;
  }

  onPoint(xy: XY) {
    if (this.corner) {
      const { ids, crossing } = this.ctx.windowSelect(this.corner, xy);
      this.corner = null;
      this.ctx.log('info', crossing ? '框選穿越（右 → 左）' : '視窗框選（左 → 右）');
      this.apply(ids);
      return;
    }
    const id = this.ctx.pick(xy);
    if (id !== null) this.apply([id]);
    else this.corner = xy;
  }

  /** Enter：有框選第一角時先取消框選；回傳是否已處理 */
  onEnter(): boolean {
    if (!this.corner) return false;
    this.corner = null;
    return true;
  }

  private apply(ids: FeatureId[]) {
    const cur = new Set(this.ctx.getSelection());
    let n = 0;
    for (const id of ids) {
      if (this.removing ? cur.delete(id) : !cur.has(id) && cur.add(id)) n++;
    }
    this.ctx.setSelection([...cur]);
    this.ctx.log('info', this.removing ? `移除 ${n} 個，剩 ${cur.size} 個` : `找到 ${ids.length} 個（新增 ${n}），共 ${cur.size} 個`);
  }

  preview(cursor: XY | null): Preview {
    if (!this.corner) return NO_PREVIEW;
    if (!cursor) return { points: [this.corner], lines: [] };
    return { points: [this.corner], lines: [closeRing(this.ctx.screenRect(this.corner, cursor))] };
  }
}

// ---- SELECT
export class SelectSession extends CommandSession {
  readonly name = 'SELECT';
  private readonly selector: ObjectSelector;

  constructor(ctx: SessionContext) {
    super(ctx);
    this.selector = new ObjectSelector(ctx);
    ctx.setSelection([]);
  }

  step(): Step {
    return this.selector.step(this.name, true);
  }

  onKeyword(key: string) {
    this.selector.onKeyword(key);
  }

  onPoint(xy: XY) {
    this.selector.onPoint(xy);
  }

  onEnter() {
    if (this.selector.onEnter()) return;
    const n = this.ctx.getSelection().length;
    this.ctx.log('info', n ? `已選取 ${n} 個物件（Esc 清除選取）` : '沒有選取物件');
    this.done = true;
  }

  /** Esc：取消選取（同 AutoCAD） */
  onCancel() {
    this.ctx.setSelection([]);
    this.done = true;
  }

  preview(cursor: XY | null): Preview {
    return this.selector.preview(cursor);
  }
}

// ---- 修改命令（MOVE、COPY、ROTATE、ERASE）共用：先選取物件，再進入各自的步驟
export abstract class EditSession extends CommandSession {
  private readonly selector: ObjectSelector;
  /** 選取完成後要處理的物件 */
  protected ids: FeatureId[] = [];
  protected selecting = true;

  constructor(ctx: SessionContext) {
    super(ctx);
    this.selector = new ObjectSelector(ctx);
  }

  /** 建構後由引擎呼叫：已有目前選取就直接進下一步 */
  begin(): void {
    const cur = this.ctx.getSelection();
    if (!cur.length) return;
    this.ctx.log('info', `使用目前選取的 ${cur.length} 個物件`);
    this.ids = cur;
    this.selecting = false;
    this.selected();
  }

  /** 選取完成 */
  protected abstract selected(): void;
  protected abstract editStep(): Step;
  protected abstract editPoint(xy: XY): void;
  protected editNumber(_n: number): void {}
  protected editKeyword(_key: string): void {}
  /** 編輯階段的 Enter：預設結束 */
  protected editEnter(): void {
    this.finish();
  }
  protected editPreview(_cursor: XY | null): Preview {
    return NO_PREVIEW;
  }

  step(): Step {
    return this.selecting ? this.selector.step(this.name, true) : this.editStep();
  }

  onKeyword(key: string) {
    if (this.selecting) this.selector.onKeyword(key);
    else this.editKeyword(key);
  }

  onPoint(xy: XY) {
    if (this.selecting) this.selector.onPoint(xy);
    else this.editPoint(xy);
  }

  onNumber(n: number) {
    if (!this.selecting) this.editNumber(n);
  }

  onEnter() {
    if (!this.selecting) return this.editEnter();
    if (this.selector.onEnter()) return;
    this.ids = this.ctx.getSelection();
    if (!this.ids.length) {
      this.error('沒有選取物件');
      this.done = true;
      return;
    }
    this.selecting = false;
    this.selected();
  }

  preview(cursor: XY | null): Preview {
    return this.selecting ? this.selector.preview(cursor) : this.editPreview(cursor);
  }

  /** 結束並清除選取（之後可用 P 叫回） */
  protected finish() {
    this.ctx.setSelection([]);
    this.done = true;
  }

  onCancel() {
    this.finish();
  }
}

const translate =
  (dx: number, dy: number): XYTransform =>
  ([x, y]) => [x + dx, y + dy];

const rotateAbout =
  (c: XY, t: number): XYTransform =>
  ([x, y]) => {
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    return [c[0] + (x - c[0]) * cos - (y - c[1]) * sin, c[1] + (x - c[0]) * sin + (y - c[1]) * cos];
  };

export const toDeg = (r: number) => (r * 180) / Math.PI;
export const toRad = (d: number) => (d * Math.PI) / 180;

/** 物件外形預覽加上基準點與橡皮筋線 */
function withGuide(pv: Preview, base: XY, cursor: XY): Preview {
  return { points: [base, ...pv.points], lines: [[base, cursor], ...pv.lines] };
}

// ---- MOVE、COPY（基準點 → 第二點）
abstract class DisplaceSession extends EditSession {
  protected basePoint: XY | null = null;

  protected selected() {}

  protected editStep(): Step {
    if (!this.basePoint) return { command: this.name, text: '指定基準點', options: [], input: 'point', base: null };
    return this.secondStep();
  }

  protected abstract secondStep(): Step;
  protected abstract displace(dx: number, dy: number): void;

  protected editPoint(xy: XY) {
    if (!this.basePoint) {
      this.basePoint = xy;
      return;
    }
    const dx = xy[0] - this.basePoint[0];
    const dy = xy[1] - this.basePoint[1];
    if (Math.hypot(dx, dy) < EPS) return this.error('第二點與基準點相同');
    this.displace(dx, dy);
  }

  protected editPreview(cursor: XY | null): Preview {
    const b = this.basePoint;
    if (!b) return NO_PREVIEW;
    if (!cursor) return { points: [b], lines: [] };
    return withGuide(this.ctx.shapePreview(this.ids, translate(cursor[0] - b[0], cursor[1] - b[1])), b, cursor);
  }

  protected describe(dx: number, dy: number) {
    return `ΔX ${fmt(dx)} m、ΔY ${fmt(dy)} m（距離 ${fmt(Math.hypot(dx, dy))} m）`;
  }
}

export class MoveSession extends DisplaceSession {
  readonly name = 'MOVE';

  protected secondStep(): Step {
    return { command: this.name, text: '指定第二點（可輸入 @dx,dy）', options: [], input: 'point', base: this.basePoint };
  }

  protected displace(dx: number, dy: number) {
    const n = this.ctx.transform(this.ids, translate(dx, dy));
    this.ctx.log('info', `已移動 ${n} 個物件：${this.describe(dx, dy)}`);
    this.finish();
  }
}

export class CopySession extends DisplaceSession {
  readonly name = 'COPY';
  /** 每次複製產生的新物件（U 復原用） */
  private copies: FeatureId[][] = [];

  protected secondStep(): Step {
    return {
      command: this.name,
      text: this.copies.length ? '指定第二點（Enter 結束）或' : '指定第二點（可輸入 @dx,dy）',
      options: this.copies.length ? [OPT_UNDO] : [],
      input: 'point',
      base: this.basePoint,
    };
  }

  protected displace(dx: number, dy: number) {
    const ids = this.ctx.copy(this.ids, translate(dx, dy));
    if (!ids.length) return this.error('複製失敗');
    this.copies.push(ids);
    this.ctx.log('info', `已複製 ${ids.length} 個物件：${this.describe(dx, dy)}`);
  }

  protected editKeyword(key: string) {
    if (key !== 'U') return;
    const last = this.copies.pop();
    if (last) {
      this.ctx.erase(last);
      this.ctx.log('info', `已復原上一份複製（${last.length} 個物件）`);
    }
  }

  protected editEnter() {
    if (this.copies.length) this.ctx.log('info', `共複製 ${this.copies.length} 份`);
    this.finish();
  }
}

// ---- ROTATE
type RotateStage = 'base' | 'angle' | 'ref1' | 'ref2' | 'new';

export class RotateSession extends EditSession {
  readonly name = 'ROTATE';
  private static lastAngle = 0;
  private stage: RotateStage = 'base';
  private center: XY | null = null;
  private copyMode = false;
  /** 參考角度（弧度） */
  private refAngle = 0;
  private refStart: XY | null = null;

  protected selected() {}

  protected editStep(): Step {
    const c = this.name;
    switch (this.stage) {
      case 'base':
        return { command: c, text: '指定基準點', options: [], input: 'point', base: null };
      case 'angle':
        return {
          command: c,
          text: this.copyMode ? '指定旋轉角度（複製）或' : '指定旋轉角度或',
          options: [opt('C', this.copyMode ? '不複製' : '複製'), opt('R', '參考')],
          def: fmtNum(RotateSession.lastAngle),
          input: 'pointOrNumber',
          base: this.center,
        };
      case 'ref1':
        return { command: c, text: '指定參考角度（度）或點選參考線第一點', options: [], def: '0', input: 'pointOrNumber', base: null };
      case 'ref2':
        return { command: c, text: '指定參考線第二點', options: [], input: 'point', base: this.refStart };
      case 'new':
        return { command: c, text: '指定新角度（度）或點選', options: [], input: 'pointOrNumber', base: this.center };
    }
  }

  protected editKeyword(key: string) {
    if (this.stage !== 'angle') return;
    if (key === 'C') {
      this.copyMode = !this.copyMode;
      this.ctx.log('info', this.copyMode ? '旋轉一份複本（保留原物件）' : '旋轉原物件');
    } else if (key === 'R') this.stage = 'ref1';
  }

  protected editNumber(n: number) {
    if (this.stage === 'angle') this.rotate(toRad(n));
    else if (this.stage === 'ref1') {
      this.refAngle = toRad(n);
      this.stage = 'new';
    } else if (this.stage === 'new') this.rotate(toRad(n) - this.refAngle);
  }

  protected editPoint(xy: XY) {
    const c = this.center;
    switch (this.stage) {
      case 'base':
        this.center = xy;
        this.stage = 'angle';
        return;
      case 'angle':
        if (dist(c!, xy) < EPS) return this.error('請點選與基準點不同的點');
        return this.rotate(angle(c!, xy));
      case 'ref1':
        this.refStart = xy;
        this.stage = 'ref2';
        return;
      case 'ref2':
        if (dist(this.refStart!, xy) < EPS) return this.error('兩點不可相同');
        this.refAngle = angle(this.refStart!, xy);
        this.stage = 'new';
        return;
      case 'new':
        if (dist(c!, xy) < EPS) return this.error('請點選與基準點不同的點');
        return this.rotate(angle(c!, xy) - this.refAngle);
    }
  }

  protected editEnter() {
    if (this.stage === 'angle') this.rotate(toRad(RotateSession.lastAngle));
    else if (this.stage === 'ref1') {
      this.refAngle = 0;
      this.stage = 'new';
    } else this.finish();
  }

  private rotate(t: number) {
    const fn = rotateAbout(this.center!, t);
    const d = toDeg(t);
    if (this.copyMode) {
      const ids = this.ctx.copy(this.ids, fn);
      this.ctx.log('info', `已複製並旋轉 ${ids.length} 個物件：${fmtNum(d)}°`);
    } else {
      const n = this.ctx.transform(this.ids, fn);
      this.ctx.log('info', `已旋轉 ${n} 個物件：${fmtNum(d)}°`);
    }
    RotateSession.lastAngle = Number(d.toFixed(6));
    this.finish();
  }

  protected editPreview(cursor: XY | null): Preview {
    const c = this.center;
    if (!c) return NO_PREVIEW;
    if (this.stage === 'ref2' && this.refStart && cursor) return { points: [c, this.refStart], lines: [[this.refStart, cursor]] };
    if (!cursor || (this.stage !== 'angle' && this.stage !== 'new') || dist(c, cursor) < EPS) return { points: [c], lines: [] };
    const t = angle(c, cursor) - (this.stage === 'new' ? this.refAngle : 0);
    return withGuide(this.ctx.shapePreview(this.ids, rotateAbout(c, t)), c, cursor);
  }
}

// ---- ERASE
export class EraseSession extends EditSession {
  readonly name = 'ERASE';

  protected selected() {
    const n = this.ctx.erase(this.ids);
    this.ctx.log('info', `已刪除 ${n} 個物件（可在繪圖面板復原）`);
    this.finish();
  }

  /** 選取完成後立即結束，不會用到 */
  protected editStep(): Step {
    return { command: this.name, text: '', options: [], input: 'keyword', base: null };
  }

  protected editPoint() {}
}
