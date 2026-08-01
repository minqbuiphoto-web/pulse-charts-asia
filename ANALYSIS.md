# Quyết định sản phẩm — Live V1

Phiên bản đầu dùng dữ liệu minh họa để xác nhận giao diện và luồng sử dụng. Live V1 đã thay toàn bộ dữ liệu đó bằng ba nguồn Apple Music Most Played thật cho Hàn Quốc, Nhật Bản và Trung Quốc.

## Những gì được giữ lại

- Trải nghiệm một trang: chọn thị trường, quét Top 10, mở chi tiết và nghe nhạc.
- Tìm kiếm tức thì và giao diện responsive.
- Kiến trúc tĩnh, không tài khoản và không cơ sở dữ liệu để giữ chi phí vận hành thấp.

## Những gì bị loại bỏ

- OST, lyric, biến động thứ hạng và số tuần giả lập.
- Tuyên bố “7 bảng xếp hạng” khi chưa có bảy nguồn dữ liệu hợp pháp và ổn định.
- Video ID được nhập thủ công.

## Nguồn và đồng bộ

`scripts/sync-charts.mjs` lấy Top 10 từ RSS Marketing Tools của Apple cho ba storefront. Dữ liệu được chuẩn hóa thành `public/charts.json`. GitHub Actions chạy lại quá trình này mỗi sáu giờ; nếu một nguồn lỗi tạm thời, dữ liệu thành công gần nhất của thị trường đó được giữ lại.

## Hướng phát triển tiếp theo

Chỉ thêm nguồn mới khi có API hoặc feed công khai, điều khoản sử dụng rõ ràng và độ ổn định đủ tốt. OST có thể quay lại khi tìm được nguồn hợp lệ; không suy diễn OST từ tên bài hoặc tự sao chép bảng xếp hạng có giới hạn khai thác dữ liệu.
