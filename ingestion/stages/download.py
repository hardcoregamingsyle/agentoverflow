"""Stage 1 — download the three dump archives from archive.org.

aria2c (16 connections, resumable via its control file) is preferred; wget -c
is the fallback. A ``<name>.done`` marker next to each archive records
completion, so re-running skips finished files and continues partial ones.
"""

from __future__ import annotations

import shutil
import subprocess

from ..config import Config


def run(cfg: Config) -> None:
    cfg.dumps_dir.mkdir(parents=True, exist_ok=True)
    for url in (cfg.posts_url, cfg.postlinks_url, cfg.tags_url):
        name = url.rsplit("/", 1)[1]
        dest = cfg.dumps_dir / name
        marker = cfg.dumps_dir / (name + ".done")
        if marker.exists():
            print(f"[download] {name}: already complete", flush=True)
            continue
        if shutil.which("aria2c"):
            cmd = [
                "aria2c", "-c",
                f"-x{cfg.aria2_connections}", f"-s{cfg.aria2_connections}",
                "-d", str(cfg.dumps_dir), "-o", name, url,
            ]
        elif shutil.which("wget"):
            cmd = ["wget", "-c", "-O", str(dest), url]
        else:
            raise RuntimeError("neither aria2c nor wget on PATH — install one")
        print(f"[download] {name}: {' '.join(cmd)}", flush=True)
        subprocess.run(cmd, check=True)
        marker.touch()
        print(f"[download] {name}: done", flush=True)
