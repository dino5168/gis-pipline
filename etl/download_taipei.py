# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""
臺北市資料大平臺（data.taipei）「臺北市公共管線圖資_*」資料集下載程式。

用法：
    uv run download_taipei.py [選項]

選項：
    --out <目錄>        下載目錄（預設 C:\\1-創業\\地理資訊應用\\99-Data）
    --qs <關鍵字>       搜尋關鍵字（預設「臺北市公共管線圖資」）
    --prefix <字串>     只保留標題以此開頭的資料集（預設「臺北市公共管線圖資_」）
    --match <正規式>    再以標題過濾，例如 --match "管線$" 只抓管線、--match "自來水"
    --list              只列出資料集與檔案大小，不下載
    --force             已存在且大小相同的檔案也重新下載

說明：
- 搜尋 API：POST /api/v2/frontstage/tpeod/dataset.search（網站前端用的，非公開文件，改版可能失效）。
- 明細 API：GET  /api/frontstage/tpeod/dataset.view?id=<pid>，resources 內有檔名、大小、更新時間。
- 下載：    GET  /api/frontstage/tpeod/dataset/resource.download?rid=<rid>
- 每個資料集一個資料夾：<out>\\<資料集標題>\\<檔名>，另存 metadata.json（資料集說明、欄位、更新時間）。
- 已存在且大小與平臺記載相同的檔案會跳過（可續傳整批）；下載先寫 .part，完成並核對大小後才改名。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

BASE = "https://data.taipei"
SEARCH_URL = f"{BASE}/api/v2/frontstage/tpeod/dataset.search"
VIEW_URL = f"{BASE}/api/frontstage/tpeod/dataset.view?id={{pid}}"
DOWNLOAD_URL = f"{BASE}/api/frontstage/tpeod/dataset/resource.download?rid={{rid}}"
DEFAULT_OUT = r"C:\1-創業\地理資訊應用\99-Data"
UA = "Mozilla/5.0 (pipeline-data-downloader)"
PAGE_LIMIT = 100
RETRIES = 3


def _request(url: str, data: dict | None = None, timeout: int = 60):
    body = None
    headers = {"User-Agent": UA, "Accept": "application/json"}
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(url, data=body, headers=headers)
    return urllib.request.urlopen(req, timeout=timeout)


def get_json(url: str, data: dict | None = None) -> dict:
    for attempt in range(1, RETRIES + 1):
        try:
            with _request(url, data) as resp:
                obj = json.load(resp)
            if not obj.get("success"):
                raise RuntimeError(f"API 回傳失敗：{obj.get('s_message') or obj}")
            return obj["payload"]
        except Exception as e:  # noqa: BLE001
            if attempt == RETRIES:
                raise
            print(f"  ! {e}，{attempt * 3} 秒後重試", file=sys.stderr)
            time.sleep(attempt * 3)
    raise AssertionError("unreachable")


def search_datasets(qs: str) -> list[dict]:
    results: list[dict] = []
    page = 1
    while True:
        payload = get_json(SEARCH_URL, {
            "page_num": page,
            "page_limit": PAGE_LIMIT,
            "qs": qs,
            "sort": "_score_desc",
            "post_filter": {"type": ["dataset"]},
        })
        batch = payload.get("search_result") or []
        results.extend(batch)
        if not batch or len(results) >= payload.get("search_count", 0):
            break
        page += 1
    return results


def safe_name(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]', "_", name).strip().rstrip(".")


def download(url: str, dest: Path, expected: int | None) -> int:
    part = dest.with_name(dest.name + ".part")
    for attempt in range(1, RETRIES + 1):
        try:
            done = 0
            t0 = time.time()
            with _request(url, timeout=120) as resp, open(part, "wb") as f:
                total = expected or int(resp.headers.get("Content-Length") or 0)
                while chunk := resp.read(1 << 20):
                    f.write(chunk)
                    done += len(chunk)
                    if total:
                        mb_s = done / 1048576 / max(time.time() - t0, 1e-6)
                        print(f"\r    {done / 1048576:8.1f} / {total / 1048576:.1f} MB  {mb_s:5.1f} MB/s",
                              end="", flush=True)
            print()
            if expected and done != expected:
                raise RuntimeError(f"大小不符：下載 {done}，平臺記載 {expected}")
            part.replace(dest)
            return done
        except Exception as e:  # noqa: BLE001
            print(f"\n  ! {e}", file=sys.stderr)
            if attempt == RETRIES:
                part.unlink(missing_ok=True)
                raise
            time.sleep(attempt * 5)
    raise AssertionError("unreachable")


def main() -> int:
    ap = argparse.ArgumentParser(description="下載臺北市資料大平臺的公共管線圖資")
    ap.add_argument("--out", default=DEFAULT_OUT)
    ap.add_argument("--qs", default="臺北市公共管線圖資")
    ap.add_argument("--prefix", default="臺北市公共管線圖資_")
    ap.add_argument("--match", default=None)
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    sys.stdout.reconfigure(encoding="utf-8")  # Windows 主控台中文
    out = Path(args.out)

    found = search_datasets(args.qs)
    datasets = [d for d in found if d["title"].startswith(args.prefix)]
    if args.match:
        datasets = [d for d in datasets if re.search(args.match, d["title"])]
    # 同一資料集可能重複出現，以 pid 去重
    datasets = list({d["pid"]: d for d in datasets}.values())
    datasets.sort(key=lambda d: d["title"])
    print(f"搜尋「{args.qs}」共 {len(found)} 筆，符合條件 {len(datasets)} 個資料集\n")

    total_files = total_bytes = skipped = downloaded = 0
    failed: list[str] = []
    for i, d in enumerate(datasets, 1):
        view = get_json(VIEW_URL.format(pid=d["pid"]))
        resources = view.get("resources") or []
        size = sum(r.get("size") or 0 for r in resources)
        print(f"[{i}/{len(datasets)}] {d['title']}  ({len(resources)} 檔, {size / 1048576:.1f} MB)")
        total_files += len(resources)
        total_bytes += size
        if args.list:
            for r in resources:
                print(f"    {r.get('file_name')}  {(r.get('size') or 0) / 1048576:.1f} MB  {r.get('last_modified')}")
            continue

        folder = out / safe_name(d["title"])
        folder.mkdir(parents=True, exist_ok=True)
        meta = {k: view.get(k) for k in (
            "pid", "name", "title", "description", "org_name", "update_freq_desc",
            "license_name", "publish_date", "metadata_changed", "changed", "notes")}
        meta["source_url"] = f"{BASE}/dataset/detail?id={d['pid']}"
        meta["downloaded_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
        meta["resources"] = [{k: r.get(k) for k in (
            "rid", "name", "file_name", "file_format", "encoding", "size", "last_modified", "field_desc")}
            for r in resources]
        (folder / "metadata.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

        for r in resources:
            fname = safe_name(r.get("file_name") or f"{r['rid']}.{(r.get('file_format') or 'bin').lower()}")
            dest = folder / fname
            expected = r.get("size") or None
            if dest.exists() and not args.force and (expected is None or dest.stat().st_size == expected):
                print(f"    = {fname} 已存在，跳過")
                skipped += 1
                continue
            print(f"    ↓ {fname}")
            try:
                download(DOWNLOAD_URL.format(rid=r["rid"]), dest, expected)
                downloaded += 1
            except Exception as e:  # noqa: BLE001
                failed.append(f"{d['title']} / {fname}：{e}")

    print(f"\n合計 {len(datasets)} 個資料集、{total_files} 個檔案、{total_bytes / 1048576:.1f} MB")
    if not args.list:
        print(f"下載 {downloaded}、跳過 {skipped}、失敗 {len(failed)}")
        for f in failed:
            print(f"  ✗ {f}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
