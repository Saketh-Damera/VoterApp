"""
One-shot backfill: re-run Claude enrichment on interactions that have notes but
no sentiment/issues/tags (usually because the Anthropic key was bad at save time).

Usage:
    export SUPABASE_DB_URL='postgresql://postgres:PASSWORD@...'
    export ANTHROPIC_API_KEY='sk-ant-...'
    python3 backfill_enrich.py
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone

import psycopg2
import urllib.request

SYSTEM_PROMPT = """You are an assistant helping a first-time local candidate turn free-text notes from voter interactions into structured intelligence.

Given the candidate's raw notes about one interaction, extract:
- issues: policy or topic concerns the voter raised
- sentiment: their stance toward the candidate
- tags: role/affiliation/network attributes about the person
- follow_up: a single concrete next step if warranted by the notes

Rules:
- Infer only what is clearly supported by the notes. Do not speculate.
- If the notes mention a spouse, teacher network, PTA, business, union, or other group — tag it.
- If the voter raised a concern or asked a question, suggest a follow-up that addresses it.
- If the notes are too sparse to act on, return follow_up: null.
- Keep issues and tags short and lowercase. Prefer existing canonical forms (education, not "educational concerns")."""

SCHEMA = {
    "type": "object",
    "properties": {
        "issues": {"type": "array", "items": {"type": "string"}},
        "sentiment": {
            "type": "string",
            "enum": ["supportive", "leaning_supportive", "undecided", "leaning_opposed", "opposed", "unknown"],
        },
        "tags": {"type": "array", "items": {"type": "string"}},
        "follow_up": {
            "type": ["object", "null"],
            "properties": {
                "days_until": {"type": "integer"},
                "action": {"type": "string"},
            },
            "required": ["days_until", "action"],
            "additionalProperties": False,
        },
    },
    "required": ["issues", "sentiment", "tags", "follow_up"],
    "additionalProperties": False,
}


def call_claude(notes: str) -> dict:
    body = {
        "model": "claude-opus-4-7",
        "max_tokens": 1024,
        "system": [{"type": "text", "text": SYSTEM_PROMPT}],
        "messages": [{"role": "user", "content": notes}],
        "output_config": {"format": {"type": "json_schema", "schema": SCHEMA}},
    }
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(body).encode(),
        headers={
            "Content-Type": "application/json",
            "x-api-key": os.environ["ANTHROPIC_API_KEY"],
            "anthropic-version": "2023-06-01",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        raise RuntimeError(f"{e.code} {e.reason}: {body[:500]}") from e
    text = next(b["text"] for b in data["content"] if b["type"] == "text")
    return json.loads(text)


def main() -> int:
    conn = psycopg2.connect(os.environ["SUPABASE_DB_URL"])
    with conn.cursor() as c:
        c.execute(
            """select id, user_id, voter_ncid, notes
               from interactions
               where notes is not null and length(notes) >= 4
                 and (sentiment is null or issues is null or tags is null)"""
        )
        rows = c.fetchall()

    print(f"Backfilling {len(rows)} interactions", file=sys.stderr)
    for (iid, user_id, ncid, notes) in rows:
        print(f"  {iid}: {notes[:60]}...", file=sys.stderr)
        try:
            analysis = call_claude(notes)
        except Exception as e:
            print(f"    FAILED: {e}", file=sys.stderr)
            continue
        with conn.cursor() as c:
            c.execute(
                """update interactions set issues=%s, sentiment=%s, tags=%s where id=%s""",
                (analysis["issues"], analysis["sentiment"], analysis["tags"], iid),
            )
            if analysis.get("follow_up") and ncid:
                due = datetime.now(timezone.utc) + timedelta(days=analysis["follow_up"]["days_until"])
                c.execute(
                    """insert into reminders (user_id, interaction_id, voter_ncid, due_at, message)
                       values (%s, %s, %s, %s, %s)""",
                    (user_id, iid, ncid, due, analysis["follow_up"]["action"]),
                )
        conn.commit()
        print(f"    → {analysis['sentiment']} / {analysis['issues']} / {analysis['tags']}", file=sys.stderr)

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
