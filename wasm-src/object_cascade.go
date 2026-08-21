package main

import (
	"math"
	"sort"
)

// objectProposal is an object-level hypothesis produced by one of the
// independent cues.  The complex-background pipeline intentionally keeps
// proposal generation separate from pixel ownership: proposals may overlap,
// while the final DrawUnit partition may not.
type objectProposal struct {
	block Block
	score float64
	cue   string
}

// CombinedObjectBlocks combines three complementary signals:
//  1. spectral-residual peaks (attention, robust to colour changes),
//  2. globally quantized colour components (closed object surfaces), and
//  3. Sobel edge support (text and object outlines).
//
// It is used only by the complex-background branch.  The standard/white
// background CCL path does not call this function and remains byte-for-byte
// unchanged.
func CombinedObjectBlocks(rgba []byte, w, h int, _ []uint8, saliency []uint8, settings Settings) []Block {
	if w < 1 || h < 1 || len(rgba) < w*h*4 || len(saliency) < w*h {
		return nil
	}
	edges := SobelMagnitude(Gray(rgba), w, h)
	proposals := make([]objectProposal, 0, 96)

	// Global colour clustering happens before spatial CCL.  This preserves the
	// anti-chaining guarantee required by the photo pipeline while exposing
	// complete aeroplane/text/tower silhouettes missed by a single saliency map.
	samples := make([]Color, 0, minInt(30000, w*h))
	stride := maxInt(1, w*h/30000)
	for pixel := 0; pixel < w*h; pixel += stride {
		offset := pixel * 4
		samples = append(samples, Color{int(rgba[offset]), int(rgba[offset+1]), int(rgba[offset+2])})
	}
	palette := MedianCut(samples, maxInt(8, minInt(16, settings.CascadeColorClusters+4)))
	codes := make([]uint8, w*h)
	for pixel := range codes {
		offset := pixel * 4
		codes[pixel] = uint8(nearest(Color{int(rgba[offset]), int(rgba[offset+1]), int(rgba[offset+2])}, palette) + 1)
	}
	for paletteIndex := range palette {
		mask := make([]uint8, w*h)
		for pixel, code := range codes {
			if int(code) == paletteIndex+1 {
				mask[pixel] = 1
			}
		}
		// A 2 px close joins anti-aliased surfaces but is far below the old
		// mergeRadius behaviour and cannot bridge separate large objects.
		closed := ErodeSquare(DilateSquare(mask, w, h, 2), w, h, 2)
		_, components := Components(closed, w, h)
		for _, component := range components {
			if len(component) < settings.MinBlockInk*2 {
				continue
			}
			// Keep only source pixels of this global colour.  Morphology decides
			// connectivity; it never steals pixels from a neighbouring colour.
			pixels := make([]int, 0, len(component))
			for _, pixel := range component {
				if int(codes[pixel]) == paletteIndex+1 {
					pixels = append(pixels, pixel)
				}
			}
			if len(pixels) < settings.MinBlockInk {
				continue
			}
			block := blockFromPixels(pixels, rgba, w, settings)
			if validObjectProposal(block, w, h, settings.MinBlockInk) {
				proposals = append(proposals, objectProposal{block: block, cue: "colour"})
			}
		}
	}

	// Reassemble letters/words before ranking. This operates on proposal
	// geometry only and therefore cannot connect unrelated image pixels.
	colourBlocks := make([]Block, 0, len(proposals))
	for _, proposal := range proposals {
		if proposal.cue == "colour" {
			colourBlocks = append(colourBlocks, proposal.block)
		}
	}
	for _, block := range MergeTextBlocks(colourBlocks, rgba, w, h) {
		unchanged := false
		for _, source := range colourBlocks {
			if block.BBox == source.BBox && len(block.Pixels) == len(source.Pixels) {
				unchanged = true
				break
			}
		}
		if !unchanged && validObjectProposal(block, w, h, settings.MinBlockInk) {
			proposals = append(proposals, objectProposal{block: block, cue: "text"})
		}
	}
	// Saliency is deliberately used as an objectness vote rather than as a
	// Voronoi owner. The former implementation's nearest-peak ownership was the
	// source of the large arbitrary regions crossing several real objects.
	// Colour CCL supplies the closed spatial hypotheses; saliency and Sobel
	// independently rank those hypotheses below.

	for i := range proposals {
		proposals[i].score = proposalObjectness(proposals[i], proposals, saliency, edges, w, h)
	}
	sort.SliceStable(proposals, func(i, j int) bool { return proposals[i].score > proposals[j].score })

	selected := make([]objectProposal, 0, 24)
	accept := func(candidate objectProposal) bool {
		if len(selected) >= 24 {
			return false
		}
		duplicate := false
		for _, accepted := range selected {
			intersection := rectIntersectionArea(candidate.block.BBox, accepted.block.BBox)
			if intersection == 0 {
				continue
			}
			union := candidate.block.BBox.W*candidate.block.BBox.H + accepted.block.BBox.W*accepted.block.BBox.H - intersection
			iou := float64(intersection) / float64(maxInt(1, union))
			candidateCoverage := float64(intersection) / float64(maxInt(1, candidate.block.BBox.W*candidate.block.BBox.H))
			acceptedCoverage := float64(intersection) / float64(maxInt(1, accepted.block.BBox.W*accepted.block.BBox.H))
			overlapWidth := maxInt(0, minInt(candidate.block.BBox.X+candidate.block.BBox.W, accepted.block.BBox.X+accepted.block.BBox.W)-maxInt(candidate.block.BBox.X, accepted.block.BBox.X))
			overlapHeight := maxInt(0, minInt(candidate.block.BBox.Y+candidate.block.BBox.H, accepted.block.BBox.Y+accepted.block.BBox.H)-maxInt(candidate.block.BBox.Y, accepted.block.BBox.Y))
			widthCoverage := float64(overlapWidth) / float64(maxInt(1, minInt(candidate.block.BBox.W, accepted.block.BBox.W)))
			heightCoverage := float64(overlapHeight) / float64(maxInt(1, minInt(candidate.block.BBox.H, accepted.block.BBox.H)))
			if iou >= .58 || (candidateCoverage >= .88 && acceptedCoverage >= .42) || (widthCoverage >= .78 && heightCoverage >= .78) {
				duplicate = true
				break
			}
		}
		if duplicate {
			return false
		}
		selected = append(selected, candidate)
		return true
	}
	// Long horizontal components are a strong independent cue for aircraft and
	// complete text lines. Reserve them in top-to-bottom order so several planes
	// at different heights cannot be replaced by one broad enclosing proposal.
	elongated := make([]objectProposal, 0)
	for _, candidate := range proposals {
		box := candidate.block.BBox
		if box.W >= w/8 && float64(box.W)/float64(maxInt(1, box.H)) >= 2.4 {
			elongated = append(elongated, candidate)
		}
	}
	sort.SliceStable(elongated, func(i, j int) bool { return elongated[i].score > elongated[j].score })
	for round := 0; round < 2; round++ {
		for band := 0; band < 6; band++ {
			for _, candidate := range elongated {
				cy := candidate.block.BBox.Y + candidate.block.BBox.H/2
				if minInt(5, cy*6/h) == band {
					if accept(candidate) {
						break
					}
				}
			}
		}
	}
	// Reserve compact right-side proposals by vertical band. This is where
	// control towers and small independent labels tend to be lost behind long
	// aircraft proposals.
	for band := 0; band < 3; band++ {
		for _, candidate := range proposals {
			box := candidate.block.BBox
			cx, cy := box.X+box.W/2, box.Y+box.H/2
			aspect := float64(maxInt(box.W, box.H)) / float64(maxInt(1, minInt(box.W, box.H)))
			if cx >= w*4/5 && cy*3/h == band && aspect < 2.4 {
				if accept(candidate) {
					break
				}
			}
		}
	}
	// Reserve one strong proposal per coarse spatial cell first. Without this
	// coverage pass, repeated high-contrast glyphs at the bottom can consume the
	// whole proposal budget before the right-side aircraft/tower are considered.
	const gridColumns, gridRows = 4, 3
	for round := 0; round < 2; round++ {
		for gy := 0; gy < gridRows; gy++ {
			for gx := 0; gx < gridColumns; gx++ {
				for _, candidate := range proposals {
					cx := candidate.block.BBox.X + candidate.block.BBox.W/2
					cy := candidate.block.BBox.Y + candidate.block.BBox.H/2
					if cx*gridColumns/w == gx && cy*gridRows/h == gy {
						if accept(candidate) {
							break
						}
					}
				}
			}
		}
	}
	for _, candidate := range proposals {
		if len(selected) == 24 {
			break
		}
		accept(candidate)
	}

	// Proposals may overlap. Resolve their seed pixels exactly once; Stage 5
	// subsequently assigns every residual image pixel to one of these seeds.
	// Smaller, more specific proposals claim first so a broad high-saliency
	// envelope cannot swallow the aeroplane/tower/text proposals inside it.
	sort.SliceStable(selected, func(i, j int) bool {
		ai := selected[i].block.BBox.W * selected[i].block.BBox.H
		aj := selected[j].block.BBox.W * selected[j].block.BBox.H
		return ai < aj
	})
	owner := make([]int, w*h)
	for i := range owner {
		owner[i] = -1
	}
	groups := make([][]int, len(selected))
	for proposalIndex, proposal := range selected {
		for _, pixel := range proposal.block.Pixels {
			if pixel >= 0 && pixel < len(owner) && owner[pixel] < 0 {
				owner[pixel] = proposalIndex
				groups[proposalIndex] = append(groups[proposalIndex], pixel)
			}
		}
	}
	blocks := make([]Block, 0, len(groups))
	for index, group := range groups {
		if len(group) >= settings.MinBlockInk {
			block := blockFromPixels(group, rgba, w, settings)
			// BBox/centroid describe the object proposal. Pixels describe the
			// exclusive render ownership. Keeping them separate prevents a valid
			// object box from shrinking after overlapping proposals are resolved.
			block.BBox = selected[index].block.BBox
			block.CentroidX = selected[index].block.CentroidX
			block.CentroidY = selected[index].block.CentroidY
			blocks = append(blocks, block)
		}
	}
	return blocks
}

func validObjectProposal(block Block, w, h, minInk int) bool {
	box := block.BBox
	area := box.W * box.H
	canvas := w * h
	if len(block.Pixels) < minInk || box.W < 10 || box.H < 10 || area < canvas/500 || area > canvas*24/100 {
		return false
	}
	// Broad border bands are background/lighting regions, not objects.
	borderSides := 0
	if box.X <= 1 {
		borderSides++
	}
	if box.Y <= 1 {
		borderSides++
	}
	if box.X+box.W >= w-1 {
		borderSides++
	}
	if box.Y+box.H >= h-1 {
		borderSides++
	}
	return borderSides < 2 && !(box.W > w*4/5 || box.H > h*4/5)
}

func proposalObjectness(proposal objectProposal, all []objectProposal, saliency, edges []uint8, w, h int) float64 {
	block := proposal.block
	boxArea := maxInt(1, block.BBox.W*block.BBox.H)
	density := float64(len(block.Pixels)) / float64(boxArea)
	saliencyMean, edgeMean := 0.0, 0.0
	step := maxInt(1, len(block.Pixels)/512)
	sampled := 0
	for index := 0; index < len(block.Pixels); index += step {
		pixel := block.Pixels[index]
		saliencyMean += float64(saliency[pixel]) / 255
		edgeMean += float64(edges[pixel]) / 255
		sampled++
	}
	if sampled > 0 {
		saliencyMean /= float64(sampled)
		edgeMean /= float64(sampled)
	}
	stability := 0.0
	for _, other := range all {
		if other.cue == proposal.cue {
			continue
		}
		intersection := rectIntersectionArea(block.BBox, other.block.BBox)
		if intersection == 0 {
			continue
		}
		minimumArea := minInt(boxArea, other.block.BBox.W*other.block.BBox.H)
		if float64(intersection)/float64(maxInt(1, minimumArea)) >= .62 {
			stability += .08
		}
	}
	stability = math.Min(.32, stability)
	sizePrior := math.Min(.25, math.Sqrt(float64(boxArea)/float64(w*h))*.55)
	textBonus := 0.0
	if proposal.cue == "text" {
		textBonus = .12
	}
	aspect := float64(maxInt(block.BBox.W, block.BBox.H)) / float64(maxInt(1, minInt(block.BBox.W, block.BBox.H)))
	elongatedBonus := 0.0
	if aspect >= 2.2 && aspect <= 10 {
		elongatedBonus = .14
	}
	return saliencyMean*.36 + edgeMean*.25 + math.Min(.30, density*.32) + stability + sizePrior + textBonus + elongatedBonus
}

func rectIntersectionArea(a, b Rect) int {
	w := maxInt(0, minInt(a.X+a.W, b.X+b.W)-maxInt(a.X, b.X))
	h := maxInt(0, minInt(a.Y+a.H, b.Y+b.H)-maxInt(a.Y, b.Y))
	return w * h
}
