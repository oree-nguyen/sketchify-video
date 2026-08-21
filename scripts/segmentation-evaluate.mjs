import { readFile } from 'node:fs/promises'

const annotationPath = new URL('../testdata/segmentation/annotations/editorial-instances.json', import.meta.url)
const annotation = JSON.parse(await readFile(annotationPath, 'utf8'))
const report = { fixtures: [], passed: true, errors: [] }
for (const [name, fixture] of Object.entries(annotation.fixtures ?? {})) {
  const missingMasks = (fixture.objects ?? []).filter((object) => !Array.isArray(object.maskRle) || object.maskRle.length === 0).map((object) => object.id)
  const item = { name, expectedCount: fixture.expectedCount, annotationCount: fixture.objects?.length ?? 0, missingMasks }
  report.fixtures.push(item)
  if (item.annotationCount !== item.expectedCount || missingMasks.length) { report.passed = false; report.errors.push(`${name}: complete mask annotation required (${missingMasks.length} missing)`) }
}
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
