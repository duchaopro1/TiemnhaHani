# Hướng dẫn: hai website riêng, dùng chung dữ liệu qua Firebase

Mục tiêu:

| Website | Ai dùng | Địa chỉ (ví dụ) | Nằm ở |
|---|---|---|---|
| **Quản lý Hani** | chủ shop + đồng nghiệp (đăng nhập Google) | `https://hani-quanly.web.app` | thư mục gốc của kho mã |
| **Shop Hani** (bán hàng) | khách, không cần đăng nhập | `https://hani-shop.web.app` | thư mục `docs/` |

Hai website là **hai tên miền khác nhau**, chạy riêng. Chúng chỉ chung một cơ sở dữ liệu Firebase:

- Trang quản lý tự đưa **sản phẩm, giá, ảnh, số lượng tồn** lên cửa hàng (vài giây sau khi kho đổi).
- Khách đặt hàng trên cửa hàng → **đơn về thẳng mục "📬 Đơn từ web"** của trang quản lý.
- Khách **không đọc được** giá vốn, đơn hàng, thông tin khách khác. Luật bảo mật nằm trong `firestore.rules`.

Chi phí: gói **Spark (miễn phí)** của Firebase đủ cho một shop nhỏ.

---

## Bước 1. Tạo dự án Firebase (khoảng 5 phút)

1. Vào <https://console.firebase.google.com> → **Add project** (tắt Google Analytics cũng được).
2. **Build → Firestore Database → Create database** → chọn *Production mode*, vị trí `asia-southeast1` (Singapore).
3. **Build → Authentication → Get started → Sign-in method → Google → Enable**.
4. **Project settings (bánh răng) → General → Your apps → biểu tượng Web `</>`** → đặt tên (vd `hani`) → **Register app**.
   Firebase hiện một khối `firebaseConfig = { apiKey: "...", authDomain: "...", ... }`. Giữ trang này.

## Bước 2. Gửi tôi 3 thứ (an toàn, không có mật khẩu)

- Khối `firebaseConfig` ở bước 1.4. Đây là cấu hình **công khai** của web, ai mở trang cũng thấy; **không phải** mật khẩu.
- Email Google của bạn và của đồng nghiệp được dùng trang quản lý.
- Hai tên bạn muốn cho website (vd `hani-quanly` và `hani-shop`; mỗi tên là một địa chỉ `tên.web.app`).

Tôi sẽ dán vào `js/firebase-config.js`, `docs/config.js`, `firestore.rules` và đẩy lên. **Đừng gửi mật khẩu, token hay file khoá tài khoản dịch vụ cho tôi.**

## Bước 3. Tạo hai website trên Firebase Hosting

**Build → Hosting → Get started**, rồi **Add another site** để có đủ hai site, đặt đúng hai tên ở bước 2.
Muốn dùng tên miền riêng (vd `shop.tenban.vn`): trong từng site chọn **Add custom domain** và làm theo hướng dẫn.

## Bước 4. Đưa lên mạng (làm một lần trên máy tính của bạn)

Cần cài [Node.js](https://nodejs.org) trước. Mở Terminal / PowerShell trong thư mục kho mã:

```bash
npm i -g firebase-tools
firebase login
cp .firebaserc.example .firebaserc      # rồi sửa tên dự án trong file này
firebase target:apply hosting admin hani-quanly
firebase target:apply hosting shop  hani-shop
firebase deploy                          # đưa cả 2 website + luật bảo mật lên
```

Từ lần sau, mỗi khi tôi sửa mã, bạn chạy lại `firebase deploy` (hoặc nhờ tôi hướng dẫn nối GitHub để tự đưa lên khi gộp nhánh).

## Bước 5. Chuyển dữ liệu từ trang quản lý cũ (link Claude) sang

1. Ở **trang cũ**: **Cài đặt → Tải bản sao lưu** (lưu file `.json`).
2. Mở **trang quản lý mới** (`https://hani-quanly.web.app`), đăng nhập Google.
3. **Cài đặt → Khôi phục từ bản sao lưu** → chọn file vừa tải. *Khôi phục sẽ thay toàn bộ dữ liệu của trang mới bằng bản sao lưu.*
4. Kiểm tra sản phẩm, đơn, nhập hàng đã đủ rồi mới ngừng dùng trang cũ. Trang cũ không tự cập nhật nữa sau khi chuyển.

> Ảnh: ảnh sản phẩm lưu trong bản sao lưu dưới dạng ảnh thu nhỏ. Nếu một số ảnh mất sau khi khôi phục, bạn tải lại ảnh đó ở trang Sản phẩm.

## Bước 6. Kiểm tra

1. Trang quản lý mới → tab **Cửa hàng web**: phải thấy **"✓ Cửa hàng đã khớp với kho"**. Chọn sản phẩm nào hiện, viết mô tả, điền tài khoản Instagram / Threads.
2. Mở `https://hani-shop.web.app` (website của khách): thấy sản phẩm và số lượng còn.
3. Đặt thử một đơn trên cửa hàng → trang quản lý hiện thông báo và tab **Đơn hàng** có số đỏ → **📬 Đơn từ web → Tạo đơn**.
4. Gửi cho khách **link cửa hàng** (không gửi link trang quản lý).

---

## Câu hỏi thường gặp

**Khách có xem được giá vốn, đơn của người khác không?** Không. Cửa hàng chỉ đọc hai nhóm dữ liệu công khai (`shopProducts`, `shopInfo`). Đơn khách gửi đi (`shopOrders`) khách chỉ *tạo* được, không đọc lại được, chỉ email trong danh sách mới đọc.

**Có bị người lạ gửi đơn rác không?** Có thể. Luật giới hạn kích cỡ và hình dạng đơn, và form có ô chống robot đơn giản. Nếu bị spam nhiều, bật **Firebase App Check** (tôi hướng dẫn thêm).

**Khi tắt trang quản lý, cửa hàng còn cập nhật không?** Cửa hàng luôn hiện được dữ liệu lần cuối. Số lượng tồn chỉ cập nhật khi trang quản lý đang mở (vài giây sau mỗi thay đổi).

**Chưa muốn dùng Firebase?** Cửa hàng vẫn chạy bằng file `docs/catalog.json` (xuất từ tab **Cửa hàng web**), khách gửi đơn bằng tin nhắn. Khi `docs/config.js` để trống `apiKey`, cửa hàng tự dùng cách này.

**Thêm đồng nghiệp?** Thêm email vào danh sách `allowed()` trong `firestore.rules`, rồi `firebase deploy --only firestore:rules`.
