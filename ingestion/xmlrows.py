"""Typed parsing of Stack Exchange dump ``<row>`` attributes (stdlib only).

The dump XML is one giant element per file whose children are ``<row>``
elements carrying everything as string attributes. These helpers turn the
attribute dicts produced by ``xml.etree`` into small typed records, tolerating
missing or malformed attributes (the dump has plenty of optional ones).
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass

_TAG_RE = re.compile(r"<([^<>]+)>")


@dataclass(frozen=True)
class QuestionRow:
    qid: int
    title: str
    body: str
    score: int
    views: int
    tags: list[str]
    accepted_aid: int | None


@dataclass(frozen=True)
class AnswerRow:
    aid: int
    parent_qid: int
    body: str
    score: int


@dataclass(frozen=True)
class PostLinkRow:
    post_id: int
    related_id: int
    kind: int


def _to_int(attrib: Mapping[str, str], key: str) -> int | None:
    raw = attrib.get(key)
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def parse_tags(raw: str | None) -> list[str]:
    """Parse the Tags attribute in both dump formats.

    Dumps before March 2024 use ``<python><list>``; later dumps (including
    Jan 2026) use ``|python|list|``. Anything else is treated as one tag.
    """
    if not raw:
        return []
    if raw.startswith("|"):
        return [t for t in raw.split("|") if t]
    if raw.startswith("<"):
        return _TAG_RE.findall(raw)
    return [raw]


def parse_question(attrib: Mapping[str, str]) -> QuestionRow | None:
    """Return a QuestionRow for a PostTypeId=1 row, else None."""
    if attrib.get("PostTypeId") != "1":
        return None
    qid = _to_int(attrib, "Id")
    if qid is None:
        return None
    return QuestionRow(
        qid=qid,
        title=attrib.get("Title", "").strip(),
        body=attrib.get("Body", ""),
        score=_to_int(attrib, "Score") or 0,
        views=_to_int(attrib, "ViewCount") or 0,
        tags=parse_tags(attrib.get("Tags")),
        accepted_aid=_to_int(attrib, "AcceptedAnswerId"),
    )


def parse_answer(attrib: Mapping[str, str]) -> AnswerRow | None:
    """Return an AnswerRow for a PostTypeId=2 row, else None."""
    if attrib.get("PostTypeId") != "2":
        return None
    aid = _to_int(attrib, "Id")
    parent_qid = _to_int(attrib, "ParentId")
    if aid is None or parent_qid is None:
        return None
    return AnswerRow(
        aid=aid,
        parent_qid=parent_qid,
        body=attrib.get("Body", ""),
        score=_to_int(attrib, "Score") or 0,
    )


def parse_postlink(attrib: Mapping[str, str]) -> PostLinkRow | None:
    """Return a PostLinkRow, else None if any required attribute is missing."""
    post_id = _to_int(attrib, "PostId")
    related_id = _to_int(attrib, "RelatedPostId")
    kind = _to_int(attrib, "LinkTypeId")
    if post_id is None or related_id is None or kind is None:
        return None
    return PostLinkRow(post_id=post_id, related_id=related_id, kind=kind)
