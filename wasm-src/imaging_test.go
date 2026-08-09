package main

import "testing"

func TestGray(t *testing.T) {
	g := Gray([]byte{255, 0, 0, 255, 0, 255, 0, 255})
	if g[0] != 76 || g[1] != 149 {
		t.Fatal(g)
	}
}
func TestSobel(t *testing.T) {
	g := make([]uint8, 25)
	for y := 0; y < 5; y++ {
		for x := 2; x < 5; x++ {
			g[y*5+x] = 255
		}
	}
	if SobelMagnitude(g, 5, 5)[2*5+1] == 0 {
		t.Fatal("không thấy cạnh")
	}
}
func TestDilate(t *testing.T) {
	m := make([]uint8, 25)
	m[12] = 1
	d := DilateSquare(m, 5, 5, 1)
	for _, p := range []int{6, 7, 8, 11, 12, 13, 16, 17, 18} {
		if d[p] != 1 {
			t.Fatal(p)
		}
	}
}
func TestComponents(t *testing.T) {
	m := []uint8{1, 0, 1, 0, 0, 0}
	_, c := Components(m, 3, 2)
	if len(c) != 2 {
		t.Fatal(len(c))
	}
}
func TestAnalyzeSixBlocks(t *testing.T) {
	w, h := 160, 100
	img := make([]byte, w*h*4)
	for i := 0; i < len(img); i += 4 {
		img[i], img[i+1], img[i+2], img[i+3] = 255, 255, 255, 255
	}
	for n := 0; n < 6; n++ {
		x := 10 + (n%3)*50
		y := 10 + (n/3)*45
		for yy := y; yy < y+20; yy++ {
			for xx := x; xx < x+20; xx++ {
				j := (yy*w + xx) * 4
				img[j], img[j+1], img[j+2] = uint8(20+n*20), 60, 100
			}
		}
	}
	s := DefaultSettings()
	s.WorkingWidth = w
	s.MergeRadius = 3
	s.MinBlockInk = 20
	r := Analyze(img, w, h, s)
	if len(r.Blocks) < 5 {
		t.Fatalf("got %d blocks", len(r.Blocks))
	}
}
func TestTraceContourSquare10(t *testing.T) {
	mask := make([]uint8, 100)
	for i := range mask {
		mask[i] = 1
	}
	path := TraceContour(mask, 10, 10)
	if len(path) < 34 || len(path) > 38 {
		t.Fatalf("expected about 36 contour points, got %d", len(path))
	}
	if path[0].X != 0 || path[0].Y != 0 {
		t.Fatal(path[0])
	}
}
func TestPhotoRegionsUseGlobalPalette(t *testing.T) {
	w, h := 80, 10
	rgba := make([]byte, w*h*4)
	pixels := make([]int, 0, w*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			p := y*w + x
			j := p * 4
			rgba[j], rgba[j+1], rgba[j+2], rgba[j+3] = uint8(x*3), uint8(255-x*3), 80, 255
			pixels = append(pixels, p)
		}
	}
	units := PhotoRegions(rgba, w, Block{Pixels: pixels}, 4, 5)
	if len(units) < 3 {
		t.Fatalf("global palette should split gradient bands, got %d", len(units))
	}
	for _, unit := range units {
		if len(unit.Pixels) > w*h/2 {
			t.Fatal("chaining created a giant region")
		}
	}
}

func TestBuildUnitsPreservesEveryBlockPixel(t *testing.T) {
	w, h := 40, 20
	rgba := make([]byte, w*h*4)
	pixels := make([]int, 0)
	for y := 2; y < 18; y++ {
		for x := 2; x < 38; x++ {
			p := y*w + x
			j := p * 4
			rgba[j], rgba[j+1], rgba[j+2], rgba[j+3] = uint8(x*6), uint8(y*10), 90, 255
			pixels = append(pixels, p)
		}
	}
	b := Block{ID: 3, Pixels: pixels, BBox: Rect{2, 2, 36, 16}, Kind: "photo"}
	s := DefaultSettings()
	s.MinRegionArea = 80
	units := BuildUnits(rgba, w, []Block{b}, s)
	seen := map[int]bool{}
	for _, u := range units {
		if u.BlockID != 3 {
			t.Fatalf("wrong block id %d", u.BlockID)
		}
		for _, p := range u.Pixels {
			seen[p] = true
		}
	}
	if len(seen) != len(pixels) {
		t.Fatalf("lost pixels: got %d want %d", len(seen), len(pixels))
	}
}
