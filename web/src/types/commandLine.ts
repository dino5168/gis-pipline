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

/** 已實作的命令（別名 → 命令名稱） */
export const COMMAND_ALIASES: Record<string, string> = {
  L: 'LINE',
  LINE: 'LINE',
};

/** 訊息紀錄保留的筆數 */
export const COMMAND_MAX_MESSAGES = 200;

/** 提示的完整文字，例如「指定下一點或 [封閉(C)/復原(U)]」 */
export function promptText(p: CommandPrompt): string {
  const opts = p.options.length ? ` [${p.options.map((o) => `${o.label}(${o.key})`).join('/')}]` : '';
  return `${p.text}${opts}`;
}
