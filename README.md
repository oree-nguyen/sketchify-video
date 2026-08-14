# Sketchify Video

Sketchify Video biến các ảnh PNG/JPG thành một video whiteboard gồm nhiều khung hình. Pipeline tách khối, vẽ, camera và xuất video chạy hoàn toàn trong trình duyệt; Pollinations AI là nguồn nội dung tuỳ chọn và chỉ gọi mạng khi người dùng bấm tạo ảnh/video.

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

## Pollinations AI (tuỳ chọn)

Tạo App Key công khai (`pk_…`) tại Pollinations, đăng ký callback chính xác:

```text
https://oree-nguyen.github.io/sketchify-video/auth/callback/
```

Có thể nhập App Key trong hộp “Kết nối AI”, hoặc cấu hình `VITE_POLLINATIONS_APP_KEY` lúc build. Scoped access key của từng người dùng được lưu ở `localStorage` key `wb.pollinations.key`; ứng dụng không ghi key ra console. Mỗi lần tạo ảnh/giọng đọc tiêu Pollen của người dùng và UI luôn báo số lượt gọi ước tính trước khi chạy chế độ storyboard.

Luồng BYOP dùng fragment redirect legacy mà Pollinations vẫn hỗ trợ cho client tĩnh. Kịch bản, ảnh và audio được gọi tuần tự; lỗi tại một cảnh không xoá các cảnh đã xong và có thể thử lại riêng cảnh lỗi.

## Lồng tiếng trong trình duyệt và phiên làm việc

TTS chạy trực tiếp trong một Web Worker riêng. Người dùng chỉ chọn ngôn ngữ và tên giọng; bộ định tuyến nội bộ tự chọn pipeline phù hợp. Giọng Việt và giọng kiểm thử tiếng Anh được tải lazy từ `public/voices/`; ONNX Runtime, phonemizer và từ điển phát âm được phục vụ cùng origin, nên không gọi dịch vụ TTS trả phí. Dữ liệu dự án được tự động lưu vào IndexedDB sau khoảng 2 giây và có thể tạo/mở/đổi tên/xoá snapshot trong menu **Phiên làm việc**. Session chỉ lưu ảnh, settings và audio WAV dạng base64; dữ liệu phân tích được tính lại khi khôi phục.

Kiểm tra model tiếng Anh qua runtime web thật:

```bash
npm run test:matcha-web
```

Xem nguồn và license của model/runtime tại [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Hai thiết lập đáng chú ý

- `mergeRadius`: được cố định ở `0px` theo hợp đồng hiện tại và không hiển thị trong UI.
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
