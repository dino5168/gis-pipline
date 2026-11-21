// 門牌搜尋框（頂端選單列）：邊打邊查 /api/geocode，選定後由上層定位並標記。
import { Loader2, MapPin, Route, Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { GEOCODE_DEBOUNCE_MS, GEOCODE_LIMIT } from '../config';
import type { GeocodeResponse, GeocodeResult } from '../types/geocode';

interface Props {
  onSelect: (r: GeocodeResult) => void;
  /** 清除搜尋（移除地圖上的標記） */
  onClear: () => void;
}

type FetchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'done'; results: GeocodeResult[] }
  | { kind: 'error'; message: string };

export function AddressSearch({ onSelect, onClear }: Props) {
  const [text, setText] = useState('');
  const [state, setState] = useState<FetchState>({ kind: 'idle' });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  // 邊打邊查：停止輸入 GEOCODE_DEBOUNCE_MS 後才送出，新的輸入會取消前一個請求
  const query = text.trim();
  useEffect(() => {
    if (!query) {
      setState({ kind: 'idle' });
      return;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      setState({ kind: 'loading' });
      const params = new URLSearchParams({ q: query, limit: String(GEOCODE_LIMIT) });
      fetch(`/api/geocode?${params}`, { signal: ctrl.signal })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<GeocodeResponse>;
        })
        .then((body) => {
          setState({ kind: 'done', results: body.results });
          setActive(0);
        })
        .catch((e: unknown) => {
          if (ctrl.signal.aborted) return;
          setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) });
        });
    }, GEOCODE_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  // 點在搜尋框外面就收起清單
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const results = state.kind === 'done' ? state.results : [];

  const choose = (r: GeocodeResult) => {
    setText(r.label);
    setOpen(false);
    onSelect(r);
  };

  const clear = () => {
    setText('');
    setOpen(false);
    onClear();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (results.length) {
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setActive((i) => (i + d + results.length) % results.length);
      }
    } else if (e.key === 'Enter') {
      const r = results[active] ?? results[0];
      if (r) choose(r);
    } else if (e.key === 'Escape') {
      if (open) setOpen(false);
      else e.currentTarget.blur();
    }
  };

  const showList = open && query !== '' && state.kind !== 'idle';

  return (
    <div ref={rootRef} className="relative w-72 max-w-[40vw]">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2" />
      <Input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="搜尋門牌，例如 忠孝東路4段100號"
        className="h-8 pr-7 pl-8"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
      />
      {text && (
        <button
          type="button"
          onClick={clear}
          title="清除搜尋與標記"
          className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1.5 -translate-y-1/2 rounded p-0.5"
        >
          <X className="size-4" />
        </button>
      )}
      {showList && (
        <div
          id={listId}
          role="listbox"
          className="bg-popover text-popover-foreground absolute top-full right-0 left-0 z-50 mt-1 max-h-96 overflow-y-auto rounded-lg border p-1 shadow-md"
        >
          {state.kind === 'loading' && (
            <div className="text-muted-foreground flex items-center gap-2 px-2 py-1.5 text-sm">
              <Loader2 className="size-4 animate-spin" />
              搜尋中…
            </div>
          )}
          {state.kind === 'error' && (
            <div className="text-destructive px-2 py-1.5 text-sm">搜尋失敗：{state.message}</div>
          )}
          {state.kind === 'done' && results.length === 0 && (
            <div className="text-muted-foreground px-2 py-1.5 text-sm">找不到符合的門牌（只有臺北市門牌）</div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.kind}-${r.label}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(r)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                i === active && 'bg-accent text-accent-foreground',
              )}
            >
              {r.kind === 'road' ? (
                <Route className="text-muted-foreground size-4 shrink-0" />
              ) : (
                <MapPin className="text-muted-foreground size-4 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">{r.label}</span>
              {r.kind === 'road' && <span className="text-muted-foreground shrink-0 text-xs">路段</span>}
              {r.kind === 'door' && !r.exact && <span className="text-muted-foreground shrink-0 text-xs">相近</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
