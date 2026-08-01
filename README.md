# Pulse Charts — Live V1

Pulse Charts theo dõi Top 10 bài hát được nghe nhiều trên Apple Music tại Hàn Quốc, Nhật Bản và Trung Quốc. Dữ liệu đến từ RSS công khai của Apple, không dùng API key và không cần máy chủ hoặc cơ sở dữ liệu.

## Chạy trên máy

Yêu cầu Node.js 22.13 trở lên.

```bash
npm install
npm run sync
npm run dev
```

`npm run sync` lấy dữ liệu mới nhất và tạo `public/charts.json`. Nếu một thị trường tạm thời không phản hồi, hệ thống giữ dữ liệu của lần đồng bộ thành công gần nhất.

## Kiểm tra và phát hành

```bash
npm test
npm run build:pages
```

Workflow GitHub Pages trong `.github/workflows/deploy-pages.yml` tự đồng bộ và phát hành lại mỗi 6 giờ. Để bật, đẩy dự án lên GitHub rồi chọn **Settings → Pages → GitHub Actions**.

## Phạm vi v1

- Bảy bảng dữ liệu thật: Korea Top, Korea Pop, Japan Top, Japan Pop, China Top, China Local và Asia Cross-Market Pulse.
- Tìm kiếm theo bài hát, nghệ sĩ và thể loại.
- Ảnh bìa, ngày phát hành, liên kết nghệ sĩ và nghe trên Apple Music.
- Liên kết tìm kiếm YouTube, trạng thái đồng bộ và nguồn dữ liệu rõ ràng.
- Không hiển thị OST, lyric, biến động thứ hạng hoặc số tuần khi nguồn không cung cấp các trường đó.

Nguồn: Apple RSS Feed Generator / Apple Music Marketing Tools. Dữ liệu và ảnh bìa thuộc quyền của Apple và các chủ sở hữu nội dung tương ứng.
