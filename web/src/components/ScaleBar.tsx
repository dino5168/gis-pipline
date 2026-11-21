import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { formatScaleNumber, scaleBarLayout } from '../map/scaleBar';
import type { ScaleBarSettings, ScaleBarStyle } from '../types/scaleBar';

// 圖面座標：左右留白給數字，上方一列數字，下方是比例尺本體
const PAD_L = 8;
const PAD_R = 26;
const Y0 = 14;
const H = 8;
const Y1 = Y0 + H;
const YM = Y0 + H / 2;
const SVG_H = Y1 + 2;

const INK = 'fill-neutral-900 stroke-neutral-900';
const PAPER = 'fill-white stroke-neutral-900';

/**
 * 比例尺圖形（純 SVG，不含背景）
 * 分段：前半段切成 4 小格，後半段 1 格 → 邊界 0, 1/8, 1/4, 3/8, 1/2, 1；數字標在 0, 1/4, 1/2, 1
 */
export function ScaleBarGraphic({
  style,
  width,
  labels,
  className,
}: {
  style: ScaleBarStyle;
  width: number;
  /** 依序為 0、1/4、1/2、全長處的文字 */
  labels: [string, string, string, string];
  className?: string;
}) {
  const w = Math.max(width, 8);
  const x = (f: number) => PAD_L + f * w;
  const bounds = [0, 1 / 8, 1 / 4, 3 / 8, 1 / 2, 1].map(x);
  const labelAt = [0, 1 / 4, 1 / 2, 1].map(x);
  const ticks = [0, 1 / 8, 1 / 4, 3 / 8, 1 / 2, 3 / 4, 1];
  const isMajor = (f: number) => f === 0 || f === 1 / 4 || f === 1 / 2 || f === 1;
  const segs = bounds.slice(0, -1).map((a, i) => [a, bounds[i + 1]] as const);

  let body: ReactNode;
  switch (style) {
    case 'alternating':
      body = segs.map(([a, b], i) => (
        <rect key={i} x={a} y={Y0} width={b - a} height={H} className={i % 2 === 0 ? INK : PAPER} />
      ));
      break;
    case 'checker':
      body = segs.flatMap(([a, b], i) => [
        <rect key={`t${i}`} x={a} y={Y0} width={b - a} height={H / 2} className={i % 2 === 0 ? INK : PAPER} />,
        <rect key={`b${i}`} x={a} y={YM} width={b - a} height={H / 2} className={i % 2 === 0 ? PAPER : INK} />,
      ]);
      break;
    case 'hollow':
      body = (
        <>
          {segs.map(([a, b], i) => (
            <rect key={i} x={a} y={Y0} width={b - a} height={H} className={PAPER} />
          ))}
          <line x1={x(0)} x2={x(1)} y1={YM} y2={YM} />
        </>
      );
      break;
    case 'stepped': {
      // 相鄰兩點 x 相同就是垂直段：高、低交替
      const pts = [`${x(0)},${Y1}`];
      segs.forEach(([a, b], i) => {
        const y = i % 2 === 0 ? Y0 : Y1;
        pts.push(`${a},${y}`, `${b},${y}`);
      });
      pts.push(`${x(1)},${Y1}`);
      body = <polyline points={pts.join(' ')} fill="none" />;
      break;
    }
    case 'double-line':
      body = (
        <>
          <line x1={x(0)} x2={x(1)} y1={Y0 + 2} y2={Y0 + 2} />
          <line x1={x(0)} x2={x(1)} y1={Y1 - 2} y2={Y1 - 2} />
          {ticks.map((f) => (
            <line key={f} x1={x(f)} x2={x(f)} y1={Y0} y2={Y1} />
          ))}
        </>
      );
      break;
    default: {
      // 刻度型：基線在上、下或中間，主刻度長、次刻度短
      const base = style === 'ticks-down' ? Y0 : style === 'ticks-up' ? Y1 : YM;
      body = (
        <>
          <line x1={x(0)} x2={x(1)} y1={base} y2={base} />
          {ticks.map((f) => {
            const len = isMajor(f) ? H : H * 0.55;
            const [y1, y2] =
              style === 'ticks-down' ? [base, base + len] : style === 'ticks-up' ? [base - len, base] : [base - len / 2, base + len / 2];
            return <line key={f} x1={x(f)} x2={x(f)} y1={y1} y2={y2} />;
          })}
        </>
      );
    }
  }

  return (
    <svg
      width={PAD_L + w + PAD_R}
      height={SVG_H}
      className={cn('block stroke-neutral-900', className)}
      strokeWidth={1}
      shapeRendering="crispEdges"
      aria-hidden
    >
      <g>{body}</g>
      <g className="fill-neutral-900 stroke-none" fontSize={10} textAnchor="middle">
        {labels.map((t, i) => (
          <text key={i} x={labelAt[i]} y={Y0 - 3}>
            {t}
          </text>
        ))}
      </g>
    </svg>
  );
}

/** 疊在圖台左下角的比例尺（依地面解析度計算） */
export function ScaleBar({
  settings,
  metersPerPixel,
  attribution,
}: {
  settings: ScaleBarSettings;
  metersPerPixel: number | null;
  /** 圖資出處（顯示在比例尺右邊） */
  attribution?: string;
}) {
  const layout =
    settings.visible && metersPerPixel !== null
      ? scaleBarLayout(metersPerPixel, settings.maxWidth, settings.unit)
      : null;
  if (!layout && !attribution) return null;
  const n = (f: number) => (layout ? formatScaleNumber(layout.total * f) : '');
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 z-10 flex items-end gap-1.5">
      {layout && (
        <div className="rounded bg-white/80 px-1 py-0.5 shadow-sm">
          <ScaleBarGraphic
            style={settings.style}
            width={layout.width}
            labels={['0', n(1 / 4), n(1 / 2), `${n(1)} ${layout.unitLabel}`]}
          />
        </div>
      )}
      {attribution && (
        <span className="pointer-events-auto rounded bg-white/70 px-1 text-[0.625rem] leading-4 whitespace-nowrap text-neutral-700">
          {attribution}
        </span>
      )}
    </div>
  );
}
