// 2D 命令列引擎（仿 AutoCAD Command）：解析輸入、執行命令、命令中接管地圖點選取點。
// 目前只有 LINE：每一段是一條獨立的兩點線，加到繪圖工具（DrawTool），可在繪圖面板編輯、復原、匯出。
// 預覽（上一點 → 滑鼠的橡皮筋線、第一點）用自己的 GeoJSON 圖層，不進 Terra Draw。
import type { FeatureCollection } from 'geojson';
import * as maplibregl from 'maplibre-gl';
import { lngLatToTwd97, twd97ToLngLat } from './coordTransform';
import { formatPoint, parsePointInput, type XY } from './commandInput';
import type { LngLat } from './measure';
import { DEFAULT_COORD_DISPLAY, type CoordDisplaySettings } from '../types/coordSystem';
import {
  COMMAND_ALIASES,
  COMMAND_MAX_MESSAGES,
  promptText,
  type CommandLineState,
  type CommandMessage,
  type CommandPrompt,
} from '../types/commandLine';

type FeatureId = string | number;

/** 命令畫出的圖形交給誰保存（DrawTool） */
export interface CommandSink {
  /** 加入一條線（經緯度），記入復原；失敗回傳 null */
  addLineString(coords: LngLat[]): FeatureId | null;
  removeFeatureById(id: FeatureId): void;
}

interface Options {
  onChange: (state: CommandLineState) => void;
  /** 命令開始（關閉量測、繪圖面板，避免搶滑鼠） */
  onStart: () => void;
  sink: CommandSink;
}

interface LineState {
  /** 這一串線的點（第一點起） */
  points: XY[];
  /** 第 i 段（points[i] → points[i+1]）的圖形 id */
  segIds: FeatureId[];
}

const PREVIEW_SOURCE = 'cmd-preview';
const PREVIEW_LINE = 'cmd-preview-line';
const PREVIEW_POINT = 'cmd-preview-point';
const PREVIEW_COLOR = '#ffffff';

const IDLE_PROMPT: CommandPrompt = { command: null, text: '指令', options: [] };
const OPT_UNDO = { key: 'U', label: '復原' };
const OPT_CLOSE = { key: 'C', label: '封閉' };

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

export class CommandLineEngine {
  private readonly map: maplibregl.Map;
  private readonly opts: Options;
  private coord: CoordDisplaySettings = DEFAULT_COORD_DISPLAY;
  private messages: CommandMessage[] = [];
  private nextMsgId = 1;
  private line: LineState | null = null;
  private lastCommand: string | null = null;
  /** 上一次 LINE 的終點（在「指定第一點」直接按 Enter 時接續） */
  private lastLineEnd: XY | null = null;
  private cursor: XY | null = null;

  constructor(map: maplibregl.Map, opts: Options) {
    this.map = map;
    this.opts = opts;
  }

  /** 有命令執行中 */
  get active(): boolean {
    return this.line !== null;
  }

  setCoordSettings(s: CoordDisplaySettings): void {
    this.coord = s;
  }

  /** 送出一行輸入（空字串＝Enter） */
  submit(raw: string): void {
    const text = raw.trim();
    if (this.line) {
      this.handleLineInput(text);
      return;
    }
    if (!text) {
      if (this.lastCommand) this.startCommand(this.lastCommand, `${promptText(IDLE_PROMPT)}: （重複 ${this.lastCommand}）`);
      return;
    }
    const name = COMMAND_ALIASES[text.toUpperCase()];
    if (!name) {
      this.log('input', `${promptText(IDLE_PROMPT)}: ${text}`);
      this.log('error', `未知的指令「${text}」。可用指令：LINE（L）`);
      this.emit();
      return;
    }
    this.startCommand(name, `${promptText(IDLE_PROMPT)}: ${text}`);
  }

  /** 取消執行中的命令（Esc） */
  cancel(): void {
    if (!this.line) return;
    this.log('info', '*取消*');
    this.endLine();
  }

  /** 送出目前的狀態（React 掛載時取初始值） */
  emit(): void {
    this.opts.onChange({ prompt: this.prompt(), messages: this.messages, active: this.active });
  }

  destroy(): void {
    if (this.line) this.endLine(false);
  }

  // ---- 命令
  private startCommand(name: string, echo: string) {
    this.log('input', echo);
    this.lastCommand = name;
    // 目前只有 LINE
    this.opts.onStart();
    this.line = { points: [], segIds: [] };
    this.attach();
    this.updatePreview();
    this.emit();
  }

  private handleLineInput(text: string) {
    const line = this.line!;
    const echo = (v: string) => this.log('input', `${promptText(this.prompt())}: ${v}`);
    const key = text.toUpperCase();

    if (!text) {
      if (line.points.length === 0) {
        echo('');
        if (this.lastLineEnd) this.addPoint(this.lastLineEnd);
        else this.log('error', '沒有可接續的線，請指定第一點');
      } else {
        echo('');
        this.endLine();
        return;
      }
    } else if (key === OPT_UNDO.key && line.points.length > 0) {
      echo(text);
      const id = line.segIds.pop();
      if (id !== undefined) this.opts.sink.removeFeatureById(id);
      line.points.pop();
    } else if (key === OPT_CLOSE.key && line.segIds.length >= 2) {
      echo(text);
      if (this.addSegment(line.points[line.points.length - 1], line.points[0])) {
        line.points.push(line.points[0]);
        this.endLine();
        return;
      }
    } else {
      const r = parsePointInput(text, { system: this.coord.system, last: this.lastPoint(), cursor: this.cursor });
      echo(text);
      if (!r) this.log('error', `無法辨識「${text}」。${this.inputHint()}`);
      else if (!r.ok) this.log('error', r.error);
      else this.addPoint(r.xy);
    }
    this.updatePreview();
    this.emit();
  }

  private inputHint(): string {
    const abs = this.coord.system === 'wgs84' ? '經度,緯度' : 'X,Y';
    const opts = this.prompt().options.map((o) => `${o.key}＝${o.label}`);
    return `點位可輸入 ${abs}、@dx,dy、@距離<角度、距離，或在地圖上點選${opts.length ? `；${opts.join('、')}` : ''}`;
  }

  private lastPoint(): XY | null {
    const p = this.line?.points;
    return p && p.length ? p[p.length - 1] : null;
  }

  /** 加一點：第一點只記錄；之後每一點畫一段 */
  private addPoint(xy: XY) {
    const line = this.line!;
    const last = this.lastPoint();
    if (last) {
      if (Math.hypot(xy[0] - last[0], xy[1] - last[1]) < 1e-6) {
        this.log('error', '與上一點相同，請指定其他點');
        return;
      }
      if (!this.addSegment(last, xy)) return;
    }
    line.points.push(xy);
  }

  private addSegment(a: XY, b: XY): boolean {
    const id = this.opts.sink.addLineString([twd97ToLngLat(a[0], a[1]), twd97ToLngLat(b[0], b[1])]);
    if (id === null) {
      this.log('error', '無法加入這段線（繪圖工具尚未就緒或坐標無效）');
      return false;
    }
    this.line!.segIds.push(id);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    this.log('info', `長度 ${len.toFixed(3)} m`);
    return true;
  }

  private endLine(emit = true) {
    const line = this.line;
    if (!line) return;
    this.lastLineEnd = line.segIds.length ? line.points[line.points.length - 1] : this.lastLineEnd;
    this.line = null;
    this.detach();
    this.updatePreview();
    if (emit) this.emit();
  }

  private prompt(): CommandPrompt {
    const line = this.line;
    if (!line) return IDLE_PROMPT;
    if (line.points.length === 0) return { command: 'LINE', text: '指定第一點', options: [] };
    return {
      command: 'LINE',
      text: '指定下一點或',
      options: line.segIds.length >= 2 ? [OPT_CLOSE, OPT_UNDO] : [OPT_UNDO],
    };
  }

  private log(kind: CommandMessage['kind'], text: string) {
    this.messages = [...this.messages, { id: this.nextMsgId++, kind, text }].slice(-COMMAND_MAX_MESSAGES);
  }

  // ---- 地圖互動（命令執行中才掛上）
  private attach() {
    this.map.on('click', this.handleClick);
    this.map.on('mousemove', this.handleMouseMove);
    this.map.doubleClickZoom.disable();
    this.map.getCanvas().style.cursor = 'crosshair';
  }

  private detach() {
    this.map.off('click', this.handleClick);
    this.map.off('mousemove', this.handleMouseMove);
    this.map.doubleClickZoom.enable();
    this.map.getCanvas().style.cursor = '';
    this.cursor = null;
  }

  private handleClick = (e: maplibregl.MapMouseEvent) => {
    if (!this.line) return;
    const xy = lngLatToTwd97(e.lngLat.lng, e.lngLat.lat);
    this.log('input', `${promptText(this.prompt())}: ${formatPoint(xy, this.coord)}`);
    this.addPoint(xy);
    this.updatePreview();
    this.emit();
  };

  private handleMouseMove = (e: maplibregl.MapMouseEvent) => {
    this.cursor = lngLatToTwd97(e.lngLat.lng, e.lngLat.lat);
    this.map.getCanvas().style.cursor = 'crosshair';
    this.updatePreview();
  };

  // ---- 預覽
  private updatePreview() {
    const map = this.map;
    if (!map.isStyleLoaded()) return;
    if (!map.getSource(PREVIEW_SOURCE)) {
      if (!this.line) return;
      map.addSource(PREVIEW_SOURCE, { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: PREVIEW_LINE,
        type: 'line',
        source: PREVIEW_SOURCE,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': PREVIEW_COLOR, 'line-width': 1.5, 'line-dasharray': [3, 2] },
      });
      map.addLayer({
        id: PREVIEW_POINT,
        type: 'circle',
        source: PREVIEW_SOURCE,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 4,
          'circle-color': PREVIEW_COLOR,
          'circle-stroke-color': '#000000',
          'circle-stroke-width': 1,
        },
      });
    }
    const src = map.getSource(PREVIEW_SOURCE) as maplibregl.GeoJSONSource;
    const last = this.lastPoint();
    if (!last) {
      src.setData(EMPTY);
      return;
    }
    const a = twd97ToLngLat(last[0], last[1]);
    const features: FeatureCollection['features'] = [
      { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: a } },
    ];
    if (this.cursor) {
      features.push({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: [a, twd97ToLngLat(this.cursor[0], this.cursor[1])] },
      });
    }
    src.setData({ type: 'FeatureCollection', features });
  }
}
