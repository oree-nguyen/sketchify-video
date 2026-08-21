package main

import "testing"

func TestMarkerControlledWatershedKeepsMarkerBasinsSeparate(t *testing.T) {
	gradient := []uint8{0, 4, 8, 4, 0, 4, 20, 20, 20, 4, 0, 4, 8, 4, 0}
	markers := make([]int, len(gradient)); for i := range markers { markers[i] = -1 }; markers[0] = 1; markers[4] = 2
	labels := MarkerControlledWatershed(gradient, markers, 5, 3)
	if labels[0] != 1 || labels[4] != 2 { t.Fatalf("markers lost: %#v", labels) }
	seen := map[int]bool{}; for _, label := range labels { if label >= 0 { seen[label] = true } }
	if len(seen) < 2 { t.Fatalf("expected separate basins, got %#v", labels) }
}
