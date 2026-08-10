# PROMPT_FIX_V1 — Tách đúng setting Frame và Object cho Sketchify Video

```text
Bạn đang sửa dự án sketchify-video theo prompt kỹ thuật v8. Mục tiêu của bản sửa này là
khắc phục lỗi kiến trúc: UI hiện chỉ có một bảng setting cho Frame, trong khi v8 yêu cầu
Object Formatting Panel hiển thị toàn bộ vật thể và cho phép chỉnh từng vật thể.

Đọc toàn bộ prompt v8 trước khi sửa. Không quay lại thiết kế một bảng setting chung cho cả
Frame và Object. Không dùng mergeRadius để giải quyết vấn đề này: mergeRadius đã bị khóa
0px, không hiển thị và không cho người dùng chỉnh sửa. Mỗi thành phần liên thông của Ink mask
được giữ đúng là một Block/đối tượng phân tích.

## 1. Nguyên tắc phân quyền setting

### 1.1. Setting cấp Project

Project chỉ chứa các giá trị xuyên suốt toàn video:

```ts
interface Project {
  frames: Frame[]
  activeFrameId: number | null
  handStyle: HandStyleId
  playhead: { globalTimeSec: number; playing: boolean }
}
```

`handStyle` tuyệt đối không nằm trong Frame hoặc Object.

### 1.2. Setting cấp Frame

Frame là một ảnh/slide độc lập. Frame không còn sở hữu một thanh “Thời gian vẽ” tổng
để người dùng phân bổ thủ công cho toàn ảnh. Thời lượng vẽ của Frame được tính từ các
ObjectSettings bên dưới.

```ts
interface FrameSettings {
  holdDurationSec: number              // giữ ảnh sau khi mọi object đã vẽ xong
  camera: {
    mode: 'off'|'A-auto-follow'|'B-manual-keyframe'|'C-two-stage'|'D-hybrid'
    zoomLevel: number
    zoomPadding: number
    zoomOutPortion: number
    maxBlocksForAutoFollow: number
    manualKeyframes: ManualKeyframe[]
  }
  pageZoom: {
    enabled: boolean
    mode: 'auto-rows'|'manual'
    pageGroups: number[][]
    transitionSec: number
    padding: number
  }
  transitionToNext: {
    type: 'none'|'zoom-morph'|'paper-airplane'|'paper-fold'
    durationSec: number
  }
}
```

Frame có thể giữ các tham số phân tích nội bộ (edge threshold, background tolerance,
working width) ở tầng kỹ thuật, nhưng không được đặt chúng cạnh các control thời lượng
Object trong panel chính. Không tạo lại control mergeRadius; runtime và UI đều giữ 0px.

Frame panel chỉ hiển thị:

1. Thời gian giữ khung (`holdDurationSec`).
2. Camera A/B/C/D và các option camera liên quan.
3. Zoom trang trong Frame.
4. Hiệu ứng chuyển sang Frame kế tiếp (`transitionToNext`), chỉ hiện khi Frame không phải
   phần tử cuối.

Không hiển thị trong Frame panel:

- “Thời gian vẽ” tổng.
- “Gộp vùng”/mergeRadius.
- Một checkbox hiệu ứng áp dụng ngầm cho mọi Object.
- Một order mode khiến toàn bộ Object mất thứ tự riêng.

### 1.3. Setting cấp Object

Mỗi Block sau khi WASM trả AnalysisResult phải có một bản ghi setting UI ổn định. Không
nhét setting UI vào pixels/path của AnalysisResult; giữ AnalysisResult là dữ liệu phân tích
và tạo danh sách setting song song trong Frame.

```ts
interface ObjectSettings {
  objectId: string                    // ổn định qua re-analysis nếu bbox khớp được
  blockId: number                     // id hiện tại trong AnalysisResult
  order: number                       // thứ tự vẽ, 0-based, không trùng nhau
  drawDurationSec: number             // thời gian riêng của Object
  kindOverride?: 'vector'|'photo'
  strokeColorMode: 'object'|'custom'
  inkColor: string
  strokeWidth: number
  pushEntry: {
    enabled: boolean
    edge: 'auto'|'left'|'right'|'top'|'bottom'
  }
  pinCamera: boolean                  // tương đương pinnedBlockIds
}

interface FrameObject {
  objectId: string
  blockId: number
  bbox: Rect
  centroid: Pt
  kind: 'vector'|'photo'
  inkArea: number
  settings: ObjectSettings
}
```

`Frame.objects` phải được cập nhật ngay sau khi AnalysisResult về. Danh sách phải chứa
toàn bộ Block, không tự động bỏ Object nhỏ và không tự động chọn 1–2 Object lớn nhất cho
push. `pushEntry.enabled` mặc định false cho từng Object.

## 2. Công thức timeline mới

Không dùng `frame.settings.drawDurationSec` nữa. Với Frame có N Object sau khi sort theo
`settings.order`:

```ts
const drawDurationSec = frame.objects.reduce(
  (sum, object) => sum + object.settings.drawDurationSec,
  0,
)
const totalDurationSec = drawDurationSec + frame.settings.holdDurationSec
frame.durationSec = totalDurationSec
```

Các Object chạy nối tiếp theo thứ tự vẽ. Object thứ i có:

```ts
objectStartSec = sum(duration của các object trước i)
objectEndSec = objectStartSec + object.settings.drawDurationSec
unit.t0 = objectStartSec / drawDurationSec
unit.t1 = objectEndSec / drawDurationSec
```

Nếu một Object có nhiều DrawUnit, chỉ chia phần thời gian của Object đó theo `cost` của
các unit thuộc cùng Object. Không được lấy tổng cost toàn ảnh để làm mất tác dụng của
drawDurationSec riêng từng Object.

`DrawUnit.t0/t1` vẫn là 0..1 trên draw phase của Frame để Player và camera hiện tại tái sử
dụng được. Có thể bổ sung `objectStartSec/objectEndSec` trong timeline dẫn xuất, nhưng
không được tạo pipeline render thứ hai.

Ví dụ bắt buộc:

```text
Frame B có 5 Object với thời lượng [1, 2, 3, 4, 5] giây và hold = 2 giây.
drawDurationSec = 15 giây.
totalDurationSec = 17 giây.
Các ranh giới Object là 0–1, 1–3, 3–6, 6–10, 10–15 giây.
Không được hiển thị một thanh “Thời gian vẽ = 15s” để người dùng chỉnh cả Frame.
```

`buildProjectTimeline(project)` dùng `frame.durationSec` đã dẫn xuất. Transition không
cộng thêm thời lượng; nếu transition khác `none`, chỉ trừ `durationSec/2` ở cuối Frame
hiện tại và đầu Frame sau theo đúng §11.6.

## 3. Kiến trúc UI bắt buộc

### 3.1. Panel Object Formatting

Khi Frame đã phân tích, panel phải có một danh sách cuộn riêng cho toàn bộ Object. Mỗi dòng
hiển thị:

- số thứ tự vẽ và thumbnail crop từ `unit._tile`/WorkImage;
- badge `vector` hoặc `photo`;
- inkArea/bbox ngắn gọn;
- input `drawDurationSec` của riêng dòng đó;
- điều khiển đổi thứ tự (drag handle hoặc nút lên/xuống), không dùng tọa độ trái/phải;
- chọn hiệu ứng vẽ/kiểu màu của Object;
- checkbox `Đẩy vào khung` và edge `auto/left/right/top/bottom` chỉ mở cho Object đó;
- checkbox `Ghim camera` chỉ tác động camera tại Object đó;
- trạng thái dirty/tính lại timeline nếu Object đang được sửa.

Click một dòng phải đánh dấu Object đang chọn và làm nổi bật bbox tương ứng trên overlay.
Không được gom tất cả dòng vào một setting Frame duy nhất.

### 3.2. Panel Frame

Khi không chọn Object cụ thể, panel Frame chỉ hiển thị hold, camera, page zoom và
transitionToNext. Khi đang chọn Object, transitionToNext vẫn thuộc Frame nhưng đặt trong
section Frame riêng; không copy transition vào từng Object.

Icon Edit phải mở Object Formatting khi có Frame/Object được chọn. Icon Bàn tay luôn hiện
và tiếp tục sửa `Project.handStyle` toàn cục.

### 3.3. Trạng thái rỗng và giới hạn

- Chưa có AnalysisResult: hiển thị “Chưa có vật thể”, không render các control Object.
- Có 1 Object: vẫn dùng đúng một dòng Object, không rơi về panel Frame cũ.
- Có >8 Object: danh sách Object cuộn độc lập, không làm dãn vô hạn cột phải.
- Frame cuối: ẩn transitionToNext.
- Không render/đọc control mergeRadius ở bất kỳ panel nào; giá trị gửi WASM luôn 0.

## 4. State và invalidate cache

Tạo các action rõ ràng:

```ts
setFrameHold(frameId, holdDurationSec)
setFrameCamera(frameId, cameraPatch)
setFramePageZoom(frameId, pageZoomPatch)
setFrameTransition(frameId, transitionPatch)
setObjectDuration(frameId, objectId, seconds)
setObjectOrder(frameId, objectId, order)
setObjectEffect(frameId, objectId, effectPatch)
setObjectPush(frameId, objectId, pushPatch)
setObjectPinCamera(frameId, objectId, pinned)
```

Quy tắc:

- Đổi duration/order/effect/push/pin của một Object chỉ đánh dấu Frame đó cần rebuild
  draw timeline/camera timeline tương ứng; không chạy lại WASM và không đụng Frame khác.
- Đổi hold/camera/pageZoom/transition của một Frame chỉ rebuild timeline/camera/transition;
  không chạy lại phân tích pixel.
- Chỉ các tham số phân tích thật sự (workingWidth, edgeThreshold, bgTolerance, hoặc
  block override) mới làm Frame đó dirty và gọi WASM lại.
- Khi re-analysis, ghép ObjectSettings cũ theo objectId trước; nếu id đổi thì match bằng
  bbox/centroid gần nhất trong cùng Frame. Không lấy setting Object #2 gán nhầm cho Object
  mới chỉ vì mảng bị sort lại.
- Không invalidate analysis của Frame #1/#3 khi sửa Object của Frame #2.

## 5. Camera, push và page transition

- Camera mode là setting cấp Frame vì nó điều khiển toàn bộ camera timeline của Frame.
- `pinCamera` là lựa chọn cấp Object; khi true phải tạo key zoom tại t0 Object đó kể cả
  camera mode off, đúng §12.1.
- `pushEntry` là lựa chọn cấp Object; chỉ Object được tick mới trượt vào. Không tự chọn
  Object lớn nhất.
- Page zoom/transition giữa Frame là setting cấp Frame. `keyMid` của page zoom chỉ union
  đúng hai page liền kề; transition giữa Frame không được trộn với page zoom trong một
  state mơ hồ.
- Mọi crop camera đi qua `fitRect`, không méo tỉ lệ.

## 6. Tương thích pipeline WASM/Player

- Giữ AnalysisResult field-by-field hiện có: WorkImage → Block[] → DrawUnit[].
- WASM không đọc React store; nhận settings đã chuẩn hóa qua wasmClient.
- Player dùng một render loop duy nhất cho preview và record.
- Player reveal theo DrawUnit.t0/t1 của timeline mới; contentCanvas tích lũy, unitCursor
  bỏ qua unit đã hoàn tất, unit hoàn tất phải rõ nét ngay.
- Hand cursor lấy quỹ đạo từ unit.path hoặc area trajectory và dùng Project.handStyle.
- Khi Frame chuyển tiếp, displayCanvas đang captureStream() phải là canvas nhận raster cuối
  cùng của transition; không để animation giấy chỉ nằm trên DOM overlay.

## 7. Acceptance tests bắt buộc

1. Tải một ảnh có đúng 5 Block. Danh sách Object hiển thị đúng 5 dòng, mỗi dòng có
   duration riêng, order riêng, push/pin riêng.
2. Đặt duration [1,2,3,4,5] và hold 2: tổng draw = 15s, tổng Frame = 17s; kiểm tra
   ranh giới t0/t1 của cả 5 Object.
3. Đổi duration Object #2: Object #1/#3 giữ nguyên setting, không gọi lại WASM và chỉ
   Frame đang chọn bị rebuild timeline.
4. Đổi hold/camera/transition của Frame #2: không phân tích lại Frame #1/#3.
5. Reorder Object bằng drag: chỉ `order` thay đổi, không animate left/top và không đổi
   blockId/pixels.
6. Bật pin cho Object #3 khi camera off: camera vẫn có key zoom đúng lúc Object #3 bắt
   đầu, sau đó trở lại full frame.
7. Tick push cho Object #2 và #4: chỉ hai Object đó trượt vào; tổng thời lượng không đổi.
8. Kiểm tra UI không có text/input/handler `mergeRadius` và WASM log configured/applied
   luôn bằng 0.
9. Hai Frame có duration dẫn xuất khác nhau và một transition: project timeline chuyển
   tự động sang Frame kế tiếp, tổng thời lượng không cộng thêm transition.
10. Chạy `go test ./wasm-src`, `npm test`, `npm run build`; không báo hoàn thành nếu bất kỳ
    test nào fail.

## 8. Báo cáo khi hoàn tất

Báo cáo phải nêu rõ:

- File/state nào đã tách FrameSettings khỏi ObjectSettings.
- Công thức tổng thời lượng và log 5 Object [1,2,3,4,5] → 17 giây.
- Bằng chứng sửa Object #2 không re-analyze Frame #1/#3.
- Số dòng Object panel, trạng thái Frame panel, và việc mergeRadius không còn hiển thị.
- Kết quả từng acceptance test và lệnh build/test đã chạy.
```
