// 2D 命令列視窗（浮動在 2D 圖台底部中央，仿 AutoCAD Command）。
// 鍵盤：Enter／空白鍵送出（空白＝結束命令或重複上一個命令）、Esc 取消、↑↓ 叫回之前的輸入；
// 焦點不在其他輸入框時，直接打字會自動進到命令列。
import { ChevronDown, ChevronUp, SquareTerminal, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CommandLineState } from '../types/commandLine';

interface Props {
  state: CommandLineState;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  onClose: () => void;
}

/** 收合／展開時顯示的訊息行數 */
const LINES_COLLAPSED = 3;
const LINES_EXPANDED = 12;
/** 輸入歷史保留筆數 */
const MAX_INPUT_HISTORY = 50;

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

export function CommandLineWindow({ state, onSubmit, onCancel, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  /** 正在瀏覽的歷史位置（history.length＝目前輸入） */
  const [histIndex, setHistIndex] = useState(0);

  const cb = useRef({ onSubmit, onCancel, active: state.active });
  cb.current = { onSubmit, onCancel, active: state.active };

  // 開啟時取得焦點
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // 新訊息時捲到底
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.messages, expanded]);

  // 焦點在地圖或頁面上時：打字進命令列；Esc 取消、Enter 結束命令
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const input = inputRef.current;
      if (!input) return;
      if (e.key === 'Escape' && cb.current.active) {
        cb.current.onCancel();
      } else if (e.key === 'Enter' && cb.current.active && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        cb.current.onSubmit('');
      } else if (e.key.length === 1 && e.key !== ' ') {
        // 先移焦點，這個按鍵的字元會輸入到命令列
        input.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = (text: string) => {
    const t = text.trim();
    if (t) {
      const next = [...history.filter((h) => h !== t), t].slice(-MAX_INPUT_HISTORY);
      setHistory(next);
      setHistIndex(next.length);
    } else setHistIndex(history.length);
    setValue('');
    onSubmit(t);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 不讓地圖或繪圖工具收到這些按鍵
    e.stopPropagation();
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      submit(value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (value) setValue('');
      else onCancel();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (!history.length) return;
      const i = Math.min(Math.max(histIndex + (e.key === 'ArrowUp' ? -1 : 1), 0), history.length);
      setHistIndex(i);
      setValue(history[i] ?? '');
    }
  };

  const { prompt } = state;
  const visible = state.messages.slice(-(expanded ? 200 : LINES_COLLAPSED));

  return (
    <div
      className="bg-card/85 ring-border absolute bottom-10 left-1/2 z-40 w-[min(720px,calc(100%-24px))] -translate-x-1/2 overflow-hidden rounded-md font-mono text-xs shadow-md ring-1 backdrop-blur-sm"
      onMouseDown={(e) => {
        // 點視窗空白處時把焦點留在輸入列
        if (!(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLButtonElement)) {
          e.preventDefault();
          inputRef.current?.focus();
        }
      }}
    >
      <div className="relative">
        <div
          ref={logRef}
          className="text-muted-foreground overflow-y-auto px-2 py-1 pr-16 leading-5"
          style={{ height: `${(expanded ? LINES_EXPANDED : LINES_COLLAPSED) * 1.25 + 0.5}rem` }}
        >
          {visible.map((m) => (
            <div
              key={m.id}
              className={cn('break-all whitespace-pre-wrap', m.kind === 'error' && 'text-destructive', m.kind === 'info' && 'text-foreground/80')}
            >
              {m.text}
            </div>
          ))}
        </div>
        <div className="absolute top-0.5 right-1 flex">
          <Button
            variant="ghost"
            size="icon-xs"
            title={expanded ? '收合訊息' : '展開訊息'}
            aria-label={expanded ? '收合訊息' : '展開訊息'}
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? <ChevronDown /> : <ChevronUp />}
          </Button>
          <Button variant="ghost" size="icon-xs" title="關閉命令列" aria-label="關閉命令列" onClick={onClose}>
            <X />
          </Button>
        </div>
      </div>
      <label className="border-border bg-background/60 flex items-center gap-1.5 border-t px-2 py-1">
        <SquareTerminal className="text-muted-foreground size-3.5 shrink-0" />
        <span className="shrink-0 whitespace-nowrap">
          {prompt.command && <span className="text-primary">{prompt.command} </span>}
          {prompt.text}
          {prompt.options.length > 0 && (
            <>
              {' ['}
              {prompt.options.map((o, i) => (
                <span key={o.key}>
                  {i > 0 && '/'}
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    title={`輸入 ${o.key}`}
                    onClick={() => submit(o.key)}
                  >
                    {o.label}({o.key})
                  </button>
                </span>
              ))}
              {']'}
            </>
          )}
          :
        </span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
          aria-label="命令輸入"
          placeholder={state.active ? '' : '輸入指令，例如 L'}
          className="placeholder:text-muted-foreground/60 min-w-0 flex-1 bg-transparent outline-none"
        />
      </label>
    </div>
  );
}
