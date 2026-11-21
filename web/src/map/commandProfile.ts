// 命令列 PROFILE（PA）：剖面分析。以鍵盤輸入（或點選）剖面線起點 A、終點 B，完成後開啟剖面分析視窗。
// 點位輸入與其他命令相同：x,y（依坐標系）、@dx,dy、@距離<角度、直接距離、地圖單擊。
// 坐標一律 TWD97 平面坐標（公尺）；交給剖面分析前由引擎轉經緯度。
import type { XY } from './commandInput';
import { CommandSession, type Preview, type Step } from './commandSessions';
import { formatDistance } from './measure';
import { PROFILE_MAX_LENGTH } from '../config';

const EPS = 1e-6;
const dist = (a: XY, b: XY) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const mid = (a: XY, b: XY): XY => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

export class ProfileSession extends CommandSession {
  readonly name = 'PROFILE';
  private start: XY | null = null;

  step(): Step {
    if (!this.start) return { command: this.name, text: '指定剖面起點 A', options: [], input: 'point', base: null };
    return { command: this.name, text: '指定剖面終點 B', options: [], input: 'point', base: this.start };
  }

  onEnter() {
    if (this.start) this.error('請指定剖面終點 B（Esc 取消）');
    else this.done = true;
  }

  onPoint(xy: XY) {
    const a = this.start;
    if (!a) {
      this.start = xy;
      return;
    }
    const len = dist(a, xy);
    if (len < EPS) return this.error('終點與起點相同，請指定其他點');
    if (len > PROFILE_MAX_LENGTH)
      return this.error(`剖面線長 ${formatDistance(len)}，超過上限 ${PROFILE_MAX_LENGTH} m，請重新指定終點`);
    this.ctx.log('info', `剖面線長 ${formatDistance(len)}，已開啟剖面分析視窗`);
    this.ctx.profile(a, xy);
    this.done = true;
  }

  preview(cursor: XY | null): Preview {
    const a = this.start;
    if (!a) return { lines: [], points: [] };
    if (!cursor || dist(a, cursor) < EPS)
      return { lines: [], points: [a], labels: [{ at: a, text: 'A', anchor: 'left' }] };
    const len = dist(a, cursor);
    const over = len > PROFILE_MAX_LENGTH ? `（超過 ${PROFILE_MAX_LENGTH} m）` : '';
    return {
      lines: [[a, cursor]],
      points: [a],
      labels: [
        { at: a, text: 'A', anchor: 'left' },
        { at: cursor, text: 'B', anchor: 'left' },
        { at: mid(a, cursor), text: formatDistance(len) + over },
      ],
    };
  }
}
