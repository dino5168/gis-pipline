// 剖面分析的斷面圖（SVG，以實際像素繪製）：X＝距起點 A 的距離，Y＝埋深（地表 = 0），
// 各管線依種類配色畫圓形／矩形（管徑依深度比例，保持正圓），上方直書標註「代碼 管材 管徑 權屬」。
// 畫面與匯出 PNG 共用；配色由 ink 指定（畫面用 CSS 變數跟主題，匯出用固定淺色）。
// 衝突檢核匯出 Excel 也用本圖（沿規劃管線的縱剖面）：另給 plan 畫規劃管線與檢核淨距範圍、
// numbers 在標註前加序號（對應衝突清單）、marks 在管線外圈畫狀態色。
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

/** 沿規劃管線的縱剖面：規劃管線管頂埋深由起點線性變化到終點 */
export interface ChartPlan {
  /** 起點、終點管頂埋深（公尺） */
  startDep: number;
  endDep: number;
  /** 管徑（公尺） */
  dia: number;
  /** 檢核淨距（公尺） */
  clearance: number;
  color: string;
}

export function ProfileChart({
  result,
  width,
  rem,
  ink,
  fontFamily,
  hover = null,
  onHover,
  plan,
  numbers,
  marks,
}: {
  result: ProfileResult;
  width: number;
  /** 根字級（px）；圖面尺寸以此縮放 */
  rem: number;
  ink: ChartInk;
  fontFamily?: string;
  hover?: number | null;
  onHover?: (i: number | null) => void;
  plan?: ChartPlan;
  /** 各管線標註前的序號（對應清單；管線須依 dist 排序，序號可不連續） */
  numbers?: number[];
  /** 各管線外圈顏色（undefined＝不畫） */
  marks?: (string | undefined)[];
}) {
  const fontPx = rem * 0.6875;
  const gap = fontPx * 1.35; // 直書標註的最小間距
  const n = result.pipes.length;
  const padL = rem * 3;
  const padR = rem;
  // 標註放不下時加寬（視窗可橫向捲動）
  const w = Math.max(width, padL + padR + n * gap);
  // 標註區高度：至少 9.5rem，最長的直書標註放得下（ASCII 約 0.6 字寬、中文 1 字寬）
  const textLen = (t: string) => [...t].reduce((sum, ch) => sum + (ch.charCodeAt(0) < 0x2000 ? 0.6 : 1), 0) * fontPx;
  const labels = result.pipes.map((p, i) => (numbers ? `${numbers[i]}. ` : '') + pipeLabel(p));
  const labelBand = Math.max(rem * 9.5, ...labels.map((t) => textLen(t) + rem * 1.75));
  const plotTop = labelBand + rem * 0.75;
  const plotH = rem * 9;
  const h = plotTop + plotH + rem * 1.75;
  const plotW = w - padL - padR;
  const L = result.length;
  const sx = plotW / L;

  const shapes = result.pipes.map(profileShape);
  const planBottom = plan ? Math.max(plan.startDep, plan.endDep) + plan.dia + plan.clearance : 0;
  const maxDepth = Math.max(1, planBottom, ...result.pipes.map((p, i) => (p.depth ?? 0) + shapes[i].h));
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

      {/* 規劃管線（管頂由起點埋深線性變化到終點）＋檢核淨距範圍（虛線） */}
      {plan && (
        <g>
          <polygon
            points={`${X(0)},${Y(plan.startDep)} ${X(L)},${Y(plan.endDep)} ${X(L)},${Y(plan.endDep + plan.dia)} ${X(0)},${Y(plan.startDep + plan.dia)}`}
            fill={plan.color}
            fillOpacity={0.35}
            stroke={plan.color}
            strokeWidth={1.2}
          />
          {plan.clearance > 0 && (
            <polygon
              points={`${X(0)},${Y(Math.max(0, plan.startDep - plan.clearance))} ${X(L)},${Y(Math.max(0, plan.endDep - plan.clearance))} ${X(L)},${Y(plan.endDep + plan.dia + plan.clearance)} ${X(0)},${Y(plan.startDep + plan.dia + plan.clearance)}`}
              fill="none"
              stroke={plan.color}
              strokeWidth={0.8}
              strokeDasharray="4 3"
            />
          )}
        </g>
      )}

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
        const mark = marks?.[i];
        const text = pipeLabel(p).slice(kindCode(p).length + 1);
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
            {mark &&
              (s.rect ? (
                <rect x={cx - pw / 2 - 1.5} y={cy - ph / 2 - 1.5} width={pw + 3} height={ph + 3} fill="none" stroke={mark} strokeWidth={1.5} />
              ) : (
                <circle cx={cx} cy={cy} r={pw / 2 + 1.5} fill="none" stroke={mark} strokeWidth={1.5} />
              ))}
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
              {numbers && `${numbers[i]}. `}
              <tspan style={{ fill: color }}>{kindCode(p)}</tspan> {text}
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
