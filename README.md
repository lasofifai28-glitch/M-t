# ChatWave

ChatWave là ứng dụng web chat hiện đại cho môi trường Android/Termux, hoạt động với Node.js, Express, Socket.IO và SQLite. Dự án được thiết kế để cài đặt và chạy trực tiếp trên điện thoại mà không cần Android Studio, root hay Docker.

## Kiến trúc

- Frontend: React + Vite
- Backend: Node.js + Express
- Realtime: Socket.IO
- Database: SQLite
- Auth: JWT + bcrypt
- Upload: lưu trên filesystem trong môi trường phát triển
- WebRTC: signaling qua Socket.IO, có cấu hình STUN và TURN từ biến môi trường

## Tính năng hiện có

- Đăng ký / đăng nhập / đăng xuất
- Tạo cuộc trò chuyện 1-1
- Gửi và nhận tin nhắn realtime
- Lưu lịch sử tin nhắn vào SQLite
- Tìm kiếm người dùng
- Danh sách hội thoại
- UI responsive mobile/desktop
- Upload file và lưu metadata
- Giao diện cuộc gọi thoại/video cơ bản

## Cấu trúc thư mục

- `server/src/index.js`: API và Socket.IO server
- `server/src/db.js`: schema SQLite
- `server/src/lib.js`: logic auth, hội thoại, tin nhắn
- `server/test/api.test.js`: test backend
- `web/src/App.jsx`: giao diện frontend
- `web/src/styles.css`: style ứng dụng
- `.env.example`: biến môi trường mẫu
- `scripts/termux-dev.sh`: chạy chế độ dev trên Termux
- `scripts/package-termux.sh`: đóng gói zip để chuyển sang điện thoại

## Cài đặt trên Termux

1. Cài Node.js LTS:

```bash
pkg update
pkg install nodejs npm git
```

2. Clone repo vào thư mục cá nhân, ví dụ:

```bash
cd ~/ 
git clone <URL_REPO> chatwave
cd chatwave
```

3. Cài dependency:

```bash
npm install
```

4. Tạo file `.env`:

```bash
cp .env.example .env
```

5. Chỉnh sửa `.env` với cổng và secret của bạn:

```env
PORT=4000
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=7d
CLIENT_URL=http://localhost:5173
UPLOAD_LIMIT_MB=25
PUBLIC_STUN_SERVER=stun:stun.l.google.com:19302
```

## Chạy trên Termux

Chạy cả backend và frontend cùng lúc:

```bash
npm run dev
```

Hoặc chạy riêng từng phần:

```bash
npm run dev:server
npm run dev:web
```

## Production build

```bash
npm run build
```

Khởi động backend ở chế độ production:

```bash
npm start
```

## Script tiện ích cho Termux

```bash
chmod +x scripts/termux-dev.sh
./scripts/termux-dev.sh
```

Script này sẽ kiểm tra port, cài dependency nếu cần, và chạy app với cấu hình dành cho Termux.

## Dừng app

```bash
pkill -f "vite --host 0.0.0.0 --port 5173"
pkill -f "node src/index.js"
```

## Kiểm thử đã chạy

Các lệnh sau đã được chạy thực tế và thành công trong workspace hiện tại:

```bash
cd ~/chatwave
npm test --workspace server
npm run build --workspace web
curl -sf http://localhost:4000/health
curl -I http://localhost:5173
```

## Đóng gói ZIP để chuyển sang điện thoại

Từ máy tính hoặc Termux:

```bash
cd ~/chatwave
chmod +x scripts/package-termux.sh
./scripts/package-termux.sh
```

File zip sẽ được tạo ở thư mục gốc, ví dụ: `chatwave-termux.zip`.

Sau đó chuyển file đó vào điện thoại và giải nén trong thư mục phù hợp như `~/chatwave` hoặc `~/storage/shared` rồi chạy lại các lệnh trên.

## Giới hạn thực tế

- Gọi video qua Internet yêu cầu HTTPS + TURN server thực tế.
- Upload hiện đang lưu trên filesystem local, chưa dùng S3/object storage.
- Push notification và E2EE chưa được triển khai đầy đủ trong dự án này.
- Ứng dụng có thể chạy trên môi trường local/Termux và đã được smoke test; nhưng chưa đảm bảo production deployment mà không cấu hình thêm.

## Lưu ý cho Android thật

- Cần mở trình duyệt trên thiết bị để truy cập `http://<IP_của_điện_thoại>:5173` nếu frontend chạy trên cùng thiết bị.
- Nếu chạy trên máy tính khác và muốn truy cập từ điện thoại cùng Wi-Fi, hãy đảm bảo `CLIENT_URL` và CORS cho phép IP đúng.
- Với WebRTC, trình duyệt cần quyền camera/micro; production cần HTTPS hoặc localhost.
