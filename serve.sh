#!/usr/bin/env bash
# ========== 一键启动开发服务器 ==========
# 自动寻找可用端口，启动 HTTP 服务器后打开浏览器。
# 用法：
#   bash serve.sh              # 自动选端口
#   bash serve.sh 3000         # 指定起始端口
#   bash serve.sh --no-open    # 不打开浏览器

set -e

PORT=${1:-8000}
NO_OPEN=false
[ "$1" = "--no-open" ] && NO_OPEN=true && PORT=8000

# 寻找可用端口（向上探测至 9000）
while [ "$PORT" -le 9000 ]; do
  if ! lsof -iTCP:"$PORT" -sTCP:LISTEN -Pn 2>/dev/null | grep -q .; then
    break
  fi
  PORT=$((PORT + 1))
done

if [ "$PORT" -gt 9000 ]; then
  echo "错误：8000–9000 端口均被占用"
  exit 1
fi

echo "▶ 启动服务器：http://localhost:$PORT"
python3 -m http.server "$PORT" &
PID=$!

# 退出时清理子进程
trap "kill $PID 2>/dev/null; exit" EXIT INT TERM

# 等服务器就绪
sleep 0.5

if [ "$NO_OPEN" = false ]; then
  # 优先用 xdg-open（Linux），其次尝试其他方式
  if command -v xdg-open &>/dev/null; then
    xdg-open "http://localhost:$PORT" 2>/dev/null
  elif command -v open &>/dev/null; then
    open "http://localhost:$PORT"
  fi
fi

echo "按 Ctrl+C 停止服务器"
wait
