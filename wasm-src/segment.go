package main

import "sort"

type Rect struct{ X, Y, W, H int }
type Block struct {
	ID                   int
	BBox                 Rect
	InkArea              int
	CentroidX, CentroidY float64
	Pixels               []int
	Kind                 string
}
type AnalysisResult struct {
	Background           Color
	Blocks               []Block
	EffectiveMergeRadius int
	OpeningApplied       bool
}

// Components dùng flood-fill stack 4-láng giềng, không đệ quy để tránh tràn stack.
func Components(mask []uint8, w, h int) ([]int, [][]int) {
	labels := make([]int, w*h)
	for i := range labels {
		labels[i] = -1
	}
	all := [][]int{}
	for start, v := range mask {
		if v == 0 || labels[start] >= 0 {
			continue
		}
		id := len(all)
		stack := []int{start}
		labels[start] = id
		pix := make([]int, 0)
		for len(stack) > 0 {
			n := len(stack) - 1
			p := stack[n]
			stack = stack[:n]
			pix = append(pix, p)
			x, y := p%w, p/w
			if x > 0 && mask[p-1] > 0 && labels[p-1] < 0 {
				labels[p-1] = id
				stack = append(stack, p-1)
			}
			if x+1 < w && mask[p+1] > 0 && labels[p+1] < 0 {
				labels[p+1] = id
				stack = append(stack, p+1)
			}
			if y > 0 && mask[p-w] > 0 && labels[p-w] < 0 {
				labels[p-w] = id
				stack = append(stack, p-w)
			}
			if y+1 < h && mask[p+w] > 0 && labels[p+w] < 0 {
				labels[p+w] = id
				stack = append(stack, p+w)
			}
		}
		all = append(all, pix)
	}
	return labels, all
}

// Analyze là pipeline Tầng 0-2: ink→opening→dilate→CCL→lọc→sắp thứ tự.
func Analyze(rgba []byte, w, h int, s Settings) AnalysisResult {
	bg := EstimateBackground(rgba, w, h)
	fine := InkMask(rgba, w, h, s, bg)
	fine = DilateSquare(ErodeSquare(fine, w, h, 1), w, h, 1)
	// rgba đã được resize về ảnh làm việc trước khi vào WASM. Scale bán kính theo
	// chiều rộng THỰC của ảnh này; dùng s.WorkingWidth ở đây sẽ áp 14px cả cho
	// ảnh 480px và vô tình nối các vật thể cách nhau chỉ vài pixel.
	r := effectiveMergeRadius(s.MergeRadius, w)
	dilated := DilateSquare(fine, w, h, r)
	labels, _ := Components(dilated, w, h)
	blocks := map[int]*Block{}
	for p, on := range fine {
		if on == 0 || labels[p] < 0 {
			continue
		}
		id := labels[p]
		b := blocks[id]
		if b == nil {
			b = &Block{BBox: Rect{X: w, Y: h}, Kind: "vector"}
			blocks[id] = b
		}
		x, y := p%w, p/w
		b.Pixels = append(b.Pixels, p)
		b.InkArea++
		if x < b.BBox.X {
			b.BBox.X = x
		}
		if y < b.BBox.Y {
			b.BBox.Y = y
		}
		if x > b.BBox.W {
			b.BBox.W = x
		}
		if y > b.BBox.H {
			b.BBox.H = y
		}
		b.CentroidX += float64(x)
		b.CentroidY += float64(y)
	}
	out := make([]Block, 0, len(blocks))
	for _, b := range blocks {
		if b.InkArea < s.MinBlockInk {
			continue
		}
		b.BBox.W = b.BBox.W - b.BBox.X + 1
		b.BBox.H = b.BBox.H - b.BBox.Y + 1
		b.CentroidX /= float64(b.InkArea)
		b.CentroidY /= float64(b.InkArea)
		b.Kind = ClassifyBlock(rgba, w, *b, s)
		out = append(out, *b)
	}
	OrderBlocks(out, s.OrderMode, s.RowThresholdFactor)
	for i := range out {
		out[i].ID = i
	}
	return AnalysisResult{Background: bg, Blocks: out, EffectiveMergeRadius: r, OpeningApplied: true}
}

func effectiveMergeRadius(configured, actualWidth int) int {
	if configured <= 0 || actualWidth <= 0 {
		return 0
	}
	r := (configured*actualWidth + 480) / 960
	if r < 1 {
		return 1
	}
	return r
}

func OrderBlocks(b []Block, mode string, factor float64) {
	if mode == "rtl" {
		sort.Slice(b, func(i, j int) bool { return b[i].CentroidX > b[j].CentroidX })
		return
	}
	if mode == "ttb" {
		sort.Slice(b, func(i, j int) bool { return b[i].CentroidY < b[j].CentroidY })
		return
	}
	if mode == "btt" {
		sort.Slice(b, func(i, j int) bool { return b[i].CentroidY > b[j].CentroidY })
		return
	}
	if mode == "ltr" {
		sort.Slice(b, func(i, j int) bool { return b[i].CentroidX < b[j].CentroidX })
		return
	}
	sort.Slice(b, func(i, j int) bool { return b[i].CentroidY < b[j].CentroidY })
	heights := make([]int, len(b))
	for i := range b {
		heights[i] = b[i].BBox.H
	}
	sort.Ints(heights)
	gap := 8
	if len(heights) > 0 {
		g := int(float64(heights[len(heights)/2]) * factor)
		if g > gap {
			gap = g
		}
	}
	start := 0
	for start < len(b) {
		end := start + 1
		anchor := b[start].CentroidY
		for end < len(b) && abs(b[end].CentroidY-anchor) <= float64(gap) {
			anchor = (anchor*float64(end-start) + b[end].CentroidY) / float64(end-start+1)
			end++
		}
		sort.Slice(b[start:end], func(i, j int) bool { return b[start+i].CentroidX < b[start+j].CentroidX })
		start = end
	}
}
func abs(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}
