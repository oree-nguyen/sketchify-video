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
		b.BBox.W = b.BBox.W - b.BBox.X + 1
		b.BBox.H = b.BBox.H - b.BBox.Y + 1
		b.CentroidX /= float64(b.InkArea)
		b.CentroidY /= float64(b.InkArea)
		out = append(out, *b)
	}
	out = MergeTextBlocks(out, w, h)
	filtered := out[:0]
	for i := range out {
		if out[i].InkArea < s.MinBlockInk {
			continue
		}
		out[i].Kind = ClassifyBlock(rgba, w, out[i], s)
		filtered = append(filtered, out[i])
	}
	out = filtered
	OrderBlocks(out, s.OrderMode, s.RowThresholdFactor)
	for i := range out {
		out[i].ID = i
	}
	return AnalysisResult{Background: bg, Blocks: out, EffectiveMergeRadius: r, OpeningApplied: true}
}

// MergeTextBlocks gom dấu -> ký tự rồi gom các ký tự/từ trên cùng baseline.
// Tầng này chỉ nối các bbox gần nhau theo hình học, không dilation toàn ảnh, nên
// một dòng chữ không còn vỡ thành từng chữ nhưng các minh hoạ cách xa vẫn tách.
func MergeTextBlocks(input []Block, w, h int) []Block {
	if len(input) < 2 {
		return input
	}
	parent := make([]int, len(input))
	for i := range parent {
		parent[i] = i
	}
	var root func(int) int
	root = func(i int) int {
		if parent[i] != i {
			parent[i] = root(parent[i])
		}
		return parent[i]
	}
	join := func(a, b int) {
		ra, rb := root(a), root(b)
		if ra != rb {
			parent[rb] = ra
		}
	}

	// Dấu tiếng Việt thường là một component nhỏ nằm ngay trên/dưới thân chữ.
	for i := range input {
		for j := range input {
			if i == j || input[i].BBox.H*2 > input[j].BBox.H || input[i].InkArea*3 > input[j].InkArea*2 {
				continue
			}
			if horizontalOverlap(input[i].BBox, input[j].BBox) <= 0 {
				continue
			}
			if verticalGap(input[i].BBox, input[j].BBox) <= maxInt(3, input[j].BBox.H/2) {
				join(i, j)
			}
		}
	}

	// Nối các glyph/từ có cùng hàng. Ngưỡng theo chiều cao chữ để độc lập độ phân giải.
	for i := range input {
		for j := i + 1; j < len(input); j++ {
			a, b := input[i].BBox, input[j].BBox
			minH, maxH := minInt(a.H, b.H), maxInt(a.H, b.H)
			if minH < 3 || maxH > maxInt(12, h/5) || maxH > minH*3 {
				continue
			}
			gap := horizontalGap(a, b)
			if gap < 0 || gap > maxInt(4, maxH*4/5) {
				continue
			}
			overlap := verticalOverlap(a, b)
			baselineDelta := absInt((a.Y + a.H) - (b.Y + b.H))
			if overlap*2 < minH && baselineDelta*4 > maxH {
				continue
			}
			join(i, j)
		}
	}

	groups := map[int][]int{}
	order := make([]int, 0)
	for i := range input {
		r := root(i)
		if _, exists := groups[r]; !exists {
			order = append(order, r)
		}
		groups[r] = append(groups[r], i)
	}
	result := make([]Block, 0, len(groups))
	for _, r := range order {
		members := groups[r]
		merged := input[members[0]]
		if len(members) > 1 {
			merged.Pixels = nil
			merged.InkArea = 0
			merged.BBox = Rect{X: w, Y: h}
			maxX, maxY := 0, 0
			weightedX, weightedY := 0.0, 0.0
			for _, index := range members {
				part := input[index]
				merged.Pixels = append(merged.Pixels, part.Pixels...)
				merged.InkArea += part.InkArea
				weightedX += part.CentroidX * float64(part.InkArea)
				weightedY += part.CentroidY * float64(part.InkArea)
				merged.BBox.X = minInt(merged.BBox.X, part.BBox.X)
				merged.BBox.Y = minInt(merged.BBox.Y, part.BBox.Y)
				maxX = maxInt(maxX, part.BBox.X+part.BBox.W)
				maxY = maxInt(maxY, part.BBox.Y+part.BBox.H)
			}
			merged.BBox.W, merged.BBox.H = maxX-merged.BBox.X, maxY-merged.BBox.Y
			merged.CentroidX = weightedX / float64(merged.InkArea)
			merged.CentroidY = weightedY / float64(merged.InkArea)
		}
		result = append(result, merged)
	}
	return result
}

func horizontalGap(a, b Rect) int     { return maxInt(a.X, b.X) - minInt(a.X+a.W, b.X+b.W) }
func verticalGap(a, b Rect) int       { return maxInt(a.Y, b.Y) - minInt(a.Y+a.H, b.Y+b.H) }
func horizontalOverlap(a, b Rect) int { return minInt(a.X+a.W, b.X+b.W) - maxInt(a.X, b.X) }
func verticalOverlap(a, b Rect) int   { return minInt(a.Y+a.H, b.Y+b.H) - maxInt(a.Y, b.Y) }
func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}
func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
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
