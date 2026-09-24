"""Export legacy PostgreSQL Session rows as immutable JSONL migration inputs.

Run with PostgreSQL peer access after Session writes have stopped:
    python3 scripts/export-postgres-sessions-to-jsonl.py DATABASE EMPTY_DIRECTORY
"""

import json
import os
from pathlib import Path
import sys

import psycopg2


INTERNAL_HEADER_KEY = "__dsh_session_persistence_postgres_inherited_event_count"


def code_units(value: str):
    raw = value.encode("utf-16-le", errors="surrogatepass")
    for index in range(0, len(raw), 2):
        yield int.from_bytes(raw[index:index + 2], "little")


def encode_segment(value: str) -> str:
    if not value:
        raise ValueError("empty Session ID")
    if value in (".", ".."):
        return "~002E" * len(value)
    return "".join(
        chr(unit) if chr(unit) in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-"
        else f"~{unit:04X}"
        for unit in code_units(value)
    )


def project_key(cwd: str) -> str:
    if not cwd:
        raise ValueError("empty Session project path")
    readable = []
    separator_run = False
    for unit in code_units(cwd):
        char = chr(unit)
        if char in "/\\:":
            if not separator_run:
                readable.append("-")
            separator_run = True
        else:
            readable.append(
                char if char != "~" and char in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-"
                else f"~{unit:04X}"
            )
            separator_run = False
    return f"--{(''.join(readable).lstrip('-') or 'root')[:251]}--"


def write_jsonl_line(output, value):
    output.write(json.dumps(value, ensure_ascii=False, separators=(",", ":")))
    output.write("\n")


def export(database: str, directory: Path):
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    session_count = 0
    event_count = 0
    with psycopg2.connect(dbname=database) as connection:
        connection.set_session(readonly=True, isolation_level="REPEATABLE READ")
        with connection.cursor() as cursor:
            cursor.execute("SELECT id, header_json FROM public.dsh_session_headers ORDER BY id")
            headers = cursor.fetchall()
            for session_id, stored_header in headers:
                header = dict(stored_header)
                if header.get("id") != session_id:
                    raise ValueError("Session ID differs from its PostgreSQL row key")
                version = header.get("version")
                if version not in (0, 3):
                    raise ValueError(f"unsupported Session generation {version}")
                header.pop(INTERNAL_HEADER_KEY, None)
                if version == 0:
                    header.pop("isSeeded", None)
                header["type"] = "session"
                header.setdefault("delegationDepth", 0)
                cwd = header.get("cwd")
                project = project_key(cwd) if isinstance(cwd, str) else "_no-cwd"
                session_dir = directory / project / encode_segment(session_id)
                session_dir.mkdir(mode=0o700, parents=True, exist_ok=False)
                filename = "session.jsonl" if version == 0 else f"session.v{version}.jsonl"
                path = session_dir / filename
                cursor.execute(
                    "SELECT seq, event_json FROM public.dsh_session_events "
                    "WHERE session_id = %s ORDER BY seq", (session_id,),
                )
                with path.open("x", encoding="utf-8") as output:
                    os.chmod(path, 0o600)
                    write_jsonl_line(output, header)
                    expected_seq = 0
                    for seq, event_json in cursor:
                        event = json.loads(event_json)
                        if seq != expected_seq or event.get("seq") != seq:
                            raise ValueError(f"noncontiguous event sequence in {session_id}")
                        write_jsonl_line(output, event)
                        event_count += 1
                        expected_seq += 1
                session_count += 1
    print(f"exported_sessions={session_count} exported_events={event_count}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: export-postgres-sessions-to-jsonl.py DATABASE EMPTY_DIRECTORY")
    export(sys.argv[1], Path(sys.argv[2]))
