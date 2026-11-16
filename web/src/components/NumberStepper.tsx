import { useEffect, useId, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from 'cn';

interface Props {
  /** 欄位名稱（給螢幕閱讀器與按鈕說明用） */
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  className?: string;
}

/** 檢核輸入文字：必須是 min～max 的整數，回傳錯誤訊息或 null */
function validate(text: string, min: number, max: number): string | null {
  const t = text.trim();
  if (t === '') return '請輸入數字';
  if (!/^\d+$/.test(t)) return '只能輸入整數';
  const n = Number(t);
  if (n < min || n > max) return `範圍 ${min}～${max}`;
  return null;
}

/**
 * 整數輸入＋減／加按鈕。
 * - 輸入合法才套用；不合法時顯示紅框與訊息，離開欄位（blur）後還原成目前的值。
 * - 到達上限／下限時，加／減按鈕停用，輸入超過範圍也不會套用。
 * - 鍵盤上下鍵可加減 1。
 */
export function NumberStepper({ label, value, min, max, onChange, className }: Props) {
  const [text, setText] = useState(String(value));
  const errId = useId();
  const error = validate(text, min, max);

  // 外部值變了（例如重新載入設定）→ 同步輸入框
  useEffect(() => setText(String(value)), [value]);

  const commit = (n: number) => {
    const v = Math.min(Math.max(n, min), max);
    setText(String(v));
    if (v !== value) onChange(v);
  };

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`${label}減 1`}
          disabled={value <= min}
          onClick={() => commit(value - 1)}
        >
          <Minus />
        </Button>
        <Input
          type="text"
          inputMode="numeric"
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errId : undefined}
          value={text}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            if (validate(t, min, max) === null) onChange(Number(t));
          }}
          onBlur={() => setText(String(value))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              commit(value + 1);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              commit(value - 1);
            } else if (e.key === 'Enter') {
              setText(String(value));
            }
          }}
          className="h-7 w-14 px-2 text-center font-mono tabular-nums"
        />
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={`${label}加 1`}
          disabled={value >= max}
          onClick={() => commit(value + 1)}
        >
          <Plus />
        </Button>
        <span className="text-muted-foreground ml-1 text-xs">
          位（{min}～{max}）
        </span>
      </div>
      {error && (
        <p id={errId} className="text-destructive text-xs">
          {error}
        </p>
      )}
    </div>
  );
}
