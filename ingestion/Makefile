# Run from this directory. Stages execute as `python -m ingestion <stage>`
# from the repo root so the package resolves without installation.

PY ?= python3
REPO := $(abspath $(CURDIR)/..)
RUN = cd $(REPO) && $(PY) -m ingestion

.PHONY: all download filter score rescore-llm skip-rescore embed-load graph-load test

all: download filter score rescore-llm embed-load graph-load

download:
	$(RUN) download

filter:
	$(RUN) filter

score:
	$(RUN) score

rescore-llm:
	$(RUN) rescore-llm

# Mark rescore-llm done without calling any API; `make all` then no-ops it.
skip-rescore:
	$(RUN) rescore-llm --skip

embed-load:
	$(RUN) embed-load

graph-load:
	$(RUN) graph-load

test:
	cd $(REPO) && $(PY) -m unittest discover -s ingestion/tests -v
