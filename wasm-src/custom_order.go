package main

func applyCustomOrder(blocks []Block, order []int) []Block {
	byID := map[int]Block{}
	for _, b := range blocks {
		byID[b.ID] = b
	}
	out := make([]Block, 0, len(blocks))
	used := map[int]bool{}
	for _, id := range order {
		if b, ok := byID[id]; ok && !used[id] {
			out = append(out, b)
			used[id] = true
		}
	}
	for _, b := range blocks {
		if !used[b.ID] {
			out = append(out, b)
		}
	}
	for i := range out {
		out[i].ID = i
	}
	return out
}
