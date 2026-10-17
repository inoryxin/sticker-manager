'use strict';

/* ================= 状态 ================= */
const state = {
  images: [],
  categories: [],
  tags: [],
  filters: { search: '', category: '', tags: new Set() },
  sort: 'newest',
  selectMode: false,
  selection: new Set(),
  detailList: [],      // 当前过滤排序后的 id 序列，用于详情里上一张/下一张
  detailIndex: 0,
  uploadItems: [],     // 待上传文件
};

const $ = (id) => document.getElementById(id);

const els = {
  sidebar: $('sidebar'), backdrop: $('backdrop'), menuBtn: $('menuBtn'),
  search: $('searchInput'), sort: $('sortSelect'),
  uploadBtn: $('uploadBtn'), mobileUploadBtn: $('mobileUploadBtn'), randomBtn: $('randomBtn'),
  categoryList: $('categoryList'), tagList: $('tagList'), clearTags: $('clearTags'),
  stats: $('stats'), exportBtn: $('exportBtn'),
  toolbarTitle: $('toolbarTitle'), selectBtn: $('selectBtn'),
  batchBar: $('batchBar'), selectedCount: $('selectedCount'),
  batchTagBtn: $('batchTagBtn'), batchCategoryBtn: $('batchCategoryBtn'), batchDeleteBtn: $('batchDeleteBtn'),
  cancelSelectBtn: $('cancelSelectBtn'),
  grid: $('grid'), empty: $('empty'),
  // 上传
  uploadModal: $('uploadModal'), dropzone: $('dropzone'), fileInput: $('fileInput'),
  applyCategory: $('applyCategory'), applyTags: $('applyTags'),
  uploadList: $('uploadList'), uploadCount: $('uploadCount'), doUpload: $('doUpload'),
  // 详情
  detailModal: $('detailModal'), detailImg: $('detailImg'), detailName: $('detailName'),
  detailCategory: $('detailCategory'), detailTags: $('detailTags'), detailTagInput: $('detailTagInput'),
  detailDownload: $('detailDownload'), detailCopy: $('detailCopy'), detailDelete: $('detailDelete'),
  detailMeta: $('detailMeta'), detailPrev: $('detailPrev'), detailNext: $('detailNext'),
  // 批量
  batchModal: $('batchModal'), batchAddTags: $('batchAddTags'), batchAddTagsBtn: $('batchAddTagsBtn'),
  batchCategory: $('batchCategory'), batchCategoryBtn: $('batchCategoryBtn'), batchDeleteBtn2: $('batchDeleteBtn2'),
  // 其它
  catDatalist: $('categoryDatalist'), tagDatalist: $('tagDatalist'), toast: $('toast'),
  dragOverlay: $('dragOverlay'),
  // 鉴权
  loginBtn: $('loginBtn'), logoutBtn: $('logoutBtn'), readonlyBadge: $('readonlyBadge'),
  loginModal: $('loginModal'), loginPassword: $('loginPassword'), loginSubmit: $('loginSubmit'),
};

// 鉴权状态：默认按游客处理（更安全），启动时再向服务器确认真实状态
const authState = { required: false, authed: false };

/* ================= 工具 ================= */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtSize(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

let toastTimer = null;
function toast(msg, kind) {
  els.toast.textContent = msg;
  els.toast.className = 'toast show' + (kind === 'ok' ? ' ok' : kind === 'err' ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.className = 'toast'; }, 2600);
}

async function api(url, opts) {
  const res = await fetch(url, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok) throw new Error((data && data.error) || ('请求失败 ' + res.status));
  return data;
}

const byId = (id) => state.images.find((i) => i.id === id);

/* ================= 数据加载与派生 ================= */
async function loadState() {
  try {
    const data = await api('/api/state');
    state.images = data.images || [];
    deriveFacets();
    render();
  } catch (e) {
    toast('加载失败：' + e.message, 'err');
  }
}

function deriveFacets() {
  const cat = new Map();
  const tag = new Map();
  for (const img of state.images) {
    cat.set(img.category, (cat.get(img.category) || 0) + 1);
    for (const t of img.tags) tag.set(t, (tag.get(t) || 0) + 1);
  }
  state.categories = [...cat.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .map(([name, count]) => ({ name, count }));
  state.tags = [...tag.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
    .map(([name, count]) => ({ name, count }));

  // 更新 datalist
  els.catDatalist.innerHTML = state.categories.map((c) => `<option value="${escapeHtml(c.name)}"></option>`).join('');
  els.tagDatalist.innerHTML = state.tags.map((t) => `<option value="${escapeHtml(t.name)}"></option>`).join('');
}

function filtered() {
  const q = state.filters.search.trim().toLowerCase();
  const tags = [...state.filters.tags];
  return state.images.filter((img) => {
    if (state.filters.category && img.category !== state.filters.category) return false;
    if (tags.length && !tags.every((t) => img.tags.includes(t))) return false;
    if (q) {
      const hay = (img.name + ' ' + img.tags.join(' ') + ' ' + img.category).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function sorted(list) {
  const s = state.sort;
  const arr = list.slice();
  if (s === 'newest') arr.sort((a, b) => b.addedAt - a.addedAt);
  else if (s === 'oldest') arr.sort((a, b) => a.addedAt - b.addedAt);
  else if (s === 'name') arr.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  else if (s === 'size') arr.sort((a, b) => b.size - a.size);
  return arr;
}

/* ================= 渲染 ================= */
function render() {
  renderFacets();
  renderGrid();
  renderStats();
  updateToolbarTitle();
}

function renderFacets() {
  // 分类
  const catHtml = [
    `<li><button class="cat-item ${state.filters.category ? '' : 'active'}" data-cat="">全部 <span class="count">${state.images.length}</span></button></li>`,
    ...state.categories.map((c) =>
      `<li><button class="cat-item ${state.filters.category === c.name ? 'active' : ''}" data-cat="${escapeHtml(c.name)}">${escapeHtml(c.name)} <span class="count">${c.count}</span></button></li>`
    ),
  ].join('');
  els.categoryList.innerHTML = catHtml;

  // 标签
  els.tagList.innerHTML = state.tags.map((t) => {
    const active = state.filters.tags.has(t.name);
    return `<button class="tag-chip ${active ? 'active' : ''}" data-tag="${escapeHtml(t.name)}">${escapeHtml(t.name)} <span class="count">${t.count}</span></button>`;
  }).join('');
  els.clearTags.hidden = state.filters.tags.size === 0;
}

function renderGrid() {
  const list = sorted(filtered());
  state.detailList = list.map((i) => i.id);

  if (!list.length) {
    els.grid.innerHTML = '';
    els.empty.hidden = false;
    return;
  }
  els.empty.hidden = true;

  const frag = document.createDocumentFragment();
  for (const img of list) frag.appendChild(tileEl(img));
  els.grid.innerHTML = '';
  els.grid.appendChild(frag);
  fitTileRows();
}

// 让每个格子的高度精确等于列宽（保持正方形）。
// 网格的 auto 行高不会考虑格子的 aspect-ratio，会塌陷成很矮的行，导致格子互相叠加。
function fitTileRows() {
  const first = els.grid.querySelector('.tile');
  if (!first) { els.grid.style.gridAutoRows = ''; return; }
  const w = Math.round(first.getBoundingClientRect().width);
  if (w > 0) els.grid.style.gridAutoRows = w + 'px';
}

function tileEl(img) {
  const div = document.createElement('div');
  div.className = 'tile' + (state.selection.has(img.id) ? ' selected' : '');
  div.dataset.id = img.id;
  const tags = img.tags.length
    ? `<div class="tile-tags">${img.tags.map((t) => '#' + escapeHtml(t)).join(' ')}</div>`
    : '';
  div.innerHTML = `
    <div class="tile-img">
      <img loading="lazy" src="${escapeHtml(img.url)}" alt="${escapeHtml(img.name)}" draggable="false">
    </div>
    <div class="tile-overlay">
      <button class="tile-btn" data-act="view" title="查看">👁</button>
      <button class="tile-btn" data-act="download" title="下载">⬇</button>
      <button class="tile-btn" data-act="copy" title="复制到剪贴板">📋</button>
      ${authState.authed ? '<button class="tile-btn danger" data-act="delete" title="删除">🗑</button>' : ''}
    </div>
    <div class="tile-info">
      <div class="tile-name">${escapeHtml(img.name)}</div>
      ${tags}
    </div>
    <div class="tile-check"></div>
  `;
  return div;
}

function renderStats() {
  els.stats.innerHTML = `
    <div>共 <b>${state.images.length}</b> 张表情</div>
    <div>${state.categories.length} 个分类 · ${state.tags.length} 个标签</div>
  `;
}

function updateToolbarTitle() {
  const parts = [];
  if (state.filters.search.trim()) parts.push('搜索“' + state.filters.search.trim() + '”');
  if (state.filters.category) parts.push(state.filters.category);
  if (state.filters.tags.size) parts.push([...state.filters.tags].join(' + '));
  els.toolbarTitle.textContent = parts.length ? parts.join(' · ') : '全部表情包';
}

/* ================= 筛选 / 排序 ================= */
els.search.addEventListener('input', () => {
  state.filters.search = els.search.value;
  render();
});

els.sort.addEventListener('change', () => {
  state.sort = els.sort.value;
  renderGrid();
});

els.categoryList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cat]');
  if (!btn) return;
  state.filters.category = btn.dataset.cat;
  render();
});

els.tagList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tag]');
  if (!btn) return;
  const tag = btn.dataset.tag;
  if (state.filters.tags.has(tag)) state.filters.tags.delete(tag);
  else state.filters.tags.add(tag);
  render();
});

els.clearTags.addEventListener('click', () => {
  state.filters.tags.clear();
  render();
});

/* ================= 选择模式 ================= */
function setSelectMode(on) {
  if (on && !authState.authed) { openLogin(); return; }
  state.selectMode = on;
  state.selection.clear();
  els.selectBtn.textContent = on ? '✕ 退出选择' : '☑ 选择';
  els.batchBar.hidden = !on;
  renderGrid();
  updateSelectedCount();
}

els.selectBtn.addEventListener('click', () => setSelectMode(!state.selectMode));
els.cancelSelectBtn.addEventListener('click', () => setSelectMode(false));

function toggleSelect(id) {
  if (state.selection.has(id)) state.selection.delete(id);
  else state.selection.add(id);
  updateSelectedCount();
  renderGrid();
}

function updateSelectedCount() {
  els.selectedCount.textContent = '已选 ' + state.selection.size + ' 项';
}

/* ================= 网格点击 ================= */
els.grid.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  const tile = e.target.closest('.tile');
  if (!tile) return;
  const id = tile.dataset.id;
  const img = byId(id);
  if (!img) return;
  if (btn) {
    e.stopPropagation();
    const act = btn.dataset.act;
    if (act === 'view') openDetail(id);
    else if (act === 'download') download(img);
    else if (act === 'copy') copyImage(img);
    else if (act === 'delete') deleteImage(img);
    return;
  }
  if (state.selectMode) toggleSelect(id);
  else openDetail(id);
});

/* ================= 下载 / 复制 / 删除 ================= */
function download(img) {
  const a = document.createElement('a');
  a.href = '/api/download/' + img.id;
  a.download = img.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// 复制图片到剪贴板。三层兜底：
//   1) 安全上下文（HTTPS / localhost）下用标准剪贴板 API —— 注意 Chromium 只接受 image/png，
//      所以 JPEG / GIF / WebP 都先转成 PNG（动图会变成第一帧）。
//   2) 非 HTTPS（比如用 http://局域网IP 访问）时浏览器根本不提供 navigator.clipboard，
//      退回「在页面上选中这张图 + execCommand('copy')」，这条路在 HTTP 下也能用。
//   3) 都不行才下载。
function copyImage(img) {
  if (window.isSecureContext && navigator.clipboard && window.ClipboardItem) {
    copyViaClipboardApi(img);
    return;
  }
  if (copyViaSelection(img)) { toast('已复制到剪贴板', 'ok'); return; }
  download(img);
  toast('当前环境不支持复制图片，已改为下载', 'err');
}

async function copyViaClipboardApi(img) {
  try {
    const blob = await (await fetch(img.url)).blob();
    const png = blob.type === 'image/png' ? blob : await toPngBlob(blob);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    toast('已复制到剪贴板', 'ok');
    return;
  } catch (e) { /* 落到下面的兜底 */ }
  if (copyViaSelection(img)) { toast('已复制到剪贴板', 'ok'); return; }
  download(img);
  toast('复制失败，已改为下载', 'err');
}

// 把任意格式的图片转成 PNG（Chromium 只允许往剪贴板写 PNG）
function toPngBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const im = new Image();
    im.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = im.naturalWidth || 1;
        c.height = im.naturalHeight || 1;
        c.getContext('2d').drawImage(im, 0, 0);
        c.toBlob((b) => { URL.revokeObjectURL(url); b ? resolve(b) : reject(new Error('PNG 转换失败')); }, 'image/png');
      } catch (e) { URL.revokeObjectURL(url); reject(e); }
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
    im.src = url;
  });
}

// 兜底：在页面上选中这张图并执行复制
function copyViaSelection(img) {
  let domImg = null;
  if (!els.detailModal.hidden && els.detailImg && els.detailImg.complete && els.detailImg.naturalWidth) {
    domImg = els.detailImg;
  } else {
    const tile = els.grid.querySelector('.tile[data-id="' + img.id + '"]');
    const t = tile && tile.querySelector('img');
    if (t && t.complete && t.naturalWidth) domImg = t;
  }
  if (!domImg) return false;
  const sel = window.getSelection();
  const saved = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  try {
    const range = document.createRange();
    range.selectNode(domImg);
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand('copy');
    sel.removeAllRanges();
    if (saved) { try { sel.addRange(saved); } catch (e) { /* ignore */ } }
    return ok;
  } catch (e) {
    try { sel.removeAllRanges(); } catch (e2) { /* ignore */ }
    return false;
  }
}

async function deleteImage(img) {
  if (!confirm('确定删除「' + img.name + '」吗？此操作不可恢复。')) return;
  try {
    await api('/api/image/' + img.id, { method: 'DELETE' });
    state.selection.delete(img.id);
    await loadState();
    toast('已删除', 'ok');
  } catch (e) {
    toast('删除失败：' + e.message, 'err');
  }
}

/* ================= 详情弹窗 ================= */
function openDetail(id) {
  state.detailIndex = state.detailList.indexOf(id);
  if (state.detailIndex < 0) { state.detailList = [id]; state.detailIndex = 0; }
  renderDetail();
  els.detailModal.hidden = false;
}

function currentDetailImg() {
  const id = state.detailList[state.detailIndex];
  return byId(id);
}

function renderDetail() {
  const img = currentDetailImg();
  if (!img) { closeModal('detail'); return; }
  els.detailImg.src = img.url;
  els.detailImg.alt = img.name;
  const admin = authState.authed;
  els.detailName.value = img.name;
  els.detailName.readOnly = !admin;
  els.detailCategory.value = img.category;
  els.detailCategory.readOnly = !admin;
  els.detailTags.innerHTML = img.tags.map((t) => (admin
    ? `<button class="tag-chip" data-remove-tag="${escapeHtml(t)}">${escapeHtml(t)} ✕</button>`
    : `<span class="tag-chip">${escapeHtml(t)}</span>`
  )).join('');
  els.detailTagInput.hidden = !admin;
  els.detailDelete.hidden = !admin;
  const dims = (img.width && img.height) ? `${img.width}×${img.height} · ` : '';
  const when = new Date(img.addedAt).toLocaleString('zh-CN');
  els.detailMeta.textContent = `${dims}${fmtSize(img.size)} · 上传于 ${when}`;
  els.detailPrev.style.visibility = state.detailIndex > 0 ? 'visible' : 'hidden';
  els.detailNext.style.visibility = state.detailIndex < state.detailList.length - 1 ? 'visible' : 'hidden';
}

async function saveDetail(patch) {
  const img = currentDetailImg();
  if (!img) return;
  try {
    const data = await api('/api/image/' + img.id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    Object.assign(img, data.image);
    deriveFacets();
    renderGrid();
    renderFacets();
    renderStats();
  } catch (e) {
    toast('保存失败：' + e.message, 'err');
  }
}

els.detailName.addEventListener('change', () => {
  const v = els.detailName.value.trim();
  if (v) saveDetail({ name: v });
  else renderDetail();
});

els.detailCategory.addEventListener('change', () => {
  saveDetail({ category: els.detailCategory.value });
  renderDetail();
});

els.detailTags.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove-tag]');
  if (!btn) return;
  const img = currentDetailImg();
  if (!img) return;
  saveDetail({ tags: img.tags.filter((t) => t !== btn.dataset.removeTag) }).then(() => renderDetail());
});

els.detailTagInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    addDetailTag();
  }
});
els.detailTagInput.addEventListener('blur', () => {
  if (els.detailTagInput.value.trim()) addDetailTag();
});

function addDetailTag() {
  const img = currentDetailImg();
  if (!img) return;
  const val = els.detailTagInput.value.trim();
  if (!val) return;
  const tags = val.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean);
  els.detailTagInput.value = '';
  const merged = [...img.tags];
  for (const t of tags) if (!merged.includes(t)) merged.push(t);
  saveDetail({ tags: merged }).then(() => renderDetail());
}

els.detailPrev.addEventListener('click', () => { if (state.detailIndex > 0) { state.detailIndex--; renderDetail(); } });
els.detailNext.addEventListener('click', () => { if (state.detailIndex < state.detailList.length - 1) { state.detailIndex++; renderDetail(); } });
els.detailDownload.addEventListener('click', () => { const img = currentDetailImg(); if (img) download(img); });
els.detailCopy.addEventListener('click', () => { const img = currentDetailImg(); if (img) copyImage(img); });
els.detailDelete.addEventListener('click', async () => {
  const img = currentDetailImg();
  if (!img) return;
  if (!confirm('确定删除「' + img.name + '」吗？')) return;
  try {
    await api('/api/image/' + img.id, { method: 'DELETE' });
    els.detailModal.hidden = true;
    await loadState();
    toast('已删除', 'ok');
  } catch (e) { toast('删除失败：' + e.message, 'err'); }
});

/* ================= 弹窗通用 ================= */
function closeModal(name) {
  if (name === 'upload') els.uploadModal.hidden = true;
  else if (name === 'detail') els.detailModal.hidden = true;
  else if (name === 'batch') els.batchModal.hidden = true;
  else if (name === 'login') els.loginModal.hidden = true;
}

document.querySelectorAll('[data-close]').forEach((el) => {
  el.addEventListener('click', () => closeModal(el.dataset.close));
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!els.detailModal.hidden) closeModal('detail');
    else if (!els.uploadModal.hidden) closeModal('upload');
    else if (!els.batchModal.hidden) closeModal('batch');
    else if (!els.loginModal.hidden) closeModal('login');
    else setSelectMode(false);
  } else if (e.key === 'ArrowLeft' && !els.detailModal.hidden) {
    if (state.detailIndex > 0) { state.detailIndex--; renderDetail(); }
  } else if (e.key === 'ArrowRight' && !els.detailModal.hidden) {
    if (state.detailIndex < state.detailList.length - 1) { state.detailIndex++; renderDetail(); }
  }
});

/* ================= 上传 ================= */
els.uploadBtn.addEventListener('click', openUpload);
els.mobileUploadBtn.addEventListener('click', openUpload);

function openUpload() {
  if (!authState.authed) { openLogin(); return; }
  els.uploadModal.hidden = false;
  renderUploadList();
}

els.dropzone.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', (e) => addFiles(e.target.files));


function addFiles(fileList) {
  const cat = els.applyCategory.value.trim();
  const tags = els.applyTags.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  for (const file of fileList) {
    if (!file.type.startsWith('image/') && !/\.(gif|webp|svg|bmp|avif)$/i.test(file.name)) {
      toast('已跳过非图片文件：' + file.name, 'err');
      continue;
    }
    const reader = new FileReader();
    reader.onload = () => {
      state.uploadItems.push({
        name: file.name,
        origName: file.name,
        size: file.size,
        data: reader.result,   // dataURL
        category: cat,
        tags: tags.slice(),
      });
      renderUploadList();
    };
    reader.readAsDataURL(file);
  }
  els.fileInput.value = '';
}

function renderUploadList() {
  if (!state.uploadItems.length) {
    els.uploadList.innerHTML = '<div class="muted" style="text-align:center;padding:8px">暂无文件，选择或拖拽图片添加</div>';
    els.uploadCount.textContent = '0 个文件';
    return;
  }
  els.uploadCount.textContent = state.uploadItems.length + ' 个文件';
  els.uploadList.innerHTML = state.uploadItems.map((item, i) => `
    <div class="upload-item" data-i="${i}">
      <img class="thumb" src="${item.data}" alt="">
      <div class="u-info">
        <div class="u-inputs">
          <input data-field="name" placeholder="文件名（可省略后缀）" value="${escapeHtml(item.name)}">
        </div>
        <div class="u-inputs">
          <input data-field="category" placeholder="分类" value="${escapeHtml(item.category)}" list="categoryDatalist">
          <input data-field="tags" placeholder="标签，逗号分隔" value="${escapeHtml(item.tags.join(', '))}">
        </div>
        <div class="u-size">${fmtSize(item.size)}</div>
      </div>
      <button class="u-remove" data-remove="${i}" title="移除">✕</button>
    </div>
  `).join('');
}

els.uploadList.addEventListener('input', (e) => {
  const row = e.target.closest('.upload-item');
  if (!row) return;
  const i = Number(row.dataset.i);
  const field = e.target.dataset.field;
  if (field === 'name') state.uploadItems[i].name = e.target.value.trim();
  else if (field === 'category') state.uploadItems[i].category = e.target.value.trim();
  else if (field === 'tags') state.uploadItems[i].tags = e.target.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
});

els.uploadList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-remove]');
  if (!btn) return;
  state.uploadItems.splice(Number(btn.dataset.remove), 1);
  renderUploadList();
});

els.doUpload.addEventListener('click', async () => {
  if (!state.uploadItems.length) { toast('请先添加文件', 'err'); return; }
  els.doUpload.disabled = true;
  els.doUpload.textContent = '上传中…';
  try {
    const data = await api('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: state.uploadItems.map((it) => ({ name: it.name || it.origName, data: it.data, category: it.category, tags: it.tags })),
      }),
    });
    const added = data.added.length;
    const skipped = data.skipped.length;
    const errors = data.errors.length;
    let msg = `成功上传 ${added} 个`;
    if (skipped) msg += `，跳过重复 ${skipped} 个`;
    if (errors) msg += `，失败 ${errors} 个`;
    toast(msg, errors ? 'err' : 'ok');
    state.uploadItems = [];
    renderUploadList();
    closeModal('upload');
    await loadState();
  } catch (e) {
    toast('上传失败：' + e.message, 'err');
  } finally {
    els.doUpload.disabled = false;
    els.doUpload.textContent = '上传';
  }
});

/* 全局拖拽上传：整页任何位置都能拖入，阻止浏览器打开图片 */
function isFileDrag(e) {
  return !!(e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'));
}
let dragCounter = 0;
window.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragCounter++;
  els.dragOverlay.classList.add('show');
});
window.addEventListener('dragover', (e) => {
  if (isFileDrag(e)) e.preventDefault();
});
window.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  dragCounter = Math.max(0, dragCounter - 1);
  if (dragCounter === 0) els.dragOverlay.classList.remove('show');
});
window.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragCounter = 0;
  els.dragOverlay.classList.remove('show');
  const files = Array.from(e.dataTransfer.files || []);
  if (files.length) {
    if (!authState.authed) { openLogin(); return; }
    openUpload();
    addFiles(files);
  }
});

/* 粘贴图片直接上传 */
document.addEventListener('paste', async (e) => {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  const files = [];
  for (const it of items) {
    if (it.kind === 'file' && it.type.startsWith('image/')) {
      const f = it.getAsFile();
      if (f) files.push(f);
    }
  }
  if (files.length) {
    e.preventDefault();
    if (!authState.authed) { openLogin(); return; }
    const cat = els.applyCategory.value.trim() || '未分类';
    const tags = els.applyTags.value.split(/[,，]/).map((s) => s.trim()).filter(Boolean);
    const payload = [];
    for (const f of files) {
      payload.push(new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve({ name: f.name || '粘贴图片', data: r.result, category: cat, tags: tags.slice() });
        r.readAsDataURL(f);
      }));
    }
    const fileObjs = await Promise.all(payload);
    try {
      const data = await api('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: fileObjs }),
      });
      toast(`已上传 ${data.added.length} 张粘贴图片`, 'ok');
      await loadState();
    } catch (err) {
      toast('上传失败：' + err.message, 'err');
    }
  }
});

/* ================= 批量操作 ================= */
els.batchTagBtn.addEventListener('click', () => { els.batchModal.hidden = false; });
els.batchCategoryBtn.addEventListener('click', () => { els.batchModal.hidden = false; });

els.batchAddTagsBtn.addEventListener('click', async () => {
  const tags = els.batchAddTags.value;
  if (!tags.trim()) { toast('请输入标签', 'err'); return; }
  try {
    await api('/api/batch-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...state.selection], addTags: tags }),
    });
    els.batchAddTags.value = '';
    toast('已添加标签', 'ok');
    await loadState();
  } catch (e) { toast('操作失败：' + e.message, 'err'); }
});

els.batchCategoryBtn.addEventListener('click', async () => {
  const cat = els.batchCategory.value.trim();
  if (!cat) { toast('请输入分类', 'err'); return; }
  try {
    await api('/api/batch-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...state.selection], setCategory: cat }),
    });
    els.batchCategory.value = '';
    toast('已设置分类', 'ok');
    await loadState();
  } catch (e) { toast('操作失败：' + e.message, 'err'); }
});

els.batchDeleteBtn.addEventListener('click', () => els.batchDeleteBtn2.click());
els.batchDeleteBtn2.addEventListener('click', async () => {
  const n = state.selection.size;
  if (!n) { toast('未选择任何图片', 'err'); return; }
  if (!confirm('确定删除所选 ' + n + ' 张图片吗？此操作不可恢复。')) return;
  try {
    await api('/api/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [...state.selection] }),
    });
    closeModal('batch');
    setSelectMode(false);
    await loadState();
    toast('已删除 ' + n + ' 张图片', 'ok');
  } catch (e) { toast('删除失败：' + e.message, 'err'); }
});

/* ================= 随机 / 导出 / 侧栏 ================= */
els.randomBtn.addEventListener('click', () => {
  const list = sorted(filtered());
  if (!list.length) { toast('当前没有可随机的表情', 'err'); return; }
  openDetail(list[Math.floor(Math.random() * list.length)].id);
});

els.exportBtn.addEventListener('click', () => {
  window.location.href = '/api/export';
});

els.menuBtn.addEventListener('click', () => {
  els.sidebar.classList.add('open');
  els.backdrop.classList.add('show');
});
els.backdrop.addEventListener('click', () => {
  els.sidebar.classList.remove('open');
  els.backdrop.classList.remove('show');
});

window.addEventListener('resize', fitTileRows);

/* ================= 鉴权 ================= */
function openLogin() {
  els.loginPassword.value = '';
  els.loginModal.hidden = false;
  setTimeout(() => els.loginPassword.focus(), 60);
}

function applyAuth() {
  document.body.classList.toggle('is-admin', authState.authed);
  els.loginBtn.hidden = authState.authed || !authState.required;
  els.logoutBtn.hidden = !authState.authed || !authState.required;
  els.readonlyBadge.hidden = authState.authed || !authState.required;
  if (!authState.authed && state.selectMode) setSelectMode(false);
  if (!els.detailModal.hidden) renderDetail();
}

async function loadAuth() {
  try {
    const data = await api('/api/auth');
    authState.required = !!data.required;
    authState.authed = !!data.authed;
  } catch (e) {
    authState.authed = false;
  }
  applyAuth();
}

async function doLogin() {
  const pw = els.loginPassword.value;
  if (!pw) { toast('请输入密码', 'err'); return; }
  els.loginSubmit.disabled = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '登录失败');
    els.loginModal.hidden = true;
    els.loginPassword.value = '';
    await loadAuth();
    await loadState();
    toast('登录成功，已获得管理权限', 'ok');
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    els.loginSubmit.disabled = false;
  }
}

els.loginBtn.addEventListener('click', openLogin);
els.loginSubmit.addEventListener('click', doLogin);
els.loginPassword.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
els.logoutBtn.addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  await loadAuth();
  await loadState();
  toast('已退出管理', 'ok');
});

/* ================= 启动 ================= */
(async () => {
  await loadAuth();
  await loadState();
})();
