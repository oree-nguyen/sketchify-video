// Giữ entrypoint cũ nhưng dùng chung hợp đồng browser/WASM đầy đủ để tránh hai bộ test lệch nhau.
await import('./cdp-camera-follow-e2e.mjs')
