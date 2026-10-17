# 😜 表情包管家（Sticker Manager）

一个零依赖、开箱即用的表情包管理网站。丢到 NAS 上就能跑，手机、电脑共用一套收藏。

## 功能

- 📤 **上传**：多选 / 拖拽 / 直接 Ctrl+V 粘贴截图，自动识别 GIF / PNG / JPG / WebP / AVIF / BMP / SVG，自动去重（按文件 MD5）
- 📥 **下载**：单张下载（保留原文件名）
- 🏷 **打标签**：一张图多个标签；支持单张编辑和批量加标签
- 🗂 **分类**：单张和批量都能设分类
- 🔍 **搜索**：按名称 / 标签 / 分类全文搜索；侧栏标签、分类一键筛选（标签可多选组合）
- 🗑 **删除**：单张删除、批量删除
- 🔐 **管理员鉴权**（可选开启）：设置密码后，游客只能浏览和下载，只有管理员能上传 / 改标签 / 删除 —— 详见下方「权限」
- 📋 **复制到剪贴板**：一键复制图片，直接粘贴到微信 / QQ（Chrome / Edge 支持最好）
- 🎲 **随机**：随机翻一张
- 🖼 **预览**：首页网格直接预览所有动图（GIF / 动图 WebP / APNG 都会动），点开可放大、左右切换

## 权限（分享给别人看时请务必开启）

默认**所有人都能上传和删除**。只要设置环境变量 `ADMIN_PASSWORD`，立刻变成：

- **游客**：只能浏览、预览、搜索、下载；页面上根本不会出现上传 / 删除 / 编辑入口
- **管理员**：点左下角「🔒 管理员登录」输入密码后，才能上传、打标签、改分类、删除、导出备份

设置方法（三选一）：

```bash
# 1) 直接用 Node 运行
ADMIN_PASSWORD=你的密码 node server.js

# 2) Docker
docker run -d -p 13000:3000 -e ADMIN_PASSWORD=你的密码 -v ./data:/data sticker-manager
```

3) **1Panel / docker-compose**：在编排 YAML 的 `environment` 里加一行，然后重新部署：

```yaml
    environment:
      - ADMIN_PASSWORD=你的密码
```

登录状态保存在浏览器 Cookie 中，默认保持 30 天，期间不用重复登录；点「🔓 退出管理」即可退出。

> 提醒：密码以明文写在环境变量里，请不要复用其他重要账号的密码。本工具面向家庭 / 个人内网使用。

## 目录结构

```
sticker-manager/
├── server.js                     # 后端（唯一入口，零第三方依赖）
├── public/                       # 前端页面（index.html / style.css / app.js）
├── stickers/                     # 上传的图片（首次运行自动创建）
├── data.json                     # 元数据数据库（纯 JSON，首次运行自动创建）
├── package.json                  # 供 1Panel 等面板解析启动命令（零依赖）
├── Dockerfile
├── docker-compose.yml            # 通用 Docker 部署
├── docker-compose.1panel.yml     # 1Panel「容器 → 编排」专用
├── start.bat / start.sh
└── README.md
```

## 快速开始（方式一：直接用 Node）

1. NAS 上装好 [Node.js](https://nodejs.org)（≥ 16，推荐 18/20/22）。
2. 把整个 `sticker-manager` 文件夹拷贝到 NAS 任意位置。
3. 进入该目录，运行：

```bash
node server.js
```

4. 浏览器打开 `http://<NAS的IP>:3000`，手机、电脑访问同一个地址即可。

> Windows 上可双击 `start.bat`，Linux / 群晖可用 `sh start.sh`。

## 快速开始（方式二：Docker / 群晖 Container Manager）

```bash
docker compose up -d
# 或
docker build -t sticker-manager . && docker run -d -p 3000:3000 -v ./data:/data sticker-manager
```

群晖 Container Manager（原 Docker）：新建项目，选择该文件夹的 `docker-compose.yml` 即可。

## 配置（可选，环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `DATA_DIR` | 脚本所在目录 | `data.json` 存放目录 |
| `STICKERS_DIR` | 脚本目录下的 `stickers` | 图片存储目录 |

示例：`PORT=8080 STICKERS_DIR=/volume1/stickers node server.js`

## 备份 / 恢复 / 迁移

极其简单，拷贝两个东西即可：

1. `stickers/` 目录（所有图片）
2. `data.json`（所有标签、分类等元数据）

还原时把两者放回原位即可。也可以在网页左下角点「导出数据备份」下载一份 `data.json` 快照。

## 关于数据库

没有用 MySQL / SQLite 等任何数据库，元数据就是一个 **纯文本 JSON 文件**（`data.json`），
方便查看、备份、甚至手工编辑。写入时采用「临时文件 + 原子重命名」，意外断电也不容易损坏。

## 说明与注意事项

- **动图预览**：首页直接用原图做预览，所以动图 GIF 会实时动；图片按需懒加载，收藏几百张很流畅。如果收藏特别多（几千张），首次加载会稍慢，属正常现象。
- **剪贴板复制**：依赖浏览器 Clipboard API，Chrome / Edge 完整支持；Firefox / Safari 可能不支持，按钮会给出提示。
- **单文件上限** 30MB，单次上传请求上限 220MB。
- 本工具面向个人 / 家庭使用，**默认无登录鉴权**。如需暴露到公网，请务必在前面加一层反代 + 密码，或在路由器上限制访问来源。

## 常见问题

- **端口被占用**：换一个端口，例如 `PORT=3001 node server.js`。
- **改了标签不生效**：前端是本地过滤，无需刷新，改动会即时保存到 `data.json`。
- **上传报错「文件超过大小限制」**：单个文件超过 30MB，可改 `server.js` 顶部的 `maxFileSize`。
