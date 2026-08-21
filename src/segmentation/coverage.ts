import { decodeMaskRle, encodeMaskRle } from './contracts'

/** Pixel ownership invariant used before constructing DrawUnitV2. */
export function buildResidualCoverage(totalPixels: number, ownedMasks: readonly Uint32Array[]): Uint32Array {
  const owned = new Uint8Array(Math.max(0, totalPixels))
  for (const mask of ownedMasks) for (const pixel of decodeMaskRle(mask)) if (pixel >= 0 && pixel < owned.length) owned[pixel] = 1
  const residual: number[] = []
  for (let pixel = 0; pixel < owned.length; pixel++) if (!owned[pixel]) residual.push(pixel)
  return encodeMaskRle(residual)
}
