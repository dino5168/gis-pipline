import { PIPE_LABELS, formatPipeValue, type PipeProperties } from '../types/pipe';

interface Props {
  /** 標題（管線種類名稱） */
  title: string;
  id: string | number;
  props: Partial<PipeProperties>;
}

/** 管線屬性表（顯示在地圖彈出視窗內，React 會自動跳脫字串） */
export function PipeAttributeTable({ title, id, props }: Props) {
  const keys = Object.keys(PIPE_LABELS) as (keyof PipeProperties)[];
  return (
    <table className="border-collapse text-xs text-slate-900">
      <caption className="pb-1.5 text-left text-[13px] font-semibold">{title} #{id}</caption>
      <tbody>
        {keys.map((k) => (
          <tr key={k}>
            <th className="whitespace-nowrap py-0.5 pr-2.5 text-left align-top font-medium text-slate-500">
              {PIPE_LABELS[k]}
            </th>
            <td className="break-all py-0.5">{formatPipeValue(k, props[k])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
