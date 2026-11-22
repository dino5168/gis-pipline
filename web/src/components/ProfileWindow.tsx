// 剖面分析視窗（浮動在 2D 圖台上方，可拖曳標題列移動）：
// 剖面線與管線的交點畫成斷面圖（X＝距起點 A 的距離，Y＝埋深，地表 = 0），
// 各管線依種類配色畫圓形／矩形（管徑依深度比例，保持正圓），上方標註「代碼 管材 管徑 權屬」。
import { Download, Loader2, PenLine, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PIPE3D_NO_DEPTH_COLOR } from '../config';
import { formatDistance } from '../map/measure';
import type { ProfileMapPoint } from '../map/profileTool';
import type { CoordDisplaySettings } from '../types/coordSystem';
import { PIPE_KINDS, PIPE_KIND_BY_ID, type PipeKindId } from '../types/pipeKind';
import { formatSize, type LngLat, type ProfileResult } from '../types/profile';
import { kindColor, ProfileChart, SCREEN_INK } from './ProfileChart';

interface Props {
  /** 剖面線（null＝還沒畫好） */
  line: [LngLat, LngLat] | null;
  /** 畫線中 */
  drawing: boolean;
  enabledKinds: ReadonlySet<PipeKindId>;
  /** 坐標系設定（匯出 PNG 標示 A／B 坐標） */
  coordDisplay: CoordDisplaySettings;
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

/** 目前根字級（px），讓圖面尺寸隨「系統樣式 → 文字大小」縮放 */
const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;

export function ProfileWindow({ line, drawing, enabledKinds, coordDisplay, onRedraw, onClose, onPoints, onHover }: Props) {
  const [load, setLoad] = useState<Load>({ kind: 'idle' });
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const [boxWidth, setBoxWidth] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const cb = useRef({ onPoints, onHover });
  cb.current = { onPoints, onHover };

  // 依目前顯示的管線種類查詢（順序依 PIPE_KINDS）
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

  // 匯出 PNG（匯出程式含 react-dom/server，動態載入）
  const exportPng = async () => {
    if (!result || !line) return;
    setExporting(true);
    setExportError(null);
    try {
      const { exportProfilePng } = await import('./profileExport');
      await exportProfilePng(result, line, coordDisplay);
    } catch (e) {
      setExportError(`匯出失敗：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  let status: string;
  if (exportError) status = exportError;
  else if (drawing) status = line ? '' : '在 2D 圖台依序點選剖面線起點 A、終點 B（Esc 取消）；要輸入坐標請用命令列 PA';
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
        <span className={cn('text-muted-foreground min-w-0 flex-1 truncate', (load.kind === 'error' || exportError) && 'text-destructive')}>
          {load.kind === 'loading' && <Loader2 className="mr-1 inline size-3 animate-spin" />}
          {status}
        </span>
        <Button variant="ghost" size="xs" title="在 2D 圖台重新畫剖面線" onClick={onRedraw} disabled={drawing}>
          <PenLine />
          重畫剖面線
        </Button>
        <Button
          variant="ghost"
          size="xs"
          title="將剖面分析圖匯出成 PNG（白底、含坐標與圖例）"
          onClick={exportPng}
          disabled={!result || !line || drawing || exporting}
        >
          {exporting ? <Loader2 className="animate-spin" /> : <Download />}
          匯出
        </Button>
        <Button variant="ghost" size="icon-xs" title="關閉剖面分析" aria-label="關閉剖面分析" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div ref={boxRef} className="overflow-x-auto">
        {result && boxWidth > 0 && (
          <ProfileChart result={result} width={boxWidth} rem={remPx()} ink={SCREEN_INK} hover={hover} onHover={setHover} />
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
