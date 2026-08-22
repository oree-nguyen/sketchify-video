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

func TestStandardBranchAddsResidualCoverageWithoutChangingObjectPixels(t *testing.T) {
	const w, h = 48, 32
	rgba := solidRGBA(w, h, Color{255, 255, 255})
	for y := 8; y < 24; y++ {
		for x := 12; x < 36; x++ {
			p := (y*w + x) * 4
			rgba[p], rgba[p+1], rgba[p+2] = 20, 40, 80
		}
	}
	settings := DefaultSettings()
	settings.SegmentationMode = "standard"
	settings.MinBlockInk = 1
	result := Analyze(rgba, w, h, settings)
	if len(result.Blocks) != 1 {
		t.Fatalf("simple branch object count changed: got %d, want 1", len(result.Blocks))
	}
	if len(result.CoveragePixels) == 0 {
		t.Fatal("simple branch must expose residual coverage separately")
	}
	ownership := CheckOwnership(result.Blocks, result.CoveragePixels, w*h)
	if ownership != (OwnershipStats{}) {
		t.Fatalf("simple branch ownership is not exact: %+v", ownership)
	}
	units := BuildUnitsWithCoverage(rgba, w, result.Blocks, result.CoveragePixels, settings)
	seen := make([]int, w*h)
	for _, unit := range units {
		for _, pixel := range unit.Pixels {
			if pixel < 0 || pixel >= len(seen) {
				t.Fatalf("unit pixel outside source: %d", pixel)
			}
			seen[pixel]++
		}
	}
	for pixel, count := range seen {
		if count != 1 {
			t.Fatalf("simple unit pixel %d owned %d times", pixel, count)
		}
	}
}

func TestCheckOwnershipRejectsOverlapAndMissingPixels(t *testing.T) {
	stats := CheckOwnership([]Block{{Pixels: []int{0, 1}}, {Pixels: []int{1, 2}}}, []int{3}, 5)
	if stats.Duplicate != 1 || stats.Missing != 1 || stats.Invalid != 0 {
		t.Fatalf("unexpected ownership stats: %+v", stats)
	}
}
