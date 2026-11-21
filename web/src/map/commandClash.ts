// 命令列 CLASH（CC）：衝突檢核。以鍵盤輸入（或點選）規劃管線的各點，Enter 完成後開啟衝突檢核視窗。
// 點位輸入與其他命令相同：x,y（依坐標系）、@dx,dy、@距離<角度、直接距離、地圖單擊。
// 管徑、埋深、淨距仍在衝突檢核視窗輸入。坐標一律 TWD97 平面坐標（公尺）；交給衝突檢核前由引擎轉經緯度。
import type { XY } from './commandInput';
import { CommandSession, type Preview, type PreviewLabel, type Step } from './commandSessions';
import { formatDistance } from './measure';
import { CLASH_MAX_LENGTH, CLASH_MAX_POINTS } from '../config';

const EPS = 1e-6;
const OPT_UNDO = { key: 'U', label: '復原' };
const dist = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const pathLength = (pts: XY[]) => pts.reduce((s, p, i) => (i ? s + dist(pts[i - 1], p) : 0), 0);

export class ClashSession extends CommandSession {
  readonly name = 'CLASH';
  private pts: XY[] = [];

  step(): Step {
    const n = this.pts.length;
    if (!n) return { command: this.name, text: '指定規劃管線起點', options: [], input: 'point', base: null };
    return {
      command: this.name,
      text: n >= 2 ? '指定下一點或按 Enter 完成' : '指定下一點',
      options: [OPT_UNDO],
      input: 'point',
      base: this.pts[n - 1],
    };
  }

  onKeyword(key: string) {
    if (key !== 'U') return;
    if (!this.pts.length) return this.error('沒有可復原的點');
    this.pts.pop();
  }

  onEnter() {
    if (!this.pts.length) this.done = true;
    else if (this.pts.length < 2) this.error('規劃管線至少要 2 點，請指定下一點（Esc 取消）');
    else this.finish();
  }

  onPoint(xy: XY) {
    const last = this.pts[this.pts.length - 1];
    if (last && dist(last, xy) < EPS) return this.error('與上一點相同，請指定其他點');
    const len = pathLength([...this.pts, xy]);
    if (len > CLASH_MAX_LENGTH)
      return this.error(`規劃管線長 ${formatDistance(len)}，超過上限 ${CLASH_MAX_LENGTH} m，請重新指定這一點`);
    this.pts.push(xy);
    if (this.pts.length >= CLASH_MAX_POINTS) {
      this.ctx.log('info', `已達頂點上限 ${CLASH_MAX_POINTS} 點`);
      this.finish();
    }
  }

  private finish() {
    this.ctx.log('info', `規劃管線 ${this.pts.length} 點、長 ${formatDistance(pathLength(this.pts))}，已開啟衝突檢核視窗`);
    this.ctx.clash(this.pts);
    this.done = true;
  }

  preview(cursor: XY | null): Preview {
    const pts = this.pts;
    if (!pts.length) return { lines: [], points: [] };
    const last = pts[pts.length - 1];
    const line = cursor && dist(last, cursor) >= EPS ? [...pts, cursor] : pts;
    const labels: PreviewLabel[] = [{ at: pts[0], text: '起', anchor: 'left' }];
    if (line.length >= 2) {
      const len = pathLength(line);
      const over = len > CLASH_MAX_LENGTH ? `（超過 ${CLASH_MAX_LENGTH} m）` : '';
      labels.push({ at: line[line.length - 1], text: formatDistance(len) + over, anchor: 'left' });
    }
    return { lines: line.length >= 2 ? [line] : [], points: pts, labels };
  }
}
