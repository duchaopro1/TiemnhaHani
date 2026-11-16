// Cấu hình Firebase của shop (công khai: ai mở trang cũng thấy được, an toàn nhờ luật trong firestore.rules).
// Để trống apiKey => app chạy ở chế độ "chỉ máy này" (lưu trong trình duyệt).
export const firebaseConfig = {
  apiKey: 'AIzaSyDItiM_VIT7sBtHLO8LpGD7Sf5edBtlg3s',
  authDomain: 'shoptiemnhahani.firebaseapp.com',
  projectId: 'shoptiemnhahani',
  storageBucket: 'shoptiemnhahani.firebasestorage.app',
  messagingSenderId: '808569812759',
  appId: '1:808569812759:web:4a1bdbc3943bbd59492952',
};

// Tên "kho dữ liệu" của shop trong Firestore. Giữ nguyên trừ khi muốn tách dữ liệu.
export const SHOP_ID = 'hani';
