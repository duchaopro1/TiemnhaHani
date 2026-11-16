// Cấu hình công khai của cửa hàng web (không phải bí mật: ai mở trang cũng thấy được, an toàn nhờ luật trong firestore.rules).
// Dán đúng cùng khối firebaseConfig và SHOP_ID với trang quản lý (js/firebase-config.js).
// Để trống apiKey = cửa hàng đọc sản phẩm từ file catalog.json (xuất tay từ trang quản lý) và khách gửi đơn bằng tin nhắn.
export const firebaseConfig = {
  apiKey: '',
  authDomain: '',
  projectId: '',
  storageBucket: '',
  messagingSenderId: '',
  appId: '',
};
export const SHOP_ID = 'hani';
