"""Streaming access to the 7z dump archives (stdlib only).

The archives are never extracted to disk: ``7z e -so <archive>`` writes the
contained XML to stdout and ``xml.etree`` iterparse consumes it row by row in
constant memory (Posts.xml alone is ~100 GB uncompressed).
"""

from __future__ import annotations

import shutil
import subprocess
import xml.etree.ElementTree as ET
from collections.abc import Iterator
from pathlib import Path
from typing import IO


def iter_rows(stream: IO[bytes]) -> Iterator[dict[str, str]]:
    """Yield the attribute dict of every ``<row>`` element in the stream."""
    context = ET.iterparse(stream, events=("start", "end"))
    root: ET.Element | None = None
    for event, elem in context:
        if root is None:
            root = elem  # first event is the document root's start
            continue
        if event == "end" and elem.tag == "row":
            yield dict(elem.attrib)
            root.clear()  # drop finished children so memory stays flat


def stream_7z_rows(archive: Path, seven_zip: str = "7z") -> Iterator[dict[str, str]]:
    """``7z e -so archive`` piped straight into iter_rows."""
    if not archive.exists():
        raise FileNotFoundError(f"{archive} — run the download stage first")
    if shutil.which(seven_zip) is None:
        raise RuntimeError(f"{seven_zip!r} not on PATH — apt install p7zip-full")
    proc = subprocess.Popen(
        [seven_zip, "e", "-so", str(archive)],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    assert proc.stdout is not None
    try:
        yield from iter_rows(proc.stdout)
        if proc.wait() != 0:
            raise RuntimeError(
                f"7z exited with {proc.returncode} while reading {archive}; "
                f"run `7z e -so {archive} > /dev/null` to see its error output"
            )
    finally:
        if proc.poll() is None:  # consumer stopped early
            proc.kill()
            proc.wait()
