# TiemnhaHani — app quản lý cửa hàng Hani ⭐

Web app quản lý nhập hàng, tồn kho, giá vốn, lợi nhuận và đơn hàng từ **Shopee · Threads · Instagram**.
Giao diện theo Brand Guidelines của Hani (xanh `#1479C4`, bảng màu for her / for him / for friend, font Cabin).

## Tính năng

| Tab | Làm gì |
|---|---|
| **Tổng quan** | Doanh thu, chi phí, lợi nhuận, biên lãi · xem **Tháng này**, **tháng bất kỳ** (ô chọn tháng và nút ‹ ›) hoặc **Tất cả** · **bảng trạng thái đơn hàng** (số đơn và tỉ lệ ở từng trạng thái, bấm vào để mở danh sách đơn đó) · **chi phí vận hành** (tiền nhập vật tư dùng chung trong thời gian đang xem) được cộng vào tổng chi phí và trừ khỏi lợi nhuận · so sánh 3 nền tảng · top sản phẩm lãi nhất · bảng **đã hết & sắp hết** (tồn bằng 0 ghi **Đã hết** màu đỏ đặc, từ 1 tới mức cảnh báo ghi **Sắp hết**; hàng đã hết xếp trước) · bảng **Sản phẩm theo giai đoạn**: mỗi sản phẩm một dòng, mỗi giai đoạn (đang chờ = chờ xử lý + đã thiết kế / đã đóng gói / đang giao / hoàn thành) một cột; số 0 chỉ là dấu chấm mờ, mặc định chỉ hiện sản phẩm còn việc dang dở (tick để hiện cả sản phẩm đã xong hết), bấm "Xem từng phân loại" để xem từng màu |
| **Đơn hàng** | Thêm đơn bằng tay (Threads/Instagram) · nhập file Excel đơn hàng Shopee · mỗi dòng gồm **Sản phẩm, Số lượng, Dụng cụ đóng gói 1/2/3** · phí ship **Khách chịu / Shop chịu** · tick **Có thiệp** khi khách nhờ thiết kế thiệp · trạng thái đi theo công việc: Chờ xử lý → **Đã thiết kế** → **Đã đóng gói** → Đang giao → Hoàn thành (hoặc Đã huỷ / Trả hàng), mỗi trạng thái một màu · ô **Thanh toán của khách** ghi số tiền đã trả / cọc, app tính **còn lại thu khi nhận hàng** (nút nhập nhanh: chưa trả, cọc 50%, đã trả đủ; để trống nếu không cần theo dõi) · · đơn có **ghi chú** thì ghi chú hiện ngay dưới sản phẩm trong bảng (tìm kiếm cũng tìm được theo nội dung ghi chú) · tính lãi ngay khi nhập · **cảnh báo đơn trùng**: đơn mới có cùng tài khoản khách và cùng sản phẩm với đơn đang *chờ xử lý / đã thiết kế* thì hiện cảnh báo ngay trong form và hỏi lại trước khi lưu · ô **Mã vận đơn**: ghi mã khi gửi hàng, hiện trong bảng đơn (bấm để sao chép), tìm theo mã được, có trong file xuất, nhập file Shopee tự lấy cột Mã vận đơn nếu có · **Đóng gói cả đơn**: ngoài đóng gói riêng từng sản phẩm, chọn thêm tối đa 3 dụng cụ (hộp/túi ngoài) cho cả đơn, mỗi đơn trừ kho và tính chi phí 1 lần · **cảnh báo thiếu hàng**: mở app hoặc khi có đơn mới làm thiếu hàng thì hiện pop-up nêu đơn nào thiếu sản phẩm nào (cần / kho có / thiếu / đang về); hàng trong kho chia theo thứ tự **đơn tạo trước được ưu tiên**, đơn thiếu không giữ hàng nên số còn lại vẫn dùng cho các đơn đủ; đơn thiếu có thẻ "Thiếu hàng" và nút ⚠ trên thanh đầu trang |
| **Doanh thu** | Mỗi **đơn hoàn thành** một dòng: *Tổng đơn* (hàng + ship khách trả − giảm giá), *Doanh thu* (hàng − giảm giá), các khoản phí (giá vốn SP, đóng gói, *Phí ship* một cột có dấu: **+** khách trả, **−** shop chịu, phí sàn), *Chi phí*, *Lợi nhuận* (doanh thu − chi phí), **tiền công mỗi đơn** (mặc định 10.000đ, sửa được) và *Lợi nhuận sau công*; có dòng tổng, xem theo tháng hoặc tất cả; bảng có thanh cuộn riêng, tên cột và dòng tổng luôn hiện khi kéo xuống. Chưa gồm chi phí vận hành (xem ở Tổng quan) |
| **Nhập hàng** | Phiếu nhập sản phẩm & dụng cụ đóng gói, có phí ship nhập · nhập **số lượng từng phân loại** trong một phiếu (VD: cúp đỏ 5, xanh 3, vàng 2; phí ship chia theo số lượng) · **sửa / xoá phiếu đã nhập** (tồn kho và giá vốn tự tính lại) · bấm tên mặt hàng để sửa thông tin mặt hàng · **tình trạng hàng**: phiếu mới là *Đang đặt* (chưa vào kho, giá vốn, chi phí; hiện "đang về +N" ở sản phẩm), khi hàng về bấm **Đã nhận hàng**, chọn ngày và số thực nhận (nhận thiếu thì giữ phần còn lại đang về) mới cộng vào kho · hàng đang về có thêm giai đoạn **Đang ship từ TQ → Chờ thông quan → Đã thông quan** (đổi cả lô ngay trên thẻ Hàng đang về, lọc được theo giai đoạn; chỉ là nhãn theo dõi, hàng vẫn chỉ vào kho khi bấm Đã nhận hàng); khi chuyển sang **Chờ thông quan** và **Đã thông quan** app **ghi lại thời điểm** (ngày giờ; "Đang ship từ TQ" tính từ ngày đặt hàng nên không ghi giờ), hiện trên thẻ lô và bảng phiếu, kèm số ngày đã ở giai đoạn hiện tại, sửa được nếu ghi trễ) · phiếu cũ coi như đã nhận · nút **Kiện nhiều mặt hàng**: nhập một kiện gộp nhiều mặt hàng với **tổng phí ship một lần**, app chia phí ship cho từng dòng **theo số lượng hoặc theo giá trị hàng** và hiện luôn vốn/cái · bấm ✎ ở dòng gộp để **sửa hàng loạt** các phân loại của một mặt hàng (số lượng từng phân loại, giá, ngày, tình trạng, phí ship chia lại theo số lượng) |
| **Sản phẩm** | Mỗi sản phẩm là một **ô vuông có ảnh và tên**; bấm vào để xem các **phân loại** (màu, size…) với **số lượng tồn** và **giá bán riêng** từng phân loại · sửa, nhập hàng, xoá ngay từ đó · **bảng giá thành theo từng cách đóng gói** · **Combo** (khu riêng bên dưới khu Sản phẩm trên trang): nút 🎁 Tạo combo ghép nhiều sản phẩm có sẵn (số lượng mỗi món; với sản phẩm nhiều loại thì để "Chọn loại khi lên đơn" hoặc cố định một loại) thành một sản phẩm bán riêng, lúc tạo đơn chọn loại cho **từng combo**; món "Ngẫu nhiên" (không biết trước loại nào) thì không cần chọn, kho trừ ở mức sản phẩm và có thể chọn loại thật sau; **món ngẫu nhiên giữa nhiều sản phẩm** (VD: móc khóa in ảnh / chữ cái / cầu lông): tích các sản phẩm trong nhóm, lúc lên đơn bỏ trống hoặc chọn sản phẩm (và loại) thật sau; chưa chọn thì kho chưa trừ sản phẩm nào nhưng số bộ làm được và cảnh báo thiếu hàng tính theo cả nhóm, giá vốn tính trung bình của nhóm cho tới khi chọn; giá vốn = tổng giá vốn các món, số bộ làm được ngay tính theo món sắp hết nhất, bán combo trừ kho từng món, cảnh báo thiếu hàng cũng tính theo món; combo không nhập kho riêng và sản phẩm đang nằm trong combo không xoá được · **Giá theo số lượng**: trong form sản phẩm thêm mức giá "từ N cái trở lên còn X đồng" (VD: 25.000đ, từ 10 cái còn 22.000đ); lúc lên đơn giá tự đổi theo tổng số cái của sản phẩm đó trong đơn (các dòng/phân loại cộng lại), sửa giá tay thì giữ giá tay, đơn đã lưu không bị đổi giá ngầm |
| **Đóng gói** | Dụng cụ đóng gói chọn trong đơn (hộp, túi, ruy băng…) và **Bộ đóng gói** dùng nhanh · nút **Chỉnh tồn** ở mọi dụng cụ: **đếm lại số còn** hoặc **ghi đã dùng / hao**, chỉ đổi số lượng tồn kho, không đổi giá nhập hay tiền nhập hàng (nhập số lượng ước chừng cũng được) · **Vật tư dùng chung** (băng keo, giấy chống sốc, ghim…): không chọn trong đơn, tiền nhập tính hết vào **chi phí vận hành**, nút **Ghi đã dùng** hoặc ô điều chỉnh tồn kho để biết đã xài bao nhiêu (số tiền không đổi) |
| **Cài đặt** | Chia sẻ link, sao lưu / khôi phục JSON, xuất CSV đơn hàng, dữ liệu mẫu |

## Cách tính giá thành & lợi nhuận

> **Tiền cọc / còn thu:** khách phải trả = tiền hàng − giảm giá + ship (nếu khách chịu). Còn thu = khách phải trả − đã thanh toán. Số này chỉ để theo dõi tiền mặt khi giao hàng, **không làm đổi doanh thu hay lợi nhuận**. Đơn *Hoàn thành* coi như đã thu đủ, đơn *Đã huỷ / Trả hàng* không tính vào tiền còn thu.

> **Chi phí vận hành:** vật tư đánh dấu "dùng chung" (băng keo, giấy chống sốc, ghim…) không nằm trong đơn nào. Mỗi lần nhập, cả số tiền (kể cả phí ship nhập) tính vào chi phí vận hành của **tháng nhập**, rồi trừ vào lợi nhuận ở Tổng quan và báo cáo xuất. Điều chỉnh tồn kho chỉ cho biết đã dùng bao nhiêu, không làm đổi số tiền này.

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

## Không mất đơn khi đang nhập

- **Bản nháp tự lưu:** form thêm hoặc sửa đơn tự lưu nháp vào trình duyệt sau mỗi thay đổi. Nhấn Esc, tải lại trang hay có bản mới được đăng thì lần mở sau app hỏi "Khôi phục đơn nhập dở?". Sau khi tải lại trang, app tự mở hộp hỏi đó.
- **Hỏi trước khi đóng:** đơn đã nhập mà bấm Esc, ✕ hoặc Huỷ thì hiện 3 lựa chọn: *Tiếp tục nhập*, *Đóng, giữ bản nháp*, *Bỏ đơn này*. Form chưa đụng tới thì đóng ngay.
- **Thấy rõ đang lưu:** nút Lưu chuyển thành "Đang lưu…" và khoá lại, thanh đầu trang báo *Đang lưu… → Đã lưu ✓*. Lỗi hiện ngay trong form (kèm lý do và nút **Thử lại**), không tự biến mất, và đơn vẫn được giữ làm bản nháp. Rời trang khi đang lưu thì trình duyệt hỏi lại.
- Kết nối gián đoạn lúc lưu thì app tự thử lại một lần. Bấm Thử lại không tạo ra đơn thứ hai vì mã nội bộ của đơn được cố định từ lần lưu đầu.
- Bản nháp chỉ nằm trong trình duyệt đang dùng (không đồng bộ giữa các máy) và tự xoá sau 7 ngày.

## Trang tự cập nhật khi đồng nghiệp thay đổi

Bản online tự nhận thay đổi của người khác, không cần tải lại trang:
- Dữ liệu cập nhật qua kết nối thời gian thực của nền tảng. Nếu một kết nối bị đứt thì app **tự nối lại** (thử sau 1, 2, 4… tối đa 30 giây).
- Phòng khi kết nối im lặng, app còn tự hỏi lại máy chủ **mỗi 30 giây** khi trang đang mở, và **ngay khi bạn quay lại tab** hoặc có mạng trở lại. Đang lưu đơn thì bỏ qua để không làm đơn đó biến mất tạm thời.
- Có đơn mới từ người khác thì hiện thông báo "Có đơn mới: mã đơn".
- Thanh đầu trang ghi giờ cập nhật gần nhất (⟳ 14:05). Bấm vào đó để làm mới ngay. Khi mất kết nối nó đổi thành "Đang kết nối lại…".

## Nhập đơn Shopee

Shopee không cho shop nhỏ kết nối API trực tiếp nếu chưa đăng ký Shopee Open Platform. Vì vậy app đọc file xuất từ Kênh Người Bán:

1. **Kênh Người Bán → Đơn hàng → Tất cả → Xuất**, tải file `.xlsx`.
2. Trong app: **Đơn hàng → ⬆ Nhập file Shopee**.
3. Lần đầu, app hỏi mỗi sản phẩm Shopee ứng với sản phẩm nào trong kho (hoặc tạo mới). Các lần sau app tự nhớ.
   Mẹo: đặt **SKU** sản phẩm trong app trùng với SKU phân loại trên Shopee là app tự khớp luôn.
4. Nhập lại file cũ không bị trùng đơn. App chỉ cập nhật trạng thái và phí sàn, còn đóng gói bạn đã chọn thì giữ nguyên. Trạng thái **Đã thiết kế / Đã đóng gói** do bạn đặt cũng được giữ khi Shopee vẫn báo đơn đang chờ. Shopee báo đang giao, hoàn thành hay huỷ thì app đổi theo Shopee.

## Link dùng chung (đang chạy)

👉 **https://claude.ai/artifact/S67N4vcEEpb6iSEQSnFGhA**

Bản này chạy trên Claude, dữ liệu lưu online và đồng bộ ngay giữa mọi người.
Thêm đồng nghiệp: mở link, bấm **Share**, mời bằng email với quyền **Editor** (hoặc **Contributor** nếu cùng team Claude).
Người chỉ có quyền xem (Viewer) thì xem được nhưng không lưu được thay đổi. Mỗi người cần có tài khoản claude.ai.

Trang chính của bản này là `hani.html` (dùng chung `css/` và `js/` với `index.html`).
Muốn cập nhật bản online sau khi sửa code, nhờ Claude xuất bản lại `hani.html` vào đúng link trên.

## Lưu dữ liệu & chia sẻ link cho đồng nghiệp

Ngoài link Claude ở trên, app còn chạy được ở 2 chế độ khi tự host:

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

Brand dùng **CS Mocha Demo** (logo), **Oilvare Base** (tiêu đề) và **Cabin** (nội dung).

- **Tiêu đề: Baloo 2 ExtraBold** (Google Fonts). Oilvare Base, và cả Lilita One dùng thay trước đây, không có dấu tiếng Việt: các chữ như ả, ơ, ậ bị lấy từ font khác nên trông lỗi. Baloo 2 có đủ tiếng Việt, nét tròn dày gần với phong cách brand.
- **Nội dung: Cabin**, đúng guideline, có đủ tiếng Việt.
- **Logo "hani"**: CS Mocha Demo nếu đặt file `CSMochaDemo.otf` vào thư mục `fonts/`, nếu không thì dùng Fredoka. Chữ "hani" không có dấu nên không bị lỗi.
