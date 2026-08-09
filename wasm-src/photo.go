package main

// PhotoRegions phân cụm màu TOÀN CỤC rồi mới CCL theo mã màu độc lập.
// Tuyệt đối không so ngưỡng giữa pixel liền kề để tránh gradient nối dây chuyền.
func PhotoRegions(rgba []byte, width int, block Block, clusters, minArea int) []DrawUnit {
	samples := make([]Color, 0, len(block.Pixels))
	step := 1
	if len(block.Pixels) > 30000 {
		step = len(block.Pixels)/30000 + 1
	}
	for i, p := range block.Pixels {
		if i%step == 0 {
			j := p * 4
			samples = append(samples, Color{int(rgba[j]), int(rgba[j+1]), int(rgba[j+2])})
		}
	}
	palette := MedianCut(samples, clusters)
	if len(palette) == 0 {
		return nil
	}
	inside := make(map[int]bool, len(block.Pixels))
	codes := make(map[int]int, len(block.Pixels))
	for _, p := range block.Pixels {
		inside[p] = true
		j := p * 4
		codes[p] = nearest(Color{int(rgba[j]), int(rgba[j+1]), int(rgba[j+2])}, palette)
	}
	seen := make(map[int]bool, len(block.Pixels))
	units := []DrawUnit{}
	for _, start := range block.Pixels {
		if seen[start] {
			continue
		}
		code := codes[start]
		stack := []int{start}
		seen[start] = true
		pixels := []int{}
		minX, minY, maxX, maxY := width, start/width, 0, 0
		for len(stack) > 0 {
			p := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			pixels = append(pixels, p)
			x, y := p%width, p/width
			if x < minX {
				minX = x
			}
			if x > maxX {
				maxX = x
			}
			if y < minY {
				minY = y
			}
			if y > maxY {
				maxY = y
			}
			for _, q := range []int{p - 1, p + 1, p - width, p + width} {
				if q >= 0 && inside[q] && !seen[q] && codes[q] == code && !(q == p-1 && x == 0) && !(q == p+1 && x == width-1) {
					seen[q] = true
					stack = append(stack, q)
				}
			}
		}
		if len(pixels) >= minArea {
			units = append(units, DrawUnit{Type: "area", Pixels: pixels, Color: palette[code], BBox: Rect{minX, minY, maxX - minX + 1, maxY - minY + 1}, Cost: mathSqrt(float64(len(pixels))) * 2})
		}
	}
	return units
}
func mathSqrt(v float64) float64 { // Newton đủ chính xác để không cần dependency ngoài math ở file này.
	if v <= 0 {
		return 0
	}
	x := v
	for i := 0; i < 12; i++ {
		x = (x + v/x) / 2
	}
	return x
}
