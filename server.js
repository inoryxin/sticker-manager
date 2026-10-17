#!/usr/bin/env node
'use strict';

/**
 * 表情包管家（Sticker Manager）—— 零依赖单文件后端
 *
 * 特点：
 *   - 不依赖任何第三方 npm 包，只要 NAS 上装了 Node.js（>=16）就能直接运行
 *   - 图片原样存放在 stickers/ 目录，元数据存为 data.json（纯 JSON，可直接备份）
 *   - 上传 / 下载 / 打标签 / 分类 / 搜索 / 删除 / 批量操作 / 复制到剪贴板 / 随机
 *
 * 运行：  node server.js
 * 配置（可选环境变量）：
 *   PORT          监听端口，默认 3000
 *   DATA_DIR      data.json 所在目录，默认脚本所在目录
 *   STICKERS_DIR  图片存储目录，默认脚本目录下的 stickers/
 */

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;

const CONFIG = {
  port: Number(process.env.PORT) || 3000,
  dataDir: process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : ROOT,
  stickersDir: process.env.STICKERS_DIR ? path.resolve(process.env.STICKERS_DIR) : path.join(ROOT, 'stickers'),
  publicDir: path.join(ROOT, 'public'),
  maxFileSize: 30 * 1024 * 1024,     // 单个文件上限 30MB
  maxBodySize: 220 * 1024 * 1024,    // 单次请求体上限 220MB
};

const DB_PATH = path.join(CONFIG.dataDir, 'data.json');

/* ------------------------------ 管理员鉴权 ------------------------------
 * 设置环境变量 ADMIN_PASSWORD 后启用：
 *   游客：能浏览、预览、搜索、下载；不能上传 / 改标签 / 改分类 / 删除 / 导出。
 *   管理员：输入密码登录后拥有全部权限。
 * 不设置 ADMIN_PASSWORD 则不启用鉴权（所有人都能改），保持向后兼容。
 */
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || '');
const AUTH_REQUIRED = ADMIN_PASSWORD.length > 0;
const AUTH_SECRET = crypto.createHash('sha256').update('sticker-manager::' + ADMIN_PASSWORD).digest();
const COOKIE_NAME = 'sm_auth';
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const MIME = {
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

const EXT_BY_MIME = {
  'image/gif': '.gif',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/svg+xml': '.svg',
};

const ALLOWED_EXT = new Set(Object.keys(MIME));

let db = { images: [] };
let writeChain = Promise.resolve();

/* ------------------------------ 数据层 ------------------------------ */

function loadDb() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    db = { images: Array.isArray(parsed.images) ? parsed.images : [] };
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[!] 读取 data.json 失败：', err.message);
    db = { images: [] };
  }
}

function persist() {
  writeChain = writeChain
    .then(async () => {
      const tmp = DB_PATH + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
      await fsp.rename(tmp, DB_PATH);
    })
    .catch((err) => {
      console.error('[!] 写入 data.json 失败：', err.message);
    });
  return writeChain;
}

/* ------------------------------ 工具函数 ------------------------------ */

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function getCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

function makeToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + TOKEN_TTL_MS })).toString('base64url');
  const sig = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = crypto.createHmac('sha256', AUTH_SECRET).update(payload).digest('base64url');
  if (sig.length !== expect.length) return false;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof data.exp === 'number' && data.exp > Date.now();
  } catch (e) {
    return false;
  }
}

// 未设置密码时视为永远有权限（向后兼容）
function isAuthed(req) {
  if (!AUTH_REQUIRED) return true;
  return verifyToken(getCookie(req, COOKIE_NAME));
}

function setAuthCookie(res, token) {
  res.setHeader('Set-Cookie', COOKIE_NAME + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + Math.floor(TOKEN_TTL_MS / 1000));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let done = false;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        if (!done) { done = true; reject(new Error('请求体过大')); req.destroy(); }
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(chunks)); } });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

function sanitizeName(name) {
  return path.basename(String(name || '')).replace(/[\r\n]+/g, ' ').trim().slice(0, 200);
}

function ensureExt(name, ext) {
  const n = String(name || '').trim();
  if (!n) return '未命名' + ext;
  if (!path.extname(n)) return n + ext;
  return n;
}

function extFromName(name) {
  const e = path.extname(String(name || '')).toLowerCase();
  return ALLOWED_EXT.has(e) ? e : null;
}

function normalizeTags(tags) {
  const out = [];
  const seen = new Set();
  const arr = Array.isArray(tags)
    ? tags
    : (typeof tags === 'string' ? String(tags).split(/[,，\n]/) : []);
  for (const t of arr) {
    const s = String(t).trim();
    if (s && !seen.has(s) && s.length <= 40) { seen.add(s); out.push(s); }
  }
  return out;
}

function parseDataUrl(str) {
  const m = /^data:([^;]+);base64,(.+)$/.exec(String(str || ''));
  if (!m) return null;
  return { mime: m[1].toLowerCase(), base64: m[2] };
}

function contentDisposition(name) {
  const ascii = String(name).replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const enc = encodeURIComponent(String(name)).replace(/['()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${ascii}"; filename*=UTF-8''${enc}`;
}

function imageSize(buf, ext) {
  try {
    if (ext === '.gif' && buf.length >= 10) {
      const h = buf.toString('ascii', 0, 6);
      if (h === 'GIF87a' || h === 'GIF89a') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    } else if (ext === '.png' && buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    } else if (ext === '.jpg' || ext === '.jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) { i += 2; continue; }
        const len = buf.readUInt16BE(i + 2);
        if ((marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    } else if (ext === '.webp' && buf.length >= 30) {
      const fourcc = buf.toString('ascii', 12, 16);
      if (fourcc === 'VP8X') {
        return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      }
      if (fourcc === 'VP8 ' && buf.readUIntLE(23, 3) === 0x2a019d) {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
      if (fourcc === 'VP8L' && buf[20] === 0x2f) {
        const bits = buf.readUInt32LE(21);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
    } else if (ext === '.bmp' && buf.length >= 26 && buf[0] === 0x42 && buf[1] === 0x4d) {
      return { width: buf.readInt32LE(18), height: Math.abs(buf.readInt32LE(22)) };
    } else if (ext === '.svg') {
      const head = buf.toString('utf8', 0, Math.min(buf.length, 4096));
      const vb = head.match(/viewBox=["'][^"']*?\s([\d.]+)[\s,]+([\d.]+)/);
      if (vb) return { width: Math.round(parseFloat(vb[1])) || null, height: Math.round(parseFloat(vb[2])) || null };
      const w = head.match(/<svg[^>]*\bwidth=["']([\d.]+)/);
      const h = head.match(/<svg[^>]*\bheight=["']([\d.]+)/);
      if (w && h) return { width: Math.round(parseFloat(w[1])) || null, height: Math.round(parseFloat(h[1])) || null };
    }
  } catch (e) { /* 忽略解析错误 */ }
  return { width: null, height: null };
}

function publicImage(img) {
  return {
    id: img.id,
    name: img.name,
    url: '/stickers/' + img.stored,
    mime: img.mime,
    ext: img.ext,
    size: img.size,
    width: img.width,
    height: img.height,
    category: img.category,
    tags: img.tags,
    addedAt: img.addedAt,
  };
}

async function removeFile(p) {
  try { await fsp.unlink(p); }
  catch (e) { if (e.code !== 'ENOENT') console.error('[!] 删除文件失败', p, e.message); }
}

/* ------------------------------ 接口处理 ------------------------------ */

function handleAuth(req, res) {
  sendJson(res, 200, { required: AUTH_REQUIRED, authed: isAuthed(req) });
}

async function handleLogin(req, res) {
  if (!AUTH_REQUIRED) return sendJson(res, 200, { ok: true, required: false });
  const raw = await readBody(req, 1024 * 16);
  let body;
  try { body = JSON.parse(raw.toString('utf8')); }
  catch { return sendJson(res, 400, { error: 'JSON 解析失败' }); }
  const given = Buffer.from(String(body.password || ''));
  const real = Buffer.from(ADMIN_PASSWORD);
  const ok = given.length === real.length && crypto.timingSafeEqual(given, real);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 500));
    return sendJson(res, 401, { error: '密码错误' });
  }
  setAuthCookie(res, makeToken());
  sendJson(res, 200, { ok: true });
}

function handleLogout(res) {
  res.setHeader('Set-Cookie', COOKIE_NAME + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  sendJson(res, 200, { ok: true });
}

function handleState(res) {
  const images = db.images.map(publicImage);
  const tagSet = new Set();
  const catSet = new Set();
  for (const i of db.images) {
    i.tags.forEach((t) => tagSet.add(t));
    catSet.add(i.category);
  }
  sendJson(res, 200, {
    images,
    stats: { total: images.length, tags: tagSet.size, categories: catSet.size },
  });
}

async function handleUpload(req, res) {
  const raw = await readBody(req, CONFIG.maxBodySize);
  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); }
  catch { return sendJson(res, 400, { error: '请求体不是合法 JSON' }); }

  const files = Array.isArray(payload.files) ? payload.files : [];
  if (!files.length) return sendJson(res, 400, { error: '没有收到文件' });

  const added = [];
  const skipped = [];
  const errors = [];

  for (const f of files) {
    const fname = String((f && f.name) || '');
    try {
      const parsed = parseDataUrl(f.data);
      if (!parsed) { errors.push({ name: fname, error: '数据格式错误' }); continue; }
      const ext = EXT_BY_MIME[parsed.mime] || extFromName(fname);
      if (!ext || !MIME[ext]) { errors.push({ name: fname, error: '不支持的图片格式' }); continue; }
      const buf = Buffer.from(parsed.base64, 'base64');
      if (buf.length === 0) { errors.push({ name: fname, error: '文件为空' }); continue; }
      if (buf.length > CONFIG.maxFileSize) { errors.push({ name: fname, error: '文件超过大小限制（30MB）' }); continue; }

      const hash = crypto.createHash('md5').update(buf).digest('hex');
      const dup = db.images.find((img) => img.hash === hash);
      if (dup) { skipped.push({ name: fname, id: dup.id, error: '重复文件' }); continue; }

      const id = crypto.randomUUID();
      const stored = id + ext;
      await fsp.writeFile(path.join(CONFIG.stickersDir, stored), buf);

      const { width, height } = imageSize(buf, ext);
      const name = ensureExt(sanitizeName(fname) || (id + ext), ext);
      const category = String(f.category || '').trim() || '未分类';
      const tags = normalizeTags(f.tags);

      const img = {
        id, name, stored, mime: parsed.mime, ext, size: buf.length,
        width, height, hash, category, tags, addedAt: Date.now(),
      };
      db.images.push(img);
      added.push(publicImage(img));
    } catch (e) {
      console.error('[!] 上传失败', fname, e);
      errors.push({ name: fname, error: e.message });
    }
  }

  if (added.length) await persist();
  sendJson(res, 200, { added, skipped, errors, total: db.images.length });
}

async function handleUpdate(req, res, id) {
  const idx = db.images.findIndex((i) => i.id === id);
  if (idx < 0) return sendJson(res, 404, { error: '未找到该表情' });
  const raw = await readBody(req, 5 * 1024 * 1024);
  let body;
  try { body = JSON.parse(raw.toString('utf8')); }
  catch { return sendJson(res, 400, { error: 'JSON 解析失败' }); }

  const img = db.images[idx];
  if ('name' in body && body.name != null) {
    const n = sanitizeName(body.name);
    if (n) img.name = ensureExt(n, img.ext);
  }
  if ('category' in body && body.category != null) {
    img.category = String(body.category).trim() || '未分类';
  }
  if ('tags' in body) img.tags = normalizeTags(body.tags);
  await persist();
  sendJson(res, 200, { image: publicImage(img) });
}

async function handleDelete(req, res, id) {
  const idx = db.images.findIndex((i) => i.id === id);
  if (idx < 0) return sendJson(res, 404, { error: '未找到该表情' });
  const [img] = db.images.splice(idx, 1);
  await removeFile(path.join(CONFIG.stickersDir, img.stored));
  await persist();
  sendJson(res, 200, { ok: true, total: db.images.length });
}

async function handleBatchDelete(req, res) {
  const raw = await readBody(req, 5 * 1024 * 1024);
  let body;
  try { body = JSON.parse(raw.toString('utf8')); }
  catch { return sendJson(res, 400, { error: 'JSON 解析失败' }); }
  const ids = Array.isArray(body.ids) ? body.ids : [];
  let removed = 0;
  for (const id of ids) {
    const idx = db.images.findIndex((i) => i.id === id);
    if (idx >= 0) {
      const [img] = db.images.splice(idx, 1);
      await removeFile(path.join(CONFIG.stickersDir, img.stored));
      removed++;
    }
  }
  if (removed) await persist();
  sendJson(res, 200, { removed, total: db.images.length });
}

async function handleBatchUpdate(req, res) {
  const raw = await readBody(req, 5 * 1024 * 1024);
  let body;
  try { body = JSON.parse(raw.toString('utf8')); }
  catch { return sendJson(res, 400, { error: 'JSON 解析失败' }); }
  const ids = Array.isArray(body.ids) ? body.ids : [];
  const addTags = normalizeTags(body.addTags);
  const removeTags = normalizeTags(body.removeTags);
  let changed = 0;
  for (const id of ids) {
    const img = db.images.find((i) => i.id === id);
    if (!img) continue;
    let c = false;
    if (body.setCategory != null && String(body.setCategory).trim()) {
      img.category = String(body.setCategory).trim();
      c = true;
    }
    for (const t of addTags) {
      if (!img.tags.includes(t)) { img.tags.push(t); c = true; }
    }
    if (removeTags.length) {
      const before = img.tags.length;
      img.tags = img.tags.filter((t) => !removeTags.includes(t));
      if (img.tags.length !== before) c = true;
    }
    if (c) changed++;
  }
  if (changed) await persist();
  sendJson(res, 200, { changed, total: db.images.length });
}

async function handleDownload(res, id) {
  const img = db.images.find((i) => i.id === id);
  if (!img) return sendJson(res, 404, { error: '未找到该表情' });
  const fp = path.join(CONFIG.stickersDir, img.stored);
  try { await fsp.stat(fp); }
  catch { return sendJson(res, 404, { error: '文件已丢失' }); }
  res.writeHead(200, {
    'Content-Type': img.mime,
    'Content-Length': img.size,
    'Content-Disposition': contentDisposition(img.name),
  });
  fs.createReadStream(fp).on('error', () => { if (!res.headersSent) res.destroy(); }).pipe(res);
}

function handleExport(res) {
  const data = JSON.stringify(db, null, 2);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': 'attachment; filename="stickers-data.json"',
  });
  res.end(data);
}

async function serveSticker(res, pathname) {
  let name = '';
  try { name = decodeURIComponent(pathname.replace(/^\/stickers\//, '')); }
  catch { return sendJson(res, 400, { error: '路径非法' }); }
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) {
    return sendJson(res, 400, { error: '路径非法' });
  }
  const fp = path.join(CONFIG.stickersDir, name);
  if (!fp.startsWith(path.resolve(CONFIG.stickersDir) + path.sep)) {
    return sendJson(res, 400, { error: '路径非法' });
  }
  try {
    const st = await fsp.stat(fp);
    if (!st.isFile()) return sendJson(res, 404, { error: '文件不存在' });
    const type = MIME[path.extname(name).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': st.size,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    fs.createReadStream(fp).on('error', () => { if (!res.headersSent) res.destroy(); }).pipe(res);
  } catch {
    sendJson(res, 404, { error: '文件不存在' });
  }
}

async function serveStatic(res, pathname) {
  let rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (rel.includes('..')) return sendJson(res, 400, { error: '路径非法' });
  const fp = path.join(CONFIG.publicDir, rel);
  try {
    const st = await fsp.stat(fp);
    if (!st.isFile()) return sendJson(res, 404, { error: '文件不存在' });
    const ext = path.extname(fp).toLowerCase();
    let type = 'application/octet-stream';
    if (ext === '.html') type = 'text/html; charset=utf-8';
    else if (ext === '.css') type = 'text/css; charset=utf-8';
    else if (ext === '.js') type = 'text/javascript; charset=utf-8';
    else if (MIME[ext]) type = MIME[ext];
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    fs.createReadStream(fp).on('error', () => { if (!res.headersSent) res.destroy(); }).pipe(res);
  } catch {
    sendJson(res, 404, { error: '文件不存在' });
  }
}

async function handleApi(req, res, p) {
  if (p === '/api/upload' && req.method === 'POST') return await handleUpload(req, res);
  if (p === '/api/batch-delete' && req.method === 'POST') return await handleBatchDelete(req, res);
  if (p === '/api/batch-update' && req.method === 'POST') return await handleBatchUpdate(req, res);
  const m = /^\/api\/image\/([0-9a-fA-F-]+)$/.exec(p);
  if (m) {
    const id = m[1];
    if (req.method === 'PATCH') return await handleUpdate(req, res, id);
    if (req.method === 'DELETE') return await handleDelete(req, res, id);
  }
  sendJson(res, 404, { error: '接口不存在' });
}

/* ------------------------------ 服务器 ------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  try {
    // ---- 只读接口：游客可用 ----
    if (req.method === 'GET' && p === '/api/state') return handleState(res);
    if (req.method === 'GET' && p === '/api/health') return sendJson(res, 200, { ok: true });
    if (req.method === 'GET' && p === '/api/auth') return handleAuth(req, res);
    if (req.method === 'GET' && p.startsWith('/api/download/')) {
      return await handleDownload(res, p.slice('/api/download/'.length));
    }
    if (p === '/api/login' && req.method === 'POST') return await handleLogin(req, res);
    if (p === '/api/logout' && req.method === 'POST') return handleLogout(res);

    // ---- 写操作与导出：仅管理员 ----
    if (p.startsWith('/api/')) {
      if (!isAuthed(req)) return sendJson(res, 401, { error: '需要管理员权限，请先登录' });
      if (req.method === 'GET' && p === '/api/export') return handleExport(res);
      return await handleApi(req, res, p);
    }
    if (req.method === 'GET' && p.startsWith('/stickers/')) return await serveSticker(res, p);
    if (req.method === 'GET') return await serveStatic(res, p);
    sendJson(res, 404, { error: '未找到' });
  } catch (e) {
    console.error('[!] 请求处理错误', req.method, p, e);
    if (!res.headersSent) sendJson(res, 500, { error: '服务器内部错误：' + e.message });
    else res.end();
  }
});

async function init() {
  await fsp.mkdir(CONFIG.stickersDir, { recursive: true });
  await fsp.mkdir(CONFIG.publicDir, { recursive: true });
  loadDb();
  server.listen(CONFIG.port, () => {
    console.log('😜 表情包管家已启动');
    console.log('   访问地址: http://localhost:' + CONFIG.port);
    console.log('   图片目录: ' + CONFIG.stickersDir);
    console.log('   数据库:   ' + DB_PATH);
  });
  server.on('error', (e) => {
    console.error('[!] 启动失败：', e.message);
    process.exit(1);
  });
}

init();
