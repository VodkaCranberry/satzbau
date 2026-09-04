#!/bin/bash
# 双击此文件即可启动本地服务器并打开德语造句网页
cd "$(dirname "$0")"
PORT=8080
URL="http://localhost:${PORT}/index.html"

echo "====================================="
echo "  Satzbau · 德语造句练习 本地服务器"
echo "====================================="
echo ""
echo "  启动地址: ${URL}"
echo "  按 Ctrl+C 停止服务器"
echo ""
echo "  正在启动浏览器..."
echo ""

# 自动打开浏览器
open "${URL}"

# 启动 Python HTTP 服务器
python3 -m http.server ${PORT}
