package main

import (
	"fmt"
	"image/png"
	"os"
	"testing"
)

func TestDebugProjectSampleOne(t *testing.T) {
	file, err := os.Open("../1.png")
	if os.IsNotExist(err) {
		t.Skip("1.png is an optional local acceptance fixture")
	}
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	img, err := png.Decode(file)
	if err != nil {
		t.Fatal(err)
	}
	source := img.Bounds()
	w := 960
	h := source.Dy() * w / source.Dx()
	rgba := make([]byte, w*h*4)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := img.At(source.Min.X+x*source.Dx()/w, source.Min.Y+y*source.Dy()/h).RGBA()
			i := (y*w + x) * 4
			rgba[i], rgba[i+1], rgba[i+2], rgba[i+3] = byte(r>>8), byte(g>>8), byte(b>>8), byte(a>>8)
		}
	}
	settings := DefaultSettings()
	settings.MergeRadius = 0
	// Fixture này kiểm tra hành vi pipeline nền trắng cũ; ép standard để test
	// không phụ thuộc bộ phân loại nền tự động mới.
	settings.SegmentationMode = "standard"
	bg := EstimateBackground(rgba, w, h)
	fine := DilateSquare(ErodeSquare(InkMask(rgba, w, h, settings, bg), w, h, 1), w, h, 1)
	_, components := Components(fine, w, h)
	eligible := 0
	for _, pixels := range components {
		if len(pixels) >= settings.MinBlockInk {
			eligible++
		}
	}
	fmt.Printf("raw components=%d eligible=%d minInk=%d\n", len(components), eligible, settings.MinBlockInk)
	result := Analyze(rgba, w, h, settings)
	if result.EffectiveMergeRadius != 0 {
		t.Fatalf("merge radius must stay locked at 0, got %d", result.EffectiveMergeRadius)
	}
	maxArea := 0
	for _, block := range result.Blocks {
		area := block.BBox.W * block.BBox.H
		if area > maxArea {
			maxArea = area
		}
	}
	if len(result.Blocks) < 35 || len(result.Blocks) > 80 {
		t.Fatalf("sample should preserve separate words/lines and illustrations, got %d blocks", len(result.Blocks))
	}
	if maxArea > w*h*3/4 {
		t.Fatalf("unexpected runaway merged bbox area=%d canvas=%d", maxArea, w*h)
	}
	fmt.Printf("sample blocks=%d merge=%d size=%dx%d maxBBoxArea=%d\n", len(result.Blocks), result.EffectiveMergeRadius, w, h, maxArea)
}
