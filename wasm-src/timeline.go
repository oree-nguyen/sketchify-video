package main

// BuildUnits tạo DrawUnit thật theo kind và phân bổ t0/t1 theo cost.
func BuildUnits(rgba []byte, w int, blocks []Block, s Settings) []DrawUnit {
	out := []DrawUnit{}
	for _, b := range blocks {
		var u []DrawUnit
		if b.Kind == "photo" {
			u = PhotoRegions(rgba, w, b, s.PhotoColorClusters, s.MinRegionArea)
		} else {
			u = VectorUnits(rgba, w, b, s.VectorPosterizeLevels, s.MinRegionArea)
		}
		u = mergeUnassignedPixels(u, b, rgba, w)
		for i := range u {
			u[i].BlockID = b.ID
		}
		out = append(out, u...)
	}
	total := 0.0
	for _, u := range out {
		total += u.Cost
	}
	if total == 0 {
		return out
	}
	at := 0.0
	for i := range out {
		out[i].T0 = at / total
		at += out[i].Cost
		out[i].T1 = at / total
	}
	return out
}

// mergeUnassignedPixels bảo đảm Tầng 3 không làm mất pixel khi loại region nhỏ.
func mergeUnassignedPixels(units []DrawUnit, block Block, rgba []byte, width int) []DrawUnit {
	if len(block.Pixels) == 0 {
		return units
	}
	if len(units) == 0 {
		pixels := append([]int(nil), block.Pixels...)
		return []DrawUnit{{Type: "area", Pixels: pixels, Color: averagePixelColor(rgba, pixels), BBox: bboxForPixels(pixels, width), Cost: mathSqrt(float64(len(pixels))) * 2}}
	}
	owner := make(map[int]int, len(block.Pixels))
	for i := range units {
		for _, p := range units[i].Pixels {
			owner[p] = i
		}
	}
	pending := make([]int, 0)
	for _, p := range block.Pixels {
		if _, ok := owner[p]; !ok {
			pending = append(pending, p)
		}
	}
	for round := 0; round < 3 && len(pending) > 0; round++ {
		next := make([]int, 0)
		for _, p := range pending {
			best, bestArea := -1, -1
			x := p % width
			for _, q := range []int{p - 1, p + 1, p - width, p + width} {
				if q < 0 || (q == p-1 && x == 0) || (q == p+1 && x == width-1) {
					continue
				}
				if idx, ok := owner[q]; ok && len(units[idx].Pixels) > bestArea {
					best, bestArea = idx, len(units[idx].Pixels)
				}
			}
			if best < 0 {
				next = append(next, p)
				continue
			}
			units[best].Pixels = append(units[best].Pixels, p)
			owner[p] = best
		}
		pending = next
	}
	largest := 0
	for i := 1; i < len(units); i++ {
		if len(units[i].Pixels) > len(units[largest].Pixels) {
			largest = i
		}
	}
	for _, p := range pending {
		units[largest].Pixels = append(units[largest].Pixels, p)
	}
	for i := range units {
		units[i].BBox = bboxForPixels(units[i].Pixels, width)
		if units[i].Type == "area" {
			units[i].Cost = mathSqrt(float64(len(units[i].Pixels))) * 2
		} else {
			units[i].Cost = float64(len(units[i].Path))/2 + mathSqrt(float64(len(units[i].Pixels)))
		}
	}
	return units
}
func bboxForPixels(pixels []int, width int) Rect {
	minX, minY, maxX, maxY := width, int(^uint(0)>>1), 0, 0
	for _, p := range pixels {
		x, y := p%width, p/width
		if x < minX {
			minX = x
		}
		if y < minY {
			minY = y
		}
		if x > maxX {
			maxX = x
		}
		if y > maxY {
			maxY = y
		}
	}
	return Rect{minX, minY, maxX - minX + 1, maxY - minY + 1}
}
func averagePixelColor(rgba []byte, pixels []int) Color {
	r, g, b := 0, 0, 0
	for _, p := range pixels {
		j := p * 4
		r += int(rgba[j])
		g += int(rgba[j+1])
		b += int(rgba[j+2])
	}
	n := len(pixels)
	return Color{r / n, g / n, b / n}
}
