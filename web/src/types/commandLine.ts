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
  /** 目前選取的物件數（SELECT 結束後保留，MOVE 直接使用；Esc 清除） */
  selectionCount: number;
}

/** 命令畫出的圖形種類（＝繪圖工具的模式名稱） */
export type CommandShapeMode = 'point' | 'linestring' | 'polygon' | 'rectangle' | 'circle';

/** TWD97 平面坐標轉換（命令列 MOVE、ROTATE、COPY 用） */
export type XYTransform = (xy: [number, number]) => [number, number];

export type CommandGroup = 'draw' | 'modify' | 'inquiry' | 'other';

export interface CommandInfo {
  name: string;
  aliases: string[];
  group: CommandGroup;
  /** 一行說明 */
  desc: string;
  /** 操作步驟（依提示順序） */
  steps: string[];
  /** 選項：[關鍵字, 說明] */
  options?: [string, string][];
  notes?: string[];
}

export const COMMAND_GROUP_NAMES: Record<CommandGroup, string> = {
  draw: '繪製',
  modify: '修改',
  inquiry: '查詢',
  other: '其他',
};

/** 已實作的命令（HELP 說明、錯誤提示、別名都由此表產生） */
export const COMMANDS: CommandInfo[] = [
  {
    name: 'LINE',
    aliases: ['L'],
    group: 'draw',
    desc: '直線：連續指定點，每一段是獨立的兩點線',
    steps: ['指定第一點（直接按 Enter 接續上一次 LINE 的終點）', '指定下一點，可一直畫下去', 'Enter／空白結束'],
    options: [
      ['U', '復原上一段'],
      ['C', '封閉：連回第一點並結束（畫了兩段以上才可用）'],
    ],
  },
  {
    name: 'PLINE',
    aliases: ['PL'],
    group: 'draw',
    desc: '聚合線：連續指定點，結束時成為一條多點線',
    steps: ['指定起點', '指定下一點，可一直畫下去', 'Enter／空白結束（Esc 也會保留已畫的部分）'],
    options: [
      ['U', '復原上一點'],
      ['C', '封閉：成為多邊形（三點以上）'],
    ],
  },
  {
    name: 'POLYGON',
    aliases: ['POL'],
    group: 'draw',
    desc: '正多邊形',
    steps: [
      '輸入邊數（3～1024，Enter 採用預設值）',
      '指定中心點，或輸入 E 改用「邊」',
      '選擇 I 內接於圓（半徑＝中心到頂點）或 C 外切於圓（半徑＝中心到邊中點）',
      '指定半徑：輸入數值（底邊水平），或點選（決定頂點／邊中點的方向）',
    ],
    options: [
      ['E', '邊：指定一條邊的兩個端點，逆時針建出其他邊'],
      ['I', '內接於圓'],
      ['C', '外切於圓'],
    ],
  },
  {
    name: 'RECTANG',
    aliases: ['REC', 'RECTANGLE'],
    group: 'draw',
    desc: '矩形（邊沿 TWD97 X、Y 軸）',
    steps: ['指定第一個角點', '指定另一個角點（常用 @長,寬）'],
    options: [['D', '尺寸：輸入長度（東西向）、寬度（南北向），再點一下決定往哪個象限']],
  },
  {
    name: 'CIRCLE',
    aliases: ['C'],
    group: 'draw',
    desc: '圓',
    steps: ['指定圓心', '輸入半徑或點選圓上一點（Enter 採用上次的半徑）'],
    options: [
      ['D', '直徑：改輸入直徑'],
      ['2P', '兩點：直徑的兩個端點'],
      ['3P', '三點：圓上任三點（不可共線）'],
    ],
  },
  {
    name: 'POINT',
    aliases: ['PO'],
    group: 'draw',
    desc: '點：連續放置',
    steps: ['指定點，可一直放下去', 'Enter／空白結束'],
  },
  {
    name: 'SELECT',
    aliases: [],
    group: 'modify',
    desc: '選取物件，結束後保留為目前選取（黃色醒目）',
    steps: [
      '單擊圖形選取；點在空白處開始框選，再指定對角點',
      '框選由左 → 右＝視窗（整個在框內才選）；由右 → 左＝框選穿越（碰到就選）',
      'Enter／空白結束。之後 MOVE、COPY、ROTATE、ERASE 會直接使用這個選取；Esc 清除選取',
    ],
    options: [
      ['ALL', '全部'],
      ['R', '移除模式：之後點選的物件從選取中移除'],
      ['A', '加入模式（預設）'],
      ['P', '上一個選取集'],
    ],
  },
  {
    name: 'MOVE',
    aliases: ['M'],
    group: 'modify',
    desc: '移動',
    steps: ['選取物件後按 Enter（已有目前選取則略過）', '指定基準點', '指定第二點（可輸入 @dx,dy 直接給位移）'],
    options: [['ALL／R／A／P', '選取階段的選項，同 SELECT']],
  },
  {
    name: 'COPY',
    aliases: ['CO', 'CP'],
    group: 'modify',
    desc: '複製（可連續複製多份）',
    steps: [
      '選取物件後按 Enter（已有目前選取則略過）',
      '指定基準點',
      '指定第二點，每指定一點複製一份（可輸入 @dx,dy）',
      'Enter／空白結束',
    ],
    options: [
      ['U', '復原上一份複製'],
      ['ALL／R／A／P', '選取階段的選項，同 SELECT'],
    ],
  },
  {
    name: 'ROTATE',
    aliases: ['RO'],
    group: 'modify',
    desc: '旋轉',
    steps: [
      '選取物件後按 Enter（已有目前選取則略過）',
      '指定基準點（旋轉中心）',
      '輸入旋轉角度（度，逆時針為正），或點選一點（以基準點 → 該點的方向為角度）',
    ],
    options: [
      ['C', '複製：保留原物件，旋轉一份複本'],
      ['R', '參考：指定參考角度與新角度，旋轉兩者的差'],
      ['ALL／R／A／P', '選取階段的選項，同 SELECT（選取階段的 R 是移除）'],
    ],
  },
  {
    name: 'ERASE',
    aliases: ['E'],
    group: 'modify',
    desc: '刪除',
    steps: ['已有目前選取時立即刪除', '否則選取物件後按 Enter 刪除'],
    options: [['ALL／R／A／P', '選取階段的選項，同 SELECT']],
    notes: ['可在繪圖面板按「復原」找回'],
  },
  {
    name: 'MEASUREGEOM',
    aliases: ['MEA'],
    group: 'inquiry',
    desc: '幾何量測：距離、半徑、角度、面積（只量不畫，結果寫在命令列並暫時標在地圖上）',
    steps: [
      '選擇量測項目（直接按 Enter＝距離）',
      '依提示點選或輸入點位；量完回到選項提示，可接著量下一項',
      'Enter（量過之後）或 X 結束，地圖上的標註隨之清除',
    ],
    options: [
      ['D', '距離：兩點的距離、XY 平面角度（東起逆時針）、方位角（北起順時針）、ΔX、ΔY；第二點時輸入 M＝多點累計，U 復原、Enter 完成'],
      ['R', '半徑：選取圓，顯示半徑、直徑、周長、面積'],
      ['A', '角度：選取兩條線（直線、聚合線或多邊形的邊）的夾角；直接按 Enter 改為指定頂點與兩個端點'],
      ['AR', '面積：點選角點後 Enter 完成；O＝選取多邊形或圓（扣除洞）；A／S＝加入／減去模式，累計總面積'],
      ['X', '結束'],
    ],
    notes: ['距離與面積以 TWD97 平面坐標計算', '只能選繪圖工具的圖形（不含管線）'],
  },
  {
    name: 'PROFILE',
    aliases: ['PA'],
    group: 'inquiry',
    desc: '剖面分析：指定剖面線起點、終點，開啟剖面分析視窗（管線斷面圖）',
    steps: [
      '指定剖面起點 A（輸入坐標或在地圖上點選）',
      `指定剖面終點 B（可用 @dx,dy、@距離<角度；長度上限 1000 m）`,
      '完成後開啟剖面分析視窗；只有 3D 圖台時會切到並排',
    ],
    notes: ['例：PA → 304500,2770100 → @200<30', '也可從選單「分析 → 剖面分析」用滑鼠點選'],
  },
  {
    name: 'CLASH',
    aliases: ['CC'],
    group: 'inquiry',
    desc: '衝突檢核：指定規劃管線各點，開啟衝突檢核視窗（與既有管線的淨距）',
    steps: [
      '指定規劃管線起點（輸入坐標或在地圖上點選）',
      '指定下一點（可用 @dx,dy、@距離<角度、直接距離）；U＝退回上一點',
      'Enter 完成（至少 2 點；長度上限 2000 m、最多 200 點），開啟衝突檢核視窗；只有 3D 圖台時會切到並排',
    ],
    notes: [
      '例：CC → 304500,2770100 → @150<0 → @80<90 → Enter',
      '管徑、起終點管頂埋深、檢核淨距在衝突檢核視窗輸入',
      '也可從選單「分析 → 衝突檢核」用滑鼠點選',
    ],
  },
  {
    name: 'HELP',
    aliases: ['?'],
    group: 'other',
    desc: '開啟命令說明（右側面板）',
    steps: ['沒有命令時：開啟全部說明', '命令執行中輸入 HELP 或 ?：跳到目前命令的說明，命令不中斷'],
    notes: ['也可按 F1 或命令列右上角的「?」'],
  },
];

/** 點位輸入格式（HELP 共通說明） */
export const COMMAND_INPUT_HELP: [string, string][] = [
  ['地圖單擊', '直接取點'],
  ['x,y', '絕對坐標，依「設定 → 坐標系」：經緯度（經度,緯度）或 TWD97／TWD67（X,Y 公尺）'],
  ['@dx,dy', '相對上一點（公尺，東、北為正）'],
  ['@距離<角度', '相對上一點的極坐標（0° 朝東、逆時針為正）'],
  ['距離', '直接距離：沿上一點 → 滑鼠方向'],
];

/** 鍵盤操作（HELP 共通說明） */
export const COMMAND_KEY_HELP: [string, string][] = [
  ['Enter／空白', '送出；沒有輸入時＝結束命令，或重複上一個命令'],
  ['Esc', '取消命令；沒有命令時清除目前選取'],
  ['↑ ↓', '叫回之前的輸入'],
  ['F1', '開啟說明'],
  ['直接打字', '焦點在地圖上也會輸入到命令列'],
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
