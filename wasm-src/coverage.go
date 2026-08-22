package main

// ExclusiveObjectBlocks is the ownership gate for the complex branch.  The
// proposal stage may produce overlapping hypotheses, but a renderer must have
// exactly one owner for every object pixel.  The proposal bbox is retained for
// camera framing while Pixels is made exclusive for drawing.
func ExclusiveObjectBlocks(proposals []Block, rgba []byte, w, h int, settings Settings) []Block {
	owner := make([]bool, w*h)
	out := make([]Block, 0, len(proposals))
	for _, proposal := range proposals {
		pixels := make([]int, 0, len(proposal.Pixels))
		for _, pixel := range proposal.Pixels {
			if pixel < 0 || pixel >= len(owner) || owner[pixel] {
				continue
			}
			owner[pixel] = true
			pixels = append(pixels, pixel)
		}
		if len(pixels) < settings.MinBlockInk {
			continue
		}
		// BBox and centroid are derived from the final exclusive mask. Proposal
		// geometry is evidence for graph selection, never an ownership shortcut.
		block := blockFromPixels(pixels, rgba, w, settings)
		block.Kind = proposal.Kind
		out = append(out, block)
	}
	for i := range out {
		out[i].ID = i
	}
	return out
}

// ResidualCoveragePixels is deliberately not promoted to an editorial block.
// It is a separate draw layer so background, shadows and texture can still be
// rendered without falsely claiming they are semantic objects.
func ResidualCoveragePixels(blocks []Block, w, h int) []int {
	owned := make([]bool, w*h)
	for _, block := range blocks {
		for _, pixel := range block.Pixels {
			if pixel >= 0 && pixel < len(owned) {
				owned[pixel] = true
			}
		}
	}
	residual := make([]int, 0)
	for pixel, isOwned := range owned {
		if !isOwned {
			residual = append(residual, pixel)
		}
	}
	return residual
}

// OwnershipStats is the WASM-side reconstruction gate.  Object masks and the
// residual coverage mask must partition the source image exactly once; a
// count-only check is not sufficient because overlaps can hide missing pixels.
type OwnershipStats struct {
	Duplicate int
	Missing   int
	Invalid   int
}

func CheckOwnership(blocks []Block, coverage []int, totalPixels int) OwnershipStats {
	owner := make([]uint8, totalPixels)
	stats := OwnershipStats{}
	claim := func(pixel int) {
		if pixel < 0 || pixel >= totalPixels {
			stats.Invalid++
			return
		}
		if owner[pixel] != 0 {
			stats.Duplicate++
			return
		}
		owner[pixel] = 1
	}
	for _, block := range blocks {
		for _, pixel := range block.Pixels {
			claim(pixel)
		}
	}
	for _, pixel := range coverage {
		claim(pixel)
	}
	for _, claimed := range owner {
		if claimed == 0 {
			stats.Missing++
		}
	}
	return stats
}

func fullMask(width, height int) []uint8 {
	mask := make([]uint8, width*height)
	for i := range mask {
		mask[i] = 1
	}
	return mask
}
