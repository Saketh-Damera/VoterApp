"""
Filter NC statewide voter files to Durham County active voters and load into Supabase.

Usage:
    export SUPABASE_DB_URL='postgresql://postgres:PASSWORD@db.REF.supabase.co:5432/postgres'
    export NC_DATA_DIR='/Users/sakethdamera/Development/NC-Voter-Data'
    python3 load_nc_durham.py
"""

from __future__ import annotations

import csv
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path

import psycopg2

DATA_DIR = Path(os.environ.get("NC_DATA_DIR", "/Users/sakethdamera/Development/NC-Voter-Data"))
NCVOTER_PATH = DATA_DIR / "ncvoter_Statewide.txt"
NCVHIS_PATH = DATA_DIR / "ncvhis_Statewide.txt"

TARGET_COUNTY = "DURHAM"
ACTIVE_STATUS = "A"

VOTER_COLS = {
    "county_desc":        1,
    "voter_reg_num":      2,
    "ncid":               3,
    "last_name":          4,
    "first_name":         5,
    "middle_name":        6,
    "name_suffix":        7,
    "status_cd":          8,
    "res_street_address": 12,
    "res_city":           13,
    "res_zip":            15,
    "registr_dt":         25,
    "race_code":          26,
    "ethnic_code":        27,
    "party_cd":           28,
    "gender_code":        29,
    "birth_year":         30,
    "age":                31,
    "precinct_abbrv":     37,
    "precinct_desc":      38,
    "municipality_desc":  40,
    "ward_abbrv":         41,
    "ward_desc":          42,
}

HISTORY_COLS = {
    "election_lbl":   3,
    "election_desc":  4,
    "voting_method":  5,
    "voted_party_cd": 6,
    "ncid":           10,
}

VOTER_OUT_COLS = [
    "ncid", "voter_reg_num", "first_name", "middle_name", "last_name", "name_suffix",
    "res_street_address", "res_city", "res_zip",
    "party_cd", "gender_code", "race_code", "ethnic_code",
    "birth_year", "age", "registr_dt",
    "precinct_abbrv", "precinct_desc", "ward_abbrv", "ward_desc", "municipality_desc",
]

HISTORY_OUT_COLS = ["ncid", "election_date", "election_desc", "voting_method", "voted_party_cd"]


def parse_mdy(s: str) -> str:
    s = s.strip()
    if not s:
        return ""
    try:
        return datetime.strptime(s, "%m/%d/%Y").date().isoformat()
    except ValueError:
        return ""


def stream_tsv(path: Path):
    with path.open("r", encoding="latin-1", newline="") as f:
        reader = csv.reader(f, delimiter="\t", quotechar='"')
        next(reader, None)
        for row in reader:
            yield row


def filter_voters_to_csv(out_path: Path) -> set[str]:
    ncids: set[str] = set()
    kept = 0
    scanned = 0
    with out_path.open("w", encoding="utf-8", newline="") as out:
        writer = csv.writer(out)
        for row in stream_tsv(NCVOTER_PATH):
            scanned += 1
            if scanned % 500_000 == 0:
                print(f"  ...scanned {scanned:,} voter rows, kept {kept:,}", file=sys.stderr)
            if len(row) <= max(VOTER_COLS.values()):
                continue
            if row[VOTER_COLS["county_desc"]].strip() != TARGET_COUNTY:
                continue
            if row[VOTER_COLS["status_cd"]].strip() != ACTIVE_STATUS:
                continue
            ncid = row[VOTER_COLS["ncid"]].strip()
            if not ncid:
                continue
            ncids.add(ncid)
            kept += 1
            writer.writerow([
                ncid,
                row[VOTER_COLS["voter_reg_num"]].strip(),
                row[VOTER_COLS["first_name"]].strip(),
                row[VOTER_COLS["middle_name"]].strip(),
                row[VOTER_COLS["last_name"]].strip(),
                row[VOTER_COLS["name_suffix"]].strip(),
                row[VOTER_COLS["res_street_address"]].strip(),
                row[VOTER_COLS["res_city"]].strip(),
                row[VOTER_COLS["res_zip"]].strip(),
                row[VOTER_COLS["party_cd"]].strip(),
                row[VOTER_COLS["gender_code"]].strip(),
                row[VOTER_COLS["race_code"]].strip(),
                row[VOTER_COLS["ethnic_code"]].strip(),
                row[VOTER_COLS["birth_year"]].strip(),
                row[VOTER_COLS["age"]].strip(),
                parse_mdy(row[VOTER_COLS["registr_dt"]]),
                row[VOTER_COLS["precinct_abbrv"]].strip(),
                row[VOTER_COLS["precinct_desc"]].strip(),
                row[VOTER_COLS["ward_abbrv"]].strip(),
                row[VOTER_COLS["ward_desc"]].strip(),
                row[VOTER_COLS["municipality_desc"]].strip(),
            ])
    print(f"Voters: scanned {scanned:,}, kept {kept:,} → {out_path}", file=sys.stderr)
    if kept == 0:
        raise RuntimeError("Filtered 0 voters. Check file path and that the file is fully downloaded.")
    return ncids


def filter_history_to_csv(ncids: set[str], out_path: Path) -> int:
    kept = 0
    scanned = 0
    with out_path.open("w", encoding="utf-8", newline="") as out:
        writer = csv.writer(out)
        for row in stream_tsv(NCVHIS_PATH):
            scanned += 1
            if scanned % 2_000_000 == 0:
                print(f"  ...scanned {scanned:,} history rows, kept {kept:,}", file=sys.stderr)
            if len(row) <= max(HISTORY_COLS.values()):
                continue
            ncid = row[HISTORY_COLS["ncid"]].strip()
            if ncid not in ncids:
                continue
            election_date = parse_mdy(row[HISTORY_COLS["election_lbl"]])
            if not election_date:
                continue
            kept += 1
            writer.writerow([
                ncid,
                election_date,
                row[HISTORY_COLS["election_desc"]].strip(),
                row[HISTORY_COLS["voting_method"]].strip(),
                row[HISTORY_COLS["voted_party_cd"]].strip(),
            ])
    print(f"History: scanned {scanned:,}, kept {kept:,} → {out_path}", file=sys.stderr)
    return kept


def copy_csv_to_table(conn, csv_path: Path, table: str, cols: list[str]) -> None:
    cols_sql = ", ".join(cols)
    with conn.cursor() as cur, csv_path.open("r", encoding="utf-8") as f:
        cur.copy_expert(
            f"COPY {table} ({cols_sql}) FROM STDIN WITH (FORMAT csv)",
            f,
        )
    conn.commit()


def main() -> int:
    db_url = os.environ.get("SUPABASE_DB_URL")
    if not db_url:
        print("ERROR: set SUPABASE_DB_URL env var.", file=sys.stderr)
        return 1
    if not NCVOTER_PATH.exists() or not NCVHIS_PATH.exists():
        print(f"ERROR: expected NC files in {DATA_DIR}", file=sys.stderr)
        return 1

    print("Connecting to Postgres...", file=sys.stderr)
    conn = psycopg2.connect(db_url)

    with tempfile.TemporaryDirectory() as td:
        voters_csv = Path(td) / "voters.csv"
        history_csv = Path(td) / "history.csv"

        print("Step 1: filtering voter registration file...", file=sys.stderr)
        ncids = filter_voters_to_csv(voters_csv)

        print("Step 2: loading voters into Postgres...", file=sys.stderr)
        with conn.cursor() as cur:
            cur.execute("truncate vote_history, voters restart identity cascade")
        conn.commit()
        copy_csv_to_table(conn, voters_csv, "voters", VOTER_OUT_COLS)

        print("Step 3: filtering vote history file (~36M rows)...", file=sys.stderr)
        filter_history_to_csv(ncids, history_csv)

        print("Step 4: loading vote history...", file=sys.stderr)
        copy_csv_to_table(conn, history_csv, "vote_history", HISTORY_OUT_COLS)

        print("Step 5: refreshing voter_turnout matview...", file=sys.stderr)
        with conn.cursor() as cur:
            cur.execute("refresh materialized view voter_turnout")
        conn.commit()

    with conn.cursor() as cur:
        cur.execute("select count(*) from voters")
        vc = cur.fetchone()[0]
        cur.execute("select count(*) from vote_history")
        hc = cur.fetchone()[0]

    conn.close()
    print(f"\nDone. voters={vc:,}  vote_history={hc:,}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
