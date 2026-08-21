# I.Plan — Kiến trúc tách vật thể cho nền phức tạp

## 0. Trạng thái và mục tiêu của tài liệu

Tài liệu này là kế hoạch thay kiến trúc tách vật thể nền phức tạp sau khi đối chiếu:

- pipeline Go/WASM hiện tại trong `wasm-src/`;
- `phanbietvatthe.md`;
- lịch sử các commit `a79bab0`, `27310e9`, `14e3d8d` và `a252566`;
- prompt “Chuỗi 5 thuật toán bổ trợ (cascade)”;
- kết quả thật của `testthuattoanmoi (1).png` ở commit `a252566`;
- ảnh tham chiếu 16 vật thể mà kết quả mới phải hướng tới.

Đây chưa phải bản triển khai. Không được tiếp tục chỉnh vài ngưỡng trong pipeline hiện tại rồi coi là đã thực hiện kế hoạch này.

### Mục tiêu cứng

1. Giữ nguyên tuyệt đối nhánh nền trắng/nền đơn giản đã ổn định.
2. Ảnh nền phức tạp phải tạo ra **vật thể biên tập có nghĩa**, không phải các vùng màu hoặc các ô saliency.
3. Với fixture `testthuattoanmoi (1).png`, kết quả mục tiêu là đúng 16 vật thể biên tập như ảnh tham chiếu:

   1. cụm ba dấu hỏi;
   2. nhân vật khủng long;
   3. cụm `99%`;
   4. dòng `TẠI SAO`;
   5. banner đen `MÁY BAY`;
   6. banner đỏ `CHỈ SƠN MÀU TRẮNG?`;
   7. máy bay trắng lớn;
   8. máy bay xanh;
   9. đài kiểm soát không lưu;
   10. máy bay đỏ-vàng;
   11. máy bay Bamboo;
   12–16. năm cụm icon + nhãn ở hàng dưới.

4. Không còn merge nhầm hai vật thể rõ ràng và không còn vỡ một vật thể thành nhiều mảnh vô nghĩa.
5. Ảnh render cuối vẫn khớp ảnh gốc, nhưng **pixel nền không được giả làm pixel của vật thể**.
6. Không có quy tắc runtime phụ thuộc tọa độ riêng của ảnh sân bay, ví dụ “ưu tiên mép phải”, “chia lưới 4×3 để giữ quota”, hoặc “vật thể dài thường là máy bay”.

## 1. Kết luận điều tra commit `a252566`

Commit `a252566` không đạt mục tiêu tách vật thể. Nó chỉ đạt hai thuộc tính kỹ thuật khác:

- sinh được một số proposal trong khoảng cho phép;
- mọi pixel cuối cùng được gán vào một `Block`/`DrawUnit`, nên ảnh kết thúc được tái dựng đầy đủ.

Hai thuộc tính trên không chứng minh proposal là vật thể.

### 1.1 Các lỗi gốc

| Lỗi kiến trúc | Biểu hiện | Vì sao không thể sửa chỉ bằng đổi ngưỡng |
|---|---|---|
| Đồng nhất “phủ đủ pixel” với “mọi pixel thuộc vật thể” | Trời, đường băng và texture dư bị hút vào các seed | Nền là `stuff`, không phải `thing`; cần lớp dữ liệu khác |
| Median-cut + CCL được dùng để đề xuất vật thể | Chữ, thân máy bay và nhân vật vỡ theo màu | Màu là thuộc tính bề mặt, không phải danh tính vật thể |
| Saliency được gọi là objectness | Vùng nổi bật được chọn dù chỉ là một chi tiết | Saliency đo độ thu hút thị giác, không nhận diện instance |
| Greedy NMS dùng bbox | Proposal lồng nhau hoặc che khuất nhau bị loại sai | Bbox có thể chồng mạnh trong khi mask thuộc hai vật thể khác nhau |
| `BBox` và `Pixels` mô tả hai miền khác nhau | Khung nhìn có vẻ đúng nhưng pixel bên trong thuộc vùng khác | Một `Block` mất invariant hình học cơ bản |
| Gán residual về seed gần nhất theo màu/khoảng cách | Seed tốt bị phình thành vùng vô nghĩa | Background không có seed vật thể hợp lệ để nhận nó |
| Quy tắc theo vị trí và hình dạng ảnh mẫu | Ưu tiên dải ngang, mép phải, quota 4×3 | Overfit bố cục, đổi ảnh là đổi lỗi |
| Gom chữ không có text detector/OCR | Chữ vỡ theo ký tự hoặc dính icon | Hình học CCL không phân biệt text, icon và texture |
| Test chỉ yêu cầu 8–36 khối | Kết quả 30 khối vẫn PASS | Khoảng đếm không đo merge/split đúng |
| Test landmark chỉ tìm bbox chứa điểm | Một điểm có thể nằm trong bbox sai hoặc bbox chồng | Không có ghép một-một với ground truth |

### 1.2 Sai lầm trong hợp đồng phủ pixel

Hợp đồng đúng phải là:

```text
visibleObjectMasks ∪ textMasks ∪ coverageLayers = toàn bộ pixel ảnh
```

chứ không phải:

```text
mọi pixel ảnh = pixel của một Object Block
```

Theo cách nhìn của panoptic segmentation, vật thể đếm được là `thing`; trời, sàn, tường và texture nền là `stuff`. Kiến trúc mới áp dụng đúng sự phân biệt này. Công trình Panoptic Segmentation cũng tách rõ instance/thing khỏi semantic/stuff và đưa ra Panoptic Quality để đánh giá toàn cảnh: <https://arxiv.org/abs/1801.00868>.

## 2. Định nghĩa “vật thể” của Sketchify Video

Ảnh tham chiếu cho thấy app không chỉ cần vật thể vật lý. App cần **đơn vị biên tập** để camera, thứ tự vẽ và thời lượng hoạt động hợp lý.

### 2.1 Bốn vai trò bắt buộc

```ts
type EditorialRole =
  | 'thing'       // người, máy bay, đài, đồ vật, icon độc lập
  | 'text-line'   // từ/dòng chữ được vẽ như một đơn vị
  | 'compound'    // banner + chữ, icon + nhãn, callout hoàn chỉnh
  | 'coverage'    // nền/stuff chỉ để tái dựng ảnh, không hiện trong danh sách vật thể
```

### 2.2 Quy tắc grouping của fixture tham chiếu

- Các glyph cùng dòng, cùng style và cùng cụm khoảng cách tạo một `text-line`.
- Text nằm trên một brush/banner có quan hệ containment rõ tạo một `compound` với banner.
- Icon và caption ngay dưới, cùng cột và khoảng cách nhỏ tạo một `compound`.
- Hai máy bay gần/chồng bbox vẫn là hai `thing` nếu mask và tâm instance khác nhau.
- Chi tiết bên trong máy bay, khuôn mặt, tay hoặc trang phục không trở thành vật thể riêng nếu có mask cha ổn định bao chúng.
- Nền trời, đường băng, nhà ga xa và các vùng sáng không xuất hiện trong danh sách vật thể; chúng thuộc `coverage`.

Đây là ontology cần được ghi vào fixture annotation và test. Nếu không chốt ontology, “đúng bao nhiêu vật thể” sẽ luôn mơ hồ.

## 3. Kiểm kê 2 thuật toán cũ và 5 tầng cascade

Trong mô tả hiện có, hai thuật toán cũ bị lặp lại bên trong năm tầng cascade. Kiến trúc mới vẫn dùng đủ tín hiệu, nhưng chỉ tính một lần và đăng ký provenance rõ ràng.

| ID | Thuật toán hiện có | Vai trò đúng trong kiến trúc mới | Không được phép làm |
|---|---|---|---|
| O1 | Sobel + sai màu nền + opening + CCL của nhánh chuẩn | Primary segmentation duy nhất cho nền trắng; cue biên/foreground phụ cho nền phức tạp | Tự nhận vùng là semantic object trên nền phức tạp |
| O2 | Spectral-residual saliency toàn cục + marker/split | Heatmap chú ý, gợi ý positive point và độ ưu tiên proposal | Làm owner pixel hoặc nhãn instance |
| C1 | Cascade tầng 1: Sobel + nền | Alias của O1; tái sử dụng buffer, không chạy lần hai | Sinh một pipeline trùng |
| C2 | Cascade tầng 2: global saliency | Alias của O2; tái sử dụng heatmap | OR vô điều kiện thành object mask |
| C3 | Local adaptive saliency | Bổ sung seed ở vùng tương phản cục bộ thấp/cao khác nhau | Cắt ảnh theo tile hoặc tự quyết định object |
| C4 | Median-cut + CCL/watershed vùng màu | Tạo atomic regions/superpixel và coverage candidates | Coi từng vùng màu là object; gán toàn residual cho object |
| C5 | Region merge có kiểm soát | Hợp nhất atomic regions bên trong **một proposal đã có bằng chứng** | Merge lan truyền toàn ảnh chỉ dựa màu, diện tích, tiếp xúc |

### 3.1 Thay đổi quan trọng đối với khái niệm cascade

Prompt cũ yêu cầu mỗi tầng chỉ xử lý pixel mà tầng trước bỏ lại. Quy tắc đó phù hợp với **coverage**, nhưng không phù hợp với **nhận diện vật thể**: một object detector hoặc mask refiner phải nhìn toàn vật thể và ngữ cảnh xung quanh nó.

Vì vậy pipeline mới có hai luồng:

```text
Object discovery: các cue chạy song song trên toàn ảnh → proposal graph → instance
Coverage: sau khi chốt instance → chỉ xử lý residual → coverage layer
```

Năm thuật toán vẫn được dùng đủ, nhưng không còn là năm phép OR/merge bất khả nghịch trên cùng một mask.

## 4. Kiến trúc đích

```text
Input RGBA
   │
   ├─ Background router
   │    ├─ simple/white ──> pipeline chuẩn hiện tại (đóng băng)
   │    └─ complex
   │
   └─ Complex segmentation orchestrator
        ├─ Shared CV maps (Lab, Sobel, saliency global/local)
        ├─ Text lane (text polygons + line/layout grouping)
        ├─ Known-object lane (instance detector)
        ├─ Unknown-object lane (classical proposals → MobileSAM prompts)
        ├─ Atomic-region lane (quantization + marker-controlled watershed)
        │
        └─ Proposal graph
             ├─ mask refinement
             ├─ merge/split with aggregate revalidation
             ├─ editorial grouping
             ├─ thing/text/compound selection
             └─ residual → coverage layers
                    │
                    └─ AnalysisResultV2 → DrawUnit scheduler → Player
```

### 4.1 Vì sao cần mô hình học máy

Sobel, CCL, màu và saliency không chứa thông tin để biết bốn chiếc máy bay là bốn instance, một thân máy bay có nhiều màu vẫn là một vật thể, hoặc banner + chữ nên là một đơn vị biên tập. Tiếp tục bổ sung heuristic thuần cổ điển không thể bảo đảm mục tiêu ảnh 1 trên ảnh bất kỳ.

Mô hình học máy là bắt buộc cho nhánh nền phức tạp, nhưng không được dùng như “hộp đen duy nhất”:

- detector tạo proposal instance có độ tin cậy cao;
- OCR/text detector tạo polygon chữ;
- MobileSAM tinh chỉnh mask theo box/point prompt và bắt các vật thể ngoài lớp detector;
- hai thuật toán cũ + năm tầng cascade tạo cue, atomic region và fallback;
- proposal graph kết hợp toàn bộ bằng chứng theo luật kiểm chứng được.

## 5. Lựa chọn công nghệ đã nghiên cứu

| Thành phần | Quyết định | Cơ sở |
|---|---|---|
| Runtime browser | `onnxruntime-web`; ưu tiên WebGPU, fallback WASM | ORT Web hỗ trợ inference trong browser; WASM hỗ trợ đầy đủ operator, WebGPU có tập operator giới hạn nên mỗi model phải qua compatibility spike: <https://onnxruntime.ai/docs/tutorials/web/> và <https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html> |
| Mask refiner | MobileSAM encoder + decoder ONNX | Repo chính thức hỗ trợ ONNX export và có demo browser; Apache-2.0: <https://github.com/ChaoningZhang/MobileSAM> |
| Automatic mask baseline | SAM/MobileSAM automatic mask generator chỉ dùng làm candidate, không dùng trực tiếp làm kết quả | SAM chính thức có automatic mask generation và ONNX mask decoder, nhưng mask tự động thường có nhiều cấp hạt khác nhau: <https://github.com/facebookresearch/segment-anything> |
| Text lane | PaddleOCR.js detection polygons; recognition chỉ dùng để củng cố grouping | Tài liệu chính thức có SDK browser, Worker, ONNX Runtime Web và trả `poly/text/score`: <https://github.com/PaddlePaddle/PaddleOCR/blob/main/docs/version3.x/inference_deployment/cross_platform/browser.md> |
| Known-object lane | Spike đầu dùng `yolo26n-seg` FP32 xuất ONNX; chỉ quantize sau khi FP32 đạt accuracy gate | Model segmentation trả mask, bbox, class, confidence và hỗ trợ ONNX export: <https://docs.ultralytics.com/tasks/segment> |
| Text detector thay thế | DBNet nếu PaddleOCR.js không đáp ứng tiếng Việt/layout | DBNet là detector text hình dạng tùy ý và repo chính thức có script ONNX: <https://github.com/MhLiao/DB> |

### 5.1 Giới hạn phải ghi nhận

- Model pretrained COCO không biết mọi graphic, banner, cartoon hay icon. Nó chỉ là một nguồn proposal, không được là nguồn duy nhất.
- MobileSAM không tự hiểu “đây là một đơn vị biên tập”; nó cần prompt và lớp graph/grouping phía sau.
- WebGPU không có trên mọi browser. WASM fallback phải hoạt động nhưng có budget thời gian riêng.
- Model và weight phải qua gate license/redistribution. Repo là AGPL-3.0-only; code/weight bên thứ ba phải được ghi trong `THIRD-PARTY-NOTICES.md` trước khi ship.

## 6. Pipeline chi tiết cho nền phức tạp

### Giai đoạn A — Chuẩn hóa và router

1. Decode ảnh một lần, giữ RGBA gốc và bản làm việc tối đa 960 px.
2. Tính variance/entropy viền như hiện tại.
3. Thêm confidence cho router thay vì chỉ boolean:

```ts
interface BackgroundDecision {
  mode: 'simple' | 'complex'
  confidence: number
  reasons: string[]
}
```

4. Nếu `simple`, gọi nguyên pipeline chuẩn hiện tại. Không import model ONNX, không đổi mask, không đổi kết quả golden.
5. Nếu `complex`, gọi orchestrator mới. UI `Tự động` vẫn là default; chế độ ép `standard` phục vụ debug/regression.

### Giai đoạn B — Shared cue maps

Tính đúng một lần rồi chia sẻ bằng typed array:

- RGB và CIE Lab;
- grayscale;
- Sobel magnitude + orientation;
- global spectral-residual saliency;
- local-adaptive saliency threshold map;
- local variance/entropy;
- border/background likelihood;
- quantized color code;
- marker-controlled watershed label map trên gradient Lab + Sobel.

O1/O2/C1/C2/C3 nằm ở đây. Chúng chỉ tạo bằng chứng, không tạo `Block` cuối.

### Giai đoạn C — Text lane

1. PaddleOCR.js trả polygon từng dòng/cụm text và confidence.
2. Recognition hỗ trợ xác định khoảng trắng, dòng và style; không cần nội dung đúng 100% mới giữ polygon.
3. Bên trong polygon, dùng local threshold + Sobel + màu để tạo visible text mask.
4. Gom glyph → từ → dòng theo hierarchy, không union phẳng.
5. Lưu cây nhóm để UI có thể tách về lần gom gần nhất.
6. Tạo quan hệ `inside/overlays` giữa text polygon và brush/banner/card proposal.

Điều này thay thế vai trò đoán text của `MergeTextBlocks` trên nhánh complex. `MergeTextBlocks` vẫn giữ nguyên cho nhánh simple.

### Giai đoạn D — Known-object lane

1. Chạy model instance segmentation nano ở 640 hoặc 768 px.
2. Giữ mask/bbox/confidence, không raster hóa bbox thành mask.
3. Không loại proposal chỉ vì class không nằm trong ontology UI; class chỉ là metadata.
4. Detector COCO được kỳ vọng bắt người/máy bay/đồ vật phổ biến, nhưng không được kỳ vọng bắt mọi icon/cartoon/banner.
5. Mỗi detection trở thành box prompt cho MobileSAM để tinh chỉnh ở độ phân giải ảnh làm việc.

### Giai đoạn E — Unknown-object lane

Đây là nơi 2 thuật toán cũ và 5 tầng cascade bù cho detector:

1. Lấy connected components ổn định từ O1 ở nhiều scale nhỏ, không dilation rộng.
2. Lấy cực đại O2/C3 làm positive points; lấy valley/background likelihood làm negative points.
3. C4 tạo atomic color/watershed regions, không tạo object trực tiếp.
4. Tạo box candidate từ union atomic regions khi có ít nhất hai trong các bằng chứng:

   - closed boundary support;
   - saliency peak ổn định qua global/local scale;
   - foreground/background contrast;
   - region compactness;
   - text detector hoặc detector overlap;
   - một enclosing mask ổn định từ MobileSAM.

5. Gửi box + positive/negative points sang MobileSAM.
6. Giữ nhiều mask scale khi chúng có quan hệ cha/con; chưa NMS ở bước này.

### Giai đoạn F — Atomic region và boundary snapping

C4 được sửa vai trò như sau:

- median-cut vẫn chạy toàn cục trước CCL để tránh color chaining;
- CCL theo mã màu chỉ tạo marker ban đầu;
- marker-controlled watershed chạy trên gradient Lab + Sobel để tạo vùng nguyên tử nhỏ và snap về biên ảnh;
- mask MobileSAM/detector được snap nhẹ về biên atomic region nếu làm tăng boundary support;
- vùng màu không được tự nâng cấp thành object nếu thiếu proposal semantic/layout;
- background residual chưa cần gán ở đây.

### Giai đoạn G — Proposal graph

Mỗi node chứa mask thật, không chỉ bbox:

```ts
interface ProposalNode {
  id: string
  source: 'detector' | 'text' | 'sam' | 'standard-cue' | 'saliency-cue' | 'color-region'
  roleHint: 'thing' | 'text-line' | 'container' | 'unknown'
  maskRle: Uint32Array
  bbox: Rect
  centroid: Point
  confidence: number
  boundaryScore: number
  stabilityScore: number
  sourceIds: string[]
}
```

Các edge ghi quan hệ:

- mask IoU;
- containment theo mask;
- tiếp xúc biên;
- khoảng cách mép chuẩn hóa;
- chênh màu Lab/texture;
- cùng baseline/text style;
- cùng enclosing SAM mask;
- detector instance conflict;
- foreground/background likelihood.

Không dùng bbox overlap như tiêu chí duy nhất.

### Giai đoạn H — Merge/split có kiểm soát

#### Merge

C5 chỉ được phép merge khi có bằng chứng cha chung:

- các mảnh cùng nằm trong một mask MobileSAM ổn định; hoặc
- các glyph thuộc cùng text line; hoặc
- icon và caption thỏa layout compound; hoặc
- atomic regions cùng detector instance và không có strong boundary giữa chúng.

Sau mỗi union phải tính lại score trên **toàn aggregate**. Nếu aggregate mới không còn thỏa điều kiện thì rollback union. Không cho phép transitive chaining kiểu `A≈B`, `B≈C` suy ra `A+B+C` mà không kiểm tra lại.

#### Split

Một proposal phải split khi có một trong các bằng chứng:

- chứa từ hai detection/mask con confidence cao, overlap thấp;
- projection valley đồng thời trùng strong boundary;
- có nhiều saliency peak nhưng không có enclosing mask ổn định;
- một proposal chồng hai ground-like separated components;
- text polygon cắt ngang proposal thing mà không phải quan hệ container.

Projection valley một mình không được split vật thể.

### Giai đoạn I — Editorial grouping

Sau khi có instance vật lý:

1. Text trên cùng brush/banner → `compound`.
2. Icon + caption cùng cột → `compound`.
3. Nhiều glyph cùng dòng → `text-line`.
4. Chi tiết con nằm hoàn toàn trong mask cha và không có detector/text identity riêng → hấp thụ vào cha.
5. Lưu `children`, `mergeHistory` và mask gốc để nút tách nhóm hoạt động theo lịch sử.

### Giai đoạn J — Chọn tập instance cuối

Thay greedy bbox NMS bằng chọn tập proposal theo mask và constraint:

```text
maximize Σ proposalScore
         + coverageOfForeground
         + sourceAgreement
         + layoutConsistency
         - fragmentationPenalty
         - mergeConflictPenalty
         - unexplainedForegroundPenalty
```

Ràng buộc:

- một visible foreground pixel có tối đa một owner object cuối;
- bbox có thể chồng nhau;
- text con và container được giải quyết thành compound thay vì loại nhau;
- proposal background/stuff không được thành object;
- không có hard cap 24 object; chỉ có safety cap cao và báo lỗi rõ nếu vượt.

### Giai đoạn K — Coverage layer và tái dựng ảnh

Sau khi chốt object masks:

1. `objectOwner[pixel]` chỉ gán pixel thuộc visible mask của object.
2. Pixel còn lại đưa vào một hoặc nhiều `CoverageLayer`, phân vùng bằng C4 nếu cần để reveal đẹp.
3. `CoverageLayer` không hiện trong object list, không nhận camera zoom, không có setting cấp vật thể.
4. DrawUnit của coverage có `blockId = null` và `role = 'coverage'`.
5. Scheduler có thể reveal coverage theo tile/background policy, nhưng final frame phải giữ invariant tái dựng ảnh.

Như vậy vừa đạt ảnh cuối đầy đủ, vừa không biến bầu trời thành một phần của máy bay.

## 7. Hợp đồng dữ liệu V2

Không tiếp tục dùng một `Block` vừa chứa bbox semantic vừa chứa pixel ownership khác miền.

```ts
interface ObjectInstance {
  id: number
  role: 'thing' | 'text-line' | 'compound'
  bbox: Rect                 // bbox tính trực tiếp từ visibleMask
  visibleMaskRle: Uint32Array
  centroid: Point
  confidence: number
  children: string[]
  mergeHistory: MergeNode | null
  kind: 'vector' | 'photo'
  provenance: ProposalEvidence[]
}

interface CoverageLayer {
  id: string
  maskRle: Uint32Array
  revealPolicy: 'base' | 'progressive' | 'terminal'
}

interface DrawUnitV2 {
  type: 'path' | 'area'
  role: 'object' | 'coverage'
  blockId: number | null
  pixelsRle: Uint32Array
  path: Float32Array
  color: [number, number, number]
  bbox: Rect
  cost: number
  t0: number
  t1: number
}

interface AnalysisResultV2 {
  version: 2
  img: WorkImage
  objects: ObjectInstance[]
  coverageLayers: CoverageLayer[]
  units: DrawUnitV2[]
  diagnostics: SegmentationDiagnostics
}
```

### 7.1 Quy tắc invariant

- `bbox(object.visibleMaskRle) === object.bbox`.
- Mask object cuối không chồng owner pixel; bbox được phép chồng.
- `union(object masks, coverage masks)` phủ đúng toàn ảnh.
- Mỗi visible pixel có đúng một render owner.
- Object list chỉ lấy `objects`, không lấy `coverageLayers`.
- Camera chỉ theo `objects`.
- `DrawUnitV2.blockId === null` chỉ hợp lệ với role `coverage`.

### 7.2 Tối ưu marshal

Không marshal hàng trăm nghìn pixel thành `[]interface{}`. Dùng RLE/bitset hoặc `Uint32Array`, `Float32Array` và transferable buffers. Đây là điều kiện cần để thêm model mà không làm GC/Worker message trở thành bottleneck.

## 8. Orchestrator và phân chia trách nhiệm

### 8.1 Worker

Tạo `src/segmentation/segmentation.worker.ts` làm orchestrator duy nhất:

- nạp Go/WASM để tạo cue cổ điển;
- nạp ONNX Runtime cho detector/text/SAM;
- chạy các lane có thể song song sau shared preprocessing;
- hỗ trợ cancellation theo `frameId + analysisRevision`;
- cache model session và image embedding MobileSAM;
- chỉ trả kết quả revision mới nhất.

Go/WASM không cần chứa inference ONNX. Nó tiếp tục xử lý các phép pixel/graph hiệu quả và deterministic.

### 8.2 Model adapters

```text
src/segmentation/models/objectDetector.ts
src/segmentation/models/textDetector.ts
src/segmentation/models/mobileSam.ts
src/segmentation/proposalGraph.ts
src/segmentation/editorialGrouping.ts
src/segmentation/coverage.ts
src/segmentation/contracts.ts
```

Mỗi adapter phải trả contract trung gian chung và không chứa logic UI.

### 8.3 Model delivery

- Không nhét model lớn trực tiếp vào JS bundle.
- Đặt manifest có URL, SHA-256, byte size, license và opset.
- Model có thể đặt ở GitHub Releases/CDN; cache bằng Cache Storage/IndexedDB sau lần tải đầu.
- Progress tải model tách riêng progress phân tích ảnh.
- Kiểm tra hash trước khi tạo inference session.
- `BASE_URL` phải được áp dụng đúng khi dùng asset dưới GitHub Pages.

## 9. Kế hoạch dữ liệu và huấn luyện miền

Pretrained model không đủ để hiểu ontology infographic của Sketchify. Vì vậy kế hoạch phải có đường fine-tune, không chỉ một danh sách heuristic.

### 9.1 Dataset annotation tối thiểu

Tạo `testdata/segmentation/`:

```text
images/
annotations/editorial-instances.json
masks/
golden/simple-background/
```

Annotation theo phong cách COCO gồm bbox, polygon/RLE mask, role và quan hệ compound/children.

### 9.2 Bộ dữ liệu

- Ba ảnh `testthuattoanmoi (1/2/3).png` là regression fixtures, không dùng làm training-only cheat.
- Các ảnh nền trắng hiện có là golden regression.
- Bổ sung ít nhất 50 ảnh infographic phức tạp để validation; tối thiểu 200–500 ảnh để fine-tune ban đầu.
- Sinh dữ liệu tổng hợp bằng cách compositing asset nền, text, banner, icon, nhân vật và ảnh chụp; vì compositing nên có mask ground truth chính xác.
- Có các ca bắt buộc: occlusion, cùng màu nền, vật thể lồng nhau, chữ có dấu, chữ nghiêng, nhiều máy bay cùng lớp, icon + caption, object sát nhau nhưng không chạm.

### 9.3 Fine-tune gate

1. Đo pretrained detector + OCR + MobileSAM trước.
2. Nếu không đạt gate ở mục 10, fine-tune detector/segmentation head cho các role tổng quát `thing`, `text-container`, `icon-card`.
3. Không hard-code class “máy bay” vào runtime; fixture chỉ là một mẫu của role `thing`.
4. Tách train/validation theo template để tránh cùng bố cục lọt cả hai tập.

## 10. Rubric kiểm thử mới

### 10.1 Fixture bắt buộc `testthuattoanmoi (1).png`

Hard gate trước khi merge:

- đúng 16 `ObjectInstance`, không nhiều hơn/ít hơn;
- ghép Hungarian một-một prediction ↔ ground truth;
- 16/16 bbox đạt IoU ≥ 0.70 **và** visible mask đạt IoU ≥ 0.65;
- không prediction nào match đáng kể hơn một ground-truth object;
- không ground-truth object nào bị nhiều prediction chia nhỏ;
- năm icon + nhãn dưới cùng là năm compound, không phải mười hoặc nhiều mảnh;
- bốn máy bay là bốn instance;
- đài kiểm soát là một instance;
- khủng long là một instance;
- text/banner đúng sáu nhóm đầu như ontology mục 0;
- không background/stuff xuất hiện trong object list.

Ảnh tham chiếu “95%” là mức trực quan, nhưng fixture này dùng hard gate 16/16 để không tiếp tục tranh luận bằng cảm giác.

### 10.2 Metrics toàn bộ tập

- object precision, recall, F1;
- box AP50/AP75;
- mask mIoU;
- Panoptic Quality cho thing/stuff;
- fragmentation rate: một GT bị ≥2 prediction match;
- merge error rate: một prediction phủ ≥2 GT;
- exact-count accuracy theo ảnh;
- text-line/compound grouping accuracy;
- final reconstruction mismatch pixel count.

Release gate đề xuất:

```text
Object F1              >= 0.90
PQ                     >= 0.80
Text/compound accuracy >= 0.95
Fragmentation rate     <= 0.03
Merge error rate       <= 0.03
Final pixel mismatch   = 0 (tolerance kênh <= 2)
```

### 10.3 Regression nền trắng

- Kết quả nhánh simple phải byte-equivalent/golden-equivalent với commit ổn định trước nhánh saliency.
- Không nạp model ONNX ở test nền trắng.
- `mergeRadius` vẫn là 0.
- Count, bbox, pixels và unit type của fixture nền trắng không đổi ngoài version migration được chỉ rõ.

### 10.4 Browser E2E

Script `cdp-cascade-coverage-e2e.mjs` hiện tại phải bị thay, không chỉ sửa khoảng `8..36`.

E2E mới phải:

1. tải fixture thật qua UI;
2. đợi đúng analysis revision;
3. đọc `AnalysisResultV2` diagnostics;
4. so object masks/boxes với annotation;
5. chụp overlay;
6. chạy hết preview;
7. kiểm tra reconstruction riêng;
8. fail nếu model fallback âm thầm hoặc nếu object count đúng nhưng match sai.

### 10.5 Các test bị cấm dùng làm bằng chứng hoàn thành

- “số khối nằm trong 8–36”;
- “mỗi landmark nằm trong một bbox khác nhau”;
- “không bbox nào quá 24% canvas”;
- “phủ đủ 100% pixel” nếu chưa đo object accuracy;
- đánh giá chỉ bằng console count;
- chỉnh threshold bằng chính validation fixture rồi báo đạt.

Các test này có thể giữ như sanity check, nhưng không phải acceptance test.

## 11. Debug observability

Mỗi lần analyze complex phải có diagnostics có thể xuất JSON:

```ts
interface SegmentationDiagnostics {
  route: BackgroundDecision
  timingsMs: Record<string, number>
  proposalCountsBySource: Record<string, number>
  rejected: Array<{ id: string; reason: string }>
  mergeEvents: Array<{ children: string[]; result: string; evidence: string[] }>
  splitEvents: Array<{ source: string; children: string[]; evidence: string[] }>
  finalObjectCount: number
  coveragePixelCount: number
  reconstructionMismatch: number
  executionProviders: Record<string, 'webgpu' | 'wasm'>
}
```

Debug overlay có lớp bật/tắt riêng: OCR, detector, SAM, classical cues, atomic regions, final instances, coverage. Không dùng một `Ink mask` duy nhất để đại diện cho tất cả tầng.

## 12. Hiệu năng và fallback

### 12.1 Budget

Đo cold load và warm inference riêng:

- cold model download không tính chung với analyze nhưng phải có progress thật;
- warm WebGPU target ≤ 3 giây ở ảnh 960×540 trên máy tham chiếu;
- warm WASM fallback target ≤ 8 giây và UI không treo;
- peak JS/WASM memory phải được ghi trong benchmark;
- model sessions dùng lại giữa các Frame;
- MobileSAM image embedding chỉ tính một lần mỗi ảnh.

Không được tuyên bố ≤3 giây dựa trên unit test Go nếu ONNX pipeline chưa chạy browser thật.

### 12.2 Fallback có thứ bậc

```text
WebGPU full hybrid
  ↓ nếu provider/model không hỗ trợ
WASM hybrid ở resolution thấp hơn
  ↓ nếu model tải/inference lỗi
classical proposal fallback + cảnh báo “độ chính xác giảm”
  ↓ người dùng chỉnh
manual group/split/rescan
```

Không fallback âm thầm. Diagnostics và UI phải nói rõ lane nào bị bỏ.

## 13. Các phase triển khai và cổng dừng

### Phase 0 — Ground truth và baseline

- Vẽ annotation 16 object cho fixture 1 và annotation cho fixture 2/3.
- Viết evaluator Hungarian + IoU + merge/split errors.
- Chạy commit `a252566`, lưu baseline JSON và overlay.
- Kỳ vọng baseline fixture 1 FAIL; nếu evaluator cho PASS thì evaluator sai.

**Gate:** test mới chứng minh `a252566` thất bại đúng như ảnh 2.

### Phase 1 — Tách object khỏi coverage

- Thêm contract V2.
- Loại gán residual vào seed object.
- Tạo `CoverageLayer` và scheduler/render support.
- Giữ exact reconstruction.
- Giữ nhánh simple nguyên trạng.

**Gate:** object bbox/pixels đồng nhất; background không còn trong object list; final reconstruction vẫn exact.

### Phase 2 — Text lane

- Spike PaddleOCR.js trên ba fixture và chữ tiếng Việt.
- Tạo text polygon/mask/hierarchy.
- Tạo compound banner và icon-caption bằng relation graph.

**Gate:** các nhóm chữ/compound của fixture 1 đúng annotation, không dựa tọa độ cố định.

### Phase 3 — Model compatibility spike

- Chạy detector ONNX và MobileSAM encoder/decoder trong browser thật.
- Ghi model size, EP, cold load, warm inference, operator fallback và memory.
- Kiểm tra license/redistribution.

**Gate:** cả WebGPU và WASM path có kết quả hoặc có quyết định fallback được tài liệu hóa; không commit model không chạy được.

### Phase 4 — Proposal graph hybrid

- Chuyển O1/O2/C1–C5 thành cue producers/atomic regions.
- Tích hợp detector, text và MobileSAM.
- Cài merge/split aggregate revalidation.
- Xóa spatial quotas và cap 24 của `object_cascade.go`.

**Gate:** fixture 1 tiến tới đúng 16 và giảm cả fragmentation lẫn merge error trên fixture 2/3.

### Phase 5 — Fine-tune theo miền

- Chỉ bắt đầu sau khi đo pretrained baseline.
- Tạo/composite dataset có mask thật.
- Fine-tune model nhỏ, export ONNX, kiểm tra ORT Web.

**Gate:** đạt toàn bộ metric mục 10 trên validation không trùng template.

### Phase 6 — UI, migration và production hardening

- Overlay final instance luôn bám mask/bbox V2.
- Group/split thủ công dùng merge tree V2.
- Session migration từ AnalysisResult cũ: đánh dấu dirty và analyze lại, không giả convert pixels sai.
- Cache model/hash, cancellation, lỗi mạng, browser unsupported.

**Gate:** E2E UI + preview + export `.webm` cùng dùng đúng V2; không regression camera/timeline.

### Phase 7 — Release audit

- Chạy Go tests, Vitest, build WASM Linux/CI, production build và browser E2E.
- Xuất report metrics từng fixture, timing từng lane và screenshot overlay.
- Soát license/notices/model hashes.

**Gate cuối:** tất cả hard gate mục 10 PASS. Không thay hard gate sau khi nhìn kết quả.

## 14. Bản đồ thay đổi file dự kiến

| File/nhóm | Hành động |
|---|---|
| `wasm-src/imaging.go` | Giữ primitives; thêm Lab/local stats nếu benchmark chứng minh cần |
| `wasm-src/saliency.go` | Giữ heatmap; đổi vai trò thành cue |
| `wasm-src/cascade.go` | Tách cue generation khỏi coverage; bỏ residual→seed object |
| `wasm-src/object_cascade.go` | Thay hoàn toàn spatial heuristic bằng proposal graph primitives hoặc xóa |
| `wasm-src/saliency_groups.go` | Giữ candidate marker; không trả final object |
| `wasm-src/saliency_split.go` | Chỉ split khi có multi-cue evidence |
| `wasm-src/segment.go` | Router simple/complex; simple branch frozen |
| `wasm-src/main.go` | Marshal V2 bằng typed arrays/RLE |
| `src/segmentation/*` | Orchestrator, model adapters, graph, grouping, coverage |
| `src/wasm/wasmClient.ts` | Contract V2 và diagnostics |
| `src/state/projectStore.ts` | Migration/reconcile object settings theo mask matching |
| `src/render/Player.ts` | Render object units + hidden coverage units; giữ cumulative reveal |
| `testdata/segmentation/*` | Ảnh, masks và ground truth |
| `scripts/cdp-cascade-coverage-e2e.mjs` | Thay bằng evaluator thật hoặc đổi tên để không giữ rubric sai |
| `THIRD-PARTY-NOTICES.md` | Nguồn, license và hash model |

## 15. Rủi ro và quyết định trước khi code

| Rủi ro | Cách chặn |
|---|---|
| Model generic không hiểu infographic | Domain fine-tune là phase chính thức, không thêm heuristic tọa độ |
| MobileSAM over-segment | Dùng prompt từ detector/text/cue, hierarchy và graph selection |
| OCR đọc sai tiếng Việt | Grouping dựa polygon/geometry trước, text recognition chỉ củng cố |
| WebGPU operator thiếu | Compatibility spike; WASM fallback; không chọn model trước khi chạy browser |
| Model download lớn | quantize sau accuracy gate, cache, manifest/hash, tải theo complex route |
| Exact reconstruction xung đột instance | CoverageLayer riêng, không đẩy residual vào object |
| Regression nền trắng | Frozen branch + golden tests |
| Manual grouping che lỗi auto | Auto metrics chạy trước mọi override; manual không được tính vào PASS |
| Overfit ba fixture | validation khác template và synthetic masks |

## 16. Definition of Done

Kiến trúc mới chỉ được gọi là hoàn thành khi có đủ bằng chứng sau:

- [ ] `testthuattoanmoi (1).png` trả đúng 16 object theo matching một-một.
- [ ] Không có bbox/pixels bất nhất.
- [ ] Bốn máy bay, đài và khủng long là các instance riêng.
- [ ] Text/banner/icon-caption được group theo ontology, không theo ký tự/vùng màu.
- [ ] Background không xuất hiện trong object list.
- [ ] Union object + coverage tái dựng ảnh cuối exact.
- [ ] Fixture 2/3 và tập validation đạt metric mục 10.
- [ ] Nhánh nền trắng giữ golden output.
- [ ] Browser WebGPU/WASM được chạy thật và có report timing.
- [ ] Preview, camera, DrawUnit và `.webm` dùng cùng AnalysisResultV2.
- [ ] Không còn test khoảng-count hoặc landmark-point được dùng để tuyên bố thành công.
- [ ] Không có heuristic theo vị trí riêng của ảnh sân bay.
- [ ] Model source/license/hash được ghi đầy đủ.

Nếu thiếu bất kỳ mục hard gate nào, trạng thái phải là **chưa hoàn thành**, kèm metric đang fail; không được thay đổi rubric để biến kết quả thành PASS.

## 17. Kết luận kiến trúc

Hai thuật toán cũ và năm tầng cascade không bị vứt bỏ. Chúng được đặt lại đúng vai trò: tạo foreground cue, saliency cue, atomic region, boundary evidence và coverage. Phần chúng không thể làm — hiểu instance và layout — được giao cho detector, text detector, MobileSAM và proposal graph.

Thay đổi quyết định là tách ba khái niệm từng bị trộn chung:

```text
pixel region ≠ semantic instance ≠ editorial object
```

Chỉ khi ba lớp này tồn tại riêng, Sketchify Video mới có thể vừa tách gần ảnh tham chiếu, vừa giữ ảnh cuối đầy đủ, vừa không phá nhánh nền trắng đã ổn định.
