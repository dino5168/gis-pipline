// 剖面分析的斷面圖（SVG，以實際像素繪製）：X＝距起點 A 的距離，Y＝埋深（地表 = 0），
// 各管線依種類配色畫圓形／矩形（管徑依深度比例，保持正圓），上方直書標註「代碼 管材 管徑 權屬」。
// 畫面與匯出 PNG 共用；配色由 ink 指定（畫面用 CSS 變數跟主題，匯出用固定淺色）。
import { PIPE3D_NO_DEPTH_COLOR } from '../config';
import { PIPE_KIND_BY_ID } from '../types/pipeKind';
import { formatSize, profileShape, type ProfilePipe, type ProfileResult } from '../types/profile';

/** 圖面配色（文字／線條；管線本身用種類顏色） */
export interface ChartInk {
  fg: string;
  muted: string;
  grid: string;
}

/** 畫面：跟著系統主題 */
export const SCREEN_INK: ChartInk = { fg: 'var(--foreground)', muted: 'var(--muted-foreground)', grid: 'var(--border)' };
/** 匯出：白底深色字 */
export const PRINT_INK: ChartInk = { fg: '#1f2933', muted: '#5f6b76', grid: '#d5dbe0' };

export const kindColor = (p: ProfilePipe) =>
  p.depth === null ? PIPE3D_NO_DEPTH_COLOR : PIPE_KIND_BY_ID[p.layer]?.color ?? '#888';
const kindCode = (p: ProfilePipe) => PIPE_KIND_BY_ID[p.layer]?.code ?? '?';

/** 屬性標註：代碼 管材 管徑 權屬（＋異常註記） */
function pipeLabel(p: ProfilePipe): string {
  const parts = [kindCode(p), p.material ?? '—', formatSize(p), p.mgmt_unit ?? '—'];
  if (p.depth === null) parts.push('埋深缺值');
  else if (p.clamped) parts.push('埋深異常');
  return parts.join(' ');
}

/** 1、2、5×10ⁿ 的刻度間距 */
function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

export function ProfileChart({
  result,
  width,
  rem,
  ink,
  fontFamily,
  hover = null,
  onHover,
}: {
  result: ProfileResult;
  width: number;
  /** 根字級（px）；圖面尺寸以此縮放 */
  rem: number;
  ink: ChartInk;
  fontFamily?: string;
  hover?: number | null;
  onHover?: (i: number | null) => void;
}) {
  const fontPx = rem * 0.6875;
  const gap = fontPx * 1.35; // 直書標註的最小間距
  const n = result.pipes.length;
  const padL = rem * 3;
  const padR = rem;
  // 標註放不下時加寬（視窗可橫向捲動）
  const w = Math.max(width, padL + padR + n * gap);
  const labelBand = rem * 9.5;
  const plotTop = labelBand + rem * 0.75;
  const plotH = rem * 9;
  const h = plotTop + plotH + rem * 1.75;
  const plotW = w - padL - padR;
  const L = result.length;
  const sx = plotW / L;

  const shapes = result.pipes.map(profileShape);
  const maxDepth = Math.max(1, ...result.pipes.map((p, i) => (p.depth ?? 0) + shapes[i].h));
  const yStep = niceStep(maxDepth / 4);
  const yMax = Math.ceil((maxDepth * 1.08) / yStep) * yStep;
  const sy = plotH / yMax;
  const X = (d: number) => padL + d * sx;
  const Y = (depth: number) => plotTop + depth * sy;

  const xStep = niceStep(L / Math.max(2, plotW / (rem * 5)));
  const xTicks: number[] = [];
  for (let d = 0; d <= L + 1e-6; d += xStep) xTicks.push(d);
  const yTicks: number[] = [];
  for (let d = 0; d <= yMax + 1e-6; d += yStep) yTicks.push(d);

  // 標註水平位置：依序排開，至少相隔 gap，不超出左右邊界
  const px = result.pipes.map((p) => X(p.dist));
  const lx = [...px];
  for (let i = 1; i < n; i++) lx[i] = Math.max(lx[i], lx[i - 1] + gap);
  const right = w - padR;
  if (n) lx[n - 1] = Math.min(lx[n - 1], right);
  for (let i = n - 2; i >= 0; i--) lx[i] = Math.min(lx[i], lx[i + 1] - gap);
  for (let i = 0; i < n; i++) lx[i] = Math.max(lx[i], i ? lx[i - 1] + gap : padL);

  const groundY = Y(0);
  const elbow = groundY - rem * 0.75;
  const textBase = elbow - rem * 0.5;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={w}
      height={h}
      className="block"
      style={{ fontSize: `${fontPx}px`, fontFamily }}
      onMouseLeave={onHover && (() => onHover(null))}
    >
      {/* 格線與刻度 */}
      {yTicks.map((d) => (
        <g key={`y${d}`}>
          <line x1={padL} x2={right} y1={Y(d)} y2={Y(d)} style={{ stroke: ink.grid }} strokeDasharray={d ? '2 3' : undefined} />
          <text x={padL - 4} y={Y(d)} textAnchor="end" dominantBaseline="middle" style={{ fill: ink.muted }}>
            {d ? `${+d.toFixed(2)} m` : 'GL 0'}
          </text>
        </g>
      ))}
      {xTicks.map((d) => (
        <g key={`x${d}`}>
          <line x1={X(d)} x2={X(d)} y1={plotTop + plotH} y2={plotTop + plotH + 4} style={{ stroke: ink.muted }} />
          <text x={X(d)} y={plotTop + plotH + rem * 0.9} textAnchor="middle" style={{ fill: ink.muted }}>
            {+d.toFixed(1)}
          </text>
        </g>
      ))}
      <text x={padL} y={h - 2} style={{ fill: ink.muted }}>A</text>
      <text x={right} y={h - 2} textAnchor="end" style={{ fill: ink.muted }}>B（距 A，m）</text>
      {/* 地表線 */}
      <line x1={padL} x2={right} y1={groundY} y2={groundY} style={{ stroke: ink.fg }} strokeWidth={1.5} />

      {/* 管線斷面＋標註 */}
      {result.pipes.map((p, i) => {
        const s = shapes[i];
        const color = kindColor(p);
        const top = p.depth ?? 0;
        const pw = Math.max(s.w * sy, 4);
        const ph = Math.max(s.h * sy, 4);
        const cx = px[i];
        const cy = Y(top) + ph / 2;
        const on = hover === i;
        return (
          <g key={`${p.layer}-${p.gid}-${i}`} onMouseEnter={onHover && (() => onHover(i))} className="cursor-default">
            <polyline
              points={`${cx},${Y(top)} ${cx},${groundY} ${lx[i]},${elbow} ${lx[i]},${textBase + 2}`}
              fill="none"
              style={{ stroke: on ? ink.fg : ink.muted }}
              strokeOpacity={on ? 1 : 0.5}
              strokeWidth={on ? 1.2 : 0.8}
            />
            {s.rect ? (
              <rect x={cx - pw / 2} y={cy - ph / 2} width={pw} height={ph} fill={color} fillOpacity={0.85} />
            ) : (
              <circle cx={cx} cy={cy} r={pw / 2} fill={color} fillOpacity={0.85} />
            )}
            {on &&
              (s.rect ? (
                <rect x={cx - pw / 2 - 2} y={cy - ph / 2 - 2} width={pw + 4} height={ph + 4} fill="none" style={{ stroke: ink.fg }} strokeWidth={1.5} />
              ) : (
                <circle cx={cx} cy={cy} r={pw / 2 + 2} fill="none" style={{ stroke: ink.fg }} strokeWidth={1.5} />
              ))}
            <text
              transform={`translate(${lx[i]},${textBase}) rotate(-90)`}
              dominantBaseline="middle"
              fontWeight={on ? 600 : undefined}
              style={{ fill: ink.fg }}
            >
              <tspan style={{ fill: color }}>{kindCode(p)}</tspan> {pipeLabel(p).slice(kindCode(p).length + 1)}
            </text>
            {/* 透明的較大感應區，小管線也好指（匯出時不需要） */}
            {onHover && (
              <>
                <rect x={lx[i] - gap / 2} y={0} width={gap} height={textBase + 2} fill="transparent" />
                <circle cx={cx} cy={cy} r={Math.max(pw, ph) / 2 + 4} fill="transparent" />
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
