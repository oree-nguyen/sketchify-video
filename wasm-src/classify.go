package main

import "sort"

// MedianCut tạo palette toàn cục bằng cách luôn chẻ hộp có biên màu lớn nhất.
func MedianCut(samples []Color, count int) []Color {
	if len(samples) == 0 || count < 1 {
		return nil
	}
	boxes := [][]Color{append([]Color(nil), samples...)}
	for len(boxes) < count {
		best, spread := -1, -1
		axis := 0
		for i, b := range boxes {
			if len(b) < 2 {
				continue
			}
			lo, hi := [3]int{255, 255, 255}, [3]int{}
			for _, c := range b {
				v := [3]int{c.R, c.G, c.B}
				for k := 0; k < 3; k++ {
					if v[k] < lo[k] {
						lo[k] = v[k]
					}
					if v[k] > hi[k] {
						hi[k] = v[k]
					}
				}
			}
			for k := 0; k < 3; k++ {
				if hi[k]-lo[k] > spread {
					best, spread, axis = i, hi[k]-lo[k], k
				}
			}
		}
		if best < 0 {
			break
		}
		sort.SliceStable(boxes[best], func(i, j int) bool {
			a, b := boxes[best][i], boxes[best][j]
			if axis == 0 {
				return a.R < b.R
			}
			if axis == 1 {
				return a.G < b.G
			}
			return a.B < b.B
		})
		m := len(boxes[best]) / 2
		right := append([]Color(nil), boxes[best][m:]...)
		boxes[best] = boxes[best][:m]
		boxes = append(boxes, right)
	}
	out := make([]Color, 0, len(boxes))
	for _, b := range boxes {
		sr, sg, sb := 0, 0, 0
		for _, c := range b {
			sr += c.R
			sg += c.G
			sb += c.B
		}
		out = append(out, Color{sr / len(b), sg / len(b), sb / len(b)})
	}
	return out
}
func nearest(c Color, p []Color) int {
	best, d := 0, 1<<30
	for i, v := range p {
		x := colorDistance(c.R, c.G, c.B, v)
		if x < d {
			best, d = i, x
		}
	}
	return best
}

// ClassifyBlock đo density region theo palette toàn cục; khối nhỏ luôn là vector.
func ClassifyBlock(rgba []byte, w int, b Block, s Settings) string {
	area := b.BBox.W * b.BBox.H
	if area < 2500 {
		return "vector"
	}
	sample := make([]Color, 0)
	step := 1
	if area > 20000 {
		step = area/20000 + 1
	}
	for y := b.BBox.Y; y < b.BBox.Y+b.BBox.H; y++ {
		for x := b.BBox.X; x < b.BBox.X+b.BBox.W; x++ {
			if ((y-b.BBox.Y)*b.BBox.W+x-b.BBox.X)%step == 0 {
				j := (y*w + x) * 4
				sample = append(sample, Color{int(rgba[j]), int(rgba[j+1]), int(rgba[j+2])})
			}
		}
	}
	palette := MedianCut(sample, s.ProbeColors)
	if len(palette) == 0 {
		return "vector"
	}
	mask := make([]uint8, area)
	for y := 0; y < b.BBox.H; y++ {
		for x := 0; x < b.BBox.W; x++ {
			j := ((b.BBox.Y+y)*w + b.BBox.X + x) * 4
			mask[y*b.BBox.W+x] = uint8(nearest(Color{int(rgba[j]), int(rgba[j+1]), int(rgba[j+2])}, palette) + 1)
		}
	}
	seen := make([]bool, area)
	regions := 0
	for i := range mask {
		if seen[i] {
			continue
		}
		code := mask[i]
		stack := []int{i}
		seen[i] = true
		n := 0
		for len(stack) > 0 {
			p := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			n++
			x, y := p%b.BBox.W, p/b.BBox.W
			for _, q := range []int{p - 1, p + 1, p - b.BBox.W, p + b.BBox.W} {
				if q >= 0 && q < area && !seen[q] && mask[q] == code && !(q == p-1 && x == 0) && !(q == p+1 && x == b.BBox.W-1) && !(q == p-b.BBox.W && y == 0) && !(q == p+b.BBox.W && y == b.BBox.H-1) {
					seen[q] = true
					stack = append(stack, q)
				}
			}
		}
		if n >= s.MinProbeRegion {
			regions++
		}
	}
	if float64(regions)/float64(area) > s.PhotoDensityThreshold {
		return "photo"
	}
	return "vector"
}
