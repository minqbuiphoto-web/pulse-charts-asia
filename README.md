# Pulse Charts

Pulse Charts là MVP dashboard bảng xếp hạng âm nhạc châu Á, được xây độc lập từ đầu. Ứng dụng có 7 bảng xếp hạng, tìm kiếm tức thì, lọc theo thị trường/loại bảng, chi tiết bài hát và liên kết hoặc trình phát YouTube.

## Chạy trên máy

Yêu cầu Node.js 22.13 trở lên.

```bash
npm install
npm run dev
```

Mở địa chỉ được hiển thị trong cửa sổ chạy lệnh. Dữ liệu nằm trong `public/charts.json`; chỉ cần sửa tệp này để đổi bảng xếp hạng, thứ hạng, nghệ sĩ, nhạc phim và YouTube ID.

## Kiểm tra bản phát hành

```bash
npm run build
npm run build:pages
```

`npm run build` tạo bản dành cho Sites/Cloudflare. `npm run build:pages` tạo website tĩnh trong thư mục `out`.

## Đưa lên GitHub Pages

1. Tạo repository GitHub và đẩy toàn bộ thư mục này lên nhánh `main`.
2. Vào **Settings → Pages → Source** và chọn **GitHub Actions**.
3. Workflow có sẵn trong `.github/workflows/deploy-pages.yml` sẽ tự xây và phát hành website.

Sau lần phát hành đầu, website thường có địa chỉ `https://TEN-TAI-KHOAN.github.io/TEN-REPOSITORY/`.

## Vận hành hằng tuần

1. Cập nhật `public/charts.json`.
2. Kiểm tra JSON hợp lệ và chạy `npm run build:pages`.
3. Commit và push; GitHub Pages tự cập nhật.

Không cần máy chủ, cơ sở dữ liệu, tài khoản quản trị hay API key. Nếu sau này cần tự động thu thập dữ liệu, nên để workflow riêng tạo `charts.json`; không đặt khóa bí mật trong mã chạy ở trình duyệt.
