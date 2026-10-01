# Wistorix Drive Widget (Chrome Extension, bản 1.5)

Bong bóng Wistorix và drawer bên phải chạy thẳng trên **drive.google.com**.
Giao diện lấy từ bản demo 1.2 (wistorix-widget-demo12.vercel.app).
ID extension cố định: `kdcfklgimlbbkepipbkhbjlkgjiknckl`. Khoá nằm ở `../_keys/`, đừng đưa khoá này lên GitHub.

## Cài
1. Vào `chrome://extensions` và bật **Developer mode**
2. Bấm **Load unpacked**, chọn thư mục `~/Documents/Wistorix-Extension/drive-widget`
3. Tải lại tab Google Drive. Bong bóng hiện ở góc phải dưới.

Sau mỗi lần sửa code: bấm ↻ ở thẻ extension, rồi tải lại tab Drive.

## Có gì mới ở 1.5.4
- Tab Hiệu quả có **biểu đồ hoạt động theo thời gian** (cột chồng Bạn / Người khác, rê chuột xem số từng cột) và nút chọn khoảng **30 ngày / 90 ngày / 12 tháng** (nhớ lựa chọn). 30 ngày chia theo ngày, 90 ngày theo tuần, 12 tháng theo tháng.
- Lấy tối đa 1.000 hoạt động mỗi lần (trước là 300). Thư mục nhiều hoạt động hơn thì có ghi chú giai đoạn cũ có thể thiếu.
- Khoảng thời gian đã chọn áp dụng cho cả nhật ký, "Tệp có thay đổi" và lịch sử đổi quyền ở tab Bảo mật.

## Có gì mới ở 1.5.3
- Bỏ hẳn phần **Link theo dõi** (tab Hiệu quả) và thẻ "Chia sẻ bằng link theo dõi" (tab Tệp). Tab Hiệu quả giờ chỉ còn số liệu thật từ Google Drive.

## Có gì mới ở 1.5.2
- Tab Hiệu quả diễn giải lại số liệu Drive: thêm 1 câu tóm tắt bằng lời ở đầu, tách hoạt động của **Bạn** và **Người khác** (bảng 2 cột), thêm danh sách người tương tác nhiều nhất.
- Sửa số liệu dễ hiểu sai: "Người được chia sẻ" không còn tính chủ sở hữu; "Tệp có thay đổi" đếm đủ (trước bị giới hạn 5); với thư mục đang xem, ô cuối hiện số tệp công khai bên trong (khớp tab Bảo mật).

## Có gì mới ở 1.5.1
- Tab Bảo mật: danh sách "Tệp đang chia sẻ hoặc cần chú ý" chỉ hiện 5 mục rủi ro nhất ở bản miễn phí. Còn lại hiện thẻ khoá "Còn N mục nữa" kèm nút mở Wistorix Pro để xem tổng quan. Đổi số mục, tên gói và link ở `CFG` đầu `sidepanel.js` (`freeListLimit`, `proName`, `proUrl`).

## Có gì mới ở 1.5
- Side panel làm lại giao diện, gộp thành **3 tab**:
  - **Tệp**: tệp đang chọn, 6 thao tác nhanh (copy link, đổi tên, chuyển, gắn sao, tải về, xóa), ai có quyền truy cập (thu hồi, đặt thời hạn), bản trùng, hoạt động gần đây. Chưa chọn tệp thì hiện danh sách mục trong thư mục đang xem.
  - **Bảo mật**: điểm an toàn 0 đến 100 của thư mục đang xem, 3 thẻ rủi ro (tệp công khai, người được chia sẻ, bản trùng), danh sách "Việc nên làm ngay" có nút xử lý, tệp đang chia sẻ, lịch sử thay đổi quyền 90 ngày, dung lượng. Badge đỏ trên tab = số tệp công khai + số nhóm trùng.
  - **Hiệu quả**: số liệu hoạt động từ Google Drive (tệp hoặc cả thư mục).
- Tab đang mở được nhớ lại. Menu nhanh của bong bóng mở thẳng đúng tab.
- Quét thư mục (Drive thật) lấy thêm danh sách người được chia sẻ và số nhóm trùng. Hoạt động của "Drive của tôi" nay lấy được (đổi `root` sang ID thật).
- Giao diện side panel nằm ở `sidepanel.css`, không dùng `widget.css` nữa (bong bóng trên Drive vẫn dùng `widget.css`).

## Có gì mới ở 1.4
- Panel mở bằng **Side Panel gốc của Chrome**, đứng cạnh trang Drive nên không che nội dung. Bấm bong bóng hoặc icon extension trên thanh Chrome để mở.
- Bong bóng vẫn nằm trên Drive: kéo thả được, có badge, thả tệp vào thì hiện menu nhanh.
- Thêm mục **Hoạt động & số liệu** cho cả tệp và thư mục:
  - Số hoạt động 30 ngày, số người tương tác, số người có quyền, số lần chỉnh sửa, bình luận (còn mở), link công khai
  - Biểu đồ theo loại hoạt động: sửa, bình luận, chia sẻ, di chuyển/đổi tên, tạo mới
  - Nhật ký 90 ngày: ai làm gì, lúc nào, gồm cả thay đổi quyền (+ thêm, − thu hồi)
  - Thư mục: gom hoạt động của mọi tệp bên trong, kèm danh sách tệp hoạt động nhiều nhất
  - Lần cuối BẠN xem tệp
- **Giới hạn của Google:** số lượt xem và danh sách người xem của người khác KHÔNG có trong API với tài khoản Gmail thường.
  Chỉ Google Workspace mới có (Activity dashboard trong giao diện Drive, và Admin Reports API cho quản trị viên).
  Muốn đo lượt xem hoặc reach, cần chia sẻ qua **link theo dõi của Wistorix** (link rút gọn/vanity, đếm lượt bấm). Việc này cần backend, xem roadmap.
- Scope mới `drive.activity.readonly`. Ai đã kết nối ở bản 1.3 thì bấm **Kết nối** lại một lần để cấp thêm quyền.

## Dành cho người test (gửi phần này kèm link)
1. Tải về: trên trang GitHub của repo bấm **Code → Download ZIP**, rồi giải nén (hoặc dùng file `wistorix-drive-widget-1.3.zip` được gửi kèm)
2. Chrome: vào `chrome://extensions`, bật **Developer mode**, bấm **Load unpacked** và chọn thư mục vừa giải nén (thư mục chứa `manifest.json`)
3. Mở https://drive.google.com. Bong bóng Wistorix hiện ở góc phải dưới. Bấm vào bong bóng để mở panel bên cạnh trang (cần Chrome 116 trở lên).
4. Mặc định widget chạy **dữ liệu mẫu**, không đổi gì trên Drive của bạn.
5. Muốn test với Drive thật: trong panel bấm **Kết nối**. Google sẽ báo "ứng dụng chưa được xác minh", bấm **Tiếp tục**.
   Email Google của bạn phải được thêm vào danh sách test user trước, nếu chưa thì Google báo lỗi 403 access_denied.
6. Extension đăng nhập bằng **tài khoản đang đăng nhập Chrome**. Nên dùng cùng tài khoản đó để mở Drive.
7. Lưu ý: thu hồi quyền chia sẻ là thao tác thật và không hoàn tác được. Nên test trên tệp thử.

Gửi lỗi kèm ảnh chụp màn hình panel, và nếu được thì kèm Console (F12 → Console, lọc chữ "Wistorix").

## Hai chế độ
- **Dữ liệu mẫu** (mặc định): không cần đăng nhập. Quyền chia sẻ và trùng lặp là số giả, thao tác không đổi gì trên Drive.
- **Drive thật**: trong panel bấm **Kết nối**, rồi đăng nhập Google. Panel gọi Drive API v3.
  Bấm **Ngắt kết nối** ở chân panel để quay về dữ liệu mẫu.

| Tính năng | Drive thật |
|---|---|
| Tệp đang chọn, thông tin (kích thước, chủ sở hữu, ngày tạo/sửa, đường dẫn đầy đủ) | `files.get` |
| Danh sách chia sẻ, thu hồi link công khai và từng email | `permissions.list` / `delete` |
| Thời hạn chia sẻ 7/30/90 ngày | `permissions.update` (expirationTime) |
| Trùng lặp: cùng md5 với tệp thường, cùng tên và loại với Docs/Sheets | `files.list` |
| Đổi tên, di chuyển, dấu sao, xoá (vào Thùng rác) | `files.update` |
| Chọn nhiều tệp: di chuyển, thu hồi link, xoá hàng loạt | |
| Badge và "Cần xử lý": quét thư mục đang mở (tệp công khai, tệp trùng) | `files.list` |
| Dung lượng thật và dung lượng Thùng rác | `about.get` |

Thu hồi và xoá phải bấm 2 lần để xác nhận. Xoá chỉ chuyển vào Thùng rác Drive (khôi phục được trong 30 ngày).
Chuyển quyền sở hữu vẫn mở dashboard.

## Cấu hình OAuth (một lần)
Đã tạo sẵn (29/09/2026) trong project **viethungmedia** (viethungmedia-180193): client "Wistorix Drive Widget (dev)", consent screen ở chế độ Testing, test user vhfashion18193@gmail.com. Muốn làm lại ở project khác thì:
1. APIs & Services → Credentials → **Create credentials → OAuth client ID**
2. Application type: **Chrome Extension**. Item ID: `kdcfklgimlbbkepipbkhbjlkgjiknckl`
3. Copy Client ID vào `manifest.json` → `"oauth2" → "client_id"`, rồi bấm ↻ tải lại extension
4. Nếu OAuth consent screen đang ở chế độ *Testing*: thêm email của bạn vào **Test users**
5. Bảo đảm **Google Drive API** đã được bật trong project

Lưu ý: `chrome.identity` đăng nhập bằng **tài khoản đang đăng nhập Chrome**. Nếu tab Drive mở tài khoản khác, panel sẽ cảnh báo "Khác tài khoản".

## Tuỳ chỉnh (đầu file `content.js`)
- `showDemoPill: false`: ẩn nhãn "DỮ LIỆU MẪU" và thanh "Kết nối" (khi quay video)
- `dashboardUrl`, `rightGap`, `scanTtl`

## File
- `manifest.json`: MV3. Quyền gồm `storage` và `identity`, scope `drive`, chạy trên drive.google.com
- `content.js`: bong bóng trên Drive, đọc DOM Drive, gửi snapshot cho side panel
- `sidepanel.html` + `sidepanel.js` + `sidepanel.css`: side panel 3 tab (Tệp, Bảo mật, Hiệu quả), dữ liệu mẫu và Drive thật
- `shared.js`: tiện ích dùng chung, dữ liệu mẫu
- `background.js`: mở side panel, OAuth (`chrome.identity`), gọi Drive API v3 và Drive Activity API v2
- `widget.css`, `sprite.svg`, `fonts/`, `icons/`
