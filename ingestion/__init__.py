"""AgentOverflow ingestion pipeline — Stack Overflow dump -> Qdrant + Postgres.

Six stages, run as ``python -m ingestion <stage>`` from the repo root:
download, filter, score, rescore-llm, embed-load, graph-load.

Pure logic (XML row parsing, HTML->text, keep/drop decisions, scoring math)
lives in stdlib-only modules so it can be unit-tested anywhere. Heavy deps
(fastembed, qdrant-client, psycopg) are imported lazily inside the stage
functions and are only needed on the VM.
"""
