# Segmentation ground truth

This directory is the only source of acceptance annotations for the complex
branch. `editorial-instances.json` stores normalized boxes and roles for the
the first airport fixture; fixtures 2 and 3 remain an explicit annotation task
and are not silently substituted. Masks are intentionally represented as RLE
arrays once they have been traced by a human annotator. A box-only draft is
never accepted as a mask-quality PASS: the evaluator fails closed when
`maskRle` is missing.

The 16-instance fixture is the editorial reference from `testthuattoanmoi
(1).png`: questions, dinosaur, `99%`, `TẠI SAO`, black `MÁY BAY`, red banner,
large white aircraft, blue aircraft, tower, red/yellow aircraft, Bamboo
aircraft, and five icon-caption compounds. Coordinates are normalized to the
source image so the browser working-width resize cannot alter the annotation.
