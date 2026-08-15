package main

import (
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestBackgroundComplexityChoosesExpectedPipeline(t *testing.T) {
	white := solidRGBA(96, 64, Color{248, 248, 248})
	settings := DefaultSettings()
	plain := Analyze(white, 96, 64, settings)
	if plain.SegmentationMode != "standard" {
		t.Fatalf("plain background selected %q, variance=%.2f entropy=%.2f", plain.SegmentationMode, plain.BackgroundVariance, plain.BackgroundEntropy)
	}

	textured := make([]byte, 96*64*4)
	for y := 0; y < 64; y++ {
		for x := 0; x < 96; x++ {
			i := (y*96 + x) * 4
			textured[i], textured[i+1], textured[i+2], textured[i+3] = byte((x*17+y*3)%256), byte((x*5+y*19)%256), byte((x*11+y*7)%256), 255
		}
	}
	complex := Analyze(textured, 96, 64, settings)
	if complex.SegmentationMode != "saliency" {
		t.Fatalf("textured background selected %q, variance=%.2f entropy=%.2f", complex.SegmentationMode, complex.BackgroundVariance, complex.BackgroundEntropy)
	}
	if len(complex.Saliency) != 96*64 || complex.SaliencyThreshold == 0 {
		t.Fatalf("invalid saliency output: len=%d threshold=%d", len(complex.Saliency), complex.SaliencyThreshold)
	}
}

func TestComplexProjectFixturesUseSaliency(t *testing.T) {
	for index := 1; index <= 3; index++ {
		name := fmt.Sprintf("testthuattoanmoi (%d).png", index)
		t.Run(name, func(t *testing.T) {
			rgba, w, h := loadProjectPNG(t, filepath.Join("..", name), 960)
			result := Analyze(rgba, w, h, DefaultSettings())
			standardSettings := DefaultSettings()
			standardSettings.SegmentationMode = "standard"
			standard := Analyze(rgba, w, h, standardSettings)
			if result.SegmentationMode != "saliency" {
				t.Fatalf("mode=%s variance=%.2f entropy=%.2f", result.SegmentationMode, result.BackgroundVariance, result.BackgroundEntropy)
			}
			if len(result.Blocks) <= len(standard.Blocks) {
				t.Fatalf("saliency did not separate the standard result: saliency=%d standard=%d", len(result.Blocks), len(standard.Blocks))
			}
			t.Logf("mode=%s blocks=%d standardBlocks=%d variance=%.2f entropy=%.2f threshold=%d", result.SegmentationMode, len(result.Blocks), len(standard.Blocks), result.BackgroundVariance, result.BackgroundEntropy, result.SaliencyThreshold)
			if os.Getenv("SKETCHIFY_WRITE_FIXTURES") == "1" {
				writeBlockOverlay(t, filepath.Join("..", fmt.Sprintf(".tmp-saliency-%d.png", index)), rgba, w, h, result.Blocks)
			}
		})
	}
}

func writeBlockOverlay(t *testing.T, path string, rgba []byte, w, h int, blocks []Block) {
	t.Helper()
	canvas := image.NewRGBA(image.Rect(0, 0, w, h))
	copy(canvas.Pix, rgba)
	green := color.RGBA{132, 204, 22, 255}
	for _, block := range blocks {
		for x := block.BBox.X; x < block.BBox.X+block.BBox.W; x++ {
			canvas.Set(x, block.BBox.Y, green)
			canvas.Set(x, block.BBox.Y+block.BBox.H-1, green)
		}
		for y := block.BBox.Y; y < block.BBox.Y+block.BBox.H; y++ {
			canvas.Set(block.BBox.X, y, green)
			canvas.Set(block.BBox.X+block.BBox.W-1, y, green)
		}
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if err := png.Encode(file, canvas); err != nil {
		t.Fatal(err)
	}
}

func TestWhiteBackgroundRegressionUsesUnchangedStandardMask(t *testing.T) {
	rgba, w, h := loadProjectPNG(t, filepath.Join("..", "anhmau3.png"), 960)
	autoSettings, standardSettings := DefaultSettings(), DefaultSettings()
	standardSettings.SegmentationMode = "standard"
	auto, standard := Analyze(rgba, w, h, autoSettings), Analyze(rgba, w, h, standardSettings)
	if auto.SegmentationMode != "standard" {
		t.Fatalf("white fixture selected %s; variance=%.2f entropy=%.2f", auto.SegmentationMode, auto.BackgroundVariance, auto.BackgroundEntropy)
	}
	if len(auto.Blocks) != len(standard.Blocks) {
		t.Fatalf("regression: auto=%d standard=%d", len(auto.Blocks), len(standard.Blocks))
	}
	for i := range auto.Blocks {
		if auto.Blocks[i].BBox != standard.Blocks[i].BBox || auto.Blocks[i].InkArea != standard.Blocks[i].InkArea {
			t.Fatalf("block %d changed: auto=%+v standard=%+v", i, auto.Blocks[i], standard.Blocks[i])
		}
	}
	t.Logf("standard regression blocks=%d variance=%.2f entropy=%.2f", len(auto.Blocks), auto.BackgroundVariance, auto.BackgroundEntropy)
}

func TestLocalSaliencyRescanSplitsMergedStandardFixture(t *testing.T) {
	rgba, w, h := loadProjectPNG(t, filepath.Join("..", "testthuattoanmoi (1).png"), 960)
	standardSettings := DefaultSettings()
	standardSettings.SegmentationMode = "standard"
	standard := Analyze(rgba, w, h, standardSettings)
	if len(standard.Blocks) != 1 {
		t.Fatalf("fixture no longer provides one merged standard block: got %d", len(standard.Blocks))
	}
	localSettings := DefaultSettings()
	localSettings.SegmentationMode = "saliency"
	rescanned := Analyze(rgba, w, h, localSettings)
	if len(rescanned.Blocks) < 2 {
		t.Fatalf("local saliency rescan did not split block: got %d", len(rescanned.Blocks))
	}
	t.Logf("local saliency rescan: %d merged block -> %d child blocks", len(standard.Blocks), len(rescanned.Blocks))
}

func solidRGBA(w, h int, color Color) []byte {
	rgba := make([]byte, w*h*4)
	for i := 0; i < len(rgba); i += 4 {
		rgba[i], rgba[i+1], rgba[i+2], rgba[i+3] = byte(color.R), byte(color.G), byte(color.B), 255
	}
	return rgba
}

func loadProjectPNG(t *testing.T, path string, workingWidth int) ([]byte, int, int) {
	t.Helper()
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	decoded, err := png.Decode(file)
	if err != nil {
		t.Fatal(err)
	}
	bounds := decoded.Bounds()
	w := minInt(workingWidth, bounds.Dx())
	h := maxInt(1, bounds.Dy()*w/bounds.Dx())
	rgba := make([]byte, w*h*4)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			r, g, b, a := decoded.At(bounds.Min.X+x*bounds.Dx()/w, bounds.Min.Y+y*bounds.Dy()/h).RGBA()
			i := (y*w + x) * 4
			rgba[i], rgba[i+1], rgba[i+2], rgba[i+3] = byte(r>>8), byte(g>>8), byte(b>>8), byte(a>>8)
		}
	}
	return rgba, w, h
}
