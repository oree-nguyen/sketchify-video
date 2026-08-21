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
	componentsByCode := componentsForCodes(codes, w, h)
	for paletteIndex := range palette {
		// CCL is performed once over the globally quantized label map (rather than
		// scanning/flood-filling the full canvas once per palette colour). This
		// preserves global-cluster-before-spatial semantics without an O(KN)
		// browser fallback cost.
		components := componentsByCode[uint8(paletteIndex+1)]
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
	// Collapse overlapping colour fragments and caption/icon cards before
	// ranking. This is a mask-aware editorial grouping step, not a dilation or
	// transitive pixel chain: every proposed merge is revalidated against the
	// aggregate bbox and each member can participate in at most one merge pass.
	proposals = consolidateObjectProposals(proposals, rgba, w, h, settings)
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
	// Every candidate is considered in score order. There is intentionally no
	// spatial quota and no object-count cap: selection is evidence/duplicate
	// based, not a hidden 4x3 layout prior. A later graph stage may reject a
	// proposal only after mask-aware aggregate revalidation.
	for _, candidate := range proposals { accept(candidate) }

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

func componentsForCodes(codes []uint8, w, h int) map[uint8][][]int {
	seen := make([]uint8, w*h); out := make(map[uint8][][]int)
	for start, value := range codes {
		if value == 0 || seen[start] != 0 { continue }
		stack := []int{start}; seen[start] = 1; component := make([]int, 0)
		for len(stack) > 0 {
			last := len(stack)-1; pixel := stack[last]; stack = stack[:last]; component = append(component, pixel); x, y := pixel%w, pixel/w
			if x > 0 && seen[pixel-1] == 0 && codes[pixel-1] == value { seen[pixel-1] = 1; stack = append(stack, pixel-1) }
			if x+1 < w && seen[pixel+1] == 0 && codes[pixel+1] == value { seen[pixel+1] = 1; stack = append(stack, pixel+1) }
			if y > 0 && seen[pixel-w] == 0 && codes[pixel-w] == value { seen[pixel-w] = 1; stack = append(stack, pixel-w) }
			if y+1 < h && seen[pixel+w] == 0 && codes[pixel+w] == value { seen[pixel+w] = 1; stack = append(stack, pixel+w) }
		}
		out[value] = append(out[value], component)
	}
	return out
}

func consolidateObjectProposals(input []objectProposal, rgba []byte, w, h int, settings Settings) []objectProposal {
	proposals := append([]objectProposal(nil), input...)
	colors := make([]Color, len(proposals))
	for i := range proposals { colors[i] = averageBlockColor(proposals[i].block, rgba, w) }
	for pass := 0; pass < 20; pass++ {
		bestA, bestB, bestScore := -1, -1, 0.0
		// Spatial broad-phase: merge evidence is still evaluated on complete
		// masks/bboxes, but distant proposals never enter the quadratic pair
		// loop. This is an index, not a layout prior, so it remains valid for
		// arbitrary canvas compositions.
		order := make([]int, len(proposals))
		for i := range order { order[i] = i }
		sort.Slice(order, func(i, j int) bool { return proposals[order[i]].block.BBox.X < proposals[order[j]].block.BBox.X })
		for oi, i := range order {
			a := proposals[i].block
			for oj := oi + 1; oj < len(order); oj++ {
				j := order[oj]
				b := proposals[j].block
				if b.BBox.X > a.BBox.X+a.BBox.W+maxInt(12, maxInt(a.BBox.H, b.BBox.H)) { break }
				score := proposalMergeEvidence(a, b, h)
				if score > 0 && colorDelta(colors[i], colors[j]) > 120 { score *= .55 }
				if score > bestScore { bestA, bestB, bestScore = i, j, score }
			}
		}
		if bestA < 0 || bestScore < .58 { break }
		merged := mergeBlocks([]Block{proposals[bestA].block, proposals[bestB].block}, w, h)
		// Reject a merge whose enclosing rectangle is mostly empty: this prevents
		// a thin nearby bridge from chaining unrelated objects.
		occupied := len(proposals[bestA].block.Pixels) + len(proposals[bestB].block.Pixels)
		if float64(occupied)/float64(maxInt(1, merged.BBox.W*merged.BBox.H)) < .018 { break }
		merged.Kind = ClassifyBlock(rgba, w, merged, settings)
		proposals[bestA] = objectProposal{block: merged, score: proposals[bestA].score + proposals[bestB].score, cue: "compound"}
		proposals = append(proposals[:bestB], proposals[bestB+1:]...)
		colors[bestA] = averageBlockColor(merged, rgba, w)
		colors = append(colors[:bestB], colors[bestB+1:]...)
	}
	return proposals
}

func proposalMergeEvidence(a, b Block, imageHeight int) float64 {
	intersection := rectIntersectionArea(a.BBox, b.BBox)
	minArea := maxInt(1, minInt(a.BBox.W*a.BBox.H, b.BBox.W*b.BBox.H))
	overlap := float64(intersection) / float64(minArea)
	if overlap >= .12 { return .88 + minFloat(.08, overlap*.08) }
	hGap, vGap := horizontalGap(a.BBox, b.BBox), verticalGap(a.BBox, b.BBox)
	hOverlap, vOverlap := horizontalOverlap(a.BBox, b.BBox), verticalOverlap(a.BBox, b.BBox)
	textA, textB := isTextPart(a, imageHeight), isTextPart(b, imageHeight)
	short := maxInt(6, minInt(maxInt(1, minInt(a.BBox.W, a.BBox.H)), maxInt(1, minInt(b.BBox.W, b.BBox.H)))*2)
	if textA != textB {
		if (hGap <= short && vOverlap > 0) || (vGap <= short && hOverlap > 0) { return .78 }
	}
	if textA && textB && hGap <= maxInt(8, maxInt(a.BBox.H, b.BBox.H)) && absInt((a.BBox.Y+a.BBox.H)-(b.BBox.Y+b.BBox.H)) <= maxInt(12, imageHeight/20) { return .72 }
	// Compact symbols in one visual cluster (for example three question marks)
	// may merge only when the enclosing box is still dense and the gap is small.
	if !textA && !textB && a.BBox.H < imageHeight/4 && b.BBox.H < imageHeight/4 && ((hGap <= maxInt(10, minInt(a.BBox.H, b.BBox.H))) || (vGap <= maxInt(10, minInt(a.BBox.W, b.BBox.W)))) { return .62 }
	return 0
}

func validObjectProposal(block Block, w, h, minInk int) bool {
	box := block.BBox
	area := box.W * box.H
	canvas := w * h
	if len(block.Pixels) < minInk || box.W < 10 || box.H < 10 || area < canvas/500 {
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
	return borderSides < 2
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
