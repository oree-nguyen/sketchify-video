package main

import "math"

type Point struct{ X, Y float64 }
type DrawUnit struct {
	Type    string
	BlockID int
	Path    []Point
	Pixels  []int
	Color   Color
	BBox    Rect
	Cost    float64
	T0, T1  float64
}

// VectorUnits posterize toàn bộ pixel của block, CCL theo mã màu, rồi trace/RDP từng shape.
func VectorUnits(rgba []byte, width int, block Block, levels, minArea int) []DrawUnit {
	samples := make([]Color, 0, len(block.Pixels))
	for _, p := range block.Pixels {
		j := p * 4
		samples = append(samples, Color{int(rgba[j]), int(rgba[j+1]), int(rgba[j+2])})
	}
	palette := MedianCut(samples, levels)
	if len(palette) == 0 {
		return nil
	}
	inside, codes, seen := map[int]bool{}, map[int]int{}, map[int]bool{}
	for _, p := range block.Pixels {
		inside[p] = true
		j := p * 4
		codes[p] = nearest(Color{int(rgba[j]), int(rgba[j+1]), int(rgba[j+2])}, palette)
	}
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
		if len(pixels) < minArea {
			continue
		}
		bw, bh := maxX-minX+1, maxY-minY+1
		mask := make([]uint8, bw*bh)
		for _, p := range pixels {
			mask[(p/width-minY)*bw+p%width-minX] = 1
		}
		path := ResamplePath(RDPSimplify(TraceContour(mask, bw, bh), .8), 2)
		for i := range path {
			path[i].X += float64(minX)
			path[i].Y += float64(minY)
		}
		units = append(units, DrawUnit{Type: "path", Path: path, Pixels: pixels, Color: palette[code], BBox: Rect{minX, minY, bw, bh}, Cost: float64(len(path))/2 + math.Sqrt(float64(len(pixels)))})
	}
	return units
}

// TraceContour đi biên ngoài bằng Moore-neighbor. Điều kiện dừng là quay về điểm đầu;
// điểm đầu không được thêm lần hai nên đường kín không tạo đoạn zero-length.
func TraceContour(mask []uint8, w, h int) []Point {
	start := -1
	for i, on := range mask {
		if on != 0 {
			start = i
			break
		}
	}
	if start < 0 {
		return nil
	}
	if countMask(mask) <= 2 {
		return []Point{{X: float64(start % w), Y: float64(start / w)}}
	}
	// Thứ tự ngược kim đồng hồ; quét bắt đầu từ điểm backtrack chính là quy tắc Moore.
	directions := [][2]int{{0, -1}, {-1, -1}, {-1, 0}, {-1, 1}, {0, 1}, {1, 1}, {1, 0}, {1, -1}}
	p, backDir := start, 2 // backtrack ban đầu là pixel phía tây.
	path := []Point{{X: float64(p % w), Y: float64(p / w)}}
	limit := 4 * (w + h)
	for steps := 0; steps < limit; steps++ {
		x, y := p%w, p/w
		next, found := -1, -1
		for offset := 0; offset < 8; offset++ {
			dir := (backDir + offset) % 8
			nx, ny := x+directions[dir][0], y+directions[dir][1]
			if nx >= 0 && nx < w && ny >= 0 && ny < h && mask[ny*w+nx] != 0 {
				next, found = ny*w+nx, dir
				break
			}
		}
		if next < 0 || (next == start && len(path) > 2) {
			break
		} // Jacob: trở lại điểm đầu sau một vòng.
		path = append(path, Point{X: float64(next % w), Y: float64(next / w)})
		p, backDir = next, (found+7)%8 // láng giềng ngay trước điểm vào là backtrack mới.
	}
	return path
}
func countMask(mask []uint8) int {
	n := 0
	for _, v := range mask {
		if v != 0 {
			n++
		}
	}
	return n
}

// RDPSimplify bỏ các điểm gần đoạn thẳng nhất; không thay đổi hai đầu của đường.
func RDPSimplify(path []Point, epsilon float64) []Point {
	if len(path) < 3 {
		return append([]Point(nil), path...)
	}
	farthest, distance := 0, -1.0
	for i := 1; i < len(path)-1; i++ {
		d := pointSegmentDistance(path[i], path[0], path[len(path)-1])
		if d > distance {
			farthest, distance = i, d
		}
	}
	if distance <= epsilon {
		return []Point{path[0], path[len(path)-1]}
	}
	left := RDPSimplify(path[:farthest+1], epsilon)
	right := RDPSimplify(path[farthest:], epsilon)
	return append(left[:len(left)-1], right...)
}
func pointSegmentDistance(p, a, b Point) float64 {
	dx, dy := b.X-a.X, b.Y-a.Y
	if dx == 0 && dy == 0 {
		return math.Hypot(p.X-a.X, p.Y-a.Y)
	}
	t := ((p.X-a.X)*dx + (p.Y-a.Y)*dy) / (dx*dx + dy*dy)
	if t < 0 {
		t = 0
	}
	if t > 1 {
		t = 1
	}
	return math.Hypot(p.X-(a.X+t*dx), p.Y-(a.Y+t*dy))
}

// ResamplePath giữ khoảng cách điểm xấp xỉ spacing để tốc độ bút đều.
func ResamplePath(path []Point, spacing float64) []Point {
	if len(path) < 2 || spacing <= 0 {
		return path
	}
	out := []Point{path[0]}
	carry := 0.0
	for i := 1; i < len(path); i++ {
		a, b := path[i-1], path[i]
		dx, dy := b.X-a.X, b.Y-a.Y
		length := math.Hypot(dx, dy)
		for carry+length >= spacing && length > 0 {
			need := spacing - carry
			t := need / length
			a = Point{a.X + dx*t, a.Y + dy*t}
			out = append(out, a)
			dx, dy = b.X-a.X, b.Y-a.Y
			length = math.Hypot(dx, dy)
			carry = 0
		}
		carry += length
	}
	if out[len(out)-1] != path[len(path)-1] {
		out = append(out, path[len(path)-1])
	}
	return out
}
