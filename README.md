# Reasoner — LeMap story discovery prototype

This repository isolates LeMap's **Learn** capability. Query interpretation/traversal is not yet part of this project.

The graph serialization/conversion functions in `src/graph/lemapGraph.js` were harvested from `thallukrish/datasong/demo_v2/server/explorer/mapPersistence.js` (main); all source-specific CSV and event-discovery logic is new.

## Run

```bash
npm install
npm test
npm run demo -- demo/bank.csv
npm run demo -- demo/emails.csv demo/messages.csv
```

Set `OPENAI_API_KEY` for LLM semantic annotation; without a key, structural and local pattern discovery still run and persist. Override `REASONER_MAP` to use another file instead of `data/learn-map.json`.

## Initial architecture

1. CSV structural ingestion yields `source`, `column`, and `row` graph nodes.
2. Deterministic pattern detectors summarize repeated values, temporal proximity and cross-source matches.
3. A bounded LLM prompt receives metadata and pattern summaries, not the whole data set.
4. LLM annotations create `entity`, `event`, and `micro_story` nodes with confidence, evidence and search terms.
5. New semantic search terms trigger one bounded local feedback search and, with an LLM configured, another annotation pass.\n6. The graph and revision history persist to JSON for incremental Learn runs.

This is an **initial implementation**, not the completed Learn system. In particular, deeper multi-iteration hint expansion, entity identity disambiguation, calibrated confidence changes, source deletion/replacement, automatic impacted-story LLM re-review, and the discovery UI are still pending. `reviewNeeded` marks affected stories but does not automatically reinterpret them yet.

See [Learn requirements](docs/LEARN_REQUIREMENTS.md).
