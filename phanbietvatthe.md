# Cách Sketchify Video quét và tách vật thể

Tài liệu này mô tả **đúng pipeline đang được cài đặt trong mã nguồn hiện tại** của `sketchify-video`: từ lúc người dùng tải ảnh lên, Go/WebAssembly tạo mặt nạ mực (`ink mask`), tách các vùng liên thông thành `Block`, phân loại khối vector/ảnh chụp, rồi sinh `DrawUnit` để Player vẽ lại từng phần.

> **Điểm cần hiểu trước:** trong ứng dụng, “vật thể” là một **vùng hình ảnh đã được thuật toán thị giác máy tính gom thành một `Block`**, không phải kết quả nhận diện ngữ nghĩa bằng AI. Thuật toán không biết vùng đó là “con mèo”, “dòng chữ” hay “máy bay”; nó suy luận từ màu nền, cạnh ảnh, saliency, liên thông, hình học và mật độ vùng màu.

## 1. Sơ đồ toàn bộ pipeline

```text
Ảnh người dùng
    ↓ giải mã bằng trình duyệt
RGBA, thu nhỏ tối đa về workingWidth
    ↓ gửi sang classic Web Worker
Go/WASM
    ↓
Đo variance + entropy màu ở viền ảnh
    ↓
Tự chọn nhánh
    ├─ nền đơn giản → Gray + Sobel + độ lệch màu nền
    └─ nền phức tạp → spectral-residual saliency + cạnh được giới hạn vùng nổi bật
                         ↓
                   Ink mask nhị phân
    ↓
Opening 1 px (erode → dilate)
    ↓
Dilation theo mergeRadius (hiện bị khóa ở 0 px)
    ↓
CCL 4-láng giềng
    ↓
Block thô
    ↓
Gom dấu tiếng Việt và các mảnh chữ cùng dòng
    ↓
Lọc nhiễu + phân loại vector/photo + sắp thứ tự
    ↓
Block[]
    ├─ vector → posterize → CCL màu → contour → RDP → DrawUnit path
    └─ photo  → median-cut toàn cục → CCL màu → DrawUnit area
    ↓
AnalysisResult { img, blocks, units, stats }
    ↓
React hiển thị khung vật thể; Player reveal theo DrawUnit
```

## 2. Chuẩn hóa ảnh đầu vào

Khi tải ảnh, `App.tsx` tạo canvas tạm và tính:

```text
scale = min(1, workingWidth / naturalWidth)
```

Ảnh lớn hơn `workingWidth` được thu nhỏ giữ nguyên tỉ lệ; ảnh nhỏ không bị phóng lớn. Mặc định `workingWidth = 960`. Canvas sau đó xuất dữ liệu RGBA 8-bit và gửi sang `imaging.worker.ts`.

Worker là **classic worker**, vì glue code `wasm_exec.js` của Go được nạp bằng `importScripts()`. Ảnh và cài đặt được chuyển vào hàm `wbImaging.analyze()` trong WASM. Toàn bộ phân tích diễn ra cục bộ trong trình duyệt, không cần gửi ảnh lên máy chủ.

## 3. Ước lượng nền

Hàm `EstimateBackground` chỉ lấy mẫu ở dải viền dày 3 px của ảnh:

1. Mỗi kênh RGB được lượng tử hóa còn 4 bit cao.
2. Thuật toán đếm ô màu xuất hiện nhiều nhất ở viền.
3. Các pixel thuộc ô thắng được lấy trung bình RGB chính xác.
4. Nếu không lấy được mẫu, nền mặc định là trắng `(255, 255, 255)`.

Cách này phù hợp với ảnh whiteboard có nền tương đối đồng nhất và giúp bóng xám nhẹ ở nền ít bị coi nhầm là vật thể.

### 3.1 Tự động phân loại nền

Cùng dải viền 3 px còn được dùng để đo hai đại lượng:

- độ lệch chuẩn màu RGB trung bình, được báo trong contract với tên `backgroundVariance` để giữ đúng tên tham số đặc tả;
- entropy Shannon của histogram RGB lượng tử hóa 4 bit/kênh.

Nếu đồng thời `variance < bgVarianceThreshold` và `entropy < bgEntropyThreshold`, ảnh dùng thuật toán chuẩn. Chỉ cần một đại lượng vượt ngưỡng thì ảnh dùng saliency. Mặc định hai ngưỡng là `15` và `2.5 bit`. Người dùng có thể để tự động hoặc ép `standard`/`saliency` trong UI.

### 3.2 Spectral-residual saliency cho nền phức tạp

Nhánh nền phức tạp dùng thuật toán Hou–Zhang thuần toán học:

1. Gray được nội suy xuống lưới 64×64.
2. FFT radix-2 hai chiều chạy theo hàng rồi cột.
3. Tách log-amplitude và phase.
4. Log-amplitude được lọc trung bình 3×3; hiệu với bản gốc tạo spectral residual.
5. Ghép residual với phase rồi IFFT.
6. Bình phương biên độ và Gaussian blur 5×5.
7. Nội suy song tuyến tính về kích thước WorkImage, chuẩn hóa 0..255.
8. Ngưỡng được lấy theo percentile của chính ảnh, mặc định percentile 75.

Thử nghiệm cho thấy phép `ink_old OR saliency` nguyên văn vẫn giữ toàn bộ vùng “khác một màu nền” và làm các ảnh sân bay thành một Block khổng lồ. Vì vậy nhánh phức tạp giữ phần Sobel của mask cũ, nhưng chỉ nhận cạnh nằm trong vùng hỗ trợ saliency, cộng với lõi saliency vượt ngưỡng. Các hạt saliency được nối ở bán kính rất nhỏ, thích ứng khoảng `workingWidth/480` đến `workingWidth/320`, chỉ để CCL không vỡ thành hàng trăm mảnh; pixel nối không được đưa vào nội dung Block. Block quá lớn còn được kiểm tra projection profile ngang/dọc để cắt tại valley sâu nếu hai phía đều đủ mực, nhằm loại cầu nối mảnh. Nhánh nền đơn giản không thay đổi.

## 4. Tạo Ink mask

### 4.1 Chuyển ảnh sang mức xám

`Gray` dùng công thức trọng số nguyên:

```text
gray = (299R + 587G + 114B) / 1000
```

### 4.2 Phát hiện cạnh Sobel

`SobelMagnitude` dùng hai kernel Sobel 3×3 để tính gradient ngang `gx`, dọc `gy`, sau đó lấy:

```text
magnitude = min(255, sqrt(gx² + gy²))
```

Viền ngoài ảnh được xem là 0.

### 4.3 Kết hợp cạnh và màu khác nền

Một pixel được bật trong `ink mask` nếu thỏa **ít nhất một** điều kiện:

```text
SobelMagnitude > edgeThreshold
hoặc
colorDistance(pixel, background) > bgTolerance
```

Giá trị mặc định hiện tại:

- `edgeThreshold = 42`;
- `bgTolerance = 34`.

Khoảng cách màu được chuẩn hóa theo căn bậc hai trung bình của ba kênh. Kết hợp hai điều kiện giúp giữ cả nét biên lẫn phần màu phẳng bên trong vật thể; nếu chỉ dùng Sobel, vùng màu phẳng sẽ bị rỗng.

Nút **Ink mask** trên giao diện tô các pixel mask để người dùng kiểm tra vùng nào đang được thuật toán xem là “mực”. Ink mask chưa phải danh sách vật thể cuối cùng: một vật thể cuối có thể chứa nhiều mảnh mask đã được gom ở bước sau.

## 5. Làm sạch mask và liên thông

### 5.1 Opening 1 px

Pipeline luôn áp dụng:

```text
ErodeSquare(mask, radius=1)
→ DilateSquare(mask, radius=1)
```

Đây là phép opening, dùng để loại các chấm/nối rất mảnh trước khi tìm thành phần liên thông. Hai phép hình thái học dùng prefix-sum theo hàng và cột, nên độ phức tạp tuyến tính theo số pixel.

### 5.2 Gộp vùng đang bị khóa ở 0 px

Trường `mergeRadius` vẫn còn trong hợp đồng dữ liệu để đọc được project cũ, nhưng `settingsFromJS` luôn ép nó về `0`. Vì vậy:

- giao diện không cho chỉnh “Gộp vùng”;
- không có dilation diện rộng để nối hai vật thể chỉ vì chúng ở gần nhau;
- `effectiveMergeRadius` trả `0` và bước dilation này sao chép nguyên mask đã opening.

Việc gom chữ hiện được thực hiện bằng quy tắc hình học riêng ở mục 7, không dùng bán kính gộp toàn ảnh.

### 5.3 Connected Component Labeling

Hàm `Components` dùng flood-fill với stack, không đệ quy, và xét **4-láng giềng**: trái, phải, trên, dưới. Hai vùng chỉ chạm nhau theo đường chéo không được coi là cùng thành phần.

CCL chạy trên mask sau dilation. Tuy nhiên, danh sách pixel thật của mỗi `Block` được lấy từ mask mịn sau opening (`fine`), không lấy cả phần pixel giả được tạo bởi dilation. Điều này cho phép dilation làm cầu nối mà không làm dày nội dung xuất ra — dù cấu hình hiện tại đang khóa bán kính ở 0.

Với mỗi thành phần, thuật toán tích lũy:

- danh sách chỉ số pixel;
- `inkArea`;
- bounding box `x, y, w, h`;
- trọng tâm `centroid.x`, `centroid.y`.

## 6. Phân loại Block là vector hay photo

`ClassifyBlock` không nhận diện nội dung; nó đo độ phức tạp vùng màu:

1. Block có diện tích bounding box dưới `2500 px²` luôn được coi là `vector`.
2. Block lớn được lấy mẫu màu trong toàn bounding box.
3. `MedianCut` tạo palette thử nghiệm toàn cục, mặc định tối đa 8 màu.
4. Mỗi pixel được gán vào màu palette gần nhất.
5. CCL 4-láng giềng đếm số vùng màu có diện tích tối thiểu `minProbeRegion`.
6. Nếu `regions / bboxArea > photoDensityThreshold`, block là `photo`; ngược lại là `vector`.

Mặc định phía React hiện dùng `minProbeRegion = 16` và `photoDensityThreshold = 0.012`. Ảnh chụp thường có nhiều vùng màu nhỏ nên mật độ cao; chữ, icon và minh họa phẳng thường có ít vùng hơn.

## 7. Gom chữ tự động

Sau khi tạo Block thô, `MergeTextBlocks` thực hiện hai tầng. Mục tiêu là tránh tình trạng một chữ tiếng Việt bị vỡ thành thân chữ và dấu, hoặc một từ bị vỡ thành từng ký tự, nhưng không dilation cả ảnh làm dính minh họa kế bên.

### 7.1 Gắn dấu vào thân chữ

Một mảnh nhỏ chỉ được gắn với **một thân chữ gần nhất**, không union tùy ý với nhiều đích. Ứng viên phải thỏa các giới hạn chính:

- thân chữ không quá cao so với ảnh;
- mảnh nhỏ thực sự nhỏ hơn thân chữ theo chiều cao và diện tích mực;
- bounding box có chồng lấn ngang;
- độ lệch màu tổng RGB không quá `72`;
- khoảng cách dọc không quá `max(3 px, 1/3 chiều cao thân chữ)`.

Điểm chọn đích ưu tiên khoảng cách dọc nhỏ và tâm X gần nhau. Chỉ chọn một đích giúp dấu nhỏ không trở thành “cầu nối” kéo nhiều chữ hay vật thể vào cùng nhóm.

### 7.2 Gom ký tự hoặc từ trên cùng dòng

Sau khi gắn dấu, thuật toán xác định mảnh có dáng chữ bằng các điều kiện:

- chiều cao từ 5 px đến `max(18 px, 1/4 chiều cao ảnh)`;
- chiều rộng không vượt `max(4 × chiều cao, 40 px)`;
- mật độ mực trong bounding box từ `0.04` đến `0.72`.

Các mảnh được xét cùng một hàng khi:

- tỉ lệ chiều cao lớn/nhỏ không vượt 1.5;
- độ lệch baseline không vượt 70% chiều cao lớn hơn;
- độ lệch màu tổng RGB không vượt `58`.

Trong một hàng, mảnh được sắp trái sang phải rồi chia thành từng chuỗi. Hai mảnh liền nhau chỉ được nối nếu khoảng trắng ngang nằm trong khoảng:

```text
-maxHeight/3 ≤ gap ≤ max(4 px, 2×maxHeight/3)
```

Nhờ đó, chữ cùng hàng và gần nhau có thể trở thành một Block, còn hai cụm cách xa vẫn tách. Đây là suy luận hình học, **không phải OCR**: ứng dụng không đọc được nội dung chữ và không biết chắc đâu là ranh giới từ về mặt ngôn ngữ.

## 8. Lọc nhiễu và sắp thứ tự vật thể

Sau khi gom chữ, Block có `inkArea < minBlockInk` bị loại; mặc định `minBlockInk = 60`.

Các Block còn lại được sắp theo chế độ:

- `auto-row`: sắp theo hàng từ trên xuống, trong hàng từ trái sang phải;
- `ltr`: trái sang phải;
- `rtl`: phải sang trái;
- `ttb`: trên xuống;
- `btt`: dưới lên;
- `custom`: thứ tự người dùng đã chỉnh.

Ở `auto-row`, ngưỡng gom hàng dựa trên trung vị chiều cao Block nhân `rowThresholdFactor`, nhưng không nhỏ hơn 8 px. Sau sắp xếp, ID được đánh lại liên tục từ 0.

## 9. Từ Block sang DrawUnit

Một `Block` là vật thể mà UI cho phép chọn và chỉnh. Một `DrawUnit` là phần nhỏ mà Player thật sự reveal theo thời gian. Một Block thường có nhiều DrawUnit.

### 9.1 Block vector → DrawUnit path

`VectorUnits` thực hiện:

1. Lấy toàn bộ màu pixel của Block.
2. Tạo palette bằng median-cut toàn cục, mặc định phía UI là 6 mức.
3. Gán mỗi pixel vào màu palette gần nhất.
4. Chạy CCL 4-láng giềng riêng cho từng mã màu.
5. Bỏ region nhỏ hơn `vectorMinRegionArea` ở bước tạo unit.
6. Tạo mask cục bộ cho từng region.
7. Trace biên ngoài bằng Moore-neighbor với điều kiện dừng kiểu Jacob khi quay lại điểm đầu.
8. Rút gọn đường bằng Ramer–Douglas–Peucker với `epsilon = 0.8`.
9. Lấy mẫu lại đường với khoảng cách xấp xỉ 2 px để tốc độ bàn tay đều hơn.

Kết quả là unit `type: "path"`, có cả `path`, `pixels`, `color`, `bbox` và `cost`. Khi phát, Player vẽ tăng dần theo path rồi blit đầy đủ pixel màu gốc khi unit hoàn tất.

### 9.2 Block photo → DrawUnit area

`PhotoRegions` tuân theo thứ tự bắt buộc:

1. Lấy mẫu màu từ **toàn bộ Block**.
2. Chạy median-cut để tạo palette toàn cục, mặc định 10 cụm.
3. Gán độc lập từng pixel vào màu palette gần nhất.
4. Chỉ sau đó mới chạy CCL 4-láng giềng trên các pixel có cùng mã màu.
5. Region đủ diện tích trở thành unit `type: "area"`.

Thuật toán **không region-growing bằng chênh lệch màu giữa hai pixel liền kề**. Nếu dùng cách đó, một gradient có thể nối dây chuyền từ màu đầu đến màu cuối và dính các vùng không nên dính.

Unit area có `pixels`, `color`, `bbox`, `cost` và được Player reveal bằng alpha tích lũy.

### 9.3 Không vứt pixel nhỏ

Các region nhỏ có thể bị loại trong bước tạo path/area, nhưng `mergeUnassignedPixels` gán lại mọi pixel chưa có chủ:

- thử gán cho unit kề 4 hướng, ưu tiên unit lớn hơn, tối đa 3 vòng;
- pixel còn lại được đưa vào unit lớn nhất;
- nếu Block chưa sinh được unit nào, toàn Block trở thành một unit area.

Vì vậy việc giảm số unit không được phép làm mất pixel của Block.

### 9.4 Phân bổ thời gian sơ bộ

Mỗi unit có `cost`:

- path: `len(path)/2 + sqrt(pixelCount)`;
- area: `2 × sqrt(pixelCount)`.

Go chuẩn hóa tổng cost để tạo `t0` và `t1` trong khoảng 0..1. Sau đó React retime lại theo thứ tự, thời gian vẽ riêng của từng vật thể và nhịp nghỉ đã cấu hình.

## 10. Hợp đồng dữ liệu Go/WASM → React

### 10.1 WorkImage

```ts
interface WorkImage {
  rgba: Uint8Array
  gray: Uint8Array
  ink: Uint8Array
  w: number
  h: number
  bg: [number, number, number]
}
```

- `rgba`: ảnh làm việc đã resize;
- `gray`: ảnh xám;
- `ink`: mask nhị phân 0/1 trước bước gom Block;
- `bg`: màu nền ước lượng.

### 10.2 Block

Các field thực WASM trả về gồm:

```ts
{
  id,
  bbox: { x, y, w, h },
  centroid: { x, y },
  inkArea,
  pixels,
  kind: 'vector' | 'photo'
}
```

`pixels` là mảng chỉ số tuyến tính `p = y × imageWidth + x` trong WorkImage.

### 10.3 DrawUnit

```ts
{
  type: 'path' | 'area',
  blockId,
  bbox,
  pixels,
  path,        // [x0, y0, x1, y1, ...]
  color,       // [r, g, b]
  cost,
  t0,
  t1
}
```

`blockId` nối DrawUnit về đúng vật thể. `path` có dữ liệu thật cho unit vector; `pixels/color` có dữ liệu thật cho cả path và area.

### 10.4 AnalysisResult

```ts
interface AnalysisResult {
  img: WorkImage
  blocks: Block[]
  units: DrawUnit[]
  stats: {
    blocks: number
    units: number
    mergeRadiusConfigured: number
    mergeRadiusApplied: number
    workingWidthActual: number
    openingApplied: boolean
  }
}
```

Go không đưa struct hoặc slice kiểu Go trực tiếp qua `syscall/js`. Struct được đổi thành `map[string]interface{}`, mảng số thành `[]interface{}`, còn `rgba`, `gray`, `ink` thành `Uint8Array` bằng `js.CopyBytesToJS`.

Sau khi Worker trả kết quả và trước khi Player nhận dữ liệu, `wasmClient.ts` ghi log:

```text
[Sketchify] AnalysisResult
```

Log gồm số Block, số DrawUnit, danh sách type của unit và thống kê merge/opening. Đây là điểm kiểm chứng pipeline WASM đã chạy thật.

## 11. Cách giao diện biểu diễn kết quả

- Mỗi `Block` cuối cùng tạo một khung chữ nhật trên preview và một dòng trong danh sách vật thể.
- Số trên khung là thứ tự vẽ hiện tại, không nhất thiết là nhãn CCL ban đầu.
- Bật **Ink mask** chỉ xem mask pixel; khung Block mới là kết quả gom vật thể cuối.
- Chọn vật thể trong danh sách làm nổi bật khung tương ứng.
- Thời gian, thứ tự, kiểu vector/photo cưỡng bức, zoom theo vật thể và hiệu ứng đẩy là cài đặt cấp vật thể; chúng không chạy lại thuật toán CCL trừ khi thay đổi một cài đặt phân tích và đánh dấu Frame `dirty`.

## 12. Gom nhóm thủ công và tách nhóm

Gom nhóm thủ công trong React là lớp chỉnh sửa **sau phân tích**, khác hoàn toàn với `MergeTextBlocks` trong Go:

- người dùng chọn nhiều vật thể và gom chúng thành một vật thể logic;
- bounding box, pixel và DrawUnit của các thành viên được hợp nhất dưới một `blockId`;
- lịch sử thành viên gần nhất, Block gốc và DrawUnit gốc được giữ lại;
- “Tách nhóm” khôi phục đúng lần gom gần nhất. Ví dụ `(A+B)+C+D` khi tách sẽ trở lại `A+B`, `C`, `D`; tách tiếp `A+B` mới trả về `A`, `B`.

Việc gom này không thay đổi ảnh nguồn và không huấn luyện thuật toán tự động.

## 12.1 Quét lại cục bộ một Block bị dính

Nút **Quét lại vùng này** ở thiết lập vật thể thực hiện:

1. lấy bbox của vật thể đang chọn và nới biên theo `localRescanPaddingPct`, mặc định 4%;
2. cắt RGBA trực tiếp từ `WorkImage.rgba`;
3. ép chạy pipeline saliency chỉ trên crop;
4. chuyển toàn bộ bbox, centroid, pixel index và tọa độ path từ hệ crop về hệ tọa độ ảnh đầy đủ;
5. nếu có từ hai Block con trở lên, thay Block cũ bằng các Block/DrawUnit mới đúng vị trí thứ tự;
6. lưu kết quả vào `frame.blockOverrides.splits` với `method: 'saliency-rescan'`;
7. khi khôi phục session và phân tích lại ảnh gốc, split được áp lại lên Block có độ chồng lấn hình học cao nhất.

Nếu crop vẫn chỉ có một Block, ứng dụng dừng sau một lần và báo rõ không tách được tự động; không lặp vô hạn.

## 13. Những trường hợp thuật toán dễ sai

### 13.1 Hai vật thể bị dính

Nguyên nhân thường gặp:

- chúng thực sự nối với nhau bằng pixel ink sau opening;
- bóng hoặc đường trang trí khác nền tạo một cầu nối đủ dày;
- khung chữ/minh họa chạm trực tiếp nhau;
- nền ở viền không đại diện đúng nền bên trong ảnh.

Do `mergeRadius = 0`, lỗi dính hiện tại chủ yếu đến từ pixel nối thật trong mask hoặc quy tắc gom chữ, không phải dilation gộp vùng diện rộng.

### 13.2 Một vật thể bị vỡ thành nhiều Block

Nguyên nhân thường gặp:

- phần bên trong quá gần màu nền;
- cạnh quá nhạt so với `edgeThreshold`;
- opening làm mất cầu nối chỉ rộng 1 px;
- các phần chỉ chạm chéo vì CCL dùng 4-láng giềng;
- chi tiết nhỏ bị lọc bởi `minBlockInk`.

### 13.3 Chữ bị gom quá rộng hoặc chưa đủ

Gom chữ chỉ dựa vào chiều cao, baseline, khoảng cách và màu. Nó có thể:

- gom nhiều từ cùng dòng thành một Block nếu khoảng trắng nhỏ;
- tách một cụm chữ nếu font, màu hoặc baseline khác mạnh;
- nhầm icon nhỏ cùng hàng và cùng màu là một phần chữ.

Để nhận biết chính xác từ/câu cần OCR hoặc mô hình layout; phiên bản hiện tại cố ý không phụ thuộc các mô hình đó.

### 13.4 Ảnh chụp bị phân loại thành vector hoặc ngược lại

Block nhỏ luôn là vector. Với Block lớn, quyết định phụ thuộc mật độ region màu sau median-cut; hình minh họa rất nhiều texture có thể giống photo, còn ảnh chụp ít màu/phẳng có thể giống vector. Người dùng có thể cưỡng bức kiểu hiển thị cho từng vật thể mà không cần phân tích lại ảnh.

## 14. Cách kiểm tra một ảnh cụ thể

1. Tải ảnh thành một Frame mới.
2. Chờ trạng thái “Đang phân tích bằng WASM…” kết thúc.
3. Mở DevTools và tìm `[Sketchify] AnalysisResult` để xác nhận số Block/DrawUnit và type thật.
4. Bật **Ink mask**:
   - vùng đáng lẽ là vật thể nhưng không có mask → kiểm tra nền/ngưỡng cạnh/màu;
   - hai vật thể có dải mask nối nhau → lỗi nằm trước CCL;
   - mask tách nhưng một khung Block bao cả hai → kiểm tra `MergeTextBlocks`;
   - Block đúng nhưng animation sai → kiểm tra DrawUnit/Player, không phải segmentation.
5. So khung Block với vật thể nhìn thấy bằng mắt.
6. Chạy preview để kiểm tra DrawUnit của từng Block được reveal đúng thứ tự.

Các test Go quan trọng nằm trong `wasm-src/imaging_test.go`, bao gồm Gray, Sobel, dilation, CCL, tách Block, contour hình vuông, palette photo toàn cục và bảo toàn pixel khi sinh DrawUnit.

## 15. Bản đồ mã nguồn

| Thành phần | Tệp chính |
|---|---|
| Gray, Sobel, nền, ink mask, morphology | `wasm-src/imaging.go` |
| Variance/entropy nền, FFT và spectral saliency | `wasm-src/saliency.go` |
| Cắt cầu nối mảnh trong Block saliency quá lớn | `wasm-src/saliency_split.go` |
| CCL, tạo Block, gom chữ, lọc, thứ tự | `wasm-src/segment.go` |
| Median-cut và phân loại vector/photo | `wasm-src/classify.go` |
| Contour, RDP, DrawUnit path | `wasm-src/vector.go` |
| Phân màu photo toàn cục, DrawUnit area | `wasm-src/photo.go` |
| Bảo toàn pixel, cost, t0/t1 | `wasm-src/timeline.go` |
| Marshal hợp đồng sang JavaScript | `wasm-src/main.go` |
| Worker nạp Go WASM | `src/wasm/imaging.worker.ts` |
| TypeScript contract và log kết quả | `src/wasm/wasmClient.ts` |
| Đồng bộ Block với vật thể, gom/tách thủ công, retime | `src/state/projectStore.ts` |
| Reveal DrawUnit trên canvas | `src/render/Player.ts` |

## 16. Tóm tắt ngắn

Sketchify Video tách vật thể bằng pipeline CV cục bộ: **ước lượng nền → Sobel + khác màu nền → opening → CCL → gom chữ theo hình học → lọc/phân loại → sinh DrawUnit**. Kết quả tách là vùng liên thông/hình học hợp lý chứ không phải hiểu nội dung ảnh. Vector được biến thành đường contour đã RDP; photo được phân cụm màu toàn cục trước khi xét liên thông. Mọi pixel thuộc Block được giữ lại khi tạo DrawUnit, và React dùng chính dữ liệu này để vẽ dần trong preview/video.
