package main

import (
	"math"
	"math/cmplx"
	"sort"
)

const saliencyWorkSize = 64

// BackgroundComplexity tái sử dụng đúng dải viền 3px của EstimateBackground.
// Giá trị variance được báo theo độ lệch chuẩn RGB trung bình để cùng thang 0..255.
func BackgroundComplexity(rgba []byte, w, h int) (variance, entropy float64) {
	if w < 1 || h < 1 || len(rgba) < w*h*4 {
		return 0, 0
	}
	counts := map[int]int{}
	var sums, squares [3]float64
	n := 0
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if x >= 3 && y >= 3 && x < w-3 && y < h-3 {
				continue
			}
			i := (y*w + x) * 4
			values := [3]float64{float64(rgba[i]), float64(rgba[i+1]), float64(rgba[i+2])}
			for channel, value := range values {
				sums[channel] += value
				squares[channel] += value * value
			}
			key := int(rgba[i]>>4)<<8 | int(rgba[i+1]>>4)<<4 | int(rgba[i+2]>>4)
			counts[key]++
			n++
		}
	}
	if n == 0 {
		return 0, 0
	}
	channelVariance := 0.0
	for channel := 0; channel < 3; channel++ {
		mean := sums[channel] / float64(n)
		channelVariance += math.Max(0, squares[channel]/float64(n)-mean*mean)
	}
	variance = math.Sqrt(channelVariance / 3)
	for _, count := range counts {
		p := float64(count) / float64(n)
		entropy -= p * math.Log2(p)
	}
	return variance, entropy
}

// SpectralResidualSaliency cài đặt Hou & Zhang (2007) trên lưới 64x64.
// FFT radix-2 chạy theo hàng rồi cột; kết quả cuối được nội suy song tuyến tính
// về kích thước ảnh làm việc và chuẩn hóa 0..255.
func SpectralResidualSaliency(gray []uint8, w, h int) []uint8 {
	if w < 1 || h < 1 || len(gray) < w*h {
		return make([]uint8, maxInt(0, w*h))
	}
	size := saliencyWorkSize
	resized := resizeGrayBilinear(gray, w, h, size, size)
	spectrum := make([]complex128, size*size)
	mean := 0.0
	for _, value := range resized {
		mean += float64(value)
	}
	mean /= float64(len(resized))
	for i, value := range resized {
		spectrum[i] = complex(float64(value)-mean, 0)
	}
	fft2D(spectrum, size, size, false)
	logAmplitude := make([]float64, len(spectrum))
	phase := make([]float64, len(spectrum))
	for i, value := range spectrum {
		logAmplitude[i] = math.Log(cmplx.Abs(value) + 1e-9)
		phase[i] = cmplx.Phase(value)
	}
	average := boxBlur3(logAmplitude, size, size)
	for i := range spectrum {
		amplitude := math.Exp(logAmplitude[i] - average[i])
		spectrum[i] = cmplx.Rect(amplitude, phase[i])
	}
	fft2D(spectrum, size, size, true)
	raw := make([]float64, len(spectrum))
	for i, value := range spectrum {
		magnitude := cmplx.Abs(value)
		raw[i] = magnitude * magnitude
	}
	raw = gaussianBlur5(raw, size, size)
	upscaled := resizeFloatBilinear(raw, size, size, w, h)
	return normalizeBytes(upscaled)
}

func PercentileThreshold(values []uint8, percentile float64) uint8 {
	if len(values) == 0 {
		return 255
	}
	if percentile < 0 {
		percentile = 0
	}
	if percentile > 100 {
		percentile = 100
	}
	copyValues := append([]uint8(nil), values...)
	sort.Slice(copyValues, func(i, j int) bool { return copyValues[i] < copyValues[j] })
	index := int(math.Round(percentile / 100 * float64(len(copyValues)-1)))
	return copyValues[index]
}

func fft2D(values []complex128, w, h int, inverse bool) {
	row := make([]complex128, w)
	for y := 0; y < h; y++ {
		copy(row, values[y*w:(y+1)*w])
		fft(row, inverse)
		copy(values[y*w:(y+1)*w], row)
	}
	column := make([]complex128, h)
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			column[y] = values[y*w+x]
		}
		fft(column, inverse)
		for y := 0; y < h; y++ {
			values[y*w+x] = column[y]
		}
	}
}

func fft(values []complex128, inverse bool) {
	n := len(values)
	for i, j := 1, 0; i < n; i++ {
		bit := n >> 1
		for ; j&bit != 0; bit >>= 1 {
			j ^= bit
		}
		j ^= bit
		if i < j {
			values[i], values[j] = values[j], values[i]
		}
	}
	sign := -1.0
	if inverse {
		sign = 1
	}
	for length := 2; length <= n; length <<= 1 {
		angle := sign * 2 * math.Pi / float64(length)
		root := complex(math.Cos(angle), math.Sin(angle))
		for start := 0; start < n; start += length {
			factor := complex(1, 0)
			for offset := 0; offset < length/2; offset++ {
				even, odd := values[start+offset], factor*values[start+offset+length/2]
				values[start+offset], values[start+offset+length/2] = even+odd, even-odd
				factor *= root
			}
		}
	}
	if inverse {
		for i := range values {
			values[i] /= complex(float64(n), 0)
		}
	}
}

func boxBlur3(input []float64, w, h int) []float64 {
	out := make([]float64, len(input))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			sum, count := 0.0, 0.0
			for dy := -1; dy <= 1; dy++ {
				for dx := -1; dx <= 1; dx++ {
					nx, ny := minInt(w-1, maxInt(0, x+dx)), minInt(h-1, maxInt(0, y+dy))
					sum += input[ny*w+nx]
					count++
				}
			}
			out[y*w+x] = sum / count
		}
	}
	return out
}

func gaussianBlur5(input []float64, w, h int) []float64 {
	kernel := [...]float64{1, 4, 6, 4, 1}
	tmp, out := make([]float64, len(input)), make([]float64, len(input))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			for k := -2; k <= 2; k++ {
				tmp[y*w+x] += input[y*w+minInt(w-1, maxInt(0, x+k))] * kernel[k+2] / 16
			}
		}
	}
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			for k := -2; k <= 2; k++ {
				out[y*w+x] += tmp[minInt(h-1, maxInt(0, y+k))*w+x] * kernel[k+2] / 16
			}
		}
	}
	return out
}

func resizeGrayBilinear(input []uint8, sw, sh, dw, dh int) []uint8 {
	values := make([]float64, len(input))
	for i, value := range input {
		values[i] = float64(value)
	}
	resized := resizeFloatBilinear(values, sw, sh, dw, dh)
	out := make([]uint8, len(resized))
	for i, value := range resized {
		out[i] = uint8(math.Round(math.Max(0, math.Min(255, value))))
	}
	return out
}

func resizeFloatBilinear(input []float64, sw, sh, dw, dh int) []float64 {
	out := make([]float64, dw*dh)
	for y := 0; y < dh; y++ {
		sy := (float64(y)+.5)*float64(sh)/float64(dh) - .5
		y0 := maxInt(0, minInt(sh-1, int(math.Floor(sy))))
		y1 := minInt(sh-1, y0+1)
		fy := math.Max(0, sy-float64(y0))
		for x := 0; x < dw; x++ {
			sx := (float64(x)+.5)*float64(sw)/float64(dw) - .5
			x0 := maxInt(0, minInt(sw-1, int(math.Floor(sx))))
			x1 := minInt(sw-1, x0+1)
			fx := math.Max(0, sx-float64(x0))
			top := input[y0*sw+x0]*(1-fx) + input[y0*sw+x1]*fx
			bottom := input[y1*sw+x0]*(1-fx) + input[y1*sw+x1]*fx
			out[y*dw+x] = top*(1-fy) + bottom*fy
		}
	}
	return out
}

func normalizeBytes(values []float64) []uint8 {
	out := make([]uint8, len(values))
	if len(values) == 0 {
		return out
	}
	minimum, maximum := values[0], values[0]
	for _, value := range values[1:] {
		minimum = math.Min(minimum, value)
		maximum = math.Max(maximum, value)
	}
	span := maximum - minimum
	if span <= 1e-12 {
		return out
	}
	for i, value := range values {
		out[i] = uint8(math.Round((value - minimum) / span * 255))
	}
	return out
}
