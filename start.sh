#!/usr/bin/env bash
# 一键启动：后端 http://localhost:8100 ，前端 http://localhost:3100
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d "$ROOT/backend/.venv" ]; then
  echo "▶ 初始化后端环境…"
  python3 -m venv "$ROOT/backend/.venv"
  "$ROOT/backend/.venv/bin/pip" install -q -r "$ROOT/backend/requirements.txt"
fi
[ -f "$ROOT/backend/.env" ] || cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "▶ 安装前端依赖…"
  (cd "$ROOT/frontend" && (command -v pnpm >/dev/null && pnpm install || npm install))
fi
[ -f "$ROOT/frontend/.env.local" ] || cp "$ROOT/frontend/.env.example" "$ROOT/frontend/.env.local"

trap 'kill 0' EXIT
(cd "$ROOT/backend" && .venv/bin/uvicorn app.main:app --port 8100) &
(cd "$ROOT/frontend" && npx next dev --port 3100) &
echo "▶ 前端：http://localhost:3100   后端 API 文档：http://localhost:8100/docs"
wait
