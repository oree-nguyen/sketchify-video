# Phase 0 baseline

`a252566-fixture1.json` records the observed result of the historical
`a252566` complex-cascade run against `testthuattoanmoi (1).png`. The result
is intentionally failing: 61 predicted blocks/overlays versus the 16-object
editorial annotation. It is kept as a regression baseline; later changes must
not rewrite it to make a gate pass.

`a252566-fixture1-overlay.png` is the replay overlay generated from the
`a252566` source tree and the original fixture at the Go test working width
(960px). The JSON retains the browser observation of 61 proposals; the replay
artifact is kept separately so the repository contains a deterministic visual
baseline without pretending that both runs used identical resize settings.
