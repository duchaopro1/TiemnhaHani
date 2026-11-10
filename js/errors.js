// Plain-language reasons for a failed save. `code` comes from the platform's db or the local store.
export function describeError(err) {
  switch (err?.code) {
    case 'resource_exhausted':
      return { text: 'gửi quá nhanh, chờ vài giây rồi thử lại', retry: true };
    case 'unavailable':
      return { text: 'kết nối bị gián đoạn, thử lại sau ít giây', retry: true };
    case 'quota_exceeded':
      return { text: 'kho dữ liệu đã đầy, hãy xuất sao lưu rồi xoá bớt đơn cũ', retry: false };
    case 'revoked':
      return { text: 'quyền truy cập trang đã thay đổi, hãy tải lại trang (bản nháp vẫn được giữ)', retry: false };
    case 'invalid_argument':
    case 'not_granted':
      return { text: 'tài khoản của bạn chỉ có quyền xem, nhờ chủ shop cấp quyền Editor', retry: false };
    default:
      return { text: err?.message || 'lỗi không rõ, thử lại', retry: true };
  }
}
