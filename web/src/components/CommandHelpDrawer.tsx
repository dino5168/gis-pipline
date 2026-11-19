// 命令列說明：從右邊彈出的 Drawer（比照 設定 → 比例尺）。
// 內容由 types/commandLine.ts 的 COMMANDS 產生；topic 指定時捲到該命令並標示。
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { cn } from '@/lib/utils';
import {
  COMMAND_GROUP_NAMES,
  COMMAND_INPUT_HELP,
  COMMAND_KEY_HELP,
  COMMANDS,
  type CommandGroup,
  type CommandInfo,
} from '../types/commandLine';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 要標示的命令名稱（null＝不指定） */
  topic: string | null;
}

const SECTION_LABEL = 'text-muted-foreground text-xs font-normal';
const GROUPS = Object.keys(COMMAND_GROUP_NAMES) as CommandGroup[];

function KeyTable({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-primary font-mono whitespace-nowrap">{k}</dt>
          <dd className="text-foreground/80">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CommandCard({ cmd, active }: { cmd: CommandInfo; active: boolean }) {
  return (
    <section
      id={`cmd-help-${cmd.name}`}
      className={cn('ring-border space-y-2 rounded-lg p-3 ring-1', active && 'ring-primary bg-primary/5 ring-2')}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-primary font-mono text-sm font-semibold">{cmd.name}</span>
        {cmd.aliases.length > 0 && (
          <span className="text-muted-foreground font-mono text-xs">{cmd.aliases.join('、')}</span>
        )}
        <span className="text-sm">{cmd.desc}</span>
      </div>
      <ol className="text-foreground/80 list-decimal space-y-0.5 pl-5 text-xs">
        {cmd.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      {cmd.options && cmd.options.length > 0 && <KeyTable rows={cmd.options} />}
      {cmd.notes?.map((n) => (
        <p key={n} className="text-muted-foreground text-xs">
          {n}
        </p>
      ))}
    </section>
  );
}

/** 視窗 → 2D 命令列：HELP（?、F1）開啟的說明面板 */
export function CommandHelpDrawer({ open, onOpenChange, topic }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);

  // 開啟或換主題時捲到該命令（Drawer 動畫開始後才有元素）
  useEffect(() => {
    if (!open || !topic) return;
    const t = window.setTimeout(() => {
      bodyRef.current?.querySelector(`#cmd-help-${topic}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 50);
    return () => window.clearTimeout(t);
  }, [open, topic]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent>
        <DrawerHeader className="flex-row items-start justify-between">
          <div>
            <DrawerTitle>命令說明</DrawerTitle>
            <DrawerDescription>2D 命令列（仿 AutoCAD）；指令不分大小寫</DrawerDescription>
          </div>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="關閉">
              <X />
            </Button>
          </DrawerClose>
        </DrawerHeader>

        <div ref={bodyRef} className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          <div className="space-y-2">
            <div className={SECTION_LABEL}>點位輸入</div>
            <KeyTable rows={COMMAND_INPUT_HELP} />
          </div>
          <div className="space-y-2">
            <div className={SECTION_LABEL}>鍵盤</div>
            <KeyTable rows={COMMAND_KEY_HELP} />
          </div>
          {GROUPS.map((g) => (
            <div key={g} className="space-y-2">
              <div className={SECTION_LABEL}>{COMMAND_GROUP_NAMES[g]}</div>
              {COMMANDS.filter((c) => c.group === g).map((c) => (
                <CommandCard key={c.name} cmd={c} active={c.name === topic} />
              ))}
            </div>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
