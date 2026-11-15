// utl_pipe 圖徵屬性（欄位與 PostGIS 資料表、martin.yaml properties 相同）
export interface PipeProperties {
  feat_id: string | null;
  class_code: string | null;
  pipe_no: string | null;
  start_no: string | null;
  end_no: string | null;
  mgmt_unit: string | null;
  op_type: number | null;
  set_date: string | null;
  size_unit: number | null;
  dia_width: number | null;
  dia_height: number | null;
  pipe_count: number | null;
  material: string | null;
  start_dep: number | null;
  end_dep: number | null;
  pipe_len: number | null;
  pipe_type: number | null;
  use_stat: number | null;
  data_stat: number | null;
  remark: string | null;
}

/** 屬性欄位 → 中文名稱（與 PostGIS 欄位註解相同），順序即顯示順序 */
export const PIPE_LABELS: Record<keyof PipeProperties, string> = {
  feat_id: '識別碼',
  class_code: '類別碼',
  pipe_no: '管線編號',
  start_no: '起點編號',
  end_no: '終點編號',
  mgmt_unit: '管理單位',
  op_type: '作業區分',
  set_date: '設置日期',
  size_unit: '尺寸單位',
  dia_width: '管徑寬度',
  dia_height: '管徑高度',
  pipe_count: '涵管條數',
  material: '管線材料',
  start_dep: '起點埋設深度',
  end_dep: '終點埋設深度',
  pipe_len: '管線長度',
  pipe_type: '管線型態',
  use_stat: '使用狀態',
  data_stat: '資料狀態',
  remark: '備註',
};

export function formatPipeValue(key: keyof PipeProperties, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (key === 'dia_width' || key === 'dia_height') return `${v} mm`;
  if (key === 'start_dep' || key === 'end_dep' || key === 'pipe_len') return `${v} m`;
  return String(v);
}
