#!/usr/bin/env bash
set -euo pipefail
mkdir -p public/wasm
GOOS=js GOARCH=wasm go build -o public/wasm/imaging.wasm ./wasm-src
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" public/wasm/wasm_exec.js 2>/dev/null || cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" public/wasm/wasm_exec.js
