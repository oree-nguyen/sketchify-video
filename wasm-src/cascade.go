package main

import "sort"

const (
	cascadeStage1Flag = 1 << iota
	cascadeStage2Flag
	cascadeStage3Flag
	cascadeStage4Flag
	cascadeStage5Flag
)

// CascadeStage1 is the existing Sobel + border-background comparison.
func CascadeStage1(rgba []byte, w, h int, settings Settings, background Color) []uint8 {
	if settings.CascadeDebugMask&cascadeStage1Flag == 0 {
		return make([]uint8, w*h)
	}
	return InkMask(rgba, w, h, settings, background)
}

// CascadeStage2 adds the global spectral-residual threshold without
// recalculating the map produced by Analyze.
func CascadeStage2(stage1, saliency []uint8, threshold uint8, settings Settings) []uint8 {
	out := append([]uint8(nil), stage1...)
	if settings.CascadeDebugMask&cascadeStage2Flag == 0 {
		return out
	}
	for i, value := range saliency {
		if value > threshold {
			out[i] = 1
		}
	}
	return out
}

// CascadeStage3 applies a locally adaptive saliency percentile. Thresholds are
// measured in overlapping 64px windows whose centres are 48px apart and then
// bilinearly interpolated, so tile borders never become segmentation borders.
func CascadeStage3(stage2, saliency []uint8, w, h int, percentile float64, settings Settings) []uint8 {
	out := append([]uint8(nil), stage2...)
	if settings.CascadeDebugMask&cascadeStage3Flag == 0 || w == 0 || h == 0 {
		return out
	}
	const tile, step = 64, 48
	cols, rows := (w+step-1)/step+1, (h+step-1)/step+1
	thresholds := make([]uint8, cols*rows)
	for gy := 0; gy < rows; gy++ {
		cy := minInt(h-1, gy*step)
		for gx := 0; gx < cols; gx++ {
			cx := minInt(w-1, gx*step)
			thresholds[gy*cols+gx] = percentileRect(saliency, w, h, maxInt(0, cx-tile/2), maxInt(0, cy-tile/2), minInt(w, cx+tile/2), minInt(h, cy+tile/2), percentile)
		}
	}
	for y := 0; y < h; y++ {
		gy0 := minInt(rows-1, y/step)
		gy1 := minInt(rows-1, gy0+1)
		fy := float64(y-gy0*step) / step
		for x := 0; x < w; x++ {
			gx0 := minInt(cols-1, x/step)
			gx1 := minInt(cols-1, gx0+1)
			fx := float64(x-gx0*step) / step
			top := float64(thresholds[gy0*cols+gx0])*(1-fx) + float64(thresholds[gy0*cols+gx1])*fx
			bottom := float64(thresholds[gy1*cols+gx0])*(1-fx) + float64(thresholds[gy1*cols+gx1])*fx
			if float64(saliency[y*w+x]) > top*(1-fy)+bottom*fy {
				out[y*w+x] = 1
			}
		}
	}
	return out
}

func percentileRect(values []uint8, w, h, x0, y0, x1, y1 int, percentile float64) uint8 {
	var histogram [256]int
	total := 0
	for y := maxInt(0, y0); y < minInt(h, y1); y++ {
		for _, value := range values[y*w+maxInt(0, x0) : y*w+minInt(w, x1)] {
			histogram[value]++
			total++
		}
	}
	if total == 0 {
		return 255
	}
	target := int(percentile / 100 * float64(total-1))
	accumulated := 0
	for value, count := range histogram {
		accumulated += count
		if accumulated > target {
			return uint8(value)
		}
	}
	return 255
}

// CascadeStage4 reuses MedianCut and Components to partition every pixel not
// owned by a saliency seed. Each output pixel appears in exactly one region.
func CascadeStage4(rgba []byte, w, h int, stage3, saliency []uint8, settings Settings) ([][]int, int, []uint8, []Rect, [][2]float64) {
	seedBlocks := CombinedObjectBlocks(rgba, w, h, stage3, saliency, settings)
	seedBlocks = SplitOversizedSaliencyBlocks(seedBlocks, rgba, w, h, settings)
	// CombinedObjectBlocks has already reconciled overlapping saliency, colour
	// and text proposals. Running the old pairwise merge here again collapses
	// semantic objects back into broad colour/saliency regions.
	regions := make([][]int, 0, len(seedBlocks))
	coreBoxes := make([]Rect, 0, len(seedBlocks))
	coreCentroids := make([][2]float64, 0, len(seedBlocks))
	for _, block := range seedBlocks {
		regions = append(regions, block.Pixels)
		coreBoxes = append(coreBoxes, block.BBox)
		coreCentroids = append(coreCentroids, [2]float64{block.CentroidX, block.CentroidY})
	}
	seedCount := len(regions)
	owner := make([]int, w*h)
	for i := range owner {
		owner[i] = -1
	}
	for id, region := range regions {
		for _, pixel := range region {
			owner[pixel] = id
		}
	}
	if settings.CascadeDebugMask&cascadeStage4Flag == 0 {
		return regions, seedCount, append([]uint8(nil), stage3...), coreBoxes, coreCentroids
	}
	samples := make([]Color, 0, 30000)
	stride := maxInt(1, (w*h-lenAssigned(owner))/30000)
	seenResidual := 0
	for pixel, id := range owner {
		if id >= 0 {
			continue
		}
		if seenResidual%stride == 0 {
			offset := pixel * 4
			samples = append(samples, Color{int(rgba[offset]), int(rgba[offset+1]), int(rgba[offset+2])})
		}
		seenResidual++
	}
	palette := MedianCut(samples, maxInt(2, settings.CascadeColorClusters))
	codes := make([]uint8, w*h)
	// Quantize an averaged 4x4 cell rather than every noisy source pixel. CCL
	// still runs at full resolution afterwards, and every source pixel keeps an
	// owner, but one-pixel photo texture no longer explodes into thousands of
	// components.
	const colorCell = 4
	for y0 := 0; y0 < h; y0 += colorCell {
		for x0 := 0; x0 < w; x0 += colorCell {
			r, g, b, count := 0, 0, 0, 0
			for y := y0; y < minInt(h, y0+colorCell); y++ {
				for x := x0; x < minInt(w, x0+colorCell); x++ {
					pixel := y*w + x
					if owner[pixel] >= 0 {
						continue
					}
					offset := pixel * 4
					r, g, b, count = r+int(rgba[offset]), g+int(rgba[offset+1]), b+int(rgba[offset+2]), count+1
				}
			}
			if count == 0 {
				continue
			}
			code := uint8(nearest(Color{r / count, g / count, b / count}, palette) + 1)
			for y := y0; y < minInt(h, y0+colorCell); y++ {
				for x := x0; x < minInt(w, x0+colorCell); x++ {
					pixel := y*w + x
					if owner[pixel] < 0 {
						codes[pixel] = code
					}
				}
			}
		}
	}
	smoothedCodes := append([]uint8(nil), codes...)
	for y0 := 0; y0 < h; y0 += colorCell {
		for x0 := 0; x0 < w; x0 += colorCell {
			counts := make([]int, len(palette)+1)
			for ny := maxInt(0, y0-colorCell); ny < minInt(h, y0+colorCell*2); ny++ {
				for nx := maxInt(0, x0-colorCell); nx < minInt(w, x0+colorCell*2); nx++ {
					if code := codes[ny*w+nx]; code > 0 {
						counts[code]++
					}
				}
			}
			bestCode, bestCount := 0, 0
			for code := 1; code < len(counts); code++ {
				if counts[code] > bestCount {
					bestCode, bestCount = code, counts[code]
				}
			}
			if bestCode == 0 {
				continue
			}
			for y := y0; y < minInt(h, y0+colorCell); y++ {
				for x := x0; x < minInt(w, x0+colorCell); x++ {
					pixel := y*w + x
					if owner[pixel] < 0 {
						smoothedCodes[pixel] = uint8(bestCode)
					}
				}
			}
		}
	}
	smoothedCodes = smoothPaletteCodes(smoothedCodes, owner, w, h, colorCell, len(palette))
	for code := range palette {
		binary := make([]uint8, w*h)
		for pixel, id := range owner {
			if id >= 0 {
				continue
			}
			if int(smoothedCodes[pixel]) == code+1 {
				binary[pixel] = 1
			}
		}
		_, components := Components(binary, w, h)
		for _, component := range components {
			id := len(regions)
			regions = append(regions, component)
			for _, pixel := range component {
				owner[pixel] = id
			}
		}
	}
	// Defensive fallback for an empty palette or malformed input. This is also
	// what makes the 100% coverage contract explicit rather than probabilistic.
	for pixel, id := range owner {
		if id < 0 {
			regions = append(regions, []int{pixel})
			owner[pixel] = len(regions) - 1
		}
	}
	full := make([]uint8, w*h)
	for i := range full {
		full[i] = 1
	}
	return regions, seedCount, full, coreBoxes, coreCentroids
}

func smoothPaletteCodes(codes []uint8, owner []int, w, h, cell, paletteSize int) []uint8 {
	out := append([]uint8(nil), codes...)
	for y0 := 0; y0 < h; y0 += cell {
		for x0 := 0; x0 < w; x0 += cell {
			counts := make([]int, paletteSize+1)
			for y := maxInt(0, y0-cell); y < minInt(h, y0+cell*2); y++ {
				for x := maxInt(0, x0-cell); x < minInt(w, x0+cell*2); x++ {
					if code := codes[y*w+x]; code > 0 {
						counts[code]++
					}
				}
			}
			bestCode, bestCount := 0, 0
			for code := 1; code < len(counts); code++ {
				if counts[code] > bestCount {
					bestCode, bestCount = code, counts[code]
				}
			}
			for y := y0; bestCode > 0 && y < minInt(h, y0+cell); y++ {
				for x := x0; x < minInt(w, x0+cell); x++ {
					pixel := y*w + x
					if owner[pixel] < 0 {
						out[pixel] = uint8(bestCode)
					}
				}
			}
		}
	}
	return out
}

// CascadeStage5 merges only touching pairs, at most once per region per round
// and for at most three rounds. Small texture regions may join a similarly
// coloured neighbour; similarly-sized regions never merge automatically.
func CascadeStage5(regions [][]int, seedCount int, rgba []byte, w, h int, settings Settings) [][]int {
	if settings.CascadeDebugMask&cascadeStage5Flag == 0 {
		return regions
	}
	seedCount = minInt(seedCount, len(regions))
	seeds := append([][]int(nil), regions[:seedCount]...)
	regions = append([][]int(nil), regions[seedCount:]...)
	for round := 0; round < 3; round++ {
		owner := make([]int, w*h)
		for i := range owner {
			owner[i] = -1
		}
		colors := make([]Color, len(regions))
		for id, region := range regions {
			colors[id] = averagePixelColor(rgba, region)
			for _, pixel := range region {
				owner[pixel] = id
			}
		}
		type pair struct{ a, b, score int }
		pairsByKey := map[[2]int]pair{}
		for pixel, ownerA := range owner {
			if ownerA < 0 {
				continue
			}
			x, y := pixel%w, pixel/w
			for _, neighbour := range []int{pixel + 1, pixel + w} {
				if (neighbour == pixel+1 && x+1 >= w) || (neighbour == pixel+w && y+1 >= h) {
					continue
				}
				ownerB := owner[neighbour]
				if ownerB < 0 || ownerA == ownerB {
					continue
				}
				a, b := ownerA, ownerB
				if a > b {
					a, b = b, a
				}
				key := [2]int{a, b}
				small, large := minInt(len(regions[a]), len(regions[b])), maxInt(len(regions[a]), len(regions[b]))
				ratioPct := small * 100 / maxInt(1, large)
				delta := colorDelta(colors[a], colors[b])
				microLimit := maxInt(settings.MinBlockInk*2, w*h/60)
				bothMicro := large <= microLimit
				if (ratioPct <= 45 && delta <= 100) || (bothMicro && delta <= 140) || small < settings.MinBlockInk {
					pairsByKey[key] = pair{a: a, b: b, score: delta + ratioPct}
				}
			}
		}
		pairs := make([]pair, 0, len(pairsByKey))
		for _, candidate := range pairsByKey {
			pairs = append(pairs, candidate)
		}
		sort.Slice(pairs, func(i, j int) bool { return pairs[i].score < pairs[j].score })
		absorbed := make([]bool, len(regions))
		mergedAny := false
		for _, candidate := range pairs {
			source, target := candidate.a, candidate.b
			if len(regions[source]) > len(regions[target]) {
				source, target = target, source
			}
			if absorbed[source] || absorbed[target] {
				continue
			}
			regions[target] = append(regions[target], regions[source]...)
			regions[source] = nil
			absorbed[source], mergedAny = true, true
		}
		compacted := regions[:0]
		for _, region := range regions {
			if len(region) > 0 {
				compacted = append(compacted, region)
			}
		}
		regions = compacted
		if !mergedAny {
			break
		}
	}
	if len(seeds) == 0 {
		if len(regions) == 0 {
			return nil
		}
		largest := 0
		for i := 1; i < len(regions); i++ {
			if len(regions[i]) > len(regions[largest]) {
				largest = i
			}
		}
		seeds = append(seeds, regions[largest])
		regions = append(regions[:largest], regions[largest+1:]...)
	}
	seedColors := make([]Color, len(seeds))
	seedBoxes := make([]Rect, len(seeds))
	for i, seed := range seeds {
		seedColors[i] = averagePixelColor(rgba, seed)
		seedBoxes[i] = bboxForPixels(seed, w)
	}
	for _, residual := range regions {
		if len(residual) == 0 {
			continue
		}
		color := averagePixelColor(rgba, residual)
		box := bboxForPixels(residual, w)
		cx, cy := box.X+box.W/2, box.Y+box.H/2
		best, bestScore := 0, int(^uint(0)>>1)
		for i, seedBox := range seedBoxes {
			dx := maxInt(0, maxInt(seedBox.X-cx, cx-(seedBox.X+seedBox.W)))
			dy := maxInt(0, maxInt(seedBox.Y-cy, cy-(seedBox.Y+seedBox.H)))
			score := colorDelta(color, seedColors[i])*4 + dx + dy
			if score < bestScore {
				best, bestScore = i, score
			}
		}
		seeds[best] = append(seeds[best], residual...)
	}
	return seeds
}

func lenAssigned(owner []int) int {
	n := 0
	for _, id := range owner {
		if id >= 0 {
			n++
		}
	}
	return n
}
