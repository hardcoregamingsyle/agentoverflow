"""HTML -> plain text for Stack Overflow post bodies (stdlib only).

Strips markup and normalizes whitespace, with two exceptions pinned by the
ingestion contract:

* ``<pre>`` blocks (with or without a nested ``<code>``) become fenced
  ``` blocks with their internal whitespace preserved — a nested
  ``<pre><code>`` pair produces exactly one fence;
* inline ``<code>`` (outside ``<pre>``) is wrapped in single backticks.

Block-level tags separate paragraphs with a blank line and ``<li>`` items are
rendered as ``- `` bullets. Entities are unescaped everywhere, including
inside code.
"""

from __future__ import annotations

from html.parser import HTMLParser

_BLOCK_TAGS = {
    "blockquote", "div", "h1", "h2", "h3", "h4", "h5", "h6",
    "hr", "li", "ol", "p", "table", "tr", "ul",
}


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._blocks: list[str] = []
        self._parts: list[str] = []
        self._pre_parts: list[str] = []
        self._pre_depth = 0

    def _flush_paragraph(self) -> None:
        text = " ".join("".join(self._parts).split())
        self._parts = []
        if text and text != "-":
            self._blocks.append(text)

    def _flush_pre(self) -> None:
        content = "".join(self._pre_parts).strip("\n")
        self._pre_parts = []
        fence = "```"
        while fence in content:  # code that itself contains ``` needs a longer fence
            fence += "`"
        self._blocks.append(f"{fence}\n{content}\n{fence}")

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "pre":
            if self._pre_depth == 0:
                self._flush_paragraph()
            self._pre_depth += 1
        elif self._pre_depth:
            return  # markup inside <pre> is dropped, its text kept verbatim
        elif tag == "code":
            self._parts.append("`")
        elif tag == "br":
            self._parts.append("\n")
        elif tag in _BLOCK_TAGS:
            self._flush_paragraph()
            if tag == "li":
                self._parts.append("- ")

    def handle_endtag(self, tag: str) -> None:
        if tag == "pre":
            if self._pre_depth:
                self._pre_depth -= 1
                if self._pre_depth == 0:
                    self._flush_pre()
        elif self._pre_depth:
            return
        elif tag == "code":
            self._parts.append("`")
        elif tag in _BLOCK_TAGS:
            self._flush_paragraph()

    def handle_data(self, data: str) -> None:
        (self._pre_parts if self._pre_depth else self._parts).append(data)

    def text(self) -> str:
        if self._pre_depth:  # unterminated <pre> at EOF
            self._pre_depth = 0
            self._flush_pre()
        self._flush_paragraph()
        return "\n\n".join(self._blocks)


def html_to_text(html: str) -> str:
    """Convert an SO post body to plain text with fenced code blocks."""
    parser = _TextExtractor()
    parser.feed(html)
    parser.close()
    return parser.text()
