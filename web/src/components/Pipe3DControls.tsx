import { Box, TriangleAlert } from 'lucide-react';
import { HEIGHT_MODE_LABELS, type HeightMode, type Pipe3DStatus } from '../types/pipe3d';

interface Props {
  view3d: boolean;
  onView3dChange: (on: boolean) => void;
  heightMode: HeightMode;
  onHeightModeChange: (m: HeightMode) => void;
  exaggeration: number;
  onExaggerationChange: (k: number) => void;
  status: Pipe3DStatus;
}

function StatusLine({ status }: { status: Pipe3DStatus }) {
  switch (status.kind) {
    case 'off':
      return null;
    case 'loading':
      return <div className="text-muted mt-1.5">載入中…</div>;
    case 'zoom-in':
      return (
        <div className="mt-1.5 rounded bg-yellow-100 px-2 py-1 text-yellow-900 dark:bg-yellow-950 dark:text-yellow-200">
          放大到縮放等級 {status.minZoom} 以上才會載入 3D 管線。
        </div>
      );
    case 'ready':
      return (
        <div className="text-muted mt-1.5">
          已載入 {status.count.toLocaleString()} 條管線
          {status.truncated && '（已達上限，只顯示離畫面中心較近的部分）'}
        </div>
      );
    case 'error':
      return (
        <div className="mt-1.5 flex gap-1.5 rounded bg-red-50 px-2 py-1 text-red-900 dark:bg-red-950 dark:text-red-200">
          <TriangleAlert size={14} className="mt-0.5 flex-none" />
          <span>{status.message}</span>
        </div>
      );
  }
}

export function Pipe3DControls(p: Props) {
  return (
    <>
      <h2 className="section-title">
        <Box size={13} /> 3D 檢視
      </h2>
      <label className="flex cursor-pointer items-center gap-1.5">
        <input type="checkbox" checked={p.view3d} onChange={(e) => p.onView3dChange(e.target.checked)} />
        顯示 3D 管線（地面下）
      </label>
      {p.view3d && (
        <div className="mt-1.5 space-y-1.5">
          <label className="block">
            <span className="text-muted text-xs">高度依據</span>
            <select
              className="field mt-0.5 w-full p-1"
              value={p.heightMode}
              onChange={(e) => p.onHeightModeChange(e.target.value as HeightMode)}
            >
              {(Object.keys(HEIGHT_MODE_LABELS) as HeightMode[]).map((m) => (
                <option key={m} value={m}>
                  {HEIGHT_MODE_LABELS[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-muted text-xs">垂直／管徑放大 ×{p.exaggeration}</span>
            <input
              type="range"
              className="w-full"
              min={1}
              max={20}
              step={1}
              value={p.exaggeration}
              onChange={(e) => p.onExaggerationChange(Number(e.target.value))}
            />
          </label>
          <div className="text-muted text-xs">右鍵拖曳（或 Ctrl＋拖曳）可旋轉、傾斜視角。</div>
        </div>
      )}
      <StatusLine status={p.status} />
    </>
  );
}
