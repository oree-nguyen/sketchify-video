package main

import "testing"

func TestComplexOwnershipKeepsResidualCoverageSeparate(t *testing.T) {
	const w, h = 8, 4
	rgba := solidRGBA(w, h, Color{240, 240, 240})
	settings := DefaultSettings()
	settings.MinBlockInk = 1
	proposals := []Block{
		{BBox: Rect{X: 0, Y: 0, W: 4, H: 2}, Pixels: []int{0, 1, 8, 9}, Kind: "vector", CentroidX: 1.5, CentroidY: .5},
		// Deliberately overlaps pixel 1; the ownership gate must keep it in the
		// first candidate and never duplicate it in the second candidate.
		{BBox: Rect{X: 1, Y: 0, W: 4, H: 2}, Pixels: []int{1, 2, 9, 10}, Kind: "vector", CentroidX: 2.5, CentroidY: .5},
	}
	blocks := ExclusiveObjectBlocks(proposals, rgba, w, h, settings)
	residual := ResidualCoveragePixels(blocks, w, h)
	seen := make([]int, w*h)
	for _, block := range blocks {
		for _, pixel := range block.Pixels {
			seen[pixel]++
		}
	}
	for _, pixel := range residual {
		seen[pixel]++
	}
	for pixel, count := range seen {
		if count != 1 {
			t.Fatalf("pixel %d owned %d times", pixel, count)
		}
	}
	units := BuildUnitsWithCoverage(rgba, w, blocks, residual, settings)
	unitSeen := make([]int, w*h)
	for _, unit := range units {
		for _, pixel := range unit.Pixels {
			unitSeen[pixel]++
		}
	}
	for pixel, count := range unitSeen {
		if count != 1 {
			t.Fatalf("DrawUnit pixel %d owned %d times", pixel, count)
		}
	}
	for _, unit := range units {
		if unit.BlockID < 0 && unit.Role != "coverage" {
			t.Fatalf("coverage unit role=%q", unit.Role)
		}
	}
}

func TestExclusiveObjectBBoxesComeFromOwnedPixels(t *testing.T) {
	const w, h = 12, 8
	rgba := solidRGBA(w, h, Color{245, 245, 245})
	settings := DefaultSettings(); settings.MinBlockInk = 1
	input := []Block{{BBox: Rect{X: 0, Y: 0, W: 12, H: 8}, Pixels: []int{2*w + 3, 2*w + 4, 3*w + 3}, InkArea: 3, CentroidX: 99, CentroidY: 99}}
	out := ExclusiveObjectBlocks(input, rgba, w, h, settings)
	if len(out) != 1 || out[0].BBox != (Rect{X: 3, Y: 2, W: 2, H: 2}) { t.Fatalf("bbox was not derived from mask: %#v", out) }
}
