import { TriangleAlert, ZoomIn } from 'lucide-react';
import type { Pipe3DStatus } from '../types/pipe3d';
import { PIPE_KINDS, type PipeKindId } from '../types/pipeKind';
import { WARNING_ALERT } from './PanelSection';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** 地圖上只提示需要注意的 3D 狀態；一般的「已載入 N 條」只在 3D 顯示設定 Drawer 顯示 */
const show3dStatus = (s: Pipe3DStatus) => s.kind !== 'off' && (s.kind !== 'ready' || s.truncated);

/** 3D 載入狀態（地圖提示與 3D 顯示設定 Drawer 共用） */
export function Pipe3DStatusLine({ status }: { status: Pipe3DStatus }) {
  switch (status.kind) {
    case 'off':
      return null;
    case 'loading':
      return <div className="text-muted-foreground text-xs">3D 管線載入中…</div>;
    case 'zoom-in':
      return (
        <Alert className={WARNING_ALERT}>
          <AlertDescription className="text-inherit">
            3D：放大到縮放等級 {status.minZoom} 以上才會載入管線。
          </AlertDescription>
        </Alert>
      );
    case 'ready':
      return (
        <div className="text-muted-foreground text-xs">
          3D 已載入 {status.count.toLocaleString()} 條管線
          {status.truncated && '（已達上限，只顯示離畫面中心較近的部分）'}
        </div>
      );
    case 'error':
      return (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertDescription>{status.message}</AlertDescription>
        </Alert>
      );
  }
}

interface Props {
  show2d: boolean;
  show3d: boolean;
  zoom: number | null;
  enabledKinds: ReadonlySet<PipeKindId>;
  tileError: string | null;
  pipe3dStatus: Pipe3DStatus;
  /** 放大到指定縮放等級（畫面不在資料範圍內時飛到台北市中心） */
  onZoomTo: (zoom: number) => void;
}

/** 地圖左上角的狀態提示：只在有事要提醒時出現（設定都在頂端「管線」選單） */
export function MapStatus(p: Props) {
  // 2D：勾選了但目前縮放等級還不會顯示的管線種類
  const hidden = p.show2d && p.zoom !== null ? PIPE_KINDS.filter((k) => p.enabledKinds.has(k.id) && p.zoom! < k.minZoom) : [];
  const target = Math.max(...hidden.map((k) => k.minZoom));
  const items = [
    p.tileError && (
      <Alert key="tile" variant="destructive">
        <TriangleAlert />
        <AlertDescription>{p.tileError}</AlertDescription>
      </Alert>
    ),
    !p.tileError && hidden.length > 0 && (
      <Alert key="zoom" className={WARNING_ALERT}>
        <AlertDescription className="text-inherit">
          目前縮放等級 {p.zoom!.toFixed(1)}，{hidden.map((k) => `${k.name}在 ${k.minZoom}`).join('、')} 以上才會顯示。
          <Button variant="outline" size="xs" className="mt-1.5" onClick={() => p.onZoomTo(target)}>
            <ZoomIn /> 放大到 {target}
          </Button>
        </AlertDescription>
      </Alert>
    ),
    p.show3d && show3dStatus(p.pipe3dStatus) && <Pipe3DStatusLine key="3d" status={p.pipe3dStatus} />,
  ].filter(Boolean);

  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none absolute top-3 left-3 z-40 w-[280px] max-w-[calc(100vw-24px)] space-y-2">
      {items.map((el, i) => (
        <div key={i} className="bg-card/95 pointer-events-auto rounded-lg shadow-md backdrop-blur-sm [&>div.text-xs]:px-3 [&>div.text-xs]:py-2">
          {el}
        </div>
      ))}
    </div>
  );
}
