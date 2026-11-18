// 2D 圖台左側中間的量測按鈕（外層定位由 MapView 負責）：按下「量測」展開「距離｜面積｜正方形｜圓形」，下方顯示結果與操作提示。
import { Circle, Pentagon, Ruler, Spline, Square } from 'lucide-react';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { formatArea, formatDistance, type MeasureResult } from '../map/measure';
import { MEASURE_MODE_NAMES, isTwoPointMode, type MeasureMode } from '../types/measure';

interface Props {
  /** 量測面板是否展開 */
  open: boolean;
  mode: MeasureMode | null;
  result: MeasureResult | null;
  onToggleOpen: () => void;
  onModeChange: (mode: MeasureMode) => void;
}

const MODE_ICONS = { distance: Spline, area: Pentagon, square: Square, circle: Circle } as const;

const START_HINT: Record<MeasureMode, string> = {
  distance: '單擊地圖加點開始量測',
  area: '單擊地圖加點開始量測',
  square: '單擊地圖決定正方形的一角',
  circle: '單擊地圖決定圓心',
};

function hint(mode: MeasureMode, r: MeasureResult | null): string {
  if (!r || (!r.drawing && r.pointCount === 0)) return START_HINT[mode];
  if (r.drawing && isTwoPointMode(mode)) {
    return `${mode === 'square' ? '再單擊決定對角（邊與正北平行）' : '再單擊決定半徑'}；Esc 關閉`;
  }
  if (r.drawing) return `單擊加點，雙擊結束${mode === 'area' ? '（至少 3 點）' : ''}；Esc 關閉`;
  return '單擊地圖開始新的量測；Esc 關閉';
}

export function MeasureControl({ open, mode, result, onToggleOpen, onModeChange }: Props) {
  const hasValue = result && result.lengthM > 0;
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
            {(Object.keys(MEASURE_MODE_NAMES) as MeasureMode[]).map((m) => {
              const Icon = MODE_ICONS[m];
              const active = mode === m;
              return (
                <Button
                  key={m}
                  variant="ghost"
                  size="icon-lg"
                  className={cn('rounded-none', active && 'bg-primary text-primary-foreground hover:bg-primary/80')}
                  title={`${MEASURE_MODE_NAMES[m]}量測`}
                  aria-label={`${MEASURE_MODE_NAMES[m]}量測`}
                  aria-pressed={active}
                  onClick={() => onModeChange(m)}
                >
                  <Icon />
                </Button>
              );
            })}
          </div>
        )}
      {/* 結果面板放在圖示列下方（absolute），不推動下方繪圖按鈕的位置 */}
      {open && mode && (
        <div className="bg-card/90 text-foreground absolute top-full left-10 z-10 mt-2 w-60 rounded-md px-3 py-2 text-xs shadow-sm backdrop-blur-sm">
          {hasValue && (
            <dl className="mb-1.5 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono tabular-nums">
              {isTwoPointMode(mode) && (
                <>
                  <dt className="text-muted-foreground font-sans">{mode === 'square' ? '邊長' : '半徑'}</dt>
                  <dd>{formatDistance(result.sizeM)}</dd>
                </>
              )}
              {mode !== 'distance' && (
                <>
                  <dt className="text-muted-foreground font-sans">面積</dt>
                  <dd className="font-semibold">{formatArea(result.areaM2)}</dd>
                </>
              )}
              <dt className="text-muted-foreground font-sans">{mode === 'distance' ? '總長' : '周長'}</dt>
              <dd className={cn(mode === 'distance' && 'font-semibold')}>{formatDistance(result.lengthM)}</dd>
            </dl>
          )}
          <p className="text-muted-foreground">{hint(mode, result)}</p>
          <p className="text-muted-foreground/70 mt-1">以 TWD97 TM2 平面坐標計算</p>
        </div>
      )}
    </div>
  );
}
