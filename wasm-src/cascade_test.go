package main

import "testing"

func TestCascadeDebugFlagsAndHardCoverage(t *testing.T) {
	const w, h = 48, 32
	rgba := solidRGBA(w, h, Color{230, 230, 230})
	for y := 8; y < 24; y++ {
		for x := 12; x < 36; x++ {
			offset := (y*w + x) * 4
			rgba[offset], rgba[offset+1], rgba[offset+2] = 20, 80, 180
		}
	}
	settings := DefaultSettings()
	settings.CascadeDebugMask = 0
	stage1 := CascadeStage1(rgba, w, h, settings, EstimateBackground(rgba, w, h))
	assertMaskCount(t, stage1, 0)
	saliency := SpectralResidualSaliency(Gray(rgba), w, h)
	stage2 := CascadeStage2(stage1, saliency, PercentileThreshold(saliency, 75), settings)
	assertMaskCount(t, stage2, 0)
	stage3 := CascadeStage3(stage2, saliency, w, h, 75, settings)
	assertMaskCount(t, stage3, 0)
	regions, seeds, coverage, _, _ := CascadeStage4(rgba, w, h, stage3, saliency, settings)
	if len(regions) != 0 || seeds != 0 {
		t.Fatalf("stage 4 disabled: regions=%d seeds=%d", len(regions), seeds)
	}
	assertMaskCount(t, coverage, 0)

	settings.CascadeDebugMask = 31
	stage1 = CascadeStage1(rgba, w, h, settings, EstimateBackground(rgba, w, h))
	stage2 = CascadeStage2(stage1, saliency, PercentileThreshold(saliency, 75), settings)
	stage3 = CascadeStage3(stage2, saliency, w, h, 75, settings)
	regions, seeds, coverage, _, _ = CascadeStage4(rgba, w, h, stage3, saliency, settings)
	assertMaskCount(t, coverage, w*h)
	regions = CascadeStage5(regions, seeds, rgba, w, h, settings)
	total := 0
	seen := make([]uint8, w*h)
	for _, region := range regions {
		total += len(region)
		for _, pixel := range region {
			seen[pixel]++
		}
	}
	if total != w*h {
		t.Fatalf("cascade owns %d/%d pixels", total, w*h)
	}
	for pixel, count := range seen {
		if count != 1 {
			t.Fatalf("pixel %d ownership=%d", pixel, count)
		}
	}
}

func assertMaskCount(t *testing.T, mask []uint8, want int) {
	t.Helper()
	count := 0
	for _, value := range mask {
		if value != 0 {
			count++
		}
	}
	if count != want {
		t.Fatalf("mask count=%d want=%d", count, want)
	}
}
