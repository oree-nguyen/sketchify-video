# Sketchify Video

Sketchify Video biến các ảnh PNG/JPG thành một video whiteboard gồm nhiều khung hình. Mọi xử lý diễn ra trong trình duyệt: không có tài khoản, backend, AI hoặc dữ liệu ảnh được tải lên máy chủ.

Giao diện hiện có timeline theo chiều dọc/ngang, preview, chọn một kiểu bàn tay dùng xuyên suốt dự án, thời lượng từng khung và hiệu ứng chuyển cảnh. Ảnh chụp màn hình sẽ được bổ sung khi có bản phát hành đầu tiên.

## Phát triển

Yêu cầu Node.js và Go.

```bash
npm ci
bash scripts/build-wasm.sh
npm run dev
```

## Build production

```bash
bash scripts/build-wasm.sh && npm run build
```

Thư mục đầu ra là `dist/`.

## Deploy GitHub Pages

Push lên nhánh `main`. Workflow [deploy.yml](.github/workflows/deploy.yml) sẽ build WASM, build Vite và deploy bằng GitHub Actions. Trên GitHub, bật **Settings → Pages → Source: GitHub Actions** một lần.

## Hai thiết lập đáng chú ý

- `mergeRadius`: khoảng cách dùng để gộp các vùng ảnh gần nhau. Tăng nếu ảnh có nhiều chi tiết vụn; giảm nếu các đối tượng khác nhau bị gộp nhầm.
- `orderMode`: cách sắp xếp thứ tự vẽ. Chế độ kể chuyện ưu tiên các khối nội dung có ý nghĩa thay vì chỉ quét theo tọa độ ảnh.

## Pipeline

| Tầng | Việc làm | Vị trí |
| --- | --- | --- |
| 0 | Tiền xử lý, Sobel, ngưỡng màu | `wasm-src/` |
| 1 | Gom vùng liên thông | `wasm-src/` |
| 2 | Phân loại vector/ảnh chụp | `wasm-src/` |
| 3 | Sinh nét/vùng vẽ | `wasm-src/` |
| 4 | Ráp timeline và thời lượng | `src/state/` + WASM |
| 5 | Preview, camera, ghi video | `src/App.tsx` |

## Giới hạn đã biết

Xuất `.webm` có thể không phát trên Safari cũ; chưa hỗ trợ `.mp4`. Ảnh quá nhiều chi tiết nên tăng `mergeRadius`. Build cần Go và Node, nên không mở trực tiếp bằng double-click `index.html`.

## Nâng cấp sau

Xuất `.mp4` bằng `ffmpeg.wasm`, ảnh bàn tay tùy chỉnh, xử lý hàng loạt và chroma-key thủ công. Không làm tách nền bằng AI vì trái với ràng buộc dự án.

## License

AGPL-3.0-only. Xem [LICENSE](LICENSE).
