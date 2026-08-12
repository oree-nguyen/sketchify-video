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
		b.Kind = ClassifyBlock(rgba, w, *b, s)
		out = append(out, *b)
	}
	out = MergeTextBlocks(out, rgba, w, h)
	filtered := out[:0]
	for i := range out {
		if out[i].InkArea < s.MinBlockInk {
			continue
		}
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
func MergeTextBlocks(input []Block, rgba []byte, w, h int) []Block {
	if len(input) < 2 {
		return input
	}
	colors := make([]Color, len(input))
	for i := range input {
		colors[i] = averageBlockColor(input[i], rgba, w)
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

	// Dấu tiếng Việt chỉ được gắn vào thân chữ gần nhất. Việc chọn duy nhất một
	// đích ngăn một dấu nhỏ tạo cầu nối dây chuyền giữa nhiều chữ/vật thể.
	for i := range input {
		best, bestScore := -1, int(^uint(0)>>1)
		for j := range input {
			if i == j || input[j].BBox.H > maxInt(18, h/5) || input[i].BBox.H*2 > input[j].BBox.H || input[i].InkArea*3 > input[j].InkArea*2 {
				continue
			}
			if horizontalOverlap(input[i].BBox, input[j].BBox) <= 0 || colorDelta(colors[i], colors[j]) > 72 {
				continue
			}
			gap := maxInt(0, verticalGap(input[i].BBox, input[j].BBox))
			if gap <= maxInt(3, input[j].BBox.H/3) {
				score := gap*4 + absInt(rectCenterX(input[i].BBox)-rectCenterX(input[j].BBox))
				if score < bestScore {
					best, bestScore = j, score
				}
			}
		}
		if best >= 0 {
			join(i, best)
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
	parts := make([]Block, 0, len(groups))
	for _, r := range order {
		members := make([]Block, 0, len(groups[r]))
		for _, index := range groups[r] {
			members = append(members, input[index])
		}
		parts = append(parts, mergeBlocks(members, w, h))
	}

	// Lập từng hàng theo chiều cao + baseline của seed cố định, sau đó mới sắp xếp
	// trái->phải và cắt theo khoảng trắng. Không union từng cặp xuyên hàng.
	sort.SliceStable(parts, func(i, j int) bool {
		if absInt(parts[i].BBox.Y-parts[j].BBox.Y) <= 3 {
			return parts[i].BBox.X < parts[j].BBox.X
		}
		return parts[i].BBox.Y < parts[j].BBox.Y
	})
	used := make([]bool, len(parts))
	result := make([]Block, 0, len(parts))
	for seedIndex, seed := range parts {
		if used[seedIndex] {
			continue
		}
		if !isTextPart(seed, h) {
			used[seedIndex] = true
			result = append(result, seed)
			continue
		}
		seedColor := averageBlockColor(seed, rgba, w)
		rowIndices := make([]int, 0)
		for candidateIndex, candidate := range parts {
			if used[candidateIndex] || !isTextPart(candidate, h) {
				continue
			}
			minH, maxH := minInt(seed.BBox.H, candidate.BBox.H), maxInt(seed.BBox.H, candidate.BBox.H)
			baselineDelta := absInt((seed.BBox.Y + seed.BBox.H) - (candidate.BBox.Y + candidate.BBox.H))
			if maxH*10 <= minH*15 && baselineDelta*10 <= maxH*7 && colorDelta(seedColor, averageBlockColor(candidate, rgba, w)) <= 58 {
				rowIndices = append(rowIndices, candidateIndex)
			}
		}
		sort.Slice(rowIndices, func(i, j int) bool { return parts[rowIndices[i]].BBox.X < parts[rowIndices[j]].BBox.X })
		for start := 0; start < len(rowIndices); {
			end := start + 1
			for end < len(rowIndices) {
				left, right := parts[rowIndices[end-1]], parts[rowIndices[end]]
				maxH := maxInt(left.BBox.H, right.BBox.H)
				gap := horizontalGap(left.BBox, right.BBox)
				if gap < -maxH/3 || gap > maxInt(4, maxH*2/3) {
					break
				}
				end++
			}
			run := make([]Block, 0, end-start)
			for _, index := range rowIndices[start:end] {
				used[index] = true
				run = append(run, parts[index])
			}
			result = append(result, mergeBlocks(run, w, h))
			start = end
		}
	}
	return result
}

func isTextPart(block Block, imageHeight int) bool {
	box := block.BBox
	if box.H < 5 || box.H > maxInt(18, imageHeight/4) || box.W > maxInt(box.H*4, 40) {
		return false
	}
	density := float64(block.InkArea) / float64(maxInt(1, box.W*box.H))
	return density >= 0.04 && density <= 0.72
}

func mergeBlocks(parts []Block, w, h int) Block {
	merged := parts[0]
	if len(parts) == 1 {
		return merged
	}
	merged.Pixels = nil
	merged.InkArea = 0
	merged.BBox = Rect{X: w, Y: h}
	maxX, maxY := 0, 0
	weightedX, weightedY := 0.0, 0.0
	allVector := true
	for _, part := range parts {
		merged.Pixels = append(merged.Pixels, part.Pixels...)
		merged.InkArea += part.InkArea
		weightedX += part.CentroidX * float64(part.InkArea)
		weightedY += part.CentroidY * float64(part.InkArea)
		merged.BBox.X = minInt(merged.BBox.X, part.BBox.X)
		merged.BBox.Y = minInt(merged.BBox.Y, part.BBox.Y)
		maxX = maxInt(maxX, part.BBox.X+part.BBox.W)
		maxY = maxInt(maxY, part.BBox.Y+part.BBox.H)
		allVector = allVector && part.Kind == "vector"
	}
	merged.BBox.W, merged.BBox.H = maxX-merged.BBox.X, maxY-merged.BBox.Y
	merged.CentroidX = weightedX / float64(merged.InkArea)
	merged.CentroidY = weightedY / float64(merged.InkArea)
	if allVector {
		merged.Kind = "vector"
	} else {
		merged.Kind = "photo"
	}
	return merged
}

func averageBlockColor(block Block, rgba []byte, width int) Color {
	if len(rgba) == 0 || width <= 0 || len(block.Pixels) == 0 {
		return Color{}
	}
	r, g, b, count := 0, 0, 0, 0
	step := maxInt(1, len(block.Pixels)/256)
	for i := 0; i < len(block.Pixels); i += step {
		offset := block.Pixels[i] * 4
		if offset < 0 || offset+2 >= len(rgba) {
			continue
		}
		r += int(rgba[offset])
		g += int(rgba[offset+1])
		b += int(rgba[offset+2])
		count++
	}
	if count == 0 {
		return Color{}
	}
	return Color{r / count, g / count, b / count}
}

func colorDelta(a, b Color) int { return absInt(a.R-b.R) + absInt(a.G-b.G) + absInt(a.B-b.B) }
func rectCenterX(rect Rect) int { return rect.X + rect.W/2 }

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
