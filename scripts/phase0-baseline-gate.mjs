import { access, readFile } from 'node:fs/promises'

const baseline = JSON.parse(await readFile(new URL('../testdata/segmentation/baseline/a252566-fixture1.json', import.meta.url), 'utf8'))
const overlayUrl = new URL('../testdata/segmentation/baseline/a252566-fixture1-overlay.png', import.meta.url)
let overlayPresent = true
try { await access(overlayUrl) } catch { overlayPresent = false }
const passed = baseline.sourceCommit === 'a252566'
  && baseline.expectedCount === 16
  && baseline.observed.objectCount !== baseline.expectedCount
  && baseline.observed.overlayCount !== baseline.expectedCount
  && baseline.passed === false
  && overlayPresent
if (!passed) {
  console.error(JSON.stringify({ passed: false, overlayPresent, reason: 'a252566 baseline must remain an explicit failure against the 16-object gate and include its overlay artifact.' }, null, 2))
  process.exitCode = 1
} else {
  console.log(JSON.stringify({ passed: true, overlayPresent, sourceCommit: baseline.sourceCommit, expectedCount: baseline.expectedCount, observedCount: baseline.observed.objectCount, reason: baseline.reason }, null, 2))
}
