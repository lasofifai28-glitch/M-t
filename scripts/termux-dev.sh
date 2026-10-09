#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js chưa được cài trên Termux. Chạy: pkg install nodejs npm git"
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Đang cài dependency..."
  npm install
fi

if ! command -v lsof >/dev/null 2>&1; then
  echo "Lưu ý: lsof không có sẵn, sẽ dùng pkill nếu cần."
fi

PORT=${PORT:-4000}
if ss -lnt | grep -q ":${PORT} "; then
  echo "Cổng ${PORT} đã bị chiếm. Hãy đổi PORT trong .env hoặc dừng tiến trình đang dùng."
  exit 1
fi

npm run dev
