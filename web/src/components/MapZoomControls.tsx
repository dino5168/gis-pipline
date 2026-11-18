// 圖台右上角的放大／重設視角／縮小按鈕組（2D、3D 共用同一樣式）。
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  onZoomIn: () => void;
  onReset: () => void;
  onZoomOut: () => void;
  /** 重設視角按鈕的說明 */
  resetTitle?: string;
}

export function MapZoomControls({ onZoomIn, onReset, onZoomOut, resetTitle = '重設視角（正北朝上）' }: Props) {
  return (
    <div className="bg-card/75 absolute top-3 right-3 z-40 flex flex-col overflow-hidden rounded-md shadow-sm backdrop-blur-sm">
      <Button variant="ghost" size="icon" title="放大" aria-label="放大" onClick={onZoomIn}>
        <Plus />
      </Button>
      <Button variant="ghost" size="icon" title={resetTitle} aria-label="重設視角" onClick={onReset}>
        <RotateCcw />
      </Button>
      <Button variant="ghost" size="icon" title="縮小" aria-label="縮小" onClick={onZoomOut}>
        <Minus />
      </Button>
    </div>
  );
}
