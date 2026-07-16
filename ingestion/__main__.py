"""CLI entry point: ``python -m ingestion <stage> [--config path]``."""

from __future__ import annotations

import argparse
from pathlib import Path

from .config import load_config

_DEFAULT_CONFIG = Path(__file__).resolve().parent / "config.toml"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="python -m ingestion",
        description="AgentOverflow Stack Overflow dump ingestion pipeline.",
    )
    parser.add_argument("--config", type=Path, default=_DEFAULT_CONFIG,
                        help=f"path to config.toml (default: {_DEFAULT_CONFIG})")
    sub = parser.add_subparsers(dest="stage", required=True)
    sub.add_parser("download", help="fetch the 7z dump archives from archive.org")
    sub.add_parser("filter", help="stream Posts.xml, keep good Q&A pairs, write shards")
    sub.add_parser("score", help="heuristic 0-10 scoring, drop < 4, assign tiers")
    rescore = sub.add_parser("rescore-llm", help="optional Gemini rescoring of heuristic 8+")
    rescore.add_argument("--skip", action="store_true",
                         help="mark the stage done without calling any API")
    sub.add_parser("embed-load", help="embed and load Qdrant ao_corpus + Postgres documents")
    sub.add_parser("graph-load", help="stream PostLinks.xml into Postgres doc_links")
    args = parser.parse_args(argv)

    cfg = load_config(args.config)
    if args.stage == "download":
        from .stages import download
        download.run(cfg)
    elif args.stage == "filter":
        from .stages import filter as filter_stage
        filter_stage.run(cfg)
    elif args.stage == "score":
        from .stages import score
        score.run(cfg)
    elif args.stage == "rescore-llm":
        from .stages import rescore_llm
        rescore_llm.run(cfg, skip=args.skip)
    elif args.stage == "embed-load":
        from .stages import embed_load
        embed_load.run(cfg)
    elif args.stage == "graph-load":
        from .stages import graph_load
        graph_load.run(cfg)


if __name__ == "__main__":
    main()
