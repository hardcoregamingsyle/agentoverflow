"""Tests for HTML -> text conversion, including nested code blocks."""

import unittest

from ingestion.htmltext import html_to_text


class TestHtmlToText(unittest.TestCase):
    def test_strips_inline_markup(self):
        self.assertEqual(html_to_text("<p>Hello <b>world</b></p>"), "Hello world")

    def test_unescapes_entities(self):
        self.assertEqual(html_to_text("<p>a &lt;div&gt; &amp; more</p>"), "a <div> & more")

    def test_inline_code_gets_backticks(self):
        self.assertEqual(html_to_text("<p>Use <code>x = 1</code> now</p>"),
                         "Use `x = 1` now")

    def test_nested_pre_code_yields_single_fence(self):
        html = "<p>Try:</p><pre><code>for x in y:\n    print(x)\n</code></pre>"
        self.assertEqual(html_to_text(html),
                         "Try:\n\n```\nfor x in y:\n    print(x)\n```")

    def test_pre_without_code_is_fenced_too(self):
        self.assertEqual(html_to_text("<pre>raw\n  text</pre>"),
                         "```\nraw\n  text\n```")

    def test_entities_inside_code_are_unescaped(self):
        html = "<pre><code>if a &lt; b &amp;&amp; c:\n  pass</code></pre>"
        self.assertEqual(html_to_text(html),
                         "```\nif a < b && c:\n  pass\n```")

    def test_code_containing_backtick_fence_gets_longer_fence(self):
        html = "<pre><code>say ``` here</code></pre>"
        self.assertEqual(html_to_text(html), "````\nsay ``` here\n````")

    def test_paragraphs_separated_by_blank_line(self):
        self.assertEqual(html_to_text("<p>one</p><p>two</p>"), "one\n\ntwo")

    def test_whitespace_collapsed_outside_code(self):
        self.assertEqual(html_to_text("<p>a\n\n   b</p>"), "a b")

    def test_whitespace_preserved_inside_code(self):
        html = "<pre><code>a\n\n   b</code></pre>"
        self.assertEqual(html_to_text(html), "```\na\n\n   b\n```")

    def test_list_items_become_bullets(self):
        self.assertEqual(html_to_text("<ul><li>one</li><li>two</li></ul>"),
                         "- one\n\n- two")

    def test_br_separates_words(self):
        self.assertEqual(html_to_text("<p>line1<br>line2</p>"), "line1 line2")

    def test_unterminated_pre_still_fenced(self):
        self.assertEqual(html_to_text("<pre><code>dangling"), "```\ndangling\n```")

    def test_empty_input(self):
        self.assertEqual(html_to_text(""), "")

    def test_text_after_code_block_kept(self):
        html = "<pre><code>x</code></pre><p>after</p>"
        self.assertEqual(html_to_text(html), "```\nx\n```\n\nafter")


if __name__ == "__main__":
    unittest.main()
