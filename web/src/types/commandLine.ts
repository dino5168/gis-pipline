/** 2D 命令列（類似 AutoCAD Command 視窗） */

/** 提示中可點選的選項，例如「封閉(C)」 */
export interface CommandOption {
  /** 輸入的關鍵字（大寫），例如 'C' */
  key: string;
  label: string;
}

export interface CommandPrompt {
  /** 執行中的命令名稱；null＝等待輸入命令 */
  command: string | null;
  /** 提示文字（不含選項），例如「指定下一點或」 */
  text: string;
  options: CommandOption[];
  /** 直接按 Enter 時採用的預設值，顯示成「<4>」 */
  def?: string;
}

export interface CommandMessage {
  id: number;
  /** input：使用者輸入的回顯；info：訊息；error：錯誤 */
  kind: 'input' | 'info' | 'error';
  text: string;
}

export interface CommandLineState {
  prompt: CommandPrompt;
  messages: CommandMessage[];
  /** 有命令執行中（地圖點選改為取點） */
  active: boolean;
}

/** 命令畫出的圖形種類（＝繪圖工具的模式名稱） */
export type CommandShapeMode = 'point' | 'linestring' | 'polygon' | 'rectangle' | 'circle';

/** 已實作的命令：名稱、別名、說明（說明用於 HELP 與錯誤提示） */
export const COMMANDS: { name: string; aliases: string[]; desc: string }[] = [
  { name: 'LINE', aliases: ['L'], desc: '直線（每段獨立）' },
  { name: 'PLINE', aliases: ['PL'], desc: '聚合線（一條多點線；封閉時成為多邊形）' },
  { name: 'POLYGON', aliases: ['POL'], desc: '正多邊形（中心＋半徑或一邊）' },
  { name: 'RECTANG', aliases: ['REC', 'RECTANGLE'], desc: '矩形（兩角點或長寬）' },
  { name: 'CIRCLE', aliases: ['C'], desc: '圓（中心＋半徑／直徑、兩點、三點）' },
  { name: 'POINT', aliases: ['PO'], desc: '點（可連續放置）' },
];

/** 別名 → 命令名稱（含命令全名） */
export const COMMAND_ALIASES: Record<string, string> = Object.fromEntries(
  COMMANDS.flatMap((c) => [c.name, ...c.aliases].map((k) => [k, c.name])),
);

/** 訊息紀錄保留的筆數 */
export const COMMAND_MAX_MESSAGES = 200;

/** 提示的完整文字，例如「指定下一點或 [封閉(C)/復原(U)]」 */
export function promptText(p: CommandPrompt): string {
  const opts = p.options.length ? ` [${p.options.map((o) => `${o.label}(${o.key})`).join('/')}]` : '';
  return `${p.text}${opts}${p.def !== undefined ? ` <${p.def}>` : ''}`;
}
