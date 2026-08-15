package main

import "sort"

type saliencyMarker struct {
	x, y  int
	value uint8
}

// SaliencyMarkerGroups is a marker-controlled saliency partition. Unlike the
// previous implementation it never assigns the whole ink mask to a Voronoi
// cell: only pixels inside the lower saliency support band may join a marker.
// This prevents background texture from stretching a block across the canvas.
func SaliencyMarkerGroups(mask, saliency []uint8, w, h, minInk int) [][]int {
	if w < 1 || h < 1 || len(mask) < w*h || len(saliency) < w*h {
		return nil
	}
	high := PercentileThreshold(saliency, 80)
	support := PercentileThreshold(saliency, 48)
	cell := maxInt(18, minInt(w, h)/18)
	candidates := make([]saliencyMarker, 0)
	for y0 := 0; y0 < h; y0 += cell {
		for x0 := 0; x0 < w; x0 += cell {
			best := saliencyMarker{}
			for y := y0; y < minInt(h, y0+cell); y++ {
				for x := x0; x < minInt(w, x0+cell); x++ {
					value := saliency[y*w+x]
					if value > best.value {
						best = saliencyMarker{x: x, y: y, value: value}
					}
				}
			}
			if best.value >= high {
				candidates = append(candidates, best)
			}
		}
	}
	sort.Slice(candidates, func(i, j int) bool { return candidates[i].value > candidates[j].value })
	markers := make([]saliencyMarker, 0, 16)
	minimumDistance := maxInt(48, minInt(w, h)/7)
	minimumDistanceSquared := minimumDistance * minimumDistance
	for _, candidate := range candidates {
		near := false
		for _, marker := range markers {
			dx, dy := candidate.x-marker.x, candidate.y-marker.y
			if dx*dx+dy*dy < minimumDistanceSquared {
				near = true
				break
			}
		}
		if !near {
			markers = append(markers, candidate)
			if len(markers) == cap(markers) {
				break
			}
		}
	}
	groups := make([][]int, len(markers))
	maximumDistance := maxInt(w, h) * 19 / 100
	maximumDistanceSquared := maximumDistance * maximumDistance
	for pixel, on := range mask {
		if on == 0 || saliency[pixel] < support {
			continue
		}
		x, y := pixel%w, pixel/w
		best, bestScore := -1, int(^uint(0)>>1)
		for index, marker := range markers {
			dx, dy := x-marker.x, y-marker.y
			distance := dx*dx + dy*dy
			if distance < bestScore {
				best, bestScore = index, distance
			}
		}
		if best >= 0 && bestScore <= maximumDistanceSquared {
			groups[best] = append(groups[best], pixel)
		}
	}
	out := make([][]int, 0, len(groups))
	for _, group := range groups {
		if len(group) >= minInk {
			out = append(out, group)
		}
	}
	return out
}

// MergeOverlappingSaliencyBlocks rejoins partition cells that are clearly
// different peaks of the same visual object. The overlap test is intentionally
// based on the smaller box and an occupied-union bound; merely touching edges
// is never sufficient, so a thin bridge cannot chain a whole row together.
func MergeOverlappingSaliencyBlocks(input []Block, rgba []byte, w, h int, settings Settings) []Block {
	blocks := append([]Block(nil), input...)
	for {
		bestA, bestB, bestRatio := -1, -1, 0.0
		for i := 0; i < len(blocks); i++ {
			for j := i + 1; j < len(blocks); j++ {
				a, b := blocks[i].BBox, blocks[j].BBox
				intersectionW := maxInt(0, minInt(a.X+a.W, b.X+b.W)-maxInt(a.X, b.X))
				intersectionH := maxInt(0, minInt(a.Y+a.H, b.Y+b.H)-maxInt(a.Y, b.Y))
				intersection := intersectionW * intersectionH
				if minInt(a.W, b.W) == 0 || minInt(a.H, b.H) == 0 || intersection == 0 {
					continue
				}
				widthRatio := float64(intersectionW) / float64(minInt(a.W, b.W))
				heightRatio := float64(intersectionH) / float64(minInt(a.H, b.H))
				ratio := minFloat(widthRatio, heightRatio)
				left, top := minInt(a.X, b.X), minInt(a.Y, b.Y)
				right, bottom := maxInt(a.X+a.W, b.X+b.W), maxInt(a.Y+a.H, b.Y+b.H)
				unionArea := (right - left) * (bottom - top)
				occupiedArea := a.W*a.H + b.W*b.H - intersection
				if widthRatio >= .55 && heightRatio >= .55 && float64(unionArea) <= float64(occupiedArea)*1.35 && ratio > bestRatio {
					bestA, bestB, bestRatio = i, j, ratio
				}
			}
		}
		if bestA < 0 {
			break
		}
		merged := mergeBlocks([]Block{blocks[bestA], blocks[bestB]}, w, h)
		merged.Kind = ClassifyBlock(rgba, w, merged, settings)
		blocks[bestA] = merged
		blocks = append(blocks[:bestB], blocks[bestB+1:]...)
	}
	return blocks
}

func minFloat(a, b float64) float64 {
	if a < b {
		return a
	}
	return b
}
