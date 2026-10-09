#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."

OUT="chatwave-termux.zip"
rm -f "$OUT"

zip -r "$OUT" . \
  -x "node_modules/*" \
  -x "server/node_modules/*" \
  -x "web/node_modules/*" \
  -x ".git/*" \
  -x "dist/*" \
  -x "*.log" \
  -x "*.zip"

echo "Đã tạo gói: $OUT"
