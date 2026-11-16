import type { ReactNode } from 'react';

/** 面板中的一個區段：小標題＋內容 */
export function PanelSection({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-muted-foreground flex items-center gap-1.5 text-xs font-semibold [&_svg]:size-3.5">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

/** 黃色提示框（shadcn Alert 只有 default／destructive，這裡補一個警告樣式） */
export const WARNING_ALERT =
  'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200';
