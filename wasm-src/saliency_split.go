package main

// SplitOversizedSaliencyBlocks cắt các cầu nối mảnh còn sót trong một component
// rất lớn bằng valley của projection profile. Chỉ chạy ở nhánh saliency; pipeline
// nền đơn giản giữ nguyên tuyệt đối.
func SplitOversizedSaliencyBlocks(blocks []Block, rgba []byte, w, h int, settings Settings) []Block {
	out := make([]Block, 0, len(blocks))
	for _, block := range blocks {
		out = append(out, splitSaliencyBlock(block, rgba, w, h, settings, 0)...)
	}
	return out
}

func splitSaliencyBlock(block Block, rgba []byte, w, h int, settings Settings, depth int) []Block {
	if depth >= 1 || len(block.Pixels) < settings.MinBlockInk*2 {
		return []Block{block}
	}
	boxArea := block.BBox.W * block.BBox.H
	// Complex illustrations often place several long objects on adjacent rows.
	// A proposal does not need to cover a quarter of the canvas to be oversized:
	// a wide 10%-height strip can still contain two separate aircraft. Small,
	// compact proposals remain untouched.
	if boxArea < w*h*8/100 && !(block.BBox.W > w/4 && block.BBox.H > h*15/100) {
		return []Block{block}
	}
	type candidate struct {
		axis      byte
		position  int
		ratio     float64
		leftCount int
	}
	best := candidate{ratio: 1e9}
	for _, axis := range []byte{'x', 'y'} {
		length := block.BBox.W
		origin := block.BBox.X
		if axis == 'y' {
			length, origin = block.BBox.H, block.BBox.Y
		}
		if length < 24 {
			continue
		}
		profile := make([]int, length)
		for _, pixel := range block.Pixels {
			coordinate := pixel%w - origin
			if axis == 'y' {
				coordinate = pixel/w - origin
			}
			if coordinate >= 0 && coordinate < length {
				profile[coordinate]++
			}
		}
		prefix := 0
		mean := float64(len(block.Pixels)) / float64(length)
		for index, count := range profile {
			prefix += count
			if index < length/5 || index > length*4/5 || prefix < settings.MinBlockInk || len(block.Pixels)-prefix < settings.MinBlockInk {
				continue
			}
			ratio := float64(count) / maxFloat(1, mean)
			// Ưu tiên valley sâu và gần tâm, tránh cắt một dải nhỏ sát mép.
			ratio += abs(float64(index-length/2)) / float64(length) * .12
			if ratio < best.ratio {
				best = candidate{axis: axis, position: origin + index, ratio: ratio, leftCount: prefix}
			}
		}
	}
	if best.axis == 0 || best.ratio > .42 {
		return []Block{block}
	}
	firstPixels := make([]int, 0, best.leftCount)
	secondPixels := make([]int, 0, len(block.Pixels)-best.leftCount)
	for _, pixel := range block.Pixels {
		coordinate := pixel % w
		if best.axis == 'y' {
			coordinate = pixel / w
		}
		if coordinate <= best.position {
			firstPixels = append(firstPixels, pixel)
		} else {
			secondPixels = append(secondPixels, pixel)
		}
	}
	if len(firstPixels) < settings.MinBlockInk || len(secondPixels) < settings.MinBlockInk {
		return []Block{block}
	}
	first := blockFromPixels(firstPixels, rgba, w, settings)
	second := blockFromPixels(secondPixels, rgba, w, settings)
	minimumChildArea := w * h / 700
	if first.BBox.W*first.BBox.H < minimumChildArea || second.BBox.W*second.BBox.H < minimumChildArea {
		return []Block{block}
	}
	return append(splitSaliencyBlock(first, rgba, w, h, settings, depth+1), splitSaliencyBlock(second, rgba, w, h, settings, depth+1)...)
}

func blockFromPixels(pixels []int, rgba []byte, width int, settings Settings) Block {
	bbox := bboxForPixels(pixels, width)
	x, y := 0.0, 0.0
	for _, pixel := range pixels {
		x += float64(pixel % width)
		y += float64(pixel / width)
	}
	block := Block{BBox: bbox, InkArea: len(pixels), CentroidX: x / float64(len(pixels)), CentroidY: y / float64(len(pixels)), Pixels: pixels, Kind: "vector"}
	block.Kind = ClassifyBlock(rgba, width, block, settings)
	return block
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}
