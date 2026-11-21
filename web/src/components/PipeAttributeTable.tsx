import { PIPE_LABELS, formatPipeValue, type PipeProperties } from '../types/pipe';

interface Props {
  /** 標題（管線種類名稱） */
  title: string;
  id: string | number;
  props: Partial<PipeProperties>;
}

type Key = keyof PipeProperties;

/**
 * 依性質分組，每列左右各一個欄位（成對的放同一列，例如管徑寬度／高度、起點／終點）。
 * 新增欄位時要加進這裡，否則不會顯示。
 */
const GROUPS: [Key, Key][][] = [
  // 編號與管理
  [
    ['feat_id', 'class_code'],
    ['pipe_no', 'mgmt_unit'],
    ['start_no', 'end_no'],
    ['set_date', 'op_type'],
  ],
  // 尺寸與埋設
  [
    ['dia_width', 'dia_height'],
    ['size_unit', 'pipe_count'],
    ['material', 'pipe_len'],
    ['start_dep', 'end_dep'],
  ],
  // 狀態
  [
    ['pipe_type', 'use_stat'],
    ['data_stat', 'remark'],
  ],
];

const TH = 'py-0.5 pr-2.5 text-left align-top font-medium whitespace-nowrap text-muted-foreground';

/** 管線屬性表（顯示在地圖彈出視窗內，React 會自動跳脫字串）；分左右 2 排、依性質分組 */
export function PipeAttributeTable({ title, id, props }: Props) {
  return (
    <table className="border-collapse text-xs text-popover-foreground">
      <caption className="pr-6 pb-1.5 text-left text-[0.8125rem] font-semibold">{title} #{id}</caption>
      {GROUPS.map((rows, g) => (
        // 組與組之間加分隔線
        <tbody key={g} className={g > 0 ? 'border-t border-border [&>tr:first-child>*]:pt-1.5' : undefined}>
          {rows.map(([l, r]) => (
            <tr key={l}>
              <th className={TH}>{PIPE_LABELS[l]}</th>
              <td className="py-0.5 pr-5 align-top break-all">{formatPipeValue(l, props[l])}</td>
              <th className={`${TH} border-l border-border pl-3`}>{PIPE_LABELS[r]}</th>
              <td className="py-0.5 align-top break-all">{formatPipeValue(r, props[r])}</td>
            </tr>
          ))}
        </tbody>
      ))}
    </table>
  );
}
