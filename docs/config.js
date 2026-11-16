// Cấu hình công khai của cửa hàng web (không phải bí mật: ai mở trang cũng thấy được, an toàn nhờ luật trong firestore.rules).
// Cùng khối firebaseConfig và SHOP_ID với trang quản lý (js/firebase-config.js).
// Để trống apiKey = cửa hàng đọc sản phẩm từ file catalog.json (xuất tay từ trang quản lý) và khách gửi đơn bằng tin nhắn.
export const firebaseConfig = {
  apiKey: 'AIzaSyDItiM_VIT7sBtHLO8LpGD7Sf5edBtlg3s',
  authDomain: 'shoptiemnhahani.firebaseapp.com',
  projectId: 'shoptiemnhahani',
  storageBucket: 'shoptiemnhahani.firebasestorage.app',
  messagingSenderId: '808569812759',
  appId: '1:808569812759:web:4a1bdbc3943bbd59492952',
};
export const SHOP_ID = 'hani';
