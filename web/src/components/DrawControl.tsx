// 2D 圖台左側中間的繪圖按鈕（量測按鈕下方）：按下「繪圖」向右展開「圖形｜編輯」兩組圖示，下方顯示操作提示。
import {
  Circle,
  Eraser,
  MapPin,
  Move,
  MousePointer2,
  PenTool,
  Pentagon,
  RectangleHorizontal,
  RotateCw,
  Scissors,
  Spline,
  Type,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { formatArea, formatDistance } from '../map/measure';
import {
  DRAW_EDIT_MODE_NAMES,
  DRAW_IMPLEMENTED_MODES,
  DRAW_MODE_NAMES,
  DRAW_SHAPE_MODE_NAMES,
  type DrawEditMode,
  type DrawMeasure,
  type DrawMode,
  type DrawShapeMode,
  type DrawStatus,
} from '../types/draw';

interface Props {
  /** 繪圖面板是否展開 */
  open: boolean;
  mode: DrawMode | null;
  status: DrawStatus | null;
  onToggleOpen: () => void;
  onModeChange: (mode: DrawMode) => void;
  onUndo: () => void;
}

const MODE_ICONS: Record<DrawMode, LucideIcon> = {
  point: MapPin,
  linestring: Spline,
  polygon: Pentagon,
  rectangle: RectangleHorizontal,
  circle: Circle,
  text: Type,
  select: MousePointer2,
  drag: Move,
  rotate: RotateCw,
  cut: Scissors,
  delete: Eraser,
};

const SHAPE_MODES = Object.keys(DRAW_SHAPE_MODE_NAMES) as DrawShapeMode[];
const EDIT_MODES = Object.keys(DRAW_EDIT_MODE_NAMES) as DrawEditMode[];

const GROUP_CLASS = 'bg-card/75 flex overflow-hidden rounded-md shadow-sm backdrop-blur-sm';

/** 各模式開始前的提示 */
const START_HINT: Partial<Record<DrawMode, string>> = {
  point: '單擊放置點（靠近其他圖形的頂點／邊會吸附，黃點）',
  linestring: '單擊開始畫線（靠近其他圖形的頂點／邊會吸附，黃點）',
  polygon: '單擊開始畫多邊形（靠近其他圖形的頂點／邊會吸附，黃點）',
  rectangle: '單擊決定第一個角',
  circle: '單擊決定圓心（可吸附到其他圖形的頂點／邊）',
  select:
    '單擊圖形選取；拖頂點移動（可吸附），點邊中點加頂點，右鍵刪頂點；矩形拖角、圓拖邊調整大小；Delete 刪除',
  drag: '單擊圖形選取，再拖曳移動整個圖形',
  rotate: '按住圖形拖曳，繞中心旋轉',
  delete: '單擊圖形刪除（Ctrl+Z 復原）',
};

/** 繪製中的提示 */
const DRAWING_HINT: Partial<Record<DrawMode, string>> = {
  linestring: '單擊加點；在最後一點再單擊（或雙擊、Enter）結束',
  polygon: '單擊加點；單擊起點或最後一點（或雙擊、Enter）結束',
  rectangle: '單擊決定對角',
  circle: '單擊決定半徑',
};

function hint(mode: DrawMode | null, m: DrawMeasure | null): string {
  if (!mode) return '選擇上方的圖形或編輯工具；Esc 關閉';
  if (!DRAW_IMPLEMENTED_MODES.has(mode)) return `「${DRAW_MODE_NAMES[mode]}」尚未實作`;
  if (m?.drawing) return `${DRAWING_HINT[mode] ?? ''}；Esc 取消這個圖形`;
  const esc = mode === 'select' ? 'Esc 關閉' : 'Esc 回到選取';
  return `${DRAW_MODE_NAMES[mode]}：${START_HINT[mode] ?? ''}；${esc}`;
}

/** 量測值的各列（標題、數值） */
function measureRows(m: DrawMeasure): [string, string][] {
  if (m.lngLat) return [['經緯度', `${m.lngLat[0].toFixed(6)}, ${m.lngLat[1].toFixed(6)}`]];
  if (m.mode === 'linestring') return [['長度', formatDistance(m.lengthM)]];
  const rows: [string, string][] = [];
  if (m.widthM !== undefined && m.heightM !== undefined)
    rows.push(['寬 × 高', `${formatDistance(m.widthM)} × ${formatDistance(m.heightM)}`]);
  if (m.radiusM !== undefined) rows.push(['半徑', formatDistance(m.radiusM)]);
  rows.push(['面積', formatArea(m.areaM2)], ['周長', formatDistance(m.lengthM)]);
  return rows;
}

export function DrawControl({ open, mode, status, onToggleOpen, onModeChange, onUndo }: Props) {
  const modeButton = (m: DrawMode) => {
    const Icon = MODE_ICONS[m];
    const active = mode === m;
    const ready = DRAW_IMPLEMENTED_MODES.has(m);
    return (
      <Button
        key={m}
        variant="ghost"
        size="icon-lg"
        className={cn('rounded-none', active && 'bg-primary text-primary-foreground hover:bg-primary/80')}
        title={ready ? DRAW_MODE_NAMES[m] : `${DRAW_MODE_NAMES[m]}（尚未實作）`}
        aria-label={DRAW_MODE_NAMES[m]}
        aria-pressed={active}
        disabled={!ready}
        onClick={() => onModeChange(m)}
      >
        <Icon />
      </Button>
    );
  };

  return (
    <div className="relative flex items-stretch gap-1">
      <div className="bg-card/75 overflow-hidden rounded-md shadow-sm backdrop-blur-sm">
        <Button
          variant="ghost"
          size="icon-lg"
          className={cn('rounded-none', open && 'bg-muted text-foreground')}
          title="繪圖"
          aria-label="繪圖"
          aria-pressed={open}
          onClick={onToggleOpen}
        >
          <PenTool />
        </Button>
      </div>
      {open && (
        <>
          <div className={GROUP_CLASS} role="group" aria-label="圖形">
            {SHAPE_MODES.map(modeButton)}
          </div>
          <div className={GROUP_CLASS} role="group" aria-label="編輯">
            {EDIT_MODES.map(modeButton)}
            <Button
              variant="ghost"
              size="icon-lg"
              className="rounded-none"
              title="復原（Ctrl+Z；重做 Ctrl+Y）"
              aria-label="復原"
              disabled={!status?.canUndo}
              onClick={onUndo}
            >
              <Undo2 />
            </Button>
          </div>
          {/* 提示面板放在圖示列下方，不推動左側按鈕的位置 */}
          <div className="bg-card/90 text-foreground absolute top-full left-10 mt-2 w-60 rounded-md px-3 py-2 text-xs shadow-sm backdrop-blur-sm">
            <p className="text-muted-foreground">{hint(mode, status?.measure ?? null)}</p>
            {status?.measure && (
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 tabular-nums">
                {measureRows(status.measure).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="text-muted-foreground/70 mt-1">圖上圖形：{status?.featureCount ?? 0} 個</p>
          </div>
        </>
      )}
    </div>
  );
}
