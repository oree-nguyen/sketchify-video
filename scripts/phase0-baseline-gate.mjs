import { readFile } from 'node:fs/promises'

const baseline = JSON.parse(await readFile(new URL('../testdata/segmentation/baseline/a252566-fixture1.json', import.meta.url), 'utf8'))
const passed = baseline.sourceCommit === 'a252566'
  && baseline.expectedCount === 16
  && baseline.observed.objectCount !== baseline.expectedCount
  && baseline.observed.overlayCount !== baseline.expectedCount
  && baseline.passed === false
if (!passed) {
  console.error(JSON.stringify({ passed: false, reason: 'a252566 baseline must remain an explicit failure against the 16-object gate.' }, null, 2))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ passed: true, sourceCommit: baseline.sourceCommit, expectedCount: baseline.expectedCount, observedCount: baseline.observed.objectCount, reason: baseline.reason }, null, 2))
}
