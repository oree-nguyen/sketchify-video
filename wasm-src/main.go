//go:build js && wasm

// Sketchify Video chạy thuật toán xử lý ảnh trong WebAssembly, không mở server.
package main

import "syscall/js"

func main() {
	// API chỉ nhận TypedArray; ảnh không bao giờ rời khỏi bộ nhớ trình duyệt.
	js.Global().Set("wbImaging", map[string]interface{}{
		"version": "0.2.0",
		"analyze": js.FuncOf(analyzeJS),
	})
	select {}
}

func analyzeJS(_ js.Value, args []js.Value) interface{} {
	if len(args) < 4 {
		return map[string]interface{}{"error": "Thiếu dữ liệu ảnh"}
	}
	width, height := args[1].Int(), args[2].Int()
	if width < 1 || height < 1 {
		return map[string]interface{}{"error": "Kích thước ảnh không hợp lệ"}
	}
	rgba := make([]byte, width*height*4)
	js.CopyBytesToGo(rgba, args[0])
	settings := settingsFromJS(args[3])
	result := Analyze(rgba, width, height, settings)
	if settings.OrderMode == "custom" && len(settings.CustomOrder) > 0 {
		result.Blocks = applyCustomOrder(result.Blocks, settings.CustomOrder)
	}
	units := BuildUnits(rgba, width, result.Blocks, settings)
	blocks := make([]interface{}, len(result.Blocks))
	for i, b := range result.Blocks {
		blocks[i] = map[string]interface{}{"id": b.ID, "bbox": rectJS(b.BBox), "centroid": map[string]interface{}{"x": b.CentroidX, "y": b.CentroidY}, "inkArea": b.InkArea, "pixels": intsJS(b.Pixels), "kind": b.Kind}
	}
	jsUnits := make([]interface{}, len(units))
	for i, u := range units {
		path := make([]float64, 0, len(u.Path)*2)
		for _, p := range u.Path {
			path = append(path, p.X, p.Y)
		}
		jsUnits[i] = map[string]interface{}{"type": u.Type, "blockId": u.BlockID, "bbox": rectJS(u.BBox), "pixels": intsJS(u.Pixels), "path": floatsJS(path), "color": intsJS([]int{u.Color.R, u.Color.G, u.Color.B}), "cost": u.Cost, "t0": u.T0, "t1": u.T1}
	}
	return map[string]interface{}{"img": map[string]interface{}{"rgba": bytesJS(rgba), "gray": bytesJS(Gray(rgba)), "ink": bytesJS(InkMask(rgba, width, height, settings, result.Background)), "w": width, "h": height, "bg": intsJS([]int{result.Background.R, result.Background.G, result.Background.B})}, "blocks": blocks, "units": jsUnits, "stats": map[string]interface{}{"blocks": len(blocks), "units": len(units), "mergeRadiusConfigured": settings.MergeRadius, "mergeRadiusApplied": result.EffectiveMergeRadius, "workingWidthActual": width, "openingApplied": result.OpeningApplied}}
}

func rectJS(r Rect) map[string]interface{} {
	return map[string]interface{}{"x": r.X, "y": r.Y, "w": r.W, "h": r.H}
}
func intsJS(values []int) []interface{} {
	out := make([]interface{}, len(values))
	for i, v := range values {
		out[i] = v
	}
	return out
}
func floatsJS(values []float64) []interface{} {
	out := make([]interface{}, len(values))
	for i, v := range values {
		out[i] = v
	}
	return out
}
func bytesJS(values []byte) js.Value {
	typed := js.Global().Get("Uint8Array").New(len(values))
	js.CopyBytesToJS(typed, values)
	return typed
}

func settingsFromJS(v js.Value) Settings {
	s := DefaultSettings()
	if n := v.Get("edgeThreshold"); n.Type() == js.TypeNumber {
		s.EdgeThreshold = n.Int()
	}
	if n := v.Get("bgTolerance"); n.Type() == js.TypeNumber {
		s.BGTolerance = n.Int()
	}
	// Region merging is intentionally locked off. Keeping the field in the data
	// contract preserves project compatibility, but callers cannot override 0px.
	s.MergeRadius = 0
	if n := v.Get("minBlockInk"); n.Type() == js.TypeNumber {
		s.MinBlockInk = n.Int()
	}
	if n := v.Get("workingWidth"); n.Type() == js.TypeNumber {
		s.WorkingWidth = n.Int()
	}
	if n := v.Get("rowThresholdFactor"); n.Type() == js.TypeNumber {
		s.RowThresholdFactor = n.Float()
	}
	if n := v.Get("photoDensityThreshold"); n.Type() == js.TypeNumber {
		s.PhotoDensityThreshold = n.Float()
	}
	if n := v.Get("probeColors"); n.Type() == js.TypeNumber {
		s.ProbeColors = n.Int()
	}
	if n := v.Get("minProbeRegion"); n.Type() == js.TypeNumber {
		s.MinProbeRegion = n.Int()
	}
	if n := v.Get("vectorLevels"); n.Type() == js.TypeNumber {
		s.VectorPosterizeLevels = n.Int()
	}
	if n := v.Get("photoClusters"); n.Type() == js.TypeNumber {
		s.PhotoColorClusters = n.Int()
	}
	if n := v.Get("vectorMinRegionArea"); n.Type() == js.TypeNumber {
		s.MinRegionArea = n.Int()
	}
	if n := v.Get("photoMinRegionArea"); n.Type() == js.TypeNumber {
		s.MinRegionArea = n.Int()
	}
	if n := v.Get("orderMode"); n.Type() == js.TypeString {
		s.OrderMode = n.String()
	}
	if n := v.Get("customOrder"); n.Type() == js.TypeObject && n.Get("length").Type() == js.TypeNumber {
		for i := 0; i < n.Length(); i++ {
			if n.Index(i).Type() == js.TypeNumber {
				s.CustomOrder = append(s.CustomOrder, n.Index(i).Int())
			}
		}
	}
	return s
}
