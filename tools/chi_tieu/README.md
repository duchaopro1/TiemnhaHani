# Sổ Chi Tiêu

Web app theo dõi chi tiêu, dùng trên điện thoại như app thật. Mỗi khoản chi có thể kèm ảnh chụp (kiểu Locket).
Dữ liệu và ảnh lưu **trong máy** (IndexedDB), không gửi lên mạng.

## Tính năng
- **Hôm nay**: tổng chi trong ngày, các khoản chi dạng thẻ ảnh; bấm ‹ › để xem ngày khác.
- **+**: nhập số tiền (chip +10k/+20k/+50k..., nút ×1.000), chọn mục, ghi chú, 📷 chụp ảnh hoặc chọn từ thư viện.
- **Tháng**: tổng, trung bình/ngày, so với tháng trước, biểu đồ vòng theo mục, ngân sách (tổng và theo từng mục), lịch heatmap, 5 khoản lớn nhất. Bấm một mục để xem chi tiết.
- **Nhật ký**: danh sách theo ngày, tìm theo ghi chú.
- **Cài đặt**: ngân sách, thêm/sửa/xóa danh mục, sao lưu JSON (kèm ảnh), xuất CSV, khôi phục.

## Cài lên điện thoại
App cần được mở qua **https** để "Thêm vào Màn hình chính" (PWA). Cách dễ nhất:
1. **GitHub Pages**: đưa thư mục này lên một repo, Settings → Pages → chọn branch. Mở link bằng điện thoại.
2. **Firebase Hosting** (repo Hani đã có `firebase.json`, `public: "."`): sau khi merge và deploy, app nằm ở `/tools/chi_tieu/`.
3. **Thử nhanh trong nhà** (không cài được dạng app, nhưng dùng được): trên máy tính chạy
   `python3 -m http.server 8000` trong thư mục này, rồi mở `http://<IP-máy-tính>:8000` trên điện thoại cùng WiFi.

Trên iPhone: Safari → Chia sẻ → **Thêm vào Màn hình chính**. Trên Android: Chrome → ⋮ → **Cài đặt ứng dụng**.

## Lưu ý
- Dữ liệu chỉ nằm trên thiết bị + trình duyệt đã dùng. Đổi máy hoặc xóa dữ liệu trình duyệt sẽ mất → sao lưu định kỳ.
- Ảnh được nén (cạnh dài 1080px) để nhẹ máy.
- Nút "Chụp ảnh" mở camera trên điện thoại; trên máy tính sẽ mở hộp chọn file.
