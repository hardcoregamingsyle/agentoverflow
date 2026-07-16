"""Tests for the incremental XML row reader (fed from memory, no 7z)."""

import unittest
from io import BytesIO

from ingestion.streams import iter_rows


class TestIterRows(unittest.TestCase):
    def test_yields_attribute_dicts_with_entities_unescaped(self):
        xml = (b'<?xml version="1.0" encoding="utf-8"?>\n'
               b'<posts>\n'
               b'  <row Id="1" Body="&lt;p&gt;hi&lt;/p&gt;" />\n'
               b'  <row Id="2" />\n'
               b'</posts>')
        rows = list(iter_rows(BytesIO(xml)))
        self.assertEqual(rows, [{"Id": "1", "Body": "<p>hi</p>"}, {"Id": "2"}])

    def test_many_rows_stream_through(self):
        body = b"".join(b'<row Id="%d"/>' % i for i in range(10_000))
        rows = iter_rows(BytesIO(b"<posts>" + body + b"</posts>"))
        self.assertEqual(sum(1 for _ in rows), 10_000)

    def test_non_row_elements_ignored(self):
        xml = b'<posts><meta>x</meta><row Id="1"/></posts>'
        self.assertEqual(list(iter_rows(BytesIO(xml))), [{"Id": "1"}])


if __name__ == "__main__":
    unittest.main()
