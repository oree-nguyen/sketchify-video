import { mkdir, writeFile } from 'node:fs/promises'

const width = 1672
const height = 941

const rect = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]

// Editorial polygons are deliberately kept in source-image normalized space.
// Compound text/banner/card objects use their complete visual card bounds; thing
// objects use a conservative silhouette polygon so the target is not a pixel
// crop tied to the browser working-width resize.
const fixture1 = [
  ['questions', 'compound', [0.03, 0.01, 0.20, 0.17], rect(0.03, 0.01, 0.20, 0.17)],
  ['dinosaur', 'thing', [0.00, 0.18, 0.23, 0.79], [[0.00, 0.18], [0.11, 0.17], [0.19, 0.25], [0.23, 0.43], [0.22, 0.72], [0.25, 0.98], [0.00, 0.98]]],
  ['percent', 'text-line', [0.27, 0.16, 0.28, 0.23], rect(0.27, 0.16, 0.28, 0.23)],
  ['tai-sao', 'text-line', [0.27, 0.01, 0.20, 0.12], rect(0.27, 0.01, 0.20, 0.12)],
  ['black-may-bay', 'compound', [0.52, 0.02, 0.29, 0.13], rect(0.52, 0.02, 0.29, 0.13)],
  ['red-banner', 'compound', [0.52, 0.14, 0.35, 0.19], rect(0.52, 0.14, 0.35, 0.19)],
  ['white-aircraft', 'thing', [0.22, 0.37, 0.43, 0.45], [[0.22, 0.57], [0.28, 0.47], [0.39, 0.40], [0.56, 0.39], [0.65, 0.48], [0.65, 0.66], [0.58, 0.76], [0.45, 0.83], [0.30, 0.80], [0.23, 0.70]]],
  ['blue-aircraft', 'thing', [0.64, 0.34, 0.34, 0.19], [[0.64, 0.44], [0.70, 0.37], [0.82, 0.34], [0.98, 0.40], [0.99, 0.50], [0.82, 0.53], [0.70, 0.49]]],
  ['tower', 'thing', [0.91, 0.44, 0.09, 0.31], rect(0.91, 0.44, 0.09, 0.31)],
  ['red-yellow-aircraft', 'thing', [0.67, 0.54, 0.25, 0.18], [[0.67, 0.66], [0.72, 0.57], [0.83, 0.54], [0.92, 0.57], [0.93, 0.69], [0.82, 0.73], [0.72, 0.70]]],
  ['bamboo-aircraft', 'thing', [0.64, 0.75, 0.33, 0.22], [[0.64, 0.84], [0.73, 0.77], [0.90, 0.75], [0.97, 0.80], [0.99, 0.92], [0.83, 0.96], [0.70, 0.93]]],
  ['icon-mat-hon', 'compound', [0.08, 0.78, 0.16, 0.18], rect(0.08, 0.78, 0.16, 0.18)],
  ['icon-de-kiem-tra', 'compound', [0.22, 0.78, 0.17, 0.18], rect(0.22, 0.78, 0.17, 0.18)],
  ['icon-nhe-hon', 'compound', [0.36, 0.78, 0.17, 0.18], rect(0.36, 0.78, 0.17, 0.18)],
  ['icon-tiet-kiem', 'compound', [0.50, 0.78, 0.17, 0.18], rect(0.50, 0.78, 0.17, 0.18)],
  ['icon-de-doi-moi', 'compound', [0.64, 0.78, 0.18, 0.18], rect(0.64, 0.78, 0.18, 0.18)],
]

const fixture2 = [
  ['airport-sign', 'compound', [0.09, 0.01, 0.28, 0.21], rect(0.09, 0.01, 0.28, 0.21)],
  ['thought-bubble', 'compound', [0.00, 0.14, 0.20, 0.32], rect(0.00, 0.14, 0.20, 0.32)],
  ['dinosaur', 'thing', [0.08, 0.25, 0.27, 0.72], [[0.08, 0.47], [0.12, 0.31], [0.24, 0.25], [0.33, 0.32], [0.36, 0.61], [0.35, 0.87], [0.28, 0.97], [0.13, 0.95]]],
  ['rear-white-aircraft', 'thing', [0.34, 0.28, 0.23, 0.18], [[0.34, 0.37], [0.41, 0.30], [0.52, 0.28], [0.57, 0.35], [0.53, 0.43], [0.39, 0.43]]],
  ['middle-white-aircraft', 'thing', [0.39, 0.38, 0.31, 0.20], [[0.39, 0.49], [0.46, 0.40], [0.61, 0.38], [0.70, 0.45], [0.67, 0.54], [0.46, 0.56]]],
  ['front-white-aircraft', 'thing', [0.57, 0.29, 0.35, 0.40], [[0.57, 0.52], [0.65, 0.35], [0.78, 0.29], [0.88, 0.38], [0.92, 0.55], [0.86, 0.67], [0.68, 0.69], [0.59, 0.61]]],
  ['ho-chi-minh-inset', 'thing', [0.75, 0.04, 0.22, 0.40], [[0.76, 0.22], [0.80, 0.08], [0.92, 0.05], [0.99, 0.18], [0.97, 0.39], [0.82, 0.40]]],
  ['visit-label', 'compound', [0.84, 0.42, 0.16, 0.16], rect(0.84, 0.42, 0.16, 0.16)],
  ['today-flight-label', 'compound', [0.78, 0.60, 0.18, 0.14], rect(0.78, 0.60, 0.18, 0.14)],
  ['suitcase', 'thing', [0.34, 0.52, 0.19, 0.42], rect(0.34, 0.52, 0.19, 0.42)],
  ['boarding-pass', 'compound', [0.52, 0.75, 0.31, 0.25], rect(0.52, 0.75, 0.31, 0.25)],
]

const fixture3 = [
  ['vietnam-airlines-card', 'compound', [0.05, 0.02, 0.29, 0.22], rect(0.05, 0.02, 0.29, 0.22)],
  ['tai-sao-khac-nhau', 'text-line', [0.35, 0.00, 0.32, 0.22], rect(0.35, 0.00, 0.32, 0.22)],
  ['vietjet-card', 'compound', [0.70, 0.05, 0.25, 0.24], rect(0.70, 0.05, 0.25, 0.24)],
  ['blue-aircraft', 'thing', [0.00, 0.15, 0.38, 0.38], [[0.00, 0.29], [0.08, 0.18], [0.27, 0.15], [0.38, 0.25], [0.37, 0.42], [0.25, 0.50], [0.08, 0.48]]],
  ['red-aircraft', 'thing', [0.61, 0.15, 0.39, 0.39], [[0.61, 0.34], [0.70, 0.22], [0.91, 0.15], [1.00, 0.22], [0.99, 0.47], [0.84, 0.53], [0.68, 0.49]]],
  ['dinosaur', 'thing', [0.39, 0.30, 0.26, 0.68], [[0.39, 0.60], [0.45, 0.38], [0.55, 0.30], [0.64, 0.38], [0.65, 0.71], [0.62, 0.93], [0.47, 0.98], [0.40, 0.82]]],
  ['bamboo-aircraft', 'thing', [0.00, 0.48, 0.40, 0.33], [[0.00, 0.59], [0.11, 0.50], [0.31, 0.49], [0.40, 0.59], [0.37, 0.74], [0.23, 0.81], [0.08, 0.76]]],
  ['bamboo-label', 'compound', [0.04, 0.80, 0.28, 0.17], rect(0.04, 0.80, 0.28, 0.17)],
  ['whiteboard', 'thing', [0.66, 0.50, 0.27, 0.31], rect(0.66, 0.50, 0.27, 0.31)],
  ['white-label', 'compound', [0.64, 0.78, 0.28, 0.20], rect(0.64, 0.78, 0.28, 0.20)],
]

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)) }

function polygonMaskRle(polygon) {
  const points = polygon.map(([x, y]) => [clamp(Math.round(x * (width - 1)), 0, width - 1), clamp(Math.round(y * (height - 1)), 0, height - 1)])
  const rle = []
  for (let y = 0; y < height; y++) {
    const intersections = []
    for (let i = 0; i < points.length; i++) {
      const [x1, y1] = points[i]
      const [x2, y2] = points[(i + 1) % points.length]
      if (y1 === y2) continue
      const low = Math.min(y1, y2), high = Math.max(y1, y2)
      if (y < low || y >= high) continue
      intersections.push(Math.round(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)))
    }
    intersections.sort((a, b) => a - b)
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const start = clamp(Math.min(intersections[i], intersections[i + 1]), 0, width - 1)
      const end = clamp(Math.max(intersections[i], intersections[i + 1]), 0, width - 1)
      if (end >= start) rle.push(start + y * width, end - start + 1)
    }
  }
  return rle
}

function materialize(definitions, expectedCount) {
  return {
    width,
    height,
    expectedCount,
    objects: definitions.map(([id, role, bbox, polygon]) => ({
      id,
      role,
      bbox,
      maskRle: polygonMaskRle(polygon),
    })),
  }
}

const output = {
  schemaVersion: 2,
  coordinateSpace: 'normalized',
  maskEncoding: 'row-major-start-length-rle',
  annotationSource: 'editorial polygon trace in source-image coordinates',
  fixtures: {
    'testthuattoanmoi (1).png': materialize(fixture1, 16),
    'testthuattoanmoi (2).png': materialize(fixture2, 11),
    'testthuattoanmoi (3).png': materialize(fixture3, 10),
  },
}

await mkdir(new URL('../testdata/segmentation/annotations/', import.meta.url), { recursive: true })
await writeFile(new URL('../testdata/segmentation/annotations/editorial-instances.json', import.meta.url), `${JSON.stringify(output, null, 2)}\n`)
