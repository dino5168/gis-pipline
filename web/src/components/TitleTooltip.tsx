import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/** 滑鼠停留多久才顯示（ms），與瀏覽器原生 title 相近但快一點 */
const SHOW_DELAY = 400;
/** 提示框與按鈕的間距（px） */
const GAP = 6;
/** 提示框與視窗邊緣的最小距離（px） */
const MARGIN = 8;
/** 暫存原本 title 的屬性名稱 */
const STASH = 'data-tip-title';

interface Tip {
  text: string;
  rect: DOMRect;
}

/**
 * 全域提示：接管所有元素的 `title`，改用系統配色（popover）＋圓角顯示。
 *
 * 滑鼠移到有 `title` 的元素上時，先把 `title` 暫存到 `data-tip-title`（避免瀏覽器原生提示同時出現），
 * 離開時還原，因此各元件照常寫 `title` 即可，不必個別包 Tooltip。
 * 停留期間 React 若更新了 `title`（例如「展開／收合」切換），會即時改寫內容。
 */
export function TitleTooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let target: HTMLElement | null = null;
    let timer: number | undefined;
    let observer: MutationObserver | null = null;

    const stash = (el: HTMLElement) => {
      const t = el.getAttribute('title');
      if (t === null) return;
      el.setAttribute(STASH, t);
      el.removeAttribute('title');
    };

    const release = () => {
      window.clearTimeout(timer);
      observer?.disconnect();
      observer = null;
      if (target) {
        const t = target.getAttribute(STASH);
        target.removeAttribute(STASH);
        // 停留期間 React 沒有重設 title 才還原
        if (t !== null && !target.hasAttribute('title')) target.setAttribute('title', t);
      }
      target = null;
      setTip(null);
    };

    const show = () => {
      if (!target || !target.isConnected) return;
      const text = target.getAttribute(STASH)?.trim();
      if (!text) return;
      setTip({ text, rect: target.getBoundingClientRect() });
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as Element | null)?.closest<HTMLElement>(`[title], [${STASH}]`) ?? null;
      if (el === target) return;
      release();
      if (!el || !el.getAttribute('title')?.trim()) return;
      target = el;
      stash(el);
      observer = new MutationObserver(() => {
        if (!target?.hasAttribute('title')) return;
        stash(target);
        setTip((cur) => (cur ? { text: target!.getAttribute(STASH) ?? '', rect: target!.getBoundingClientRect() } : cur));
      });
      observer.observe(el, { attributes: true, attributeFilter: ['title'] });
      timer = window.setTimeout(show, SHOW_DELAY);
    };

    const onOut = (e: PointerEvent) => {
      if (!target) return;
      const to = e.relatedTarget as Node | null;
      if (to && target.contains(to)) return;
      release();
    };

    // 按下、捲動、按鍵時收起（不還原 target，避免同一次停留又跳出來）
    const hide = () => {
      window.clearTimeout(timer);
      setTip(null);
    };

    document.addEventListener('pointerover', onOver, true);
    document.addEventListener('pointerout', onOut, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('wheel', hide, { capture: true, passive: true });
    window.addEventListener('blur', release);
    return () => {
      release();
      document.removeEventListener('pointerover', onOver, true);
      document.removeEventListener('pointerout', onOut, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      window.removeEventListener('wheel', hide, true);
      window.removeEventListener('blur', release);
    };
  }, []);

  // 量完提示框大小後定位：預設在下方置中，下方放不下改上方，左右不超出視窗
  useEffect(() => {
    if (!tip || !boxRef.current) {
      setPos(null);
      return;
    }
    const { width, height } = boxRef.current.getBoundingClientRect();
    const r = tip.rect;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = r.bottom + GAP;
    if (top + height > vh - MARGIN) top = Math.max(MARGIN, r.top - GAP - height);
    const left = Math.min(Math.max(MARGIN, r.left + r.width / 2 - width / 2), vw - MARGIN - width);
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={boxRef}
      role="tooltip"
      className="bg-popover text-popover-foreground ring-foreground/10 pointer-events-none fixed z-[1000] max-w-xs rounded-md px-2.5 py-1.5 text-xs leading-snug whitespace-pre-line shadow-md ring-1"
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
