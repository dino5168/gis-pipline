// 命令列 CLASH（CC）：衝突檢核。以鍵盤輸入（或點選）規劃管線的各點，Enter 完成後開啟衝突檢核視窗。
// 點位輸入與其他命令相同：x,y（依坐標系）、@dx,dy、@距離<角度、直接距離、地圖單擊。
// 可仿 AutoCAD PLINE 加入圓弧段：A 進入圓弧模式（預設與前一段相切，或 A 夾角／CE 圓心／D 方向／R 半徑／S 第二點），L 回直線。
// 圓弧存成多點（密度同 ARC：一整圈 64 段），衝突檢核視窗收到的仍是點串。
// 管徑、埋深、淨距仍在衝突檢核視窗輸入。坐標一律 TWD97 平面坐標（公尺）；交給衝突檢核前由引擎轉經緯度。
import type { XY } from './commandInput';
import {
  CommandSession,
  arc3p,
  arcPoints,
  arcSCE,
  arcSCL,
  arcSEA,
  arcSED,
  arcSER,
  toDeg,
  toRad,
  type Arc,
  type Preview,
  type PreviewLabel,
  type Step,
  type StepInput,
} from './commandSessions';
import type { CommandOption } from '../types/commandLine';
import { formatDistance } from './measure';
import { CLASH_MAX_LENGTH, CLASH_MAX_POINTS } from '../config';

const EPS = 1e-6;
const opt = (key: string, label: string): CommandOption => ({ key, label });
const OPT_UNDO = opt('U', '復原');
const OPT_ARC = opt('A', '圓弧');
const ARC_OPTIONS = [opt('A', '角度'), opt('CE', '圓心'), opt('D', '方向'), opt('L', '直線'), opt('R', '半徑'), opt('S', '第二點'), OPT_UNDO];
const dist = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const angle = (a: XY, b: XY) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const pathLength = (pts: XY[]) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0);
const fmt = (v: number) => v.toFixed(3);

/** 一段：直線為 [終點]；圓弧為弧上各點（不含起點） */
interface Segment {
  pts: XY[];
  arc?: Arc;
}

/**
 * 圓弧模式的步驟：
 * end 終點（相切）；angle → angleEnd；center → centerEnd（或 centerAngle／centerChord）；
 * dir → dirEnd；radius → radiusEnd；second → secondEnd
 */
type ArcStage =
  | 'end'
  | 'angle'
  | 'angleEnd'
  | 'center'
  | 'centerEnd'
  | 'centerAngle'
  | 'centerChord'
  | 'dir'
  | 'dirEnd'
  | 'radius'
  | 'radiusEnd'
  | 'second'
  | 'secondEnd';

/** 圓弧模式 end 步驟的選項 → 下一步 */
const ARC_KEYS: Record<string, ArcStage> = { A: 'angle', CE: 'center', D: 'dir', R: 'radius', S: 'second' };

export class ClashSession extends CommandSession {
  readonly name = 'CLASH';
  private start: XY | null = null;
  private segs: Segment[] = [];
  private arcMode = false;
  private stage: ArcStage = 'end';
  /** 圓弧子步驟已輸入的值 */
  private sweep = 0;
  private center: XY | null = null;
  private dir = 0;
  private radius = 0;
  private second: XY | null = null;

  /** 全部頂點 */
  private get pts(): XY[] {
    return this.start ? [this.start, ...this.segs.flatMap((s) => s.pts)] : [];
  }

  private get last(): XY {
    const s = this.segs[this.segs.length - 1];
    return s ? s.pts[s.pts.length - 1] : this.start!;
  }

  /** 目前終點的切線方向（前一段的走向）；還沒有任何一段時為 null */
  private tangent(): number | null {
    const s = this.segs[this.segs.length - 1];
    if (!s) return null;
    if (s.arc) return s.arc.a0 + s.arc.sweep + Math.sign(s.arc.sweep) * (Math.PI / 2);
    const pts = this.pts;
    return angle(pts[pts.length - 2], pts[pts.length - 1]);
  }

  step(): Step {
    const ask = (text: string, input: StepInput, base: XY | null, options: CommandOption[] = []): Step => ({
      command: this.name,
      text,
      options,
      input,
      base,
    });
    if (!this.start) return ask('指定規劃管線起點', 'point', null);
    const s = this.last;
    const n = this.pts.length;
    if (!this.arcMode) return ask(n >= 2 ? '指定下一點或按 Enter 完成，或' : '指定下一點或', 'point', s, [OPT_ARC, OPT_UNDO]);
    switch (this.stage) {
      case 'end':
        return ask(
          this.tangent() === null ? '指定圓弧的終點（第一段須用選項）或' : '指定圓弧的終點（與前一段相切）或',
          'point',
          s,
          ARC_OPTIONS,
        );
      case 'angle':
        return ask('指定夾角（度，正＝逆時針、負＝順時針）', 'number', s);
      case 'angleEnd':
      case 'dirEnd':
      case 'radiusEnd':
        return ask('指定圓弧的終點', 'point', s);
      case 'center':
        return ask('指定圓弧的圓心', 'point', s);
      case 'centerEnd':
        return ask('指定圓弧的終點（逆時針）或', 'point', this.center, [opt('A', '角度'), opt('L', '弦長')]);
      case 'centerAngle':
        return ask('指定夾角（度，正＝逆時針、負＝順時針）', 'number', s);
      case 'centerChord':
        return ask('指定弦長（負值＝大弧）', 'pointOrNumber', s);
      case 'dir':
        return ask('指定起點的切線方向（度，0° 朝東、逆時針為正）', 'pointOrNumber', s);
      case 'radius':
        return ask('指定圓弧的半徑（負值＝大弧，逆時針）', 'pointOrNumber', s);
      case 'second':
        return ask('指定圓弧上的第二點', 'point', s);
      case 'secondEnd':
        return ask('指定圓弧的終點', 'point', this.second);
    }
  }

  onKeyword(key: string) {
    if (key === 'U') return this.undo();
    if (!this.arcMode) {
      if (key === 'A') {
        this.arcMode = true;
        this.stage = 'end';
      }
      return;
    }
    if (this.stage === 'end') {
      if (key === 'L') this.arcMode = false;
      else if (ARC_KEYS[key]) this.stage = ARC_KEYS[key];
    } else if (this.stage === 'centerEnd') {
      if (key === 'A') this.stage = 'centerAngle';
      else if (key === 'L') this.stage = 'centerChord';
    }
  }

  private undo() {
    if (!this.segs.length) {
      if (!this.start) return this.error('沒有可復原的點');
      this.start = null;
      this.arcMode = false;
      return;
    }
    this.segs.pop();
    this.stage = 'end';
  }

  onEnter() {
    // 圓弧子步驟中按 Enter：取消這個選項，回到圓弧終點
    if (this.arcMode && this.stage !== 'end') {
      this.stage = 'end';
      return;
    }
    const n = this.pts.length;
    if (!n) this.done = true;
    else if (n < 2) this.error('規劃管線至少要 2 點，請指定下一點（Esc 取消）');
    else this.finish();
  }

  onPoint(xy: XY) {
    if (!this.start) {
      this.start = xy;
      return;
    }
    const s = this.last;
    if (!this.arcMode) {
      if (dist(s, xy) < EPS) return this.error('與上一點相同，請指定其他點');
      return this.addSegment({ pts: [xy] });
    }
    switch (this.stage) {
      case 'center':
        if (dist(s, xy) < EPS) return this.error('圓心不可與起點相同');
        this.center = xy;
        this.stage = 'centerEnd';
        return;
      case 'second':
        if (dist(s, xy) < EPS) return this.error('與起點相同，請指定其他點');
        this.second = xy;
        this.stage = 'secondEnd';
        return;
      // 點選：方向＝起點往該點、半徑／弦長＝起點到該點
      case 'dir':
        if (dist(s, xy) < EPS) return this.error('與起點相同，請指定其他點');
        return this.onNumber(toDeg(angle(s, xy)));
      case 'radius':
      case 'centerChord':
        return this.onNumber(dist(s, xy));
      default: {
        const arc = this.pointArc(xy);
        if (arc) return this.addSegment({ pts: arcPoints(arc).slice(1), arc });
        if (this.stage === 'end' && this.tangent() === null)
          return this.error('第一段沒有前一段可相切，請用 A 角度、CE 圓心、D 方向、R 半徑或 S 第二點');
        if (dist(s, xy) < EPS) return this.error('終點不可與起點相同');
        if (this.stage === 'secondEnd') return this.error('三點共線，無法決定圓弧');
        if (this.stage === 'end' || this.stage === 'dirEnd') return this.error('終點在切線方向上，無法決定圓弧；請改用直線（L）');
        return this.error('無法由此點決定圓弧，請指定其他點');
      }
    }
  }

  onNumber(n: number) {
    if (!this.start || !this.arcMode) return;
    const s = this.last;
    const badAngle = n === 0 || Math.abs(n) >= 360;
    switch (this.stage) {
      case 'angle':
        if (badAngle) return this.error('夾角須介於 -360° 與 360° 之間且不為 0');
        this.sweep = toRad(n);
        this.stage = 'angleEnd';
        return;
      case 'dir':
        this.dir = toRad(n);
        this.stage = 'dirEnd';
        return;
      case 'radius':
        if (Math.abs(n) < EPS) return this.error('半徑須大於 0');
        this.radius = n;
        this.stage = 'radiusEnd';
        return;
      case 'centerAngle': {
        if (badAngle) return this.error('夾角須介於 -360° 與 360° 之間且不為 0');
        const c = this.center!;
        return this.addSegment(this.arcSeg({ c, r: dist(c, s), a0: angle(c, s), sweep: toRad(n) }));
      }
      case 'centerChord': {
        const arc = arcSCL(s, this.center!, n);
        if (!arc) return this.error(`弦長須大於 0 且不超過直徑 ${fmt(2 * dist(this.center!, s))} m`);
        return this.addSegment(this.arcSeg(arc));
      }
    }
  }

  private arcSeg(arc: Arc): Segment {
    return { pts: arcPoints(arc).slice(1), arc };
  }

  /** 以點位決定圓弧（點選與預覽共用） */
  private pointArc(xy: XY): Arc | null {
    if (!this.start || !this.arcMode) return null;
    const s = this.last;
    switch (this.stage) {
      case 'end': {
        const t = this.tangent();
        return t === null || dist(s, xy) < EPS ? null : arcSED(s, xy, t);
      }
      case 'angleEnd':
        return arcSEA(s, xy, this.sweep);
      case 'centerEnd':
        return arcSCE(s, this.center!, xy);
      case 'centerChord':
        return arcSCL(s, this.center!, dist(s, xy));
      case 'dirEnd':
        return dist(s, xy) < EPS ? null : arcSED(s, xy, this.dir);
      case 'radiusEnd':
        return arcSER(s, xy, this.radius);
      case 'secondEnd':
        return arc3p(s, this.second!, xy);
      default:
        return null;
    }
  }

  /** 檢查長度與頂點數後加入一段 */
  private addSegment(seg: Segment) {
    const pts = [...this.pts, ...seg.pts];
    const len = pathLength(pts);
    if (len > CLASH_MAX_LENGTH)
      return this.error(`規劃管線長 ${formatDistance(len)}，超過上限 ${CLASH_MAX_LENGTH} m，請重新指定`);
    if (pts.length > CLASH_MAX_POINTS)
      return this.error(`加入這段後共 ${pts.length} 點，超過頂點上限 ${CLASH_MAX_POINTS} 點（圓弧以多點表示），請縮小圓弧或按 Enter 完成`);
    this.segs.push(seg);
    if (seg.arc) {
      const a = seg.arc;
      const deg = Math.abs(toDeg(a.sweep));
      this.ctx.log(
        'info',
        `圓弧：半徑 ${fmt(a.r)} m、夾角 ${String(Number(deg.toFixed(4)))}°（${a.sweep > 0 ? '逆時針' : '順時針'}）、弧長 ${fmt(a.r * Math.abs(a.sweep))} m`,
      );
    }
    this.stage = 'end';
    if (pts.length >= CLASH_MAX_POINTS) {
      this.ctx.log('info', `已達頂點上限 ${CLASH_MAX_POINTS} 點`);
      this.finish();
    }
  }

  private finish() {
    const pts = this.pts;
    const arcs = this.segs.filter((s) => s.arc).length;
    const arcText = arcs ? `（含 ${arcs} 段圓弧）` : '';
    this.ctx.log('info', `規劃管線 ${pts.length} 點${arcText}、長 ${formatDistance(pathLength(pts))}，已開啟衝突檢核視窗`);
    this.ctx.clash(pts);
    this.done = true;
  }

  preview(cursor: XY | null): Preview {
    const pts = this.pts;
    if (!pts.length) return { lines: [], points: [] };
    const last = pts[pts.length - 1];
    let line = pts;
    const extra: XY[][] = [];
    const marks: XY[] = [pts[0]];
    if (cursor && !this.arcMode && dist(last, cursor) >= EPS) line = [...pts, cursor];
    else if (cursor && this.arcMode) {
      const arc = this.pointArc(cursor);
      if (arc && arc.r > EPS) line = [...pts, ...arcPoints(arc).slice(1)];
      // 子步驟：基準點到游標的輔助線，並標出已指定的圓心／第二點
      const base = this.step().base;
      if (this.stage !== 'end' && base && dist(base, cursor) >= EPS) extra.push([base, cursor]);
      if (this.center && this.stage.startsWith('center')) marks.push(this.center);
      if (this.second && this.stage === 'secondEnd') marks.push(this.second);
    }
    const labels: PreviewLabel[] = [{ at: pts[0], text: '起', anchor: 'left' }];
    if (line.length >= 2) {
      const len = pathLength(line);
      const over = len > CLASH_MAX_LENGTH ? `（超過 ${CLASH_MAX_LENGTH} m）` : '';
      labels.push({ at: line[line.length - 1], text: formatDistance(len) + over, anchor: 'left' });
    }
    // 頂點只標直線轉折（圓弧上的點不標，以免一串圓點）
    const vertices = [pts[0], ...this.segs.map((s) => s.pts[s.pts.length - 1])];
    return { lines: line.length >= 2 ? [line, ...extra] : extra, points: [...vertices, ...marks.slice(1)], labels };
  }
}
