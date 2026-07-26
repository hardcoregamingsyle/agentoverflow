-- AgentOverflow corpus schema (runs once on first postgres boot via
-- /docker-entrypoint-initdb.d). Matches the pinned spec exactly.
--
-- DUPLICATED ON PURPOSE: ingestion/stages/embed_load.py `_PG_SCHEMA` declares
-- the same three tables with IF NOT EXISTS. Neither copy can go. This one runs
-- before ingestion has ever happened (the api container queries `documents` on
-- boot); that one bootstraps a Postgres whose volume predates this file, since
-- docker only runs initdb scripts on an empty data volume. Change one, change
-- the other — nothing checks that they agree.

CREATE TABLE documents (
  doc_id text PRIMARY KEY,           -- "so-<questionId>" | "learning-<convexId>"
  title text NOT NULL, problem text NOT NULL, solution text NOT NULL,
  score int NOT NULL, tier text NOT NULL,   -- low|medium|gold
  source text NOT NULL,              -- stackoverflow|learning
  url text, created_at timestamptz DEFAULT now());
CREATE TABLE doc_tags  (doc_id text, tag text, PRIMARY KEY (doc_id, tag));
CREATE TABLE doc_links (src text, dst text, kind smallint, PRIMARY KEY (src, dst, kind)); -- 1=linked 3=duplicate
CREATE INDEX ON doc_tags (tag);
CREATE INDEX ON doc_links (src);
