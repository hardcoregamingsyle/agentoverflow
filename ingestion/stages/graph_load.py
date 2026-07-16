"""Stage 6 — stream PostLinks.xml into Postgres doc_links.

Streams ``7z e -so PostLinks.7z`` the same way the filter stage streams
Posts, keeps rows with LinkTypeId 1 (linked) or 3 (duplicate), and inserts
(src, dst, kind) edges as ("so-<PostId>", "so-<RelatedPostId>", kind) — but
only where BOTH endpoints already exist in documents.

Resume: inserts are ON CONFLICT DO NOTHING and the whole stream takes well
under an hour, so an interrupted run is simply replayed; a done marker in
state/graph_load.json makes completed runs no-op (delete it to force a redo).
"""

from __future__ import annotations

from ..config import Config
from ..records import doc_id
from ..state import load_state, save_state
from ..streams import stream_7z_rows
from ..xmlrows import parse_postlink

_KINDS = (1, 3)  # 1 = linked, 3 = duplicate
_INSERT_BATCH = 5_000


def run(cfg: Config) -> None:
    import psycopg  # heavy dep, lazy on purpose

    cfg.state_dir.mkdir(parents=True, exist_ok=True)
    state_path = cfg.state_dir / "graph_load.json"
    state = load_state(state_path)
    if state.get("done"):
        print("[graph-load] already done — delete state/graph_load.json to redo", flush=True)
        return

    pg = psycopg.connect(cfg.pg_dsn)
    # The kept-question ids fit in memory: a few million ints is a few hundred
    # MB, which the ingest VM has to spare — no second spill file needed.
    kept = {
        int(row[0][3:])
        for row in pg.execute("SELECT doc_id FROM documents WHERE source = 'stackoverflow'")
    }
    if not kept:
        raise SystemExit("[graph-load] documents table is empty — run embed-load first")
    print(f"[graph-load] {len(kept):,} document ids loaded", flush=True)

    seen = inserted = 0
    batch: list[tuple[str, str, int]] = []

    def flush() -> None:
        nonlocal inserted
        with pg.cursor() as cur:
            cur.executemany(
                "INSERT INTO doc_links (src, dst, kind) VALUES (%s,%s,%s) "
                "ON CONFLICT DO NOTHING",
                batch,
            )
        pg.commit()
        inserted += len(batch)
        batch.clear()

    for attrib in stream_7z_rows(cfg.archive_path(cfg.postlinks_url)):
        seen += 1
        if seen % 5_000_000 == 0:
            print(f"[graph-load] {seen:,} rows seen, {inserted:,} edges inserted", flush=True)
        link = parse_postlink(attrib)
        if link is None or link.kind not in _KINDS:
            continue
        if link.post_id in kept and link.related_id in kept:
            batch.append((doc_id(link.post_id), doc_id(link.related_id), link.kind))
            if len(batch) >= _INSERT_BATCH:
                flush()
    if batch:
        flush()
    pg.close()
    state["done"] = True
    save_state(state_path, state)
    print(f"[graph-load] done: {seen:,} rows seen, {inserted:,} edges inserted", flush=True)
