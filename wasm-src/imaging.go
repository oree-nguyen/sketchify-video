package main

import "math"

// Color là một màu RGB không premultiply alpha.
type Color struct{ R, G, B int }

// Settings tập hợp các tham số CV có giá trị mặc định theo đặc tả.
type Settings struct {
	WorkingWidth, EdgeThreshold, BGTolerance, MergeRadius, MinBlockInk                    int
	RowThresholdFactor                                                                    float64
	PhotoDensityThreshold                                                                 float64
	ProbeColors, MinProbeRegion, VectorPosterizeLevels, PhotoColorClusters, MinRegionArea int
	OrderMode                                                                             string
	CustomOrder                                                                           []int
	SegmentationMode                                                                      string
	BGVarianceThreshold, BGEntropyThreshold, SaliencyPercentile                           float64
}

func DefaultSettings() Settings {
	return Settings{WorkingWidth: 960, EdgeThreshold: 42, BGTolerance: 34, MergeRadius: 0, MinBlockInk: 60, RowThresholdFactor: .6, PhotoDensityThreshold: .0025, ProbeColors: 8, MinProbeRegion: 12, VectorPosterizeLevels: 8, PhotoColorClusters: 10, MinRegionArea: 40, OrderMode: "auto-row", SegmentationMode: "auto", BGVarianceThreshold: 15, BGEntropyThreshold: 2.5, SaliencyPercentile: 75}
}

// Gray chuyển RGBA sang độ sáng; input/output tuyến tính O(w*h).
func Gray(rgba []byte) []uint8 {
	out := make([]uint8, len(rgba)/4)
	for i := range out {
		j := i * 4
		out[i] = uint8((299*int(rgba[j]) + 587*int(rgba[j+1]) + 114*int(rgba[j+2])) / 1000)
	}
	return out
}

// SobelMagnitude dùng nhân Sobel 3x3, viền ảnh được xem là 0; O(w*h).
func SobelMagnitude(gray []uint8, w, h int) []uint8 {
	out := make([]uint8, w*h)
	for y := 1; y < h-1; y++ {
		for x := 1; x < w-1; x++ {
			p := func(dx, dy int) int { return int(gray[(y+dy)*w+x+dx]) }
			gx := p(1, -1) + 2*p(1, 0) + p(1, 1) - p(-1, -1) - 2*p(-1, 0) - p(-1, 1)
			gy := p(-1, 1) + 2*p(0, 1) + p(1, 1) - p(-1, -1) - 2*p(0, -1) - p(1, -1)
			v := int(math.Sqrt(float64(gx*gx + gy*gy)))
			if v > 255 {
				v = 255
			}
			out[y*w+x] = uint8(v)
		}
	}
	return out
}

// EstimateBackground lấy mode lượng tử hoá ở viền dày 3px rồi trung bình chính xác trong ô đó.
func EstimateBackground(rgba []byte, w, h int) Color {
	bins := map[int]int{}
	border := func(x, y int) bool { return x < 3 || y < 3 || x >= w-3 || y >= h-3 }
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if border(x, y) {
				j := (y*w + x) * 4
				k := int(rgba[j]>>4)<<8 | int(rgba[j+1]>>4)<<4 | int(rgba[j+2]>>4)
				bins[k]++
			}
		}
	}
	best, bn := 0, -1
	for k, n := range bins {
		if n > bn {
			best, bn = k, n
		}
	}
	sr, sg, sb, n := 0, 0, 0, 0
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if border(x, y) {
				j := (y*w + x) * 4
				k := int(rgba[j]>>4)<<8 | int(rgba[j+1]>>4)<<4 | int(rgba[j+2]>>4)
				if k == best {
					sr += int(rgba[j])
					sg += int(rgba[j+1])
					sb += int(rgba[j+2])
					n++
				}
			}
		}
	}
	if n == 0 {
		return Color{255, 255, 255}
	}
	return Color{sr / n, sg / n, sb / n}
}
func colorDistance(r, g, b int, c Color) int {
	dr, dg, db := r-c.R, g-c.G, b-c.B
	// BGTolerance biểu diễn mức lệch trung bình trên một kênh. Chuẩn hoá theo
	// sqrt(3) để bóng xám nhẹ không bị phóng đại và biến thành cầu nối ink.
	return int(math.Sqrt(float64(dr*dr+dg*dg+db*db) / 3))
}

// InkMask kết hợp Sobel và chênh lệch nền để vùng màu phẳng không bị rỗng.
func InkMask(rgba []byte, w, h int, s Settings, bg Color) []uint8 {
	gray := Gray(rgba)
	edge := SobelMagnitude(gray, w, h)
	out := make([]uint8, w*h)
	for i := range out {
		j := i * 4
		if int(edge[i]) > s.EdgeThreshold || colorDistance(int(rgba[j]), int(rgba[j+1]), int(rgba[j+2]), bg) > s.BGTolerance {
			out[i] = 1
		}
	}
	return out
}

// DilateSquare dùng prefix-sum ngang/dọc O(w*h), không phụ thuộc bán kính.
func DilateSquare(mask []uint8, w, h, r int) []uint8 {
	if r <= 0 {
		return append([]uint8(nil), mask...)
	}
	tmp := make([]uint8, w*h)
	for y := 0; y < h; y++ {
		pref := make([]int, w+1)
		for x := 0; x < w; x++ {
			pref[x+1] = pref[x] + int(mask[y*w+x])
		}
		for x := 0; x < w; x++ {
			a, b := x-r, x+r
			if a < 0 {
				a = 0
			}
			if b >= w {
				b = w - 1
			}
			if pref[b+1]-pref[a] > 0 {
				tmp[y*w+x] = 1
			}
		}
	}
	out := make([]uint8, w*h)
	for x := 0; x < w; x++ {
		pref := make([]int, h+1)
		for y := 0; y < h; y++ {
			pref[y+1] = pref[y] + int(tmp[y*w+x])
		}
		for y := 0; y < h; y++ {
			a, b := y-r, y+r
			if a < 0 {
				a = 0
			}
			if b >= h {
				b = h - 1
			}
			if pref[b+1]-pref[a] > 0 {
				out[y*w+x] = 1
			}
		}
	}
	return out
}

// ErodeSquare cũng dùng prefix-sum; kết hợp Erode rồi Dilate tạo opening lọc đốm.
func ErodeSquare(mask []uint8, w, h, r int) []uint8 {
	if r <= 0 {
		return append([]uint8(nil), mask...)
	}
	tmp := make([]uint8, w*h)
	for y := 0; y < h; y++ {
		pref := make([]int, w+1)
		for x := 0; x < w; x++ {
			pref[x+1] = pref[x] + int(mask[y*w+x])
		}
		for x := 0; x < w; x++ {
			a, b := x-r, x+r
			if a < 0 {
				a = 0
			}
			if b >= w {
				b = w - 1
			}
			if pref[b+1]-pref[a] == b-a+1 {
				tmp[y*w+x] = 1
			}
		}
	}
	out := make([]uint8, w*h)
	for x := 0; x < w; x++ {
		pref := make([]int, h+1)
		for y := 0; y < h; y++ {
			pref[y+1] = pref[y] + int(tmp[y*w+x])
		}
		for y := 0; y < h; y++ {
			a, b := y-r, y+r
			if a < 0 {
				a = 0
			}
			if b >= h {
				b = h - 1
			}
			if pref[b+1]-pref[a] == b-a+1 {
				out[y*w+x] = 1
			}
		}
	}
	return out
}
