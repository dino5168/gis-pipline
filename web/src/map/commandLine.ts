// 2D 命令列引擎（仿 AutoCAD Command）：解析輸入、執行命令、命令中接管地圖點選取點。
// 命令本身（LINE、PLINE、POLYGON、RECTANG、CIRCLE、POINT）在 commandSessions.ts；
// 畫出的圖形加到繪圖工具（DrawTool），可在繪圖面板編輯、復原、匯出。
// 預覽（橡皮筋線、圖形外框、已點的點）用自己的 GeoJSON 圖層，不進 Terra Draw。
import type { FeatureCollection, LineString, Point, Polygon } from 'geojson';
import * as maplibregl from 'maplibre-gl';
import { lngLatToTwd97, twd97ToLngLat } from './coordTransform';
import { formatPoint, parsePointInput, type XY } from './commandInput';
import {
  CircleSession,
  CommandSession,
  LineSession,
  PlineSession,
  PointSession,
  PolygonSession,
  RectangSession,
  type SessionContext,
  type Step,
} from './commandSessions';
import { DEFAULT_COORD_DISPLAY, type CoordDisplaySettings } from '../types/coordSystem';
import {
  COMMAND_ALIASES,
  COMMAND_MAX_MESSAGES,
  COMMANDS,
  promptText,
  type CommandLineState,
  type CommandMessage,
  type CommandPrompt,
  type CommandShapeMode,
} from '../types/commandLine';

type FeatureId = string | number;

/** 命令畫出的圖形交給誰保存（DrawTool） */
export interface CommandSink {
  /** 加入一個圖形（經緯度），記入復原；失敗回傳 null */
  addShape(mode: CommandShapeMode, geometry: Point | LineString | Polygon): FeatureId | null;
  removeFeatureById(id: FeatureId): void;
}

interface Options {
  onChange: (state: CommandLineState) => void;
  /** 命令開始（關閉量測、繪圖面板，避免搶滑鼠） */
  onStart: () => void;
  sink: CommandSink;
}

const PREVIEW_SOURCE = 'cmd-preview';
const PREVIEW_LINE = 'cmd-preview-line';
const PREVIEW_POINT = 'cmd-preview-point';
const PREVIEW_COLOR = '#ffffff';

const IDLE_PROMPT: CommandPrompt = { command: null, text: '指令', options: [] };
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const RE_NUMBER = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const COMMAND_LIST = COMMANDS.map((c) => `${c.name}（${c.aliases[0]}）`).join('、');

const toLngLat = (p: XY) => twd97ToLngLat(p[0], p[1]);

/** 外環轉成封閉、逆時針的經緯度坐標 */
function polygonRing(ring: XY[]): [number, number][] {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  const ccw = area < 0 ? [...ring].reverse() : ring;
  return [...ccw, ccw[0]].map(toLngLat);
}

export class CommandLineEngine {
  private readonly map: maplibregl.Map;
  private readonly opts: Options;
  private coord: CoordDisplaySettings = DEFAULT_COORD_DISPLAY;
  private messages: CommandMessage[] = [];
  private nextMsgId = 1;
  private session: CommandSession | null = null;
  private lastCommand: string | null = null;
  /** 上一次 LINE 的終點（在「指定第一點」直接按 Enter 時接續） */
  private lastLineEnd: XY | null = null;
  private cursor: XY | null = null;
  private readonly ctx: SessionContext;

  constructor(map: maplibregl.Map, opts: Options) {
    this.map = map;
    this.opts = opts;
    this.ctx = {
      log: (kind, text) => this.log(kind, text),
      add: (mode, coords) => this.addShape(mode, coords),
      remove: (id) => this.opts.sink.removeFeatureById(id),
    };
  }

  /** 有命令執行中 */
  get active(): boolean {
    return this.session !== null;
  }

  setCoordSettings(s: CoordDisplaySettings): void {
    this.coord = s;
  }

  /** 送出一行輸入（空字串＝Enter） */
  submit(raw: string): void {
    const text = raw.trim();
    if (this.session) {
      this.handleInput(text);
      return;
    }
    if (!text) {
      if (this.lastCommand) this.startCommand(this.lastCommand, `${promptText(IDLE_PROMPT)}: （重複 ${this.lastCommand}）`);
      return;
    }
    const name = COMMAND_ALIASES[text.toUpperCase()];
    if (!name) {
      this.log('input', `${promptText(IDLE_PROMPT)}: ${text}`);
      this.log('error', `未知的指令「${text}」。可用指令：${COMMAND_LIST}`);
      this.emit();
      return;
    }
    this.startCommand(name, `${promptText(IDLE_PROMPT)}: ${text}`);
  }

  /** 取消執行中的命令（Esc） */
  cancel(): void {
    const s = this.session;
    if (!s) return;
    this.log('info', '*取消*');
    s.onCancel();
    this.endSession();
  }

  /** 送出目前的狀態（React 掛載時取初始值） */
  emit(): void {
    this.opts.onChange({ prompt: this.prompt(), messages: this.messages, active: this.active });
  }

  destroy(): void {
    if (this.session) this.endSession(false);
  }

  // ---- 命令
  private createSession(name: string): CommandSession {
    switch (name) {
      case 'PLINE':
        return new PlineSession(this.ctx);
      case 'POLYGON':
        return new PolygonSession(this.ctx);
      case 'RECTANG':
        return new RectangSession(this.ctx);
      case 'CIRCLE':
        return new CircleSession(this.ctx);
      case 'POINT':
        return new PointSession(this.ctx);
      default:
        return new LineSession(this.ctx, this.lastLineEnd);
    }
  }

  private startCommand(name: string, echo: string) {
    this.log('input', echo);
    this.lastCommand = name;
    this.opts.onStart();
    this.session = this.createSession(name);
    this.attach();
    this.updatePreview();
    this.emit();
  }

  private handleInput(text: string) {
    const s = this.session!;
    const step = s.step();
    this.log('input', `${promptText(step)}: ${text}`);
    const key = text.toUpperCase();

    if (!text) s.onEnter();
    else if (step.options.some((o) => o.key === key)) s.onKeyword(key);
    else if ((step.input === 'number' || step.input === 'pointOrNumber') && RE_NUMBER.test(text)) s.onNumber(Number(text));
    else if (step.input === 'number') this.log('error', `請輸入數值${step.def !== undefined ? `，或按 Enter 採用預設值 ${step.def}` : ''}`);
    else if (step.input === 'keyword') this.log('error', `請輸入選項：${this.optionHint(step)}`);
    else {
      const r = parsePointInput(text, { system: this.coord.system, last: step.base, cursor: this.cursor });
      if (!r) this.log('error', `無法辨識「${text}」。${this.inputHint(step)}`);
      else if (!r.ok) this.log('error', r.error);
      else s.onPoint(r.xy);
    }
    this.afterInput();
  }

  private afterInput() {
    if (this.session?.done) this.endSession();
    else {
      this.updatePreview();
      this.emit();
    }
  }

  private optionHint(step: Step): string {
    return step.options.map((o) => `${o.key}＝${o.label}`).join('、');
  }

  private inputHint(step: Step): string {
    const abs = this.coord.system === 'wgs84' ? '經度,緯度' : 'X,Y';
    const num = step.input === 'pointOrNumber' ? '數值、' : '';
    const opts = this.optionHint(step);
    return `可輸入 ${num}${abs}、@dx,dy、@距離<角度、距離，或在地圖上點選${opts ? `；${opts}` : ''}`;
  }

  private addShape(mode: CommandShapeMode, coords: XY | XY[]): FeatureId | null {
    let geometry: Point | LineString | Polygon;
    if (mode === 'point') geometry = { type: 'Point', coordinates: toLngLat(coords as XY) };
    else if (mode === 'linestring') geometry = { type: 'LineString', coordinates: (coords as XY[]).map(toLngLat) };
    else geometry = { type: 'Polygon', coordinates: [polygonRing(coords as XY[])] };
    const id = this.opts.sink.addShape(mode, geometry);
    if (id === null) this.log('error', '無法加入圖形（繪圖工具尚未就緒、坐標無效或圖形自我相交）');
    return id;
  }

  private endSession(emit = true) {
    const s = this.session;
    if (!s) return;
    if (s instanceof LineSession) this.lastLineEnd = s.endPoint ?? this.lastLineEnd;
    this.session = null;
    this.detach();
    this.updatePreview();
    if (emit) this.emit();
  }

  private prompt(): CommandPrompt {
    if (!this.session) return IDLE_PROMPT;
    const { command, text, options, def } = this.session.step();
    return { command, text, options, def };
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
    const s = this.session;
    if (!s) return;
    const step = s.step();
    const xy = lngLatToTwd97(e.lngLat.lng, e.lngLat.lat);
    this.log('input', `${promptText(step)}: ${formatPoint(xy, this.coord)}`);
    if (step.input === 'point' || step.input === 'pointOrNumber') s.onPoint(xy);
    else if (step.input === 'number') this.log('error', '這一步請在命令列輸入數值');
    else this.log('error', `這一步請選擇：${this.optionHint(step)}`);
    this.afterInput();
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
      if (!this.session) return;
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
    if (!this.session) {
      src.setData(EMPTY);
      return;
    }
    const pv = this.session.preview(this.cursor);
    const features: FeatureCollection['features'] = [
      ...pv.lines
        .filter((l) => l.length >= 2)
        .map((l) => ({
          type: 'Feature' as const,
          properties: {},
          geometry: { type: 'LineString' as const, coordinates: l.map(toLngLat) },
        })),
      ...pv.points.map((p) => ({
        type: 'Feature' as const,
        properties: {},
        geometry: { type: 'Point' as const, coordinates: toLngLat(p) },
      })),
    ];
    src.setData({ type: 'FeatureCollection', features });
  }
}
