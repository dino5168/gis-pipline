// 剖面分析視窗（浮動在 2D 圖台上方，可拖曳標題列移動）：
// 剖面線與管線的交點畫成斷面圖（X＝距起點 A 的距離，Y＝埋深，地表 = 0），
// 各管線依種類配色畫圓形／矩形（管徑依深度比例，保持正圓），上方標註「代碼 管材 管徑 權屬」。
import { Loader2, PenLine, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PIPE3D_NO_DEPTH_COLOR } from '../config';
import { formatDistance } from '../map/measure';
import type { ProfileMapPoint } from '../map/profileTool';
import { PIPE_KINDS, PIPE_KIND_BY_ID, type PipeKindId } from '../types/pipeKind';
import { formatSize, profileShape, type LngLat, type ProfilePipe, type ProfileResult } from '../types/profile';

interface Props {
  /** 剖面線（null＝還沒畫好） */
  line: [LngLat, LngLat] | null;
  /** 畫線中 */
  drawing: boolean;
  enabledKinds: ReadonlySet<PipeKindId>;
  onRedraw: () => void;
  onClose: () => void;
  /** 交點（給地圖標示） */
  onPoints: (points: ProfileMapPoint[]) => void;
  /** 滑鼠指到的交點（索引同 onPoints） */
  onHover: (index: number | null) => void;
}

type Load =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; result: ProfileResult };

const kindColor = (p: ProfilePipe) => (p.depth === null ? PIPE3D_NO_DEPTH_COLOR : PIPE_KIND_BY_ID[p.layer]?.color ?? '#888');
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

/** 目前根字級（px），讓圖面尺寸隨「系統樣式 → 文字大小」縮放 */
const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

export function ProfileWindow({ line, drawing, enabledKinds, onRedraw, onClose, onPoints, onHover }: Props) {
  const [load, setLoad] = useState<Load>({ kind: 'idle' });
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const cb = useRef({ onPoints, onHover });
  cb.current = { onPoints, onHover };

  // 依目前顯示的管線種類查詢（順序依 PIPE_KINDS）
  const layers = useMemo(() => PIPE_KINDS.filter((k) => enabledKinds.has(k.id)).map((k) => k.id), [enabledKinds]);
  useEffect(() => {
    setHover(null);
    if (!line || !layers.length) {
      setLoad({ kind: 'idle' });
      cb.current.onPoints([]);
      return;
    }
    const ctrl = new AbortController();
    setLoad({ kind: 'loading' });
    const q = new URLSearchParams({ line: [...line[0], ...line[1]].join(','), layers: layers.join(',') });
    fetch(`/api/profile?${q}`, { signal: ctrl.signal })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as (ProfileResult & { detail?: unknown }) | null;
        if (!res.ok || !body) throw new Error(typeof body?.detail === 'string' ? body.detail : `查詢失敗（HTTP ${res.status}）`);
        return body;
      })
      .then((result) => {
        setLoad({ kind: 'done', result });
        cb.current.onPoints(result.pipes.map((p) => ({ at: [p.lng, p.lat], color: kindColor(p) })));
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setLoad({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
        cb.current.onPoints([]);
      });
    return () => ctrl.abort();
  }, [line, layers]);

  useEffect(() => cb.current.onHover(hover), [hover]);

  // 圖面寬度跟著視窗
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBoxWidth(el.clientWidth));
    ro.observe(el);
    setBoxWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // 拖曳標題列移動視窗
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const sx = e.clientX - drag.x;
    const sy = e.clientY - drag.y;
    const move = (ev: PointerEvent) => setDrag({ x: ev.clientX - sx, y: ev.clientY - sy });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const result = load.kind === 'done' ? load.result : null;
  const hovered = result && hover !== null ? result.pipes[hover] : null;
  const usedKinds = result ? PIPE_KINDS.filter((k) => result.pipes.some((p) => p.layer === k.id)) : [];

  let status: string;
  if (drawing) status = line ? '' : '在 2D 圖台依序點選剖面線起點 A、終點 B（Esc 取消）';
  else if (!line) status = '按「重畫剖面線」開始';
  else if (!layers.length) status = '沒有開啟的管線種類（選單「管線」）';
  else if (load.kind === 'loading') status = '查詢中…';
  else if (load.kind === 'error') status = load.message;
  else if (result)
    status = `剖面長 ${formatDistance(result.length)}，交會管線 ${result.pipes.length} 條${result.truncated ? '（已達上限，只列前面的）' : ''}`;
  else status = '';

  return (
    <div
      className="bg-card/90 ring-border absolute top-3 left-1/2 z-40 flex w-[min(760px,calc(100%-24px))] flex-col overflow-hidden rounded-md text-xs shadow-md ring-1 backdrop-blur-sm"
      style={{ transform: `translate(calc(-50% + ${drag.x}px), ${drag.y}px)` }}
    >
      <div
        className="border-border flex cursor-move items-center gap-2 border-b px-2 py-1 select-none"
        onPointerDown={startDrag}
      >
        <span className="font-semibold">剖面分析</span>
        <span className={cn('text-muted-foreground min-w-0 flex-1 truncate', load.kind === 'error' && 'text-destructive')}>
          {load.kind === 'loading' && <Loader2 className="mr-1 inline size-3 animate-spin" />}
          {status}
        </span>
        <Button variant="ghost" size="xs" title="在 2D 圖台重新畫剖面線" onClick={onRedraw} disabled={drawing}>
          <PenLine />
          重畫剖面線
        </Button>
        <Button variant="ghost" size="icon-xs" title="關閉剖面分析" aria-label="關閉剖面分析" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div ref={boxRef} className="overflow-x-auto">
        {result && boxWidth > 0 && (
          <ProfileChart result={result} width={boxWidth} hover={hover} onHover={setHover} />
        )}
      </div>
      {result && (
        <div className="border-border text-muted-foreground flex min-h-6 flex-wrap items-center gap-x-3 gap-y-0.5 border-t px-2 py-1">
          {hovered ? (
            <span className="text-foreground">
              {PIPE_KIND_BY_ID[hovered.layer]?.name} #{hovered.gid}
              {hovered.pipe_no && `｜編號 ${hovered.pipe_no}`}｜管材 {hovered.material ?? '—'}｜{formatSize(hovered)}｜管頂深{' '}
              {hovered.depth === null ? '缺值' : `${hovered.depth.toFixed(2)} m${hovered.clamped ? '（異常，截在上限）' : ''}`}
              ｜距 A {hovered.dist.toFixed(1)} m｜權屬 {hovered.mgmt_unit ?? '—'}
              {hovered.overlap && '｜與剖面線平行重疊（取中點）'}
            </span>
          ) : (
            <>
              {usedKinds.map((k) => (
                <span key={k.id} className="inline-flex items-center gap-1">
                  <span className="inline-block size-2.5 rounded-sm" style={{ background: k.color }} />
                  {k.code} {k.name}
                </span>
              ))}
              {result.pipes.some((p) => p.depth === null) && (
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block size-2.5 rounded-sm" style={{ background: PIPE3D_NO_DEPTH_COLOR }} />
                  埋深缺值（畫在地表）
                </span>
              )}
              <span>標註：代碼 管材 管徑 權屬｜深度方向放大，管線依深度比例畫</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---- 斷面圖（SVG，以實際像素繪製，文字用 rem 才會跟著系統字級）
function ProfileChart({
  result,
  width,
  hover,
  onHover,
}: {
  result: ProfileResult;
  width: number;
  hover: number | null;
  onHover: (i: number | null) => void;
}) {
  const rem = remPx();
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
    <svg width={w} height={h} className="block" style={{ fontSize: `${fontPx}px` }} onMouseLeave={() => onHover(null)}>
      {/* 格線與刻度 */}
      {yTicks.map((d) => (
        <g key={`y${d}`}>
          <line x1={padL} x2={right} y1={Y(d)} y2={Y(d)} className="stroke-border" strokeDasharray={d ? '2 3' : undefined} />
          <text x={padL - 4} y={Y(d)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground">
            {d ? `${+d.toFixed(2)} m` : 'GL 0'}
          </text>
        </g>
      ))}
      {xTicks.map((d) => (
        <g key={`x${d}`}>
          <line x1={X(d)} x2={X(d)} y1={plotTop + plotH} y2={plotTop + plotH + 4} className="stroke-muted-foreground" />
          <text x={X(d)} y={plotTop + plotH + rem * 0.9} textAnchor="middle" className="fill-muted-foreground">
            {+d.toFixed(1)}
          </text>
        </g>
      ))}
      <text x={padL} y={h - 2} className="fill-muted-foreground">A</text>
      <text x={right} y={h - 2} textAnchor="end" className="fill-muted-foreground">B（距 A，m）</text>
      {/* 地表線 */}
      <line x1={padL} x2={right} y1={groundY} y2={groundY} className="stroke-foreground" strokeWidth={1.5} />

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
          <g key={`${p.layer}-${p.gid}-${i}`} onMouseEnter={() => onHover(i)} className="cursor-default">
            <polyline
              points={`${cx},${Y(top)} ${cx},${groundY} ${lx[i]},${elbow} ${lx[i]},${textBase + 2}`}
              fill="none"
              className={on ? 'stroke-foreground' : 'stroke-muted-foreground'}
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
                <rect x={cx - pw / 2 - 2} y={cy - ph / 2 - 2} width={pw + 4} height={ph + 4} fill="none" className="stroke-foreground" strokeWidth={1.5} />
              ) : (
                <circle cx={cx} cy={cy} r={pw / 2 + 2} fill="none" className="stroke-foreground" strokeWidth={1.5} />
              ))}
            <text
              transform={`translate(${lx[i]},${textBase}) rotate(-90)`}
              dominantBaseline="middle"
              className={on ? 'fill-foreground font-semibold' : 'fill-foreground'}
            >
              <tspan style={{ fill: color }}>{kindCode(p)}</tspan> {pipeLabel(p).slice(kindCode(p).length + 1)}
            </text>
            {/* 透明的較大感應區，小管線也好指 */}
            <rect x={lx[i] - gap / 2} y={0} width={gap} height={textBase + 2} fill="transparent" />
            <circle cx={cx} cy={cy} r={Math.max(pw, ph) / 2 + 4} fill="transparent" />
          </g>
        );
      })}
    </svg>
  );
}
