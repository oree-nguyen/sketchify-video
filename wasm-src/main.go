//go:build js && wasm

// Sketchify Video chạy thuật toán xử lý ảnh trong WebAssembly, không mở server.
package main

import (
	"encoding/binary"
	"math"
	"sort"
	"syscall/js"
	"time"
)

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
	started := time.Now()
	result := Analyze(rgba, width, height, settings)
	analyzeElapsed := float64(time.Since(started).Microseconds()) / 1000
	if settings.OrderMode == "custom" && len(settings.CustomOrder) > 0 {
		result.Blocks = applyCustomOrder(result.Blocks, settings.CustomOrder)
	}
	units := BuildUnitsWithCoverage(rgba, width, result.Blocks, result.CoveragePixels, settings)
	blocks := make([]interface{}, len(result.Blocks))
	for i, b := range result.Blocks {
		blocks[i] = map[string]interface{}{"id": b.ID, "bbox": rectJS(b.BBox), "centroid": map[string]interface{}{"x": b.CentroidX, "y": b.CentroidY}, "inkArea": b.InkArea, "pixels": uint32JS(b.Pixels), "kind": b.Kind}
	}
	objects := make([]interface{}, len(result.Blocks))
	for i, b := range result.Blocks {
		objects[i] = map[string]interface{}{"id": b.ID, "role": "thing", "bbox": rectJS(b.BBox), "visibleMaskRle": uint32JS(maskRLE(b.Pixels)), "centroid": map[string]interface{}{"x": b.CentroidX, "y": b.CentroidY}, "confidence": 0.0, "children": []interface{}{}, "mergeHistory": nil, "kind": b.Kind, "provenance": []interface{}{map[string]interface{}{"source": "legacy-cascade", "note": "provisional complex-branch candidate"}}}
	}
	coverageLayers := []interface{}{}
	if len(result.CoveragePixels) > 0 {
		coverageLayers = append(coverageLayers, map[string]interface{}{"id": "coverage:residual", "maskRle": uint32JS(maskRLE(result.CoveragePixels)), "revealPolicy": "base", "reason": "residual"})
	}
	jsUnits := make([]interface{}, len(units))
	unitsV2 := make([]interface{}, len(units))
	for i, u := range units {
		path := make([]float64, 0, len(u.Path)*2)
		for _, p := range u.Path {
			path = append(path, p.X, p.Y)
		}
		role := u.Role
		if role == "" {
			role = "object"
			if u.BlockID < 0 {
				role = "coverage"
			}
		}
		jsUnits[i] = map[string]interface{}{"type": u.Type, "role": role, "blockId": u.BlockID, "bbox": rectJS(u.BBox), "pixels": uint32JS(u.Pixels), "path": float32JS(path), "color": uint8JS([]byte{byte(u.Color.R), byte(u.Color.G), byte(u.Color.B)}), "cost": u.Cost, "t0": u.T0, "t1": u.T1}
		var owner interface{} = u.BlockID
		if u.BlockID < 0 {
			owner = nil
		}
		unitsV2[i] = map[string]interface{}{"type": u.Type, "role": role, "blockId": owner, "bbox": rectJS(u.BBox), "pixelsRle": uint32JS(maskRLE(u.Pixels)), "path": float32JS(path), "color": intsJS([]int{u.Color.R, u.Color.G, u.Color.B}), "cost": u.Cost, "t0": u.T0, "t1": u.T1}
	}
	architecture := result.Architecture
	if architecture == "" {
		architecture = "legacy"
	}
	ownership := CheckOwnership(result.Blocks, result.CoveragePixels, width*height)
	reconstruction := "incomplete"
	if ownership.Duplicate == 0 && ownership.Missing == 0 && ownership.Invalid == 0 {
		reconstruction = "exact" // objects + residual coverage form the full frame.
	}
	routeMode := "simple"
	if result.SegmentationMode == "saliency" { routeMode = "complex" }
	routeConfidence := result.BackgroundVariance/50 + result.BackgroundEntropy/8
	if routeConfidence > 1 { routeConfidence = 1 }
	routeReasons := []interface{}{"background variance and entropy evaluated in Go/WASM"}
	if routeMode == "complex" { routeReasons = append(routeReasons, "complex branch selected because texture/entropy exceeded thresholds") } else { routeReasons = append(routeReasons, "simple branch selected because background is low-variance") }
	warnings := []interface{}{"Semantic OCR/detector/SAM model lanes are not configured; legacy candidates are provisional and must not be used as benchmark evidence."}
	if reconstruction != "exact" { warnings = append(warnings, "Ownership invariant failed: residual coverage does not partition the source image exactly.") }
	diagnostics := map[string]interface{}{
		"architecture": "v2-cascade", "mode": map[bool]string{true: "complex", false: "standard"}[result.SegmentationMode == "saliency"],
		"route": map[string]interface{}{"mode": routeMode, "confidence": routeConfidence, "reasons": routeReasons},
		"timingsMs": map[string]interface{}{"wasmAnalyze": analyzeElapsed}, "proposalCountsBySource": map[string]interface{}{"legacy-cascade": len(result.Blocks), "watershed": result.AtomicRegionCount},
		"rejected": []interface{}{}, "mergeEvents": []interface{}{}, "splitEvents": []interface{}{},
		"lanesAttempted": []interface{}{"legacy-cascade", "ocr", "known-object-detector", "unknown-object-sam"}, "lanesUsed": []interface{}{"legacy-cascade"},
		"fallbackLanes": []interface{}{"ocr", "known-object-detector", "unknown-object-sam"}, "warnings": warnings,
		"proposalCount": len(result.Blocks), "finalObjectCount": len(result.Blocks), "objectCount": len(result.Blocks), "coveragePixelCount": len(result.CoveragePixels),
		"reconstruction": reconstruction, "reconstructionMismatch": ownership.Duplicate + ownership.Missing + ownership.Invalid, "executionProviders": map[string]interface{}{"go-cues": "wasm"}, "evaluated": false,
	}
	return map[string]interface{}{"version": 2, "img": map[string]interface{}{"rgba": bytesJS(rgba), "gray": bytesJS(Gray(rgba)), "ink": bytesJS(result.Ink), "saliency": bytesJS(result.Saliency), "w": width, "h": height, "bg": intsJS([]int{result.Background.R, result.Background.G, result.Background.B})}, "blocks": blocks, "objects": objects, "coverageLayers": coverageLayers, "units": jsUnits, "unitsV2": unitsV2, "diagnostics": diagnostics, "stats": map[string]interface{}{"blocks": len(blocks), "units": len(units), "objectBlocks": len(blocks), "coveragePixels": len(result.CoveragePixels), "atomicRegions": result.AtomicRegionCount, "architecture": architecture, "mergeRadiusConfigured": settings.MergeRadius, "mergeRadiusApplied": result.EffectiveMergeRadius, "workingWidthActual": width, "openingApplied": result.OpeningApplied, "segmentationMode": result.SegmentationMode, "backgroundVariance": result.BackgroundVariance, "backgroundEntropy": result.BackgroundEntropy, "saliencyThreshold": result.SaliencyThreshold}}
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

func maskRLE(values []int) []int {
	if len(values) == 0 {
		return nil
	}
	copyValues := append([]int(nil), values...)
	sort.Ints(copyValues)
	runs := make([]int, 0)
	start, previous := copyValues[0], copyValues[0]
	for _, value := range copyValues[1:] {
		if value == previous || value == previous+1 {
			previous = value
			continue
		}
		runs = append(runs, start, previous-start+1)
		start, previous = value, value
	}
	return append(runs, start, previous-start+1)
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

func uint8JS(values []byte) js.Value { return bytesJS(values) }

// Typed arrays are part of the V2 browser contract. Returning a Go slice here
// makes syscall/js panic with "invalid value" and is explicitly forbidden.
func uint32JS(values []int) js.Value {
	bytes := make([]byte, len(values)*4)
	for i, value := range values { binary.LittleEndian.PutUint32(bytes[i*4:], uint32(value)) }
	view := js.Global().Get("Uint8Array").New(len(bytes)); js.CopyBytesToJS(view, bytes)
	return js.Global().Get("Uint32Array").New(view.Get("buffer"))
}

func float32JS(values []float64) js.Value {
	bytes := make([]byte, len(values)*4)
	for i, value := range values { binary.LittleEndian.PutUint32(bytes[i*4:], math.Float32bits(float32(value))) }
	view := js.Global().Get("Uint8Array").New(len(bytes)); js.CopyBytesToJS(view, bytes)
	return js.Global().Get("Float32Array").New(view.Get("buffer"))
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
	if n := v.Get("segmentationMode"); n.Type() == js.TypeString {
		s.SegmentationMode = n.String()
	}
	if n := v.Get("bgVarianceThreshold"); n.Type() == js.TypeNumber {
		s.BGVarianceThreshold = n.Float()
	}
	if n := v.Get("bgEntropyThreshold"); n.Type() == js.TypeNumber {
		s.BGEntropyThreshold = n.Float()
	}
	if n := v.Get("saliencyPercentile"); n.Type() == js.TypeNumber {
		s.SaliencyPercentile = n.Float()
	}
	if n := v.Get("cascadeDebugMask"); n.Type() == js.TypeNumber {
		s.CascadeDebugMask = n.Int() & 31
	}
	if n := v.Get("cascadeColorClusters"); n.Type() == js.TypeNumber {
		s.CascadeColorClusters = maxInt(2, minInt(16, n.Int()))
	}
	return s
}
