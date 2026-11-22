// 管線衝突檢核視窗（浮動在 2D 圖台上方，可拖曳標題列移動）：
// 輸入規劃管線的管徑、起終點管頂埋深與檢核淨距，對畫好的規劃管線查詢 /api/clash，
// 列出疑似衝突（重疊／淨距不足／埋深缺值）；滑鼠指到一筆在地圖標示，點一下移過去。
// 「匯出」產生 Excel（摘要＋沿規劃管線剖面圖、衝突清單、規劃管線頂點）。
import { Download, Loader2, PenLine, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { usePersistentState } from '../lib/storage';
import { formatDistance } from '../map/measure';
import type { ClashMapPoint } from '../map/clashTool';
import {
  CLASH_CLEARANCE_RANGE,
  CLASH_DEPTH_RANGE,
  CLASH_DIA_RANGE,
  CLASH_SEVERITY,
  parseClashParams,
  type ClashParams,
  type ClashPipe,
  type ClashResult,
} from '../types/clash';
import { PIPE_KINDS, PIPE_KIND_BY_ID, type PipeKindId } from '../types/pipeKind';
import { formatSize, type LngLat } from '../types/profile';

interface Props {
  /** 規劃管線（null＝還沒畫好） */
  line: LngLat[] | null;
  /** 畫線中 */
  drawing: boolean;
  enabledKinds: ReadonlySet<PipeKindId>;
  onRedraw: () => void;
  onClose: () => void;
  /** 衝突位置（給地圖標示） */
  onPoints: (points: ClashMapPoint[]) => void;
  /** 滑鼠指到的衝突（索引同 onPoints） */
  onHover: (index: number | null) => void;
  /** 點清單中的一筆：地圖移到該處 */
  onLocate: (at: LngLat) => void;
}

type Load =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'done'; result: ClashResult };

/** 參數輸入停止多久後才查詢（毫秒） */
const QUERY_DEBOUNCE_MS = 400;

const m2 = (v: number | null) => (v === null ? '—' : v.toFixed(2));

/** 一個數值欄位：文字暫存，合法（範圍內）才套用 */
function NumberField({
  label,
  unit,
  value,
  range,
  step,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  range: { min: number; max: number };
  step: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const n = Number(text);
  const ok = text.trim() !== '' && Number.isFinite(n) && n >= range.min && n <= range.max;
  return (
    <label className="flex items-center gap-1" title={`${range.min}～${range.max} ${unit}`}>
      <span className="text-muted-foreground whitespace-nowrap">{label}</span>
      <Input
        type="number"
        inputMode="decimal"
        min={range.min}
        max={range.max}
        step={step}
        value={text}
        aria-invalid={!ok}
        className="h-6 w-[4.5rem] px-1.5 text-xs md:text-xs"
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() !== '' && Number.isFinite(v) && v >= range.min && v <= range.max) onChange(v);
        }}
        onBlur={() => setText(String(value))}
      />
      <span className="text-muted-foreground">{unit}</span>
    </label>
  );
}

export function ClashWindow({ line, drawing, enabledKinds, onRedraw, onClose, onPoints, onHover, onLocate }: Props) {
  const [params, setParams] = usePersistentState('utl.clashParams', parseClashParams);
  const [load, setLoad] = useState<Load>({ kind: 'idle' });
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const cb = useRef({ onPoints, onHover });
  cb.current = { onPoints, onHover };
  const set = (patch: Partial<ClashParams>) => setParams((p) => ({ ...p, ...patch }));

  const layers = useMemo(() => PIPE_KINDS.filter((k) => enabledKinds.has(k.id)).map((k) => k.id), [enabledKinds]);
  useEffect(() => {
    setHover(null);
    setExportError(null);
    if (!line || !layers.length) {
      setLoad({ kind: 'idle' });
      cb.current.onPoints([]);
      return;
    }
    const ctrl = new AbortController();
    setLoad({ kind: 'loading' });
    const timer = setTimeout(() => {
      fetch('/api/clash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          line,
          dia: params.diaMm / 1000,
          start_dep: params.startDep,
          end_dep: params.endDep,
          clearance: params.clearance,
          layers,
        }),
      })
        .then(async (res) => {
          const body = (await res.json().catch(() => null)) as (ClashResult & { detail?: unknown }) | null;
          if (!res.ok || !body) throw new Error(typeof body?.detail === 'string' ? body.detail : `查詢失敗（HTTP ${res.status}）`);
          return body;
        })
        .then((result) => {
          setLoad({ kind: 'done', result });
          cb.current.onPoints(result.clashes.map((c) => ({ at: [c.lng, c.lat], color: CLASH_SEVERITY[c.severity].color })));
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          setLoad({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
          cb.current.onPoints([]);
        });
    }, QUERY_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [line, layers, params]);

  useEffect(() => cb.current.onHover(hover), [hover]);

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
  const counts = result
    ? (Object.keys(CLASH_SEVERITY) as ClashPipe['severity'][])
        .map((s) => ({ s, n: result.clashes.filter((c) => c.severity === s).length }))
        .filter((x) => x.n)
    : [];

  // 匯出 Excel（exceljs 約 1MB，動態載入）
  const exportXlsx = async () => {
    if (!result || !line) return;
    setExporting(true);
    setExportError(null);
    try {
      const { exportClashXlsx } = await import('./clashExport');
      await exportClashXlsx(result, line, params, layers);
    } catch (e) {
      setExportError(`匯出失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  let status: string;
  if (exportError) status = exportError;
  else if (drawing) status = '在 2D 圖台單擊加點，雙擊或 Enter 完成（Backspace 退一點、Esc 取消）；要輸入坐標請用命令列 CC';
  else if (!line) status = '按「重畫規劃管線」開始';
  else if (!layers.length) status = '沒有開啟的管線種類（選單「管線」）';
  else if (load.kind === 'loading') status = '檢核中…';
  else if (load.kind === 'error') status = load.message;
  else if (result)
    status = `規劃管線長 ${formatDistance(result.length)}，比對 ${result.checked} 條，疑似衝突 ${result.clashes.length} 條${result.truncated ? '（已達上限，只列前面的）' : ''}`;
  else status = '';

  return (
    <div
      className="bg-card/90 ring-border absolute top-3 left-1/2 z-40 flex max-h-[calc(100%-24px)] w-[min(820px,calc(100%-24px))] flex-col overflow-hidden rounded-md text-xs shadow-md ring-1 backdrop-blur-sm"
      style={{ transform: `translate(calc(-50% + ${drag.x}px), ${drag.y}px)` }}
    >
      <div className="border-border flex cursor-move items-center gap-2 border-b px-2 py-1 select-none" onPointerDown={startDrag}>
        <span className="font-semibold">衝突檢核</span>
        <span className={cn('text-muted-foreground min-w-0 flex-1 truncate', (load.kind === 'error' || exportError) && 'text-destructive')}>
          {load.kind === 'loading' && <Loader2 className="mr-1 inline size-3 animate-spin" />}
          {status}
        </span>
        <Button variant="ghost" size="xs" title="在 2D 圖台重新畫規劃管線" onClick={onRedraw} disabled={drawing}>
          <PenLine />
          重畫規劃管線
        </Button>
        <Button
          variant="ghost"
          size="xs"
          title="將衝突檢核結果匯出成 Excel（參數、統計、沿規劃管線剖面圖、衝突清單、頂點坐標）"
          onClick={exportXlsx}
          disabled={!result || !line || drawing || exporting}
        >
          {exporting ? <Loader2 className="animate-spin" /> : <Download />}
          匯出
        </Button>
        <Button variant="ghost" size="icon-xs" title="關閉衝突檢核" aria-label="關閉衝突檢核" onClick={onClose}>
          <X />
        </Button>
      </div>
      {/* 規劃管線參數 */}
      <div className="border-border flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-2 py-1.5">
        <span className="font-medium">規劃管線</span>
        <NumberField label="管徑 Ø" unit="mm" value={params.diaMm} range={CLASH_DIA_RANGE} step={50} onChange={(v) => set({ diaMm: v })} />
        <NumberField label="起點管頂埋深" unit="m" value={params.startDep} range={CLASH_DEPTH_RANGE} step={0.1} onChange={(v) => set({ startDep: v })} />
        <NumberField label="終點管頂埋深" unit="m" value={params.endDep} range={CLASH_DEPTH_RANGE} step={0.1} onChange={(v) => set({ endDep: v })} />
        <NumberField label="檢核淨距" unit="m" value={params.clearance} range={CLASH_CLEARANCE_RANGE} step={0.05} onChange={(v) => set({ clearance: v })} />
      </div>
      {result && result.clashes.length > 0 && (
        <div className="max-h-72 min-h-0 overflow-auto" onMouseLeave={() => setHover(null)}>
          <table className="w-full border-collapse tabular-nums">
            <thead className="bg-card text-muted-foreground sticky top-0">
              <tr className="[&>th]:px-2 [&>th]:py-1 [&>th]:text-left [&>th]:font-normal [&>th]:whitespace-nowrap">
                <th>狀態</th>
                <th>種類</th>
                <th>編號</th>
                <th>管材／管徑</th>
                <th className="!text-right">既有管頂深</th>
                <th className="!text-right">規劃管頂深</th>
                <th className="!text-right">水平淨距</th>
                <th className="!text-right">垂直淨距</th>
                <th className="!text-right">距起點</th>
              </tr>
            </thead>
            <tbody>
              {result.clashes.map((c, i) => {
                const sev = CLASH_SEVERITY[c.severity];
                const kind = PIPE_KIND_BY_ID[c.layer];
                return (
                  <tr
                    key={`${c.layer}-${c.gid}`}
                    className={cn(
                      'border-border cursor-pointer border-t [&>td]:px-2 [&>td]:py-0.5 [&>td]:whitespace-nowrap',
                      hover === i && 'bg-accent',
                    )}
                    onMouseEnter={() => setHover(i)}
                    onClick={() => onLocate([c.lng, c.lat])}
                    title="點一下移到該處"
                  >
                    <td>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block size-2.5 rounded-full" style={{ background: sev.color }} />
                        {sev.label}
                      </span>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1">
                        <span className="inline-block size-2.5 rounded-sm" style={{ background: kind?.color }} />
                        {kind?.name ?? c.layer}
                      </span>
                    </td>
                    <td>{c.pipe_no ?? `#${c.gid}`}</td>
                    <td>
                      {c.material ?? '—'} {formatSize(c)}
                    </td>
                    <td className="text-right">
                      {c.depth === null ? '缺值' : `${m2(c.depth)} m`}
                      {c.clamped && '（異常）'}
                    </td>
                    <td className="text-right">{m2(c.plan_depth)} m</td>
                    <td className={cn('text-right', c.h_gap < 0 && 'text-destructive')}>{m2(c.h_gap)} m</td>
                    <td className={cn('text-right', c.v_gap !== null && c.v_gap < 0 && 'text-destructive')}>
                      {c.v_gap === null ? '—' : `${m2(c.v_gap)} m`}
                    </td>
                    <td className="text-right">{c.dist.toFixed(1)} m</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {result && (
        <div className="border-border text-muted-foreground flex min-h-6 flex-wrap items-center gap-x-3 gap-y-0.5 border-t px-2 py-1">
          {counts.map(({ s, n }) => (
            <span key={s} className="inline-flex items-center gap-1">
              <span className="inline-block size-2.5 rounded-full" style={{ background: CLASH_SEVERITY[s].color }} />
              {CLASH_SEVERITY[s].label} {n}
            </span>
          ))}
          {!result.clashes.length && <span className="text-foreground">未發現衝突</span>}
          <span>淨距為負值＝該方向重疊；依資料埋深推算，僅供篩檢，開挖前仍需現場確認</span>
        </div>
      )}
    </div>
  );
}
