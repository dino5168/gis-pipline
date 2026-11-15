"""PostgreSQL 連線池。

連線資訊走 libpq 標準：環境變數 PGHOST / PGPORT / PGDATABASE / PGUSER / PGPASSWORD
或 %APPDATA%\\postgresql\\pgpass.conf。密碼不寫進程式或設定檔。
未設定時預設 localhost / gis / postgres。
"""
from __future__ import annotations

import os

from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

_DEFAULTS = {"PGHOST": "localhost", "PGDATABASE": "gis", "PGUSER": "postgres"}


def _conninfo() -> str:
    parts = []
    for env, key in (("PGHOST", "host"), ("PGDATABASE", "dbname"), ("PGUSER", "user")):
        if env not in os.environ:
            parts.append(f"{key}={_DEFAULTS[env]}")
    return " ".join(parts)


pool = ConnectionPool(
    _conninfo(),
    min_size=1,
    max_size=10,
    open=False,
    kwargs={"row_factory": dict_row},
)
