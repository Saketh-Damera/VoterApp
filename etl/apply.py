#!/usr/bin/env python3
"""Apply one or more SQL files to the Supabase Postgres.

Usage:
    SUPABASE_DB_URL=... python etl/apply.py path/to/migration.sql [more.sql ...]

The connection string lives in web/.env.local as SUPABASE_DB_URL. This script
auto-loads it from there if the env var isn't already set.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import psycopg2

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / "web" / ".env.local"


def load_env_from_dotfile() -> None:
    if "SUPABASE_DB_URL" in os.environ or not ENV_FILE.exists():
        return
    for raw in ENV_FILE.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


def main(paths: list[str]) -> int:
    load_env_from_dotfile()
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        print("ERROR: SUPABASE_DB_URL not set", file=sys.stderr)
        return 1
    if not paths:
        print("usage: etl/apply.py <file.sql> [...]", file=sys.stderr)
        return 1
    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            for p in paths:
                sql = Path(p).read_text()
                print(f"Applying {p} ({len(sql)} bytes)...", flush=True)
                cur.execute(sql)
                print(f"  ok", flush=True)
        conn.commit()
        print("All migrations committed.")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
