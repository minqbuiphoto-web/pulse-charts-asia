# Phân tích trang tham chiếu và đề xuất MVP

## Trang hiện tại làm gì

Trang tham chiếu là dashboard một trang tên “Trending & OST Dashboard”. Nó gom 7 danh mục vào hai nhóm: 4 bảng bài hát (K-Pop, K-Ballad, Billboard Nhật, QQ Music Trung Quốc) và 3 bảng OST (Hàn, Nhật, Trung). Mặc định trang mở K-Pop Top 10. Khi người dùng đổi tab, danh sách được thay tại chỗ; khi chọn một bài, khung bên phải hiện lời/ghi chú và phía dưới nhúng YouTube.

## Cấu trúc giao diện

- Header giữa trang với tiêu đề và một dòng cam kết dữ liệu.
- Hai hàng tab lớn: bảng bài hát và bảng OST.
- Khu nội dung hai cột: danh sách xếp hạng bên trái, lời bài hát bên phải.
- Trình phát toàn chiều rộng nằm dưới danh sách/khung lời.
- Nền gần đen, thẻ xám đậm, màu xanh lá làm điểm nhấn; desktop là bố cục chính.
- Chỉ có một URL và một màn hình; không có trang chi tiết hoặc URL riêng cho từng bảng/bài.

## Tìm kiếm, bộ lọc và kết quả

- Không có thanh tìm kiếm.
- Không có lọc theo nghệ sĩ, bài hát, quốc gia, thời gian hay trạng thái.
- Bảy nút danh mục đóng vai trò bộ lọc duy nhất.
- Kết quả là danh sách Top 10, mỗi dòng gồm thứ hạng, tên bài, nghệ sĩ; OST có thể kèm tên phim.
- Không có biến động thứ hạng, số tuần, nguồn dữ liệu, phân trang, sắp xếp hoặc trạng thái “cập nhật lần cuối” ở cấp từng bảng.

## Dữ liệu và hành vi

- Trang tải `live-data.json` với tham số chống cache. Mã JavaScript lấy khóa bảng như `KR_HOT`, dựng các dòng bằng DOM rồi gắn sự kiện chọn bài.
- Bản ghi bài hát có thể suy ra gồm `rank`, `title`, `artist`, `ytId`, `lyric` và tùy chọn `movie`.
- Nếu YouTube ID tồn tại, trang nhúng video trực tiếp; nếu thiếu, nó tạo truy vấn tìm kiếm YouTube.
- Nếu JSON lỗi, trang hướng người vận hành chạy workflow; điều này cho thấy dữ liệu có thể được tạo bởi GitHub Actions hoặc một robot bên ngoài.
- Không có trạng thái URL, lưu lựa chọn, đăng nhập, chỉnh sửa tại chỗ hoặc backend tương tác.

## Công nghệ có thể suy ra

- GitHub Pages là lớp lưu trữ.
- HTML, CSS và JavaScript thuần trong một tệp trang; không thấy dấu hiệu framework phía client.
- JSON tĩnh là “cơ sở dữ liệu” đọc công khai.
- YouTube iframe là dịch vụ phát nhạc.
- GitHub Actions có khả năng là công cụ đồng bộ, nhưng đây là suy luận từ thông báo lỗi và cấu trúc triển khai, không phải bằng chứng về workflow cụ thể.

## MVP đề xuất

Giữ mô hình một trang và dữ liệu JSON vì đây là phương án rẻ, dễ vận hành nhất. Bổ sung những thiếu sót có giá trị trực tiếp: tìm kiếm tức thì, lọc quốc gia/loại bảng, hiển thị biến động và số tuần, trạng thái tải/lỗi, thiết kế responsive, chi tiết bài hát rõ ràng và liên kết YouTube an toàn khi không có video ID. Không thêm tài khoản, CMS, cơ sở dữ liệu hay API trả phí ở giai đoạn đầu.
