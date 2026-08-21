package main

type watershedNode struct { index, label int }

// MarkerControlledWatershed floods low-gradient pixels from explicit markers.
// Label -2 denotes a watershed boundary and is never silently assigned to an
// object. This keeps atomic regions available for graph refinement.
func MarkerControlledWatershed(gradient []uint8, markers []int, w, h int) []int {
	labels := make([]int, w*h)
	for i := range labels { labels[i] = -1 }
	var buckets [256][]watershedNode
	queued := 0
	for i, marker := range markers {
		if i >= len(labels) || marker < 0 { continue }
		labels[i] = marker
		bucket := int(gradientAt(gradient, i)); buckets[bucket] = append(buckets[bucket], watershedNode{index:i, label:marker}); queued++
	}
	current := 0
	for queued > 0 {
		bucket := -1
		for current < len(buckets) && len(buckets[current]) == 0 { current++ }
		if current < len(buckets) { bucket = current }
		if bucket < 0 { break }
		last := len(buckets[bucket])-1; n := buckets[bucket][last]; buckets[bucket] = buckets[bucket][:last]; queued--
		x, y := n.index%w, n.index/w
		for _, next := range watershedNeighbours(n.index, x, y, w, h) {
			if labels[next] == -1 {
				labels[next] = n.label
				level := int(gradientAt(gradient, next)); buckets[level] = append(buckets[level], watershedNode{index:next, label:n.label}); queued++
			} else if labels[next] != n.label && labels[next] >= 0 {
				labels[next] = -2
			}
		}
	}
	return labels
}

func gradientAt(values []uint8, index int) uint8 { if index < 0 || index >= len(values) { return 255 }; return values[index] }
func watershedNeighbours(index, x, y, w, h int) []int {
	out := make([]int, 0, 4)
	if x > 0 { out = append(out, index-1) }; if x+1 < w { out = append(out, index+1) }; if y > 0 { out = append(out, index-w) }; if y+1 < h { out = append(out, index+w) }
	return out
}
