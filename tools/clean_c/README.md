# CleanC - giải phóng ổ C: an toàn

Script PowerShell tìm thứ đang chiếm ổ C: và xoá các cache / file tạm **an toàn**. Mặc định chỉ báo cáo, không xoá gì.

## Cách dùng
1. Giải nén cả thư mục.
2. Chuột phải **1_Report.bat** → **Run as administrator**. Xem bảng dung lượng từng nhóm có thể dọn và các thư mục / file lớn nhất.
3. Chuột phải **2_Clean.bat** → **Run as administrator**. Script hỏi `y/N` từng nhóm rồi mới xoá.

4. **3_Inspect_Folder.bat**: nhập đường dẫn một thư mục (ví dụ `C:\Users\HP\AppData\Local\Google`), script liệt kê thư mục con và file lớn nhất bên trong. Chỉ đọc, không xoá.

(Hoặc mở PowerShell bằng quyền Administrator: `powershell -ExecutionPolicy Bypass -File .\CleanC.ps1 [-Big] [-Clean]`.)

## Script dọn những gì
Temp của user, `C:\Windows\Temp`, cache Windows Update, crash dump, thumbnail cache, cache trình duyệt (Chrome/Edge/Firefox),
cache VS Code, cache npm/pip/NuGet/yarn, cache Gradle, cache CapCut (`User Data\Cache`, không đụng project), file cập nhật cũ của Zalo, cache Cốc Cốc, Thùng rác.

## Script KHÔNG bao giờ xoá
Documents, Downloads, Desktop, Pictures, mật khẩu / lịch sử / cookie trình duyệt, Windows.old, WinSxS, hiberfil.sys, pagefile.sys.
Những mục lớn đó script chỉ liệt kê để bạn tự quyết định (xem phần cuối bảng báo cáo).
