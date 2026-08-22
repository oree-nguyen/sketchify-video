# Segmentation ground truth

This directory is the only source of acceptance annotations for the complex
branch. `editorial-instances.json` stores normalized boxes, roles and
row-major start/length RLE masks for all three airport fixtures. The source
polygons are kept in `scripts/build-phase0-annotations.mjs` so regeneration is
deterministic and reviewable. A box-only draft is never accepted as a
mask-quality PASS: the evaluator fails closed when `maskRle` is missing or
contains pixels outside the source image.

The 16-instance fixture is the editorial reference from `testthuattoanmoi
(1).png`: questions, dinosaur, `99%`, `TẠI SAO`, black `MÁY BAY`, red banner,
large white aircraft, blue aircraft, tower, red/yellow aircraft, Bamboo
aircraft, and five icon-caption compounds. Coordinates are normalized to the
source image so the browser working-width resize cannot alter the annotation.
