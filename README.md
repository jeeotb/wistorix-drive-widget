# Wistorix Drive Widget (Chrome Extension, bản 1.3)

Bong bóng Wistorix và drawer bên phải chạy thẳng trên **drive.google.com**.
Giao diện lấy từ bản demo 1.2 (wistorix-widget-demo12.vercel.app).
ID extension cố định: `kdcfklgimlbbkepipbkhbjlkgjiknckl`. Khoá nằm ở `../_keys/`, đừng đưa khoá này lên GitHub.

## Cài
1. Vào `chrome://extensions` và bật **Developer mode**
2. Bấm **Load unpacked**, chọn thư mục `~/Documents/Wistorix-Extension/drive-widget`
3. Tải lại tab Google Drive. Bong bóng hiện ở góc phải dưới.

Sau mỗi lần sửa code: bấm ↻ ở thẻ extension, rồi tải lại tab Drive.

## Dành cho người test (gửi phần này kèm link)
1. Tải về: trên trang GitHub của repo bấm **Code → Download ZIP**, rồi giải nén (hoặc dùng file `wistorix-drive-widget-1.3.zip` được gửi kèm)
2. Chrome: vào `chrome://extensions`, bật **Developer mode**, bấm **Load unpacked** và chọn thư mục vừa giải nén (thư mục chứa `manifest.json`)
3. Mở https://drive.google.com. Bong bóng Wistorix hiện ở góc phải dưới.
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
- `content.js`: đọc DOM Drive, dữ liệu mẫu, render panel, gọi API qua background
- `background.js`: OAuth (`chrome.identity`) và toàn bộ lệnh gọi Drive API v3
- `widget.css`, `sprite.svg`, `fonts/`, `icons/`
