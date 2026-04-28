#!/usr/bin/env python3
"""Apply Postgres migrations to the Supabase project.

Two modes:

    # 1. Default: apply every migration in etl/migrations/ in numeric order,
    #    skipping any version already recorded in schema_migrations.
    python3 etl/apply.py

    # 2. Apply specific files (used when iterating on a new migration).
    python3 etl/apply.py path/to/file.sql [more.sql ...]

The schema_migrations table tracks what has been applied so reruns are safe.
SUPABASE_DB_URL is auto-loaded from web/.env.local if not in the environment.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

import psycopg2

ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = ROOT / "web" / ".env.local"
MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"

VERSION_RE = re.compile(r"^(\d{4})_")


def load_env_from_dotfile() -> None:
    if "SUPABASE_DB_URL" in os.environ or not ENV_FILE.exists():
        return
    for raw in ENV_FILE.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


def ensure_tracking_table(cur) -> None:
    cur.execute("""
        create table if not exists schema_migrations (
            version    text primary key,
            filename   text not null,
            applied_at timestamptz not null default now()
        );
    """)


def applied_versions(cur) -> set[str]:
    cur.execute("select version from schema_migrations")
    return {row[0] for row in cur.fetchall()}


def discover_migrations() -> list[tuple[str, Path]]:
    if not MIGRATIONS_DIR.exists():
        return []
    items: list[tuple[str, Path]] = []
    for p in sorted(MIGRATIONS_DIR.iterdir()):
        if p.suffix.lower() != ".sql":
            continue
        m = VERSION_RE.match(p.name)
        if not m:
            print(f"  warning: {p.name} does not match NNNN_ prefix; skipping", file=sys.stderr)
            continue
        items.append((m.group(1), p))
    return items


def apply_one(cur, version: str | None, path: Path) -> None:
    sql = path.read_text()
    print(f"Applying {path} ({len(sql)} bytes)...", flush=True)
    cur.execute(sql)
    if version is not None:
        cur.execute(
            "insert into schema_migrations (version, filename) values (%s, %s) "
            "on conflict (version) do nothing",
            (version, path.name),
        )
    print("  ok", flush=True)


def main(argv: list[str]) -> int:
    load_env_from_dotfile()
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        print("ERROR: SUPABASE_DB_URL not set", file=sys.stderr)
        return 1

    conn = psycopg2.connect(db_url)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            ensure_tracking_table(cur)

            if argv:
                # Explicit file list — apply each. Track if numbered.
                for arg in argv:
                    p = Path(arg)
                    if not p.exists():
                        raise FileNotFoundError(p)
                    m = VERSION_RE.match(p.name)
                    apply_one(cur, m.group(1) if m else None, p)
                conn.commit()
                print("Done.")
                return 0

            # Discover mode: apply unapplied migrations in numeric order.
            done = applied_versions(cur)
            todo = [(v, p) for (v, p) in discover_migrations() if v not in done]
            if not todo:
                print(f"Up to date. {len(done)} migrations already applied.")
                return 0
            print(f"{len(todo)} migration(s) pending; {len(done)} already applied.")
            for version, path in todo:
                apply_one(cur, version, path)
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
