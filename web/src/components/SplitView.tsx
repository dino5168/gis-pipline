import { useRef, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ViewMode } from '../types/view';
import type { ActivePane } from '../map/useViewSync';

/** 左側比例的範圍 */
const MIN_RATIO = 0.15;
const MAX_RATIO = 0.85;
const KEY_STEP = 0.02;

export const clampRatio = (r: number) => Math.min(Math.max(r, MIN_RATIO), MAX_RATIO);

interface Props {
  mode: ViewMode;
  /** 並排時 2D 所占寬度比例 */
  ratio: number;
  onRatioChange: (r: number) => void;
  /** 使用者開始操作某一邊（視角同步依此決定由哪邊帶動） */
  onActivate: (pane: ActivePane) => void;
  left: ReactNode;
  right: ReactNode;
}

/**
 * 2D／3D 圖台版面。兩邊永遠保持掛載與實際尺寸（隱藏的那邊只是不可見），
 * 這樣切換模式時不必重建地圖，視角同步的換算也一直有效。
 */
export function SplitView({ mode, ratio, onRatioChange, onActivate, left, right }: Props) {
  const areaRef = useRef<HTMLDivElement>(null);
  const pct = `${ratio * 100}%`;
  const full: CSSProperties = { left: 0, width: '100%' };
  const leftStyle = mode === 'split' ? { left: 0, width: pct } : full;
  const rightStyle = mode === 'split' ? { left: pct, width: `${(1 - ratio) * 100}%` } : full;
  const hidden = 'invisible pointer-events-none';

  const paneHandlers = (pane: ActivePane) => ({
    onPointerEnter: () => onActivate(pane),
    onPointerDownCapture: () => onActivate(pane),
    onWheelCapture: () => onActivate(pane),
  });

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId) || !areaRef.current) return;
    const rect = areaRef.current.getBoundingClientRect();
    onRatioChange(clampRatio((e.clientX - rect.left) / rect.width));
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') onRatioChange(clampRatio(ratio - KEY_STEP));
    else if (e.key === 'ArrowRight') onRatioChange(clampRatio(ratio + KEY_STEP));
    else return;
    e.preventDefault();
  };

  return (
    <div ref={areaRef} className="relative min-h-0 flex-1 overflow-hidden">
      <div
        className={cn('absolute inset-y-0', mode === '3d' && hidden, mode === '3d' ? 'z-0' : 'z-10')}
        style={leftStyle}
        {...paneHandlers('2d')}
      >
        {left}
      </div>
      <div
        className={cn('absolute inset-y-0', mode === '2d' && hidden, mode === '2d' ? 'z-0' : 'z-10')}
        style={rightStyle}
        {...paneHandlers('3d')}
      >
        {right}
      </div>
      {mode === 'split' && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="調整 2D／3D 視窗大小"
          aria-valuemin={MIN_RATIO * 100}
          aria-valuemax={MAX_RATIO * 100}
          aria-valuenow={Math.round(ratio * 100)}
          tabIndex={0}
          className="group bg-border hover:bg-primary/30 focus-visible:bg-primary/30 absolute inset-y-0 z-30 flex w-2 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center outline-none"
          style={{ left: pct }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onKeyDown={onKeyDown}
          onDoubleClick={() => onRatioChange(0.5)}
        >
          <div className="bg-background text-muted-foreground group-hover:text-foreground flex h-8 w-3.5 items-center justify-center rounded-sm border shadow-sm">
            <GripVertical className="size-3" />
          </div>
        </div>
      )}
    </div>
  );
}
