// 門牌搜尋 /api/geocode 的回應型別

/** door：單一門牌；road：路段（含範圍 bbox） */
export type GeocodeKind = 'door' | 'road';

export interface GeocodeResult {
  kind: GeocodeKind;
  /** 顯示用完整地址，例如「大安區忠孝東路四段100號」 */
  label: string;
  town: string;
  road: string;
  lng: number;
  lat: number;
  /** false：不是完全相符（號碼找不到時列出最接近的，或整串模糊比對的結果） */
  exact: boolean;
  /** 路段範圍 [west, south, east, north]（kind = road 才有） */
  bbox?: [number, number, number, number];
}

export interface GeocodeResponse {
  query: string;
  normalized: string;
  method: string;
  ms: number;
  results: GeocodeResult[];
}
