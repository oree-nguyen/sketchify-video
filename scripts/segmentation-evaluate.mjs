import { access, readFile } from 'node:fs/promises'

const annotationPath = new URL('../testdata/segmentation/annotations/editorial-instances.json', import.meta.url)
const annotation = JSON.parse(await readFile(annotationPath, 'utf8'))
const report = { fixtures: [], passed: true, errors: [] }
const root = new URL('../', import.meta.url)
const sourceWidth = Number(annotation.width ?? 1672)
const sourceHeight = Number(annotation.height ?? 941)
const decodeRle = (rle) => {
  const pixels = []
  for (let i = 0; i + 1 < rle.length; i += 2) {
    const start = Number(rle[i]); const length = Number(rle[i + 1])
    for (let offset = 0; offset < length; offset++) pixels.push(start + offset)
  }
  return pixels
}
for (const [name, fixture] of Object.entries(annotation.fixtures ?? {})) {
  const missingMasks = (fixture.objects ?? []).filter((object) => !Array.isArray(object.maskRle) || object.maskRle.length === 0).map((object) => object.id)
  const invalidObjects = []
  for (const object of fixture.objects ?? []) {
    const [x, y, w, h] = object.bbox ?? []
    const validBox = [x, y, w, h].every((value) => Number.isFinite(value)) && x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= 1 && y + h <= 1
    const rle = Array.isArray(object.maskRle) ? object.maskRle : []
    const validRle = rle.length > 0 && rle.length % 2 === 0 && rle.every((value) => Number.isInteger(value) && value >= 0)
      && decodeRle(rle).every((pixel) => pixel >= 0 && pixel < sourceWidth * sourceHeight)
    if (!validBox || !validRle) invalidObjects.push(object.id)
  }
  const item = { name, expectedCount: fixture.expectedCount, annotationCount: fixture.objects?.length ?? 0, missingMasks, invalidObjects }
  report.fixtures.push(item)
  try { await access(new URL(name, root)) } catch { report.passed = false; report.errors.push(`${name}: source fixture image missing`) }
  if (item.annotationCount !== item.expectedCount || missingMasks.length || invalidObjects.length) {
    report.passed = false
    report.errors.push(`${name}: annotation count/mask validation failed (missing=${missingMasks.length}, invalid=${invalidObjects.length})`)
  }
}
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
