#!/bin/sh
# 进入脚本所在目录并启动
cd "$(dirname "$0")" || exit 1
exec node server.js
