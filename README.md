# ChatWave

ChatWave là ứng dụng web chat hiện đại chạy được trên môi trường Node.js và phù hợp cho triển khai trên Termux Android. Ứng dụng có frontend React, backend Express, Socket.IO realtime, database SQLite và giao diện responsive dành cho điện thoại.

## Kiến trúc

- Frontend: React + Vite + TypeScript
- Backend: Node.js + Express
- Real-time: Socket.IO
- Database: SQLite
- Auth: JWT + bcrypt
- Upload: lưu trên filesystem trong môi trường phát triển
- WebRTC: signaling qua Socket.IO, cấu hình STUN và TURN từ biến môi trường

## Tính năng thực tế đã có

- Đăng ký / đăng nhập / đăng xuất
- Quản lý phiên người dùng
- Tạo cuộc trò chuyện 1-1
- Gửi tin nhắn realtime
- Lưu lịch sử tin nhắn vào SQLite
- Tìm kiếm người dùng
- Danh sách hội thoại
- UI responsive cho mobile và desktop
- Upload file và lưu metadata vào database
- Giao diện cuộc gọi thoại/video cơ bản

## Cấu trúc project

- [server/src/index.js](server/src/index.js) — API + Socket.IO
- [server/src/db.js](server/src/db.js) — schema SQLite
- [server/src/lib.js](server/src/lib.js) — auth và logic tin nhắn
- [server/test/api.test.js](server/test/api.test.js) — test backend
- [web/src/App.jsx](web/src/App.jsx) — giao diện frontend
- [web/src/styles.css](web/src/styles.css) — style application
- [.env.example](.env.example) — mẫu biến môi trường

## Cài đặt trên Termux

1. Cài Node.js LTS trong Termux:

```bash
pkg update
pkg install nodejs npm git
```

2. Clone hoặc vào workspace hiện tại.

3. Cài dependency:

```bash
cd /workspaces/M-t
npm install
```

4. Tạo file môi trường từ mẫu:

```bash
cp .env.example .env
```

5. Chỉnh sửa `.env` nếu cần.

## Chạy development

Backend:

```bash
npm run dev:server
```

Frontend:

```bash
npm run dev:web
```

Hoặc chạy cả hai cùng lúc:

```bash
npm run dev
```

## Chạy production build

```bash
npm run build
```

## Khởi động server production

```bash
npm start
```

## Kiểm thử đã thực hiện

Các kiểm thử đã chạy thành công trên môi trường hiện tại:

```bash
cd /workspaces/M-t && npm test --workspace server
```

```bash
cd /workspaces/M-t && npm run build --workspace web
```

```bash
curl -sf http://localhost:4000/health
```

```bash
curl -I http://localhost:5173
```

## Biến môi trường

Trong [.env.example](.env.example):

```env
PORT=4000
JWT_SECRET=replace_with_a_long_random_secret
JWT_EXPIRES_IN=7d
CLIENT_URL=http://localhost:5173
UPLOAD_LIMIT_MB=25
PUBLIC_STUN_SERVER=stun:stun.l.google.com:19302
```

## Giới hạn thực tế

- Gọi video qua Internet cần HTTPS + TURN server thực tế, ngoài môi trường localhost.
- Upload hiện đang lưu trên filesystem local, không phải S3/Cloud Storage.
- Push notification và E2EE chưa được cung cấp đầy đủ trong môi trường này.
- Ứng dụng hiện là nền tảng chạy được, nhưng chưa hoàn tất để deploy production công khai mà không cấu hình thêm.

## Lệnh dừng và khởi động lại

Dừng tiến trình bằng Ctrl+C trong terminal tương ứng hoặc kill process nếu cần:

```bash
pkill -f "vite --host 0.0.0.0 --port 5173"
pkill -f "node src/index.js"
```

Khởi động lại:

```bash
npm run dev
```
