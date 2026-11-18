// 3D 圖台左側中間的量測按鈕（外觀與 2D 的 MeasureControl 一致）：按下「量測」展開「距離｜高度｜面積」，下方顯示結果與操作提示。
import { MapPinned, Pentagon, Ruler, Spline } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { formatArea, formatDistance } from '../map/measure';
import { formatDh, formatHeight } from '../map/measure3d';
import { lngLatToTwd97 } from '../map/coordTransform';
import { PIPE_KIND_BY_ID } from '../types/pipeKind';
import { MEASURE3D_MODE_NAMES, type Measure3DMode, type Measure3DResult } from '../types/measure3d';

interface Props {
  open: boolean;
  mode: Measure3DMode | null;
  result: Measure3DResult | null;
  onToggleOpen: () => void;
  onModeChange: (mode: Measure3DMode) => void;
}

const MODE_ICONS = { distance: Spline, height: MapPinned, area: Pentagon } as const;

function hint(mode: Measure3DMode, r: Measure3DResult | null): string {
  if (mode === 'height') return '單擊管線或地面查詢高度；Esc 關閉';
  if (!r || (!r.drawing && r.pointCount === 0)) return '單擊管線或地面加點開始量測';
  if (r.drawing) return `單擊加點，雙擊結束${mode === 'area' ? '（至少 3 點）' : ''}；Esc 關閉`;
  return '單擊開始新的量測；Esc 關閉';
}

const Row = ({ label, value, strong }: { label: string; value: string; strong?: boolean }) => (
  <>
    <dt className="text-muted-foreground font-sans">{label}</dt>
    <dd className={cn(strong && 'font-semibold')}>{value}</dd>
  </>
);

function Values({ r }: { r: Measure3DResult }) {
  if (r.mode === 'distance') {
    if (r.pointCount < 2) return null;
    return (
      <>
        <Row label="斜距" value={formatDistance(r.slantM)} strong />
        <Row label="水平距離" value={formatDistance(r.horizontalM)} />
        <Row label="高差" value={formatDh(r.dhM)} />
      </>
    );
  }
  if (r.mode === 'area') {
    if (r.pointCount < 3) return null;
    return (
      <>
        <Row label="面積" value={formatArea(r.areaM2)} strong />
        <Row label="周長" value={formatDistance(r.perimeterM)} />
      </>
    );
  }
  const p = r.point;
  if (!p) return null;
  const [x, y] = lngLatToTwd97(p.lng, p.lat);
  const where = p.pipe ? `${PIPE_KIND_BY_ID[p.pipe.layer].name} #${p.pipe.gid}` : '地面';
  return (
    <>
      <Row label="高度" value={formatHeight(p.h, r.heightMode)} strong />
      <Row label="位置" value={where} />
      <Row label="X" value={x.toFixed(2)} />
      <Row label="Y" value={y.toFixed(2)} />
    </>
  );
}

export function Measure3DControl({ open, mode, result, onToggleOpen, onModeChange }: Props) {
  return (
    <div className="relative flex items-stretch gap-1">
      <div className="bg-card/75 overflow-hidden rounded-md shadow-sm backdrop-blur-sm">
        <Button
          variant="ghost"
          size="icon-lg"
          className={cn('rounded-none', open && 'bg-muted text-foreground')}
          title="量測"
          aria-label="量測"
          aria-pressed={open}
          onClick={onToggleOpen}
        >
          <Ruler />
        </Button>
      </div>
      {open && (
        <div className="bg-card/75 flex overflow-hidden rounded-md shadow-sm backdrop-blur-sm">
          {(Object.keys(MEASURE3D_MODE_NAMES) as Measure3DMode[]).map((m) => {
            const Icon = MODE_ICONS[m];
            const active = mode === m;
            return (
              <Button
                key={m}
                variant="ghost"
                size="icon-lg"
                className={cn('rounded-none', active && 'bg-primary text-primary-foreground hover:bg-primary/80')}
                title={`${MEASURE3D_MODE_NAMES[m]}量測`}
                aria-label={`${MEASURE3D_MODE_NAMES[m]}量測`}
                aria-pressed={active}
                onClick={() => onModeChange(m)}
              >
                <Icon />
              </Button>
            );
          })}
        </div>
      )}
      {open && mode && (
        <div className="bg-card/90 text-foreground absolute top-full left-10 z-10 mt-2 w-64 rounded-md px-3 py-2 text-xs shadow-sm backdrop-blur-sm">
          {result && (
            <dl className="mb-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono tabular-nums empty:hidden">
              <Values r={result} />
            </dl>
          )}
          <p className="text-muted-foreground">{hint(mode, result)}</p>
          <p className="text-muted-foreground/70 mt-1">
            {mode === 'area' ? '水平投影，' : ''}以 TWD97 TM2 平面坐標計算；高度為實際尺寸（不含放大倍率）
          </p>
        </div>
      )}
    </div>
  );
}
