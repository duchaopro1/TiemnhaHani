# TiemnhaHani — app quản lý cửa hàng Hani ⭐

Web app quản lý nhập hàng, tồn kho, giá vốn, lợi nhuận và đơn hàng từ **Shopee · Threads · Instagram**.
Giao diện theo Brand Guidelines của Hani (xanh `#1479C4`, bảng màu for her / for him / for friend, font Cabin).

## Tính năng

| Tab | Làm gì |
|---|---|
| **Tổng quan** | Doanh thu, chi phí, lợi nhuận, biên lãi theo tháng; so sánh 3 nền tảng; top sản phẩm lãi nhất; cảnh báo sắp hết hàng |
| **Đơn hàng** | Thêm đơn bằng tay (Threads/Instagram) · nhập file Excel đơn hàng Shopee · mỗi dòng gồm **Sản phẩm, Số lượng, Dụng cụ đóng gói 1/2/3** · phí ship **Khách chịu / Shop chịu** · tính lãi ngay khi nhập |
| **Nhập hàng** | Phiếu nhập sản phẩm & dụng cụ đóng gói, có phí ship nhập · **sửa / xoá phiếu đã nhập** (tồn kho và giá vốn tự tính lại) · bấm tên mặt hàng để sửa thông tin mặt hàng |
| **Sản phẩm** | Giá bán, giá vốn TB, bộ đóng gói mặc định, giá thành đủ, lãi/cái, tồn kho · **bảng giá thành theo từng cách đóng gói** |
| **Đóng gói** | Dụng cụ đóng gói (hộp, giấy, ruy băng, thiệp…) và **Bộ đóng gói** dùng nhanh |
| **Cài đặt** | Chia sẻ link, sao lưu / khôi phục JSON, xuất CSV đơn hàng, dữ liệu mẫu |

## Cách tính giá thành & lợi nhuận

```
Giá vốn 1 sản phẩm   = Σ(SL × giá nhập + phí ship nhập) / Σ SL      (trung bình các lần nhập)
Chi phí đóng gói     = giá dụng cụ 1 + 2 + 3   (× SL nếu tick "đóng gói riêng từng cái")
Doanh thu đơn        = Σ(giá bán × SL) − giảm giá/voucher shop
Lợi nhuận đơn        = Doanh thu − giá vốn SP − đóng gói − phí sàn − phí ship (chỉ khi Shop chịu)
```

Khi khách chịu ship, tiền ship chỉ chuyển qua tay shop nên không tính vào lãi.
Đơn ở trạng thái **Đã huỷ / Trả hàng** không trừ kho và không tính doanh thu.

### Tối ưu "giá SP + giá đóng gói + ship"

Thay vì nhập giá từng kiểu gói cho từng sản phẩm, app tách thành 3 lớp:

1. **Dụng cụ đóng gói** có giá riêng (cập nhật tự động theo lần nhập gần nhất / trung bình).
2. **Bộ đóng gói** = tổ hợp tối đa 3 dụng cụ (VD *Hộp quà* = hộp + giấy rơm + ruy băng). Mỗi sản phẩm chọn 1 bộ mặc định.
3. Khi lên đơn, chọn sản phẩm là **tự điền** 3 dụng cụ theo bộ mặc định. Muốn đổi thì chọn bộ khác hoặc sửa từng ô.

Nhờ vậy, khi giá hộp tăng bạn chỉ cần nhập phiếu mới. Mọi sản phẩm dùng hộp đó tự cập nhật giá thành. Bảng **"Giá thành theo cách đóng gói"** ở tab Sản phẩm cho thấy ngay giá vốn của mỗi sản phẩm với từng kiểu gói, để đặt giá bán cho hợp lý.
Ship được tính theo từng đơn (vì phụ thuộc địa chỉ), không cộng vào giá thành sản phẩm.

## Nhập đơn Shopee

Shopee không cho shop nhỏ kết nối API trực tiếp nếu chưa đăng ký Shopee Open Platform. Vì vậy app đọc file xuất từ Kênh Người Bán:

1. **Kênh Người Bán → Đơn hàng → Tất cả → Xuất**, tải file `.xlsx`.
2. Trong app: **Đơn hàng → ⬆ Nhập file Shopee**.
3. Lần đầu, app hỏi mỗi sản phẩm Shopee ứng với sản phẩm nào trong kho (hoặc tạo mới). Các lần sau app tự nhớ.
   Mẹo: đặt **SKU** sản phẩm trong app trùng với SKU phân loại trên Shopee là app tự khớp luôn.
4. Nhập lại file cũ không bị trùng đơn. App chỉ cập nhật trạng thái và phí sàn, còn đóng gói bạn đã chọn thì giữ nguyên.

## Lưu dữ liệu & chia sẻ link cho đồng nghiệp

App có 2 chế độ:

- **Chỉ máy này** (mặc định, chưa cấu hình gì): dữ liệu lưu trong trình duyệt. Dùng để thử.
- **Dùng chung online** (Firebase, miễn phí): dữ liệu lưu trên cloud và đồng bộ realtime. Ai có link và email được cấp quyền đều dùng được, kể cả trên điện thoại.

### Bật chế độ dùng chung (~15 phút, làm 1 lần)

1. Vào <https://console.firebase.google.com> → **Add project** (tắt Analytics cũng được).
2. **Build → Firestore Database → Create database** (chọn vùng `asia-southeast1`, production mode).
3. **Build → Authentication → Get started → Sign-in method → Google → Enable**.
4. **Project settings → General → Your apps → Web (`</>`)** → đăng ký app, copy đoạn `firebaseConfig` dán vào [`js/firebase-config.js`](js/firebase-config.js).
5. Mở [`firestore.rules`](firestore.rules), thay email bằng email Google của bạn và đồng nghiệp. Sau đó dán nội dung vào **Firestore → Rules → Publish**.
6. Deploy để có link (chọn 1 trong 2 cách):
   - **Firebase Hosting** (khuyên dùng, repo private vẫn được):
     ```bash
     npm i -g firebase-tools
     firebase login
     firebase use --add        # chọn project vừa tạo
     firebase deploy           # → https://<project>.web.app
     ```
   - **GitHub Pages**: Settings → Pages → Source = *GitHub Actions*. Mỗi lần push lên `main` sẽ tự deploy (workflow `.github/workflows/pages.yml`). Repo private cần GitHub Pro.
7. Nếu dùng GitHub Pages: thêm domain `<user>.github.io` vào **Authentication → Settings → Authorized domains**.
8. Gửi link cho đồng nghiệp. Họ đăng nhập Google là dùng được. Muốn thêm người, thêm email vào rules rồi Publish lại.

Đã nhập dữ liệu ở chế độ "chỉ máy này"? Vào **Cài đặt → Tải bản sao lưu**, bật Firebase, đăng nhập, rồi **Khôi phục** file đó.

## Chạy thử trên máy

```bash
npm start          # mở http://localhost:5173
npm test           # kiểm tra công thức tính
```

Không cần build. App là HTML/CSS/JS thuần (`index.html`, `css/`, `js/`).

## Font

Brand dùng **CS Mocha Demo** (logo) và **Oilvare Base** (tiêu đề), 2 font này không có trên Google Fonts.
Nếu có file font, đặt vào thư mục `fonts/` với tên `CSMochaDemo.otf` và `OilvareBase.otf`, app sẽ tự dùng.
Nếu không có, app dùng Fredoka / Lilita One thay thế. Font nội dung là **Cabin**, đúng theo guideline.
