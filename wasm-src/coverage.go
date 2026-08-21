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
		block := blockFromPixels(pixels, rgba, w, settings)
		// Preserve proposal geometry for camera framing. Pixels remain the
		// exclusive ownership mask used by the renderer.
		block.BBox = proposal.BBox
		block.CentroidX, block.CentroidY = proposal.CentroidX, proposal.CentroidY
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

func fullMask(width, height int) []uint8 {
	mask := make([]uint8, width*height)
	for i := range mask {
		mask[i] = 1
	}
	return mask
}
