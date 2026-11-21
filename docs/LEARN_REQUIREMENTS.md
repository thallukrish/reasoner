# Reasoner — Learn requirements and implementation plan

Status: Initial requirements baseline, 2026-11-21.
Source: `thallukrish/datasong`, `main/demo_v2`; destination: `thallukrish/reasoner`.
Scope: Learn/discovery only; query interpretation, query traversal, and answer generation are out of scope.

## Requirements — one line per important thought

- LeMap discovers the world's interconnected stories rather than merely cataloguing its actors and entities.
- A story is a sequence of interactions and state changes; actors and entities participate in it.
- Real-world records initially provide fragments of scenes, not an already-known workflow or screenplay.
- All demo inputs, including normalized emails and messages, enter through CSV files.
- A structural parser creates source/sheet, column, row, and value information without imposing semantic meaning.
- Structural nodes retain source identity, original values, basic inferred types, and durable provenance.
- The standard LeMap graph remains an array of nodes with `id`, `type`, `name`, `data`, and `links`.
- Each link identifies its target node and relationship, with supporting evidence and confidence where applicable.
- A local deterministic analyzer finds repeat values, cross-source matches, periodicity, amount patterns, proximity, co-occurrence, sequences, and anomalies.
- Pattern findings are compact, evidence-linked summaries rather than raw-data dumps sent to the LLM.
- The LLM interprets relevant structural metadata and findings to infer semantic entities, relations, events, and micro-stories.
- LLM annotations include descriptions, confidence, evidence references, and additional search terms or discovery hypotheses.
- New search terms feed back into local analysis to uncover more candidates without passing all rows to the LLM.
- A CSV row is an observation, not automatically a story instance or proof that an event occurred.
- Independent micro-stories can emerge before sufficient evidence exists to join them into larger stories.
- Introduce a `micro_story` graph-node type alongside existing `workflow` nodes; introduce other types only when needed.
- Repeated story episodes may establish a reusable workflow or story pattern while preserving variants and branches.
- Newly arriving records must match strong existing semantic nodes where supported, rather than creating unnecessary duplicates.
- Existing high-confidence nodes are preferred candidates but never treated as infallible identity matches.
- New evidence triggers re-evaluation of affected semantic relationships, micro-stories, descriptions, and confidence.
- Confidence for entity identity, relationship, and story interpretation is maintained independently.
- Contradictory evidence may lower confidence or split an incorrect association rather than merely increasing scores.
- Confidence changes depend on evidence changes, not on repeated LLM agreement.
- Preserve conflicting or unassigned observations so later evidence can connect or reinterpret them.
- Re-evaluate only the impacted neighborhood and propagate material changes to dependent micro-stories.
- Preserve provenance and a revision trail for learned claims and confidence changes.
- Stop an exploration direction when no material new evidence, interpretation, or unresolved hypothesis is produced.
- Learned travel episodes, such as a bus booking to Mysuru, should remain available as high-priority evidence for later queries.
- A booking is not proof of completed travel or of a preference for that mode of transportation.
- The demo must show structural discovery, deterministic patterns, semantic micro-stories, and refinement after incremental evidence.
- Use synthetic personal records for the initial demo and retain DataSong unchanged.

## Implementation sequence — one line per task

- **L0:** Harvest and test the minimal compatible graph persistence/normalization, model-call, and semantic-reconciliation utilities from DataSong `demo_v2`.
- **L1:** Implement a CSV structural adapter producing stable source, column, row, and record provenance identifiers.
- **L2:** Implement a bounded local pattern-detector registry with evidence IDs, match scores, and compact finding summaries.
- **L3:** Implement LLM semantic annotation over selected findings, with validated evidence IDs and generated search terms.
- **L4:** Implement an incremental discovery frontier that runs suggested local searches and deduplicates explored hypotheses.
- **L5:** Persist `micro_story` nodes, related events/entities, links, confidence, and supporting pattern references.
- **L6:** Implement incremental entity matching, impacted-story re-evaluation, contradiction handling, and revision logging.
- **L7:** Expose minimal Learn controls and inspectable graph/pattern/story views in a simple UI.
- **L8:** Validate first-pass and incremental discovery on synthetic bank, email, and message CSV fixtures without any query component.

## Extraction boundary

- **Reuse:** `demo_v2/server/explorer/mapPersistence.js` graph conventions, semantic model-call patterns, entity-reconciliation ideas, and workflow accumulation concepts.
- **Adapt:** Current reconciliation assumes repository-backed entity schemas; CSV-driven identity and event linking need a source-agnostic path.
- **Exclude initially:** Call-path indexers, Git runtime topology, Odoo/Moqui/Python adapters, Pass-2 executable-flow logic, Query-v4, and query UI.
- **Contract:** Keep source observations immutable and differentiate structural facts, deterministic findings, and LLM-inferred claims.
- **Acceptance:** Learning from an added ticket/email record updates existing entities and affected micro-stories without full relearning.

## Implementation status (2026-11-21)

- **Implemented:** Harvested DataSong LeMap graph conversion and normalization functions, retaining its node/link representation.
- **Implemented:** CSV source, column, and row structural nodes with stable IDs and basic column types.
- **Implemented:** Deterministic repeated-value, cross-source, periodicity, and bounded temporal-proximity findings.
- **Implemented:** Optional LLM interpretation of compact findings into evidence-backed entities, events, and micro-stories.
- **Implemented:** Semantic search-term feedback through one bounded local-search/interpretation pass.
- **Implemented:** JSON map persistence, revision history, and marking affected existing story nodes for review.
- **Implemented:** Synthetic bank, email, and message CSVs; built-in Node regression suite and GitHub Actions test workflow.
- **Pending:** Strong entity identity reconciliation and de-duplication against multiple candidate existing nodes.
- **Pending:** Automated affected-story re-interpretation, contradiction-aware confidence calibration, and evidence invalidation.
- **Pending:** Deeper temporal event/episode reconstruction, story clustering, and recurring workflow generalization.
- **Pending:** Minimal Learn UI for loading CSV and inspecting patterns, evidence, and micro-stories.
- **Excluded:** Query-v4 and goal-directed query traversal remain outside the current Learn-only milestone.

## Demo revision 3 review (2026-11-21)

- **Validated:** DeepSeek produced four semantic entity nodes, five event nodes, and three micro-story nodes from the three synthetic CSV sources.
- **Validated:** Twenty-five deterministic findings comprise two cross-source matches, nine temporal matches, two repeated values, and twelve semantic-hint searches.
- **Validated:** All 61 graph nodes have resolvable link targets in the uploaded revision-3 map.
- **Issue:** A third micro-story groups unrelated healthcare and travel messages solely through a common sender; require plot or causal continuity, not actor overlap alone.
- **Issue:** Semantic refinement creates parallel links to the same node with differing free-text relationship labels; normalize relation vocabulary and merge equivalent claims.
- **Issue:** Existing micro-stories remain marked `reviewNeeded` even after the feedback annotation pass; distinguish pending review from completed semantic review.
- **Issue:** Semantic confidence is model-reported and not yet independently calibrated from supporting and contradicting evidence.
- **Issue:** Cross-source pattern classification masks the simultaneous monthly recurrence pattern for hospital payments; permit multiple independent observations on the same records.
- **Next milestone:** Introduce story-coherence validation and normalized relation claims before expanding the demo dataset or adding query traversal.

- **Implemented (2026-11-21):** DeepSeek Learn prompt now keeps shared-actor activities in separate micro-stories unless purpose, causal/dependency, sequence, or other meaningful evidence connects them.
- **Limitation:** Prompt refinements affect future annotations but do not automatically delete pre-existing incoherent story nodes; semantic cleanup remains pending.

## Story-coherence reconciliation implementation (2026-11-21)

- **Implemented:** Added `src/learn/storyReview.js` for targeted DeepSeek reassessment of existing micro-story coherence from bounded evidence and related nodes.
- **Implemented:** Shared actors alone cannot justify an umbrella story; a meaningful purpose, dependency, temporal sequence, or causal link must support continuity.
- **Implemented:** Model-reviewed incoherent stories are retired only when a substantive decision reaches at least 0.80 stated confidence.
- **Implemented:** Retired stories remain in the graph for provenance while entity/event nodes and separately supported micro-stories remain intact.
- **Implemented:** Reviews have per-node revision history, review status, and pending/retired summary counters.
- **Implemented:** Regression tests cover shared-actor retirement, preservation of underlying evidence, and guarding low-confidence retirement.
- **Pending:** Retired stories need exclusion from active story-facing views and full identity/contradiction reconciliation remains outstanding.

## Generic semantic-claim reconciliation (implemented 2026-11-21)

- **Implemented:** Each semantic relationship has a deterministic claim ID derived from its source node, target node and normalized relationship predicate; no demo entity names appear in the reconciliation algorithm.
- **Implemented:** Existing maps are migrated in place on next Learn revision via `claimSchemaVersion: 1`; raw observations, patterns, prior links and original IDs remain available.
- **Implemented:** Incremental targeted claim review receives bounded source rows, pattern evidence, active claims and semantic-node context; applies explicit keep/retire/uncertain decisions.
- **Implemented:** A claim is retired only if the verdict has confidence >= 0.8, a substantive reason, and a valid supporting pattern ID already attached to the claim.
- **Implemented:** Retired relationships remain in the graph with status and retirement provenance; active-link consumers must filter `status !== 'retired'`.
- **Implemented:** Search terms and semantic evidence can be deactivated only as part of a supported claim retirement; their inactive values are retained for provenance.
- **Implemented:** Repeated ingestion with no new records/patterns bypasses semantic model calls and redundant story review; new relevant changes trigger review.
- **Implemented:** The targeted micro-story review now sees only active relationships and avoids domain-specific examples.
- **Tested:** Synthetic production/expense, supplier/delivery and unchanged sensor-ingest cases cover generic retirement, evidence preservation, idempotent claims, and no-op convergence.
- **Limitations:** Claim identity still depends on the supplied predicate wording; paraphrases may remain separate claims until canonical relation types/semantic equivalence are implemented.
- **Limitations:** Explicit uncertain decisions leave links active rather than deleting potentially valid evidence; future passes must revisit pending claims when meaningful evidence changes.
- **Limitations:** Semantic reconciliation is model-assisted and has not yet been validated against a live DeepSeek revision-5 map after the migration.
