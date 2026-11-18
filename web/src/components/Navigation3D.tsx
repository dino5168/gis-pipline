// 3D 圖台右上角的瀏覽輔助：立體導覽元件（小 Cesium 畫面，見 map/cesium/NavGizmo.ts）＋放大／重設視角／縮小。
// 立體元件：左右拖曳轉方位、上下拖曳改俯仰（環繞畫面中心的地面點）；雙擊 N 轉正北；點天頂軸轉成正上方俯視。
import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CesiumScene } from '../map/cesium/CesiumScene';
import type { NavGizmoHandle } from '../map/cesium/NavGizmo';

/** 立體元件尺寸（px） */
const SIZE = 110;
/** 拖曳每像素旋轉的角度（弧度） */
const DRAG_RAD_PER_PX = 0.01;
/** 移動超過這個距離才算拖曳 */
const CLICK_TOLERANCE = 3;
/** 放大／縮小一次的距離倍率 */
const ZOOM_STEP = 0.5;

interface Drag {
  sx: number;
  sy: number;
  x: number;
  y: number;
  moved: boolean;
}

export function Navigation3D({ scene }: { scene: CesiumScene }) {
  const box = useRef<HTMLDivElement>(null);
  const gizmo = useRef<NavGizmoHandle | null>(null);
  const drag = useRef<Drag | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const g = scene.createNavGizmo(box.current);
    gizmo.current = g;
    return () => {
      gizmo.current = null;
      g.destroy();
    };
  }, [scene]);

  /** 指標相對立體元件左上角的位置 */
  const local = (e: ReactMouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < CLICK_TOLERANCE) return;
      d.moved = true;
      scene.beginOrbit();
    }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    // 往右拖：場景跟著往右轉；往下拖：鏡頭升高、往下看
    scene.orbit(-dx * DRAG_RAD_PER_PX, -dy * DRAG_RAD_PER_PX);
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d) return;
    if (d.moved) {
      scene.endOrbit();
      return;
    }
    // 單擊：點到天頂軸 → 正上方俯視
    const p = local(e);
    if (gizmo.current?.pick(p.x, p.y) === 'zenith') scene.lookStraightDown();
  };

  const onPointerCancel = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current?.moved) scene.endOrbit();
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onDoubleClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const p = local(e);
    if (gizmo.current?.pick(p.x, p.y) === 'north') scene.faceNorth();
  };

  return (
    <div className="absolute top-3 right-3 z-40 flex flex-col items-center gap-2">
      <div
        ref={box}
        style={{ width: SIZE, height: SIZE }}
        className="cursor-default touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onDoubleClick={onDoubleClick}
        role="img"
        aria-label="立體導覽：左右拖曳轉方位、上下拖曳改俯仰，雙擊 N 轉為正北，點天頂軸轉成正上方俯視"
        title="左右拖曳轉方位、上下拖曳改俯仰；雙擊 N 轉正北；點天頂軸俯視"
      />

      <div className="bg-card/75 flex flex-col overflow-hidden rounded-md shadow-sm backdrop-blur-sm">
        <Button variant="ghost" size="icon" title="放大" aria-label="放大" onClick={() => scene.zoomBy(ZOOM_STEP)}>
          <Plus />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="重設視角（正北朝上、正上方俯視）"
          aria-label="重設視角"
          onClick={() => scene.resetView()}
        >
          <RotateCcw />
        </Button>
        <Button variant="ghost" size="icon" title="縮小" aria-label="縮小" onClick={() => scene.zoomBy(1 / ZOOM_STEP)}>
          <Minus />
        </Button>
      </div>
    </div>
  );
}
