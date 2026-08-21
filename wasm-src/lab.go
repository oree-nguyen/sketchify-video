package main

import "math"

// LabGradientCue combines perceptual colour distance with the existing Sobel
// edge cue. It is intentionally a cue map: it never declares an editorial
// object by itself.
func LabGradientCue(rgba []byte, w, h int) []uint8 {
	if w <= 0 || h <= 0 { return nil }
	gray := Gray(rgba)
	sobel := SobelMagnitude(gray, w, h)
	out := make([]uint8, w*h)
	for i := 0; i < w*h; i++ {
		j := i * 4
		if j+2 >= len(rgba) { break }
		// A compact Lab-like opponent transform is sufficient for boundary
		// ranking and avoids a second large float image in the WASM heap.
		r, g, b := float64(rgba[j])/255, float64(rgba[j+1])/255, float64(rgba[j+2])/255
		l := 0.2126*r + 0.7152*g + 0.0722*b
		a := r - g
		bb := g - b
		if i%w == 0 || i%w == w-1 || i/w == 0 || i/w == h-1 { out[i] = sobel[i]; continue }
		prev := i - 1
		next := i + 1
		up := i - w
		down := i + w
		jp, jn, ju, jd := prev*4, next*4, up*4, down*4
		colour := math.Abs(l-(0.2126*float64(rgba[jp])/255+0.7152*float64(rgba[jp+1])/255+0.0722*float64(rgba[jp+2])/255))
		colour += math.Abs(a-(float64(rgba[jn])-float64(rgba[jn+1]))/255)
		colour += math.Abs(bb-(float64(rgba[ju+1])-float64(rgba[ju+2]))/255)
		colour += math.Abs(bb-(float64(rgba[jd+1])-float64(rgba[jd+2]))/255)
		value := float64(sobel[i])*.65 + math.Min(1, colour)*255*.35
		out[i] = uint8(math.Max(0, math.Min(255, value)))
	}
	return out
}
