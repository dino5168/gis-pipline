// 3D 圖台右上角的導覽控制項：軸向球（拖曳旋轉、點軸切換視角）＋放大／縮小。
// 軸向：X＝東、Y＝北、Z＝上（以畫面中心的地面點為準）。
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { CesiumScene } from '../map/cesium/CesiumScene';

type Axis = 'x' | 'y' | 'z';
type AxesOnScreen = ReturnType<CesiumScene['axesOnScreen']>;

/** 軸的顏色（比照常見 3D 軟體：X 紅、Y 綠、Z 藍） */
const AXIS_COLORS: Record<Axis, string> = { x: '#e5484d', y: '#7ac943', z: '#3b82f6' };
const AXIS_NAMES: Record<Axis, [string, string]> = {
  x: ['東側（+X）', '西側（−X）'],
  y: ['北側（+Y）', '南側（−Y）'],
  z: ['正上方（+Z）', '正下方（−Z）'],
};

/** 控制項尺寸（px） */
const SIZE = 84;
const CENTER = SIZE / 2;
/** 軸長、軸端圓球半徑 */
const AXIS_LEN = 28;
const BALL_R = 9;
/** 拖曳每像素旋轉的角度（弧度） */
const DRAG_RAD_PER_PX = 0.01;
/** 移動超過這個距離才算拖曳，否則視為點擊 */
const CLICK_TOLERANCE = 3;
/** 放大／縮小一次的距離倍率 */
const ZOOM_STEP = 0.5;

interface Ball {
  axis: Axis;
  positive: boolean;
  x: number;
  y: number;
  depth: number;
}

function ballsOf(axes: AxesOnScreen): Ball[] {
  const balls: Ball[] = [];
  for (const axis of ['x', 'y', 'z'] as const) {
    const a = axes[axis];
    for (const positive of [true, false]) {
      const s = positive ? 1 : -1;
      balls.push({ axis, positive, x: CENTER + s * a.x * AXIS_LEN, y: CENTER - s * a.y * AXIS_LEN, depth: s * a.depth });
    }
  }
  // 遠的先畫，近的蓋在上面
  return balls.sort((a, b) => b.depth - a.depth);
}

export function Navigation3D({ scene }: { scene: CesiumScene }) {
  const [axes, setAxes] = useState<AxesOnScreen>(() => scene.axesOnScreen());
  const [hover, setHover] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean; ball: Ball | null } | null>(null);
  /** 按下的軸端圓球（圓球先收到 pointerdown，再冒泡到 svg 開始拖曳） */
  const pressed = useRef<Ball | null>(null);

  useEffect(() => {
    setAxes(scene.axesOnScreen());
    return scene.onCameraChange(() => setAxes(scene.axesOnScreen()));
  }, [scene]);

  const balls = ballsOf(axes);

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    const ball = pressed.current;
    pressed.current = null;
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, moved: false, ball };
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < CLICK_TOLERANCE) return;
    d.moved = true;
    d.x = e.clientX;
    d.y = e.clientY;
    // 往右拖：場景跟著往右轉；往下拖：把上方拉向自己（鏡頭升高、往下看）
    scene.orbit(-dx * DRAG_RAD_PER_PX, -dy * DRAG_RAD_PER_PX);
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d && !d.moved && d.ball) scene.viewFromAxis(d.ball.axis, d.ball.positive);
  };

  return (
    <div className="absolute top-3 right-3 z-40 flex flex-col items-center gap-2">
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="group cursor-grab touch-none select-none active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        role="img"
        aria-label="3D 視角控制：拖曳旋轉，點軸端切換視角"
      >
        <title>拖曳旋轉視角；點軸端圓球從該方向看</title>
        <circle
          cx={CENTER}
          cy={CENTER}
          r={CENTER - 1}
          className="fill-card/0 transition-colors group-hover:fill-card/60"
        />
        {balls.map((b) => {
          const key = `${b.axis}${b.positive ? '+' : '-'}`;
          const color = AXIS_COLORS[b.axis];
          const hot = hover === key;
          return (
            <g key={key}>
              {b.positive && <line x1={CENTER} y1={CENTER} x2={b.x} y2={b.y} stroke={color} strokeWidth={2.5} strokeLinecap="round" />}
              <circle
                cx={b.x}
                cy={b.y}
                r={BALL_R}
                fill={color}
                fillOpacity={b.positive ? 1 : 0.35}
                stroke={hot ? 'white' : color}
                strokeWidth={b.positive && !hot ? 0 : 1.5}
                className="cursor-pointer"
                onPointerDown={() => (pressed.current = b)}
                onPointerEnter={() => setHover(key)}
                onPointerLeave={() => setHover((h) => (h === key ? null : h))}
              >
                <title>從{AXIS_NAMES[b.axis][b.positive ? 0 : 1]}看</title>
              </circle>
              {b.positive && (
                <text
                  x={b.x}
                  y={b.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="pointer-events-none fill-white text-[11px] font-bold"
                >
                  {b.axis.toUpperCase()}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="bg-card/80 flex flex-col overflow-hidden rounded-md shadow-sm backdrop-blur-sm">
        <Button variant="ghost" size="icon-sm" title="放大" aria-label="放大" onClick={() => scene.zoomBy(ZOOM_STEP)}>
          <ZoomIn />
        </Button>
        <Button variant="ghost" size="icon-sm" title="縮小" aria-label="縮小" onClick={() => scene.zoomBy(1 / ZOOM_STEP)}>
          <ZoomOut />
        </Button>
      </div>
    </div>
  );
}
