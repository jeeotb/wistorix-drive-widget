/* ================================================================
   WISTORIX · DRIVE WIDGET: content script cho drive.google.com
   Bản 1.3: có hai chế độ
     • DỮ LIỆU MẪU: không cần đăng nhập, quyền chia sẻ và trùng lặp là số giả (để demo, quay video)
     • DRIVE THẬT:  bấm "Kết nối Google Drive" để gọi Drive API v3 qua background.js

   Luôn đọc thật từ trang Drive: tệp đang chọn (lưới và danh sách), thư mục đang mở, tài khoản, dung lượng.
   UI nằm trong Shadow DOM nên không đụng CSS của Drive.
   ================================================================ */
(() => {
  'use strict';
  if (window.top !== window || window.__wistorixWidget) return;
  window.__wistorixWidget = true;

  /* ───────── CẤU HÌNH ───────── */
  const CFG = {
    dashboardUrl: 'https://ws-extension-demo.vercel.app/',
    showDemoPill: true,    // false: ẩn nhãn "DỮ LIỆU MẪU" và thanh "Kết nối" (khi quay video demo)
    rightGap: 64,          // chừa cột icon Google (Lịch, Keep…) ở mép phải Drive
    scanTtl: 60e3,         // quét lại thư mục sau 60 giây
  };

  const hasExt = typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id);
  const TEST = window.__WX_TEST || null; // chạy thử không qua extension (Playwright)
  const extUrl = (p) => (hasExt ? chrome.runtime.getURL(p) : '');

  const store = {
    async get(key, dflt) {
      if (!hasExt || !chrome.storage) return dflt;
      try { const o = await chrome.storage.local.get(key); return o[key] ?? dflt; } catch (e) { return dflt; }
    },
    set(key, val) { if (hasExt && chrome.storage) { try { chrome.storage.local.set({ [key]: val }); } catch (e) { /* bỏ qua */ } } },
  };

  /* Gọi background (Drive API). Khi chạy thử thì dùng window.__WX_TEST.api */
  async function api(op, args) {
    let r;
    if (TEST && TEST.api) r = await TEST.api(op, args);
    else if (hasExt) r = await chrome.runtime.sendMessage({ type: 'wx-api', op, args });
    else r = { ok: false, error: 'Không chạy trong extension' };
    if (!r || !r.ok) { const e = new Error((r && r.error) || 'Lỗi không xác định'); e.code = r && r.code; e.status = r && r.status; throw e; }
    return r.data;
  }

  /* ───────── TIỆN ÍCH ───────── */
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const IC = (n) => `<svg class="ic"><use href="#i-${n}"/></svg>`;
  const LOGO = '<svg class="wslogo"><use href="#ws-logo"/></svg>';
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  const visible = (el) => !!(el && el.isConnected && el.getClientRects().length);
  function parseSize(txt) {
    const m = String(txt || '').replace(/\./g, '').replace(',', '.').match(/([\d.]+)\s*(byte|B|KB|kB|MB|GB|TB)/i);
    if (!m) return 0;
    return parseFloat(m[1]) * ({ B: 1, BYTE: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 }[m[2].toUpperCase()] || 1);
  }
  function fmtSize(b) {
    b = +b || 0; if (!b) return '0 KB';
    const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
    while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
    return (b >= 100 || i === 0 ? Math.round(b) : b.toFixed(1)).toString().replace('.', ',') + ' ' + u[i];
  }
  function fmtDate(iso) { if (!iso) return '—'; const d = new Date(iso); return `${String(d.getDate()).padStart(2, '0')} thg ${d.getMonth() + 1}, ${d.getFullYear()}`; }

  /* ================================================================
     ĐỌC GIAO DIỆN DRIVE (đã kiểm trên Drive tiếng Việt, 29/09/2026)
     - Lưới:      div[role=gridcell][data-target=doc][data-id], aria-label="Tên Loại Thông tin khác (…)"
     - Danh sách: tr[role=row][data-target=doc][data-id], [data-tooltip]="Tên Loại" + aria-label phụ
     - Đang chọn: aria-selected="true"
     ================================================================ */
  const ITEM_SEL = '[data-id][data-target="doc"]';
  const FOLDER_RE = /\s+(Thư mục dùng chung|Thư mục|Shared folder|Folder)$/i;
  const MORE_RE = /\s*(Thông tin khác|More info)\s*\(.*\)\s*$/i;

  function readItem(el) {
    const id = el.getAttribute('data-id');
    const tipEl = el.querySelector('[data-tooltip]');
    let label = (el.getAttribute('aria-label') || (tipEl && tipEl.getAttribute('data-tooltip')) || '').trim().replace(MORE_RE, '').trim();
    let type = ((el.querySelector('svg title') || {}).textContent || '').trim();
    let isFolder = false, sharedFolder = false;
    const fm = label.match(FOLDER_RE);
    if (fm) {
      isFolder = true; sharedFolder = /chung|shared/i.test(fm[1]);
      label = label.slice(0, fm.index).trim();
      type = sharedFolder ? 'Thư mục dùng chung' : 'Thư mục';
    } else if (type && label.endsWith(' ' + type)) label = label.slice(0, -(type.length + 1)).trim();
    if (!type) { const ext = (label.match(/\.([a-z0-9]{2,5})$/i) || [])[1]; type = ext ? 'Tệp ' + ext.toUpperCase() : 'Tệp'; }
    const arias = [...el.querySelectorAll('[aria-label]')].map((e) => e.getAttribute('aria-label') || '');
    const pick = (re) => arias.find((a) => re.test(a));
    return {
      id, el, isFolder, sharedFolder, name: label || 'Không rõ tên', type,
      owner: (pick(/^(Người sở hữu|Owner)\s*:/i) || '').split(':').slice(1).join(':').trim(),
      mod: (pick(/^(Lần sửa đổi gần đây nhất|Last modified)/i) || '').replace(/^(Lần sửa đổi gần đây nhất|Last modified)\s*/i, '').trim(),
      size: (((pick(/^(Kích thước|Size)\s*:/i) || '').split('\n')[0].split(':')[1]) || '').trim(),
      kind: kindOf(type, label, isFolder),
    };
  }
  function kindOf(type, name, isFolder) {
    const t = (type + ' ' + name).toLowerCase();
    if (isFolder) return 'folder';
    if (/google (tài liệu|docs)/.test(t)) return 'gdoc';
    if (/google (trang tính|sheets)/.test(t)) return 'gsheet';
    if (/google (trang trình bày|slides)/.test(t)) return 'gslide';
    if (/excel|sheet|\.xlsx?$|\.csv$/.test(t)) return 'sheet';
    if (/image|hình|png|jpe?g|svg|webp|gif/.test(t)) return 'image';
    if (/video|mp4|mov|webm/.test(t)) return 'video';
    if (/zip|rar|7z|nén|archive/.test(t)) return 'zip';
    return 'file';
  }
  const SPRITE_OF = { folder: 'folder', gdoc: 'file', gsheet: 'chart', gslide: 'file', sheet: 'chart', image: 'image', video: 'video', zip: 'database', file: 'file' };

  function collect(sel) {
    const seen = new Set(), out = [];
    document.querySelectorAll(sel).forEach((el) => {
      const id = el.getAttribute('data-id');
      if (!id || seen.has(id) || !visible(el)) return;
      seen.add(id); out.push(readItem(el));
    });
    return out;
  }
  const getSelected = () => collect(ITEM_SEL + '[aria-selected="true"]');
  const getVisibleItems = () => collect(ITEM_SEL);
  const findItemEl = (id) => [...document.querySelectorAll(`[data-id="${CSS.escape(id)}"][data-target="doc"]`)].find(visible);

  function currentFolderName() { return document.title.replace(/\s*[-–]\s*Google Drive\s*$/i, '').trim() || 'Drive của tôi'; }
  function currentPath() { const f = currentFolderName(); return /^(Drive của tôi|My Drive)$/i.test(f) ? 'Drive của tôi' : `Drive › ${f}`; }
  function currentFolderId() {
    const p = location.pathname;
    const m = p.match(/\/folders\/([-\w]{10,})/);
    if (m) return m[1];
    if (/\/my-drive\/?$/.test(p)) return 'root';
    return null; // Gần đây, Được chia sẻ, Tìm kiếm… không quét được theo thư mục
  }
  function accountEmail() {
    for (const a of document.querySelectorAll('a[aria-label*="@"]')) {
      const m = (a.getAttribute('aria-label') || '').match(/\(([^()\s]+@[^()\s]+)\)/);
      if (m) return m[1];
    }
    return '';
  }
  let storageCache = null, storageAt = 0;
  function domStorage() {
    if (storageCache && Date.now() - storageAt < 30000) return storageCache;
    const re = /(?:Đã sử dụng|Used)\s+([\d.,]+\s*[KMGT]?B)\s+(?:trong tổng số|of)\s+([\d.,]+\s*[KMGT]?B)/i;
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n, m = null;
    while ((n = w.nextNode())) { const t = n.nodeValue; if (t && t.length <= 80 && (m = t.match(re))) break; }
    storageCache = m ? { used: m[1], total: m[2], pct: Math.min(100, Math.round((parseSize(m[1]) / (parseSize(m[2]) || 1)) * 100)) } : null;
    storageAt = Date.now();
    return storageCache;
  }

  /* ================================================================
     DỮ LIỆU
     ================================================================ */
  const DS = {
    mode: 'demo',          // 'demo' | 'live'
    me: null,              // {emailAddress, displayName} từ Drive API
    quota: null,           // storageQuota từ Drive API
    details: {},           // id -> {status:'loading'|'ok'|'error', data, error, at}
    scans: {},             // folderId -> {status, data, error, at}
    setup: null,           // {extId} khi chưa có OAuth Client ID
  };
  const live = () => DS.mode === 'live';

  /* ───── Dữ liệu mẫu (ổn định theo id tệp) ───── */
  const EMAIL_POOL = [
    ['minhanh.design@gmail.com', 'Người chỉnh sửa'], ['trungkien.mkt@gmail.com', 'Người xem'],
    ['ketoan.wistorix@gmail.com', 'Người chỉnh sửa'], ['phulong.dev@gmail.com', 'Người xem'],
    ['agency.media.vn@gmail.com', 'Người xem'], ['thuha.review@gmail.com', 'Người bình luận'],
  ];
  const DUP_PLACES = ['00_Backup', 'Archive', 'Bản cũ', '08_Share', 'Tải lên từ máy tính'];
  let overrides = {};
  function demoMeta(item) {
    const h = hash(item.id);
    const base = { pub: !item.isFolder && h % 4 === 0, emails: [], dups: [], created: `${String(1 + (h % 28)).padStart(2, '0')} thg ${1 + ((h >>> 7) % 9)}, 2026`, starred: false };
    let nE = (h >>> 3) % 4; if (item.sharedFolder && nE === 0) nE = 2;
    const used = new Set();
    for (let i = 0; i < nE; i++) {
      let k = (h >>> (5 + i * 3)) % EMAIL_POOL.length;
      while (used.has(k)) k = (k + 1) % EMAIL_POOL.length;
      used.add(k); base.emails.push({ e: EMAIL_POOL[k][0], r: EMAIL_POOL[k][1] });
    }
    if (!item.isFolder && h % 5 === 1) {
      const nd = 1 + ((h >>> 9) % 2);
      for (let i = 0; i < nd; i++) base.dups.push({ path: 'Drive của tôi › ' + DUP_PLACES[(h >>> (11 + i * 2)) % DUP_PLACES.length], size: item.size || '—', date: `${String(1 + ((h >>> (4 + i)) % 28)).padStart(2, '0')} thg ${1 + ((h >>> (13 + i)) % 8)}, 2026` });
    }
    return Object.assign(base, overrides[item.id] || {});
  }
  function setOverride(id, patch) { overrides[id] = Object.assign({}, overrides[id] || {}, patch); store.set('wx_overrides', overrides); }

  /* ───── View model thống nhất cho cả 2 chế độ ───── */
  function view(item) {
    const me = (DS.me && DS.me.emailAddress) || accountEmail();
    const base = {
      id: item.id, isFolder: item.isFolder, kind: item.kind, name: item.name, type: item.type,
      size: item.size, mod: item.mod || '—', created: '—', path: currentPath(),
      owner: !item.owner || /^(tôi|me)$/i.test(item.owner) ? `Bạn${me ? ' (' + me + ')' : ''}` : item.owner,
      pub: false, publicLabel: '', emails: [], dups: [], starred: false, canSeePerms: true,
    };
    if (!live()) {
      const m = demoMeta(item);
      return Object.assign(base, {
        name: m.name || item.name, path: m.path || base.path, created: m.created, pub: m.pub,
        publicLabel: 'Bất kỳ ai có đường liên kết đều xem được.', emails: m.emails, dups: m.dups, starred: !!m.starred,
      });
    }
    const d = DS.details[item.id];
    if (!d || d.status === 'loading') return Object.assign(base, { loading: true });
    if (d.status === 'error') return Object.assign(base, { error: d.error });
    const f = d.data.file, perms = d.data.perms || [];
    const pubPerms = perms.filter((p) => p.type === 'anyone' || p.type === 'domain');
    const owner = (f.owners || [])[0];
    return Object.assign(base, {
      name: f.name, size: f.size ? fmtSize(f.size) : (f.quotaBytesUsed && +f.quotaBytesUsed ? fmtSize(f.quotaBytesUsed) : (item.isFolder ? '—' : 'Không tính dung lượng')),
      mod: fmtDate(f.modifiedTime), created: fmtDate(f.createdTime), path: d.data.path, starred: !!f.starred,
      owner: owner ? (owner.me ? `Bạn (${owner.emailAddress})` : `${owner.displayName || ''} (${owner.emailAddress || ''})`) : 'Bộ nhớ dùng chung',
      pub: pubPerms.length > 0,
      publicLabel: pubPerms.map((p) => (p.type === 'anyone' ? 'Bất kỳ ai có đường liên kết' : `Mọi người trong ${p.domain}`) + ` (${p.roleVi.toLowerCase()})`).join(' · '),
      emails: perms.filter((p) => (p.type === 'user' || p.type === 'group') && p.role !== 'owner')
        .map((p) => ({ e: p.emailAddress || p.displayName || '—', r: p.roleVi + (p.expirationTime ? ' · hết hạn ' + fmtDate(p.expirationTime) : ''), permId: p.id })),
      dups: (d.data.dups || []).map((x) => ({ id: x.id, path: x.path, size: x.size ? fmtSize(x.size) : '—', date: fmtDate(x.modifiedTime), exact: x.exact, ownedByMe: x.ownedByMe })),
      canSeePerms: d.data.canSeePerms, caps: f.capabilities || {},
    });
  }

  /* ───── Nạp dữ liệu thật ───── */
  function ensureDetails(id, force) {
    if (!live() || !id) return;
    const d = DS.details[id];
    if (!force && d && (d.status === 'loading' || (d.status === 'ok' && Date.now() - d.at < 30e3))) return;
    DS.details[id] = { status: 'loading', at: Date.now() };
    api('details', { id })
      .then((data) => { DS.details[id] = { status: 'ok', data, at: Date.now() }; })
      .catch((e) => { DS.details[id] = { status: 'error', error: e.message, at: Date.now() }; handleAuthError(e); })
      .finally(() => { if (isOpen() && state.current && state.current.id === id) render(); });
  }
  function ensureScan(force) {
    if (!live()) return;
    const fid = currentFolderId(); if (!fid) { updateBadge(); return; }
    const s = DS.scans[fid];
    if (!force && s && (s.status === 'loading' || (s.status === 'ok' && Date.now() - s.at < CFG.scanTtl))) return;
    DS.scans[fid] = { status: 'loading', at: Date.now() };
    return api('scanFolder', { folderId: fid })
      .then((data) => { DS.scans[fid] = { status: 'ok', data, at: Date.now() }; })
      .catch((e) => { DS.scans[fid] = { status: 'error', error: e.message, at: Date.now() }; handleAuthError(e); })
      .finally(() => { updateBadge(); if (isOpen() && !state.current) render(); });
  }
  function refreshAbout() {
    if (!live()) return;
    api('about').then((a) => { DS.me = a.user; DS.quota = a.storageQuota; if (isOpen()) render(); }).catch(handleAuthError);
  }
  function handleAuthError(e) {
    if (e && e.code === 'AUTH') { DS.mode = 'demo'; store.set('wx_mode', 'demo'); toast('Phiên đăng nhập Google Drive đã hết. Bấm <b>Kết nối</b> để đăng nhập lại.'); if (isOpen()) render(); }
  }
  function invalidate(ids) {
    (ids || []).forEach((id) => { delete DS.details[id]; });
    const fid = currentFolderId(); if (fid) delete DS.scans[fid];
  }

  /* Các tệp "cần xử lý" trong thư mục đang mở */
  function issueList() {
    if (!live()) {
      return getVisibleItems().filter((i) => !i.isFolder).map((i) => ({ it: i, m: demoMeta(i) }))
        .filter((x) => x.m.pub || x.m.dups.length)
        .map((x) => ({ id: x.it.id, name: x.m.name || x.it.name, pub: x.m.pub, emails: x.m.emails.length, dup: x.m.dups.length ? x.m.dups.length + 1 : 0, size: x.it.size }));
    }
    const fid = currentFolderId(); const s = fid && DS.scans[fid];
    if (!s || s.status !== 'ok') return [];
    return Object.entries(s.data.issues).map(([id, x]) => ({ id, name: x.name, pub: x.pub, emails: 0, dup: x.dup, size: x.size ? fmtSize(x.size) : '' }))
      .sort((a, b) => (b.pub - a.pub) || (b.dup - a.dup));
  }

  /* ================================================================
     DỰNG UI (Shadow DOM)
     ================================================================ */
  const host = document.createElement('wistorix-widget');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483600;';
  const root = host.attachShadow({ mode: 'open' });
  const $ = (id) => root.getElementById(id);

  const state = {
    current: null, bulk: [], lastSel: '',
    open: { perm: false, dup: false, storage: false },
    dupKeep: {}, pickedFolder: null, inline: null, dragItem: null,
    armed: null, busy: false,
  };

  async function boot() {
    if (hasExt) {
      const st = document.createElement('style');
      st.id = 'wistorix-font';
      st.textContent = `@font-face{font-family:'WX Manrope';src:url('${extUrl('fonts/Manrope-Variable.woff2')}') format('woff2');font-weight:200 800;font-style:normal;font-display:swap}`;
      (document.head || document.documentElement).appendChild(st);
    }
    let css, sprite;
    if (TEST) { css = TEST.css; sprite = TEST.sprite; }
    else [css, sprite] = await Promise.all([fetch(extUrl('widget.css')).then((r) => r.text()), fetch(extUrl('sprite.svg')).then((r) => r.text())]);
    overrides = await store.get('wx_overrides', {});
    const pos = await store.get('wx_bubble', null);

    root.innerHTML = `<style>${css}</style>${sprite}
      <div id="wxBubble" role="button" aria-label="Wistorix">${LOGO}<span id="wxBadge" style="display:none">0</span></div>
      <div id="wxTip"></div>
      <div id="wxQuick">
        <div class="qh">${IC('file')}<span id="wxQuickName">—</span></div>
        <button data-act="quick" data-sec="move">${IC('folder-in')} Di chuyển tới thư mục…</button>
        <button data-act="quick" data-sec="perm">${IC('key')} Quản lý quyền truy cập</button>
        <button data-act="quick" data-sec="dup">${IC('layers')} Kiểm tra trùng lặp</button>
        <button data-act="quick" data-sec="info">${IC('info')} Xem thông tin chi tiết</button>
      </div>
      <aside id="wxPanel" aria-label="Wistorix">
        <div class="wx-head">
          <div class="mini">${LOGO}</div>
          <div class="t"><b>Wistorix<span class="wx-pill" id="wxPill"></span></b><span id="wxAcct">—</span></div>
          <button class="wx-x" data-act="close" aria-label="Đóng">${IC('x')}</button>
        </div>
        <div class="wx-body" id="wxBody"></div>
        <div class="wx-foot"><div class="wx-footnote" id="wxFootNote"></div><button class="wx-dash" data-act="dashboard">${IC('grid')} Mở dashboard Wistorix đầy đủ</button></div>
      </aside>
      <div id="wxToast"></div>`;
    document.documentElement.appendChild(host);

    initBubble(pos);
    wireEvents();
    observeDrive();

    // khôi phục chế độ Drive thật nếu lần trước đã kết nối
    if ((await store.get('wx_mode', 'demo')) === 'live') {
      try {
        const st = await api('status');
        if (st.ready && st.connected) { DS.mode = 'live'; refreshAbout(); ensureScan(); }
      } catch (e) { /* ở lại chế độ mẫu */ }
    }
    sync(true);
  }

  /* ───────── BONG BÓNG ───────── */
  let bx = 0, by = 0, bxBeforePanel = null;
  const rightX = () => window.innerWidth - 58 - CFG.rightGap;
  function placeBubble() { const b = $('wxBubble'); b.style.left = bx + 'px'; b.style.top = by + 'px'; }
  function initBubble(pos) {
    const b = $('wxBubble');
    bx = pos && pos.side === 'left' ? 14 : rightX();
    by = Math.max(74, Math.min(window.innerHeight - 72, pos && typeof pos.y === 'number' ? pos.y : window.innerHeight - 170));
    placeBubble();

    let drag = false, moved = false, offX = 0, offY = 0;
    b.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      drag = true; moved = false; offX = e.clientX - bx; offY = e.clientY - by;
      $('wxTip').style.opacity = 0;
      b.setPointerCapture(e.pointerId); b.classList.remove('snap');
    });
    b.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const nx = e.clientX - offX, ny = e.clientY - offY;
      if (Math.abs(nx - bx) + Math.abs(ny - by) > 4) moved = true;
      if (moved) { b.classList.add('dragging'); bx = nx; by = ny; placeBubble(); }
    });
    b.addEventListener('pointerup', () => {
      if (!drag) return;
      drag = false; b.classList.remove('dragging');
      if (!moved) { togglePanel(); return; }
      b.classList.add('snap');
      const left = bx + 29 < window.innerWidth / 2;
      bx = left ? 14 : rightX();
      by = Math.max(74, Math.min(window.innerHeight - 72, by));
      bxBeforePanel = null; placeBubble();
      store.set('wx_bubble', { side: left ? 'left' : 'right', y: by });
    });
    b.addEventListener('mouseenter', () => {
      if (drag) return;
      const tip = $('wxTip');
      tip.textContent = state.current ? 'Wistorix: ' + state.current.name : 'Wistorix: Direct Interface';
      const r = b.getBoundingClientRect(), onRight = r.left > window.innerWidth / 2;
      tip.style.top = (r.top + 18) + 'px';
      tip.style.left = onRight ? 'auto' : (r.right + 10) + 'px';
      tip.style.right = onRight ? (window.innerWidth - r.left + 10) + 'px' : 'auto';
      tip.style.opacity = 1;
    });
    b.addEventListener('mouseleave', () => { $('wxTip').style.opacity = 0; });

    b.addEventListener('dragenter', (e) => { e.preventDefault(); b.classList.add('dropTarget'); });
    b.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; b.classList.add('dropTarget'); });
    b.addEventListener('dragleave', () => b.classList.remove('dropTarget'));
    b.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation(); b.classList.remove('dropTarget');
      $('wxTip').style.opacity = 0;
      let it = state.dragItem;
      if (!it && e.dataTransfer) {
        const raw = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '';
        const id = (raw.match(/[-\w]{25,}/) || [])[0];
        const el = id && findItemEl(id);
        if (el) it = readItem(el);
      }
      state.dragItem = null;
      if (!it) { toast('Không nhận được tệp. Hãy chọn tệp rồi bấm vào bong bóng.'); return; }
      setCurrent(it); showQuick(it);
    });
  }
  function showQuick(it) {
    const q = $('wxQuick'), r = $('wxBubble').getBoundingClientRect();
    $('wxQuickName').textContent = it.name;
    q.classList.add('show');
    q.style.top = Math.min(window.innerHeight - 210, r.top) + 'px';
    q.style.left = r.left > window.innerWidth / 2 ? (r.left - 264) + 'px' : (r.right + 12) + 'px';
  }
  const hideQuick = () => $('wxQuick').classList.remove('show');

  /* ───────── PANEL ───────── */
  const isOpen = () => $('wxPanel').classList.contains('open');
  function dodgeBubble() {
    const panelLeft = window.innerWidth - 388;
    if (bx > panelLeft - 70) { bxBeforePanel = bx; $('wxBubble').classList.add('snap'); bx = panelLeft - 74; placeBubble(); }
  }
  function openPanel() {
    if (isOpen()) return;
    if (state.current) ensureDetails(state.current.id);
    ensureScan();
    render(); $('wxPanel').classList.add('open'); dodgeBubble();
  }
  function closePanel() {
    $('wxPanel').classList.remove('open'); state.inline = null; state.armed = null;
    if (bxBeforePanel !== null) { $('wxBubble').classList.add('snap'); bx = bxBeforePanel; placeBubble(); bxBeforePanel = null; }
  }
  function togglePanel() { isOpen() ? closePanel() : openPanel(); }

  /* nút cần bấm 2 lần mới chạy (thao tác thật không hoàn tác được) */
  const isArmed = (key) => state.armed && state.armed.key === key && Date.now() - state.armed.t < 4000;
  function arm(key) {
    state.armed = { key, t: Date.now() }; render();
    setTimeout(() => { if (state.armed && state.armed.key === key) { state.armed = null; if (isOpen()) render(); } }, 4000);
  }
  const lbl = (key, normal, confirm = 'Bấm lần nữa để xác nhận') => (isArmed(key) ? confirm : normal);
  function needConfirm(key) { if (!live()) return false; if (isArmed(key)) { state.armed = null; return false; } arm(key); return true; }

  function grp(icon, title, body, cnt, warn, id, drop) {
    const closed = drop && !state.open[id];
    return `<div class="grp ${drop ? 'drop' : ''} ${closed ? 'closed' : ''}" ${id ? `id="sec-${id}"` : ''}>
      <div class="grp-h" ${drop ? `data-act="grp" data-id="${id}"` : ''}>${IC(icon)}<span>${title}</span>
        ${cnt != null ? `<span class="cnt ${warn ? 'warn' : ''}">${cnt}</span>` : ''}
        ${drop ? `<span class="chev" ${cnt == null ? 'style="margin-left:auto"' : ''}>▾</span>` : ''}</div>
      <div class="grp-b">${body}</div></div>`;
  }
  const loadingBox = () => `<div class="wx-loading"><i></i><i></i><i></i> Đang tải từ Google Drive…</div>`;

  function storageSec(drop) {
    let body;
    if (live() && DS.quota) {
      const lim = +DS.quota.limit || 0, use = +DS.quota.usage || 0, pct = lim ? Math.min(100, Math.round((use / lim) * 100)) : 0;
      body = `<div class="wx-snum"><span>Đã dùng <b>${fmtSize(use)}</b> / ${lim ? fmtSize(lim) : 'Không giới hạn'}</span><span>${pct}%</span></div>
        <div class="wx-sbar"><i style="width:${pct}%"></i></div>
        ${+DS.quota.usageInDriveTrash ? `<div class="wx-note">Thùng rác đang chiếm ${fmtSize(DS.quota.usageInDriveTrash)}.</div>` : ''}`;
    } else {
      const s = domStorage();
      body = s ? `<div class="wx-snum"><span>Đã dùng <b>${esc(s.used)}</b> / ${esc(s.total)}</span><span>${s.pct}%</span></div><div class="wx-sbar"><i style="width:${s.pct}%"></i></div>`
        : `<div class="wx-note">Không đọc được dung lượng. Mở mục "Bộ nhớ" ở thanh bên trái của Drive.</div>`;
    }
    let free = 0, label;
    if (live()) {
      const fid = currentFolderId(), s = fid && DS.scans[fid];
      if (!fid) label = 'Mở 1 thư mục để quét trùng lặp';
      else if (!s || s.status === 'loading') label = 'Đang quét thư mục này…';
      else if (s.status === 'error') label = 'Chưa quét được thư mục này';
      else { free = s.data.freeBytes; label = free ? 'Có thể giải phóng ~' + fmtSize(free) : `Không có bản trùng trong ${s.data.total} mục`; }
    } else {
      getVisibleItems().filter((i) => !i.isFolder).forEach((i) => { const m = demoMeta(i); if (m.dups.length) free += parseSize(i.size) * m.dups.length; });
      label = free ? 'Có thể giải phóng ~' + fmtSize(free) : 'Quét thư mục này để tìm bản trùng';
    }
    return grp('database', 'Dung lượng Drive', body + `
      <div class="wx-free"><span>${label}</span><button class="wx-scan" data-act="scan">${IC('refresh')} Quét thư mục này</button></div>`,
      null, false, 'storage', !!drop);
  }

  function topNotices() {
    let h = '';
    if (DS.setup) {
      h += `<div class="wx-setup"><b>${IC('key')} Cần 1 bước cấu hình trước khi nối Drive thật</b>
        <ol><li>Google Cloud Console → <i>APIs &amp; Services → Credentials</i> → <i>Create credentials → OAuth client ID</i></li>
        <li>Application type: <b>Chrome Extension</b>, Item ID:<br><code>${esc(DS.setup.extId)}</code> <a data-act="copy-extid">Copy</a></li>
        <li>Dán Client ID vào <code>manifest.json</code> → <code>oauth2.client_id</code>, rồi bấm ↻ tải lại extension</li></ol>
        <button data-act="connect" ${state.busy ? 'disabled' : ''}>Thử kết nối lại</button></div>`;
    }
    if (!live() && CFG.showDemoPill && !DS.setup) {
      h += `<div class="wx-mode">${IC('database')}<div><b>Đang dùng dữ liệu mẫu</b>Kết nối Google Drive để xem quyền chia sẻ, trùng lặp thật và thao tác trực tiếp.</div>
        <button data-act="connect" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Đang mở…' : 'Kết nối'}</button></div>`;
    }
    if (live() && DS.me && accountEmail() && DS.me.emailAddress.toLowerCase() !== accountEmail().toLowerCase()) {
      h += `<div class="wx-warn">${IC('alert')}<div><b>Khác tài khoản</b>Widget đang kết nối <b>${esc(DS.me.emailAddress)}</b> (tài khoản Chrome), còn tab Drive đang mở <b>${esc(accountEmail())}</b>. Kết quả có thể không khớp với tệp bạn thấy.</div></div>`;
    }
    return h;
  }

  function render() {
    const acct = (live() && DS.me && DS.me.emailAddress) || accountEmail() || 'Tài khoản Google';
    $('wxAcct').textContent = acct;
    const pill = $('wxPill');
    pill.textContent = live() ? 'DRIVE THẬT' : 'DỮ LIỆU MẪU';
    pill.style.display = live() || CFG.showDemoPill ? '' : 'none';
    $('wxFootNote').innerHTML = live() ? `Đã kết nối Google Drive · <a data-act="disconnect">Ngắt kết nối</a>` : '';

    let html = topNotices();

    if (state.bulk.length > 1) {
      const n = state.bulk.length;
      html += `<div class="wx-bulk"><b>${IC('check')} ${n} tệp đang chọn trên Drive</b>
        <div class="row">
          <button data-act="bulk-move">${IC('folder-in')} Di chuyển</button>
          <button data-act="bulk-revoke">${IC('lock')} ${lbl('bulk-revoke', 'Thu hồi link', 'Bấm lần nữa')}</button>
          <button data-act="bulk-trash">${IC('trash')} ${lbl('bulk-trash', 'Xóa', 'Bấm lần nữa')}</button>
        </div>
        ${state.inline === 'bulk-move' ? `<div class="wx-inline show"><div class="wx-tree">${folderTree(null)}</div>
          <div class="row"><button data-act="inline-cancel">Hủy</button><button class="pri" data-act="move" data-bulk="1">Di chuyển ${n} tệp tới đây</button></div></div>` : ''}
      </div>`;
    }

    const f = state.current;
    const b = $('wxBody');
    if (!f) {
      const list = issueList();
      const fid = currentFolderId(), sc = live() && fid ? DS.scans[fid] : null;
      html += `<div class="wx-empty">Chưa chọn tệp nào. <b>Bấm chọn 1 tệp trên Drive</b> hoặc <b>kéo tệp thả vào bong bóng</b> để xem chi tiết và thao tác nhanh.</div>`;
      let body;
      if (live() && !fid) body = `<div class="wx-note">Mở "Drive của tôi" hoặc một thư mục để Wistorix quét tệp công khai và trùng lặp.</div>`;
      else if (sc && sc.status === 'loading') body = loadingBox();
      else if (sc && sc.status === 'error') body = `<div class="wx-note">Không quét được: ${esc(sc.error)}</div>`;
      else {
        body = list.slice(0, 8).map((x) => {
          const desc = x.pub ? `đang công khai${x.emails ? ' · chia sẻ với ' + x.emails + ' email' : ''}${x.dup ? ' · trùng ×' + x.dup : ''}` : `trùng lặp ×${x.dup}${x.size ? ' · ' + esc(x.size) + ' mỗi bản' : ''}`;
          return `<div class="wx-alert" data-act="pick" data-id="${esc(x.id)}" data-name="${esc(x.name)}"><div class="ai ${x.pub ? 'r' : 'a'}">${IC(x.pub ? 'globe' : 'copy')}</div>
            <div class="am"><b>${esc(x.name)}</b>${desc}</div><span class="go">${IC('chev-r')}</span></div>`;
        }).join('') || `<div class="wx-only">${IC('check-circle')} Không có tệp nào cần xử lý trong thư mục đang xem.</div>`;
        if (list.length > 8) body += `<div class="wx-note">…và ${list.length - 8} tệp khác. Xem hết trên dashboard.</div>`;
      }
      html += grp('alert', 'Cần xử lý trong thư mục này', body, list.length || null, list.length > 0);
      html += storageSec(false);
      b.innerHTML = html; return;
    }

    const v = view(f);
    if (!(f.id in state.dupKeep) || state.dupKeep[f.id].length !== v.dups.length) state.dupKeep[f.id] = v.dups.map(() => false);
    const spr = SPRITE_OF[v.kind] || 'file';

    html += `<button class="wx-back" data-act="overview">${IC('chev-r')} Tổng quan thư mục</button>`;

    html += grp(v.isFolder ? 'folder' : 'file', v.isFolder ? 'Thư mục đang chọn' : 'Tệp đang chọn', `
      <div class="wx-fcard"><div class="ftile">${IC(spr)}</div><div>
        <div class="fn">${esc(v.name)}</div>
        <div class="fp">${esc(v.path)} · <a data-act="open">Mở ${v.isFolder ? 'thư mục' : 'tệp'} ${IC('external')}</a></div>
        <div class="wx-flags">
          ${v.loading ? '<span class="chip dk-ok">ĐANG TẢI…</span>'
            : v.pub ? `<span class="chip dk-pub">${IC('globe')}CÔNG KHAI</span>`
            : v.emails.length ? `<span class="chip dk-dup">${IC('users')}CHIA SẺ ${v.emails.length}</span>`
            : `<span class="chip dk-ok">${IC('lock')}RIÊNG TƯ</span>`}
          ${v.dups.length ? `<span class="chip dk-dup">${IC('copy')}TRÙNG ×${v.dups.length + 1}</span>` : ''}
          ${v.starred ? `<span class="chip dk-ok">${IC('star')}CÓ SAO</span>` : ''}
        </div></div></div>`);

    html += grp('zap', 'Hành động nhanh', `
      <div class="wx-acts">
        <button class="wx-act" data-act="copy">${IC('link')}<span class="l">Copy link</span></button>
        <button class="wx-act" data-act="inline" data-which="rename">${IC('edit')}<span class="l">Đổi tên</span></button>
        <button class="wx-act" data-act="inline" data-which="move">${IC('folder-in')}<span class="l">Di chuyển</span></button>
        <button class="wx-act" data-act="star">${IC('star')}<span class="l">${v.starred ? 'Bỏ sao' : 'Dấu sao'}</span></button>
        <button class="wx-act" data-act="download" ${v.isFolder ? 'disabled' : ''}>${IC('download')}<span class="l">Tải về</span></button>
        <button class="wx-act dngr" data-act="trash">${IC('trash')}<span class="l">${lbl('trash', 'Xóa', 'Chắc chắn?')}</span></button>
      </div>
      <div class="wx-inline ${state.inline === 'rename' ? 'show' : ''}" id="inlineRename">
        <input id="renameInput" value="${esc(v.name)}" spellcheck="false">
        <div class="row"><button data-act="inline-cancel">Hủy</button><button class="pri" data-act="rename">Lưu tên mới</button></div>
      </div>
      <div class="wx-inline ${state.inline === 'move' ? 'show' : ''}" id="inlineMove">
        <div class="wx-tree">${folderTree(f)}</div>
        <div class="row"><button data-act="inline-cancel">Hủy</button><button class="pri" data-act="move">Di chuyển tới đây</button></div>
      </div>`);

    html += grp('info', 'Thông tin', `
      <div class="wx-kv"><span class="k">Loại</span><span class="v">${esc(v.type)}</span></div>
      <div class="wx-kv"><span class="k">Kích thước</span><span class="v">${esc(v.size || (v.isFolder ? '—' : (live() ? '…' : 'Xem ở chế độ danh sách')))}</span></div>
      <div class="wx-kv"><span class="k">Chủ sở hữu</span><span class="v">${esc(v.owner)}</span></div>
      <div class="wx-kv"><span class="k">Ngày tạo</span><span class="v">${esc(v.created)}</span></div>
      <div class="wx-kv"><span class="k">Sửa đổi gần nhất</span><span class="v">${esc(v.mod)}</span></div>
      <div class="wx-kv"><span class="k">Vị trí</span><span class="v" style="font-size:11px">${esc(v.path)}</span></div>`,
      null, false, 'info');

    /* Bảo mật & chia sẻ */
    let perm = '';
    if (v.loading) perm = loadingBox();
    else if (v.error) perm = `<div class="wx-warn">${IC('alert')}<div><b>Không tải được</b>${esc(v.error)}<button data-act="retry">${IC('refresh')} Thử lại</button></div></div>`;
    else if (!v.canSeePerms) perm = `<div class="wx-only">${IC('info')} Bạn không có quyền xem danh sách chia sẻ của tệp này (chỉ chủ sở hữu hoặc người chỉnh sửa mới xem được).</div>`;
    else {
      if (v.pub) {
        perm += `<div class="wx-warn">${IC('globe')}<div><b>${v.isFolder ? 'Thư mục' : 'Tệp'} đang công khai!</b>${esc(v.publicLabel)}
          <button data-act="revoke-public">${IC('lock')} ${lbl('revoke-public', 'Thu hồi tất cả link công khai')}</button></div></div>`;
      }
      if (v.emails.length) {
        perm += v.emails.map((x, i) => `<div class="wx-em"><div class="av">${esc((x.e[0] || '?').toUpperCase())}</div>
          <div class="em"><b>${esc(x.e)}</b><span>${esc(x.r)}</span></div>
          <button class="wx-rv" data-act="revoke-email" data-i="${i}">${lbl('revoke-email:' + i, 'Thu hồi', 'Chắc chắn?')}</button></div>`).join('');
      } else if (!v.pub) perm += `<div class="wx-only">${IC('check-circle')} Chỉ mình bạn có quyền truy cập.</div>`;
      perm += `<div class="wx-sub">
        <div class="wx-expiry">${IC('clock')} Thời hạn chia sẻ
          <select data-act="expiry" ${v.emails.length ? '' : 'disabled'}><option value="0">Không giới hạn</option><option value="7">7 ngày</option><option value="30">30 ngày</option><option value="90">90 ngày</option></select></div>
        <div class="wx-link" data-act="transfer">${IC('crown')} Chuyển quyền sở hữu ${IC('chev-r')}</div>
      </div>`;
    }
    html += grp('key', 'Bảo mật & chia sẻ', perm, v.loading ? null : ((v.emails.length + (v.pub ? 1 : 0)) || null), v.pub, 'perm', true);

    /* Trùng lặp */
    if (!v.isFolder) {
      if (v.loading) html += grp('copy', 'Trùng lặp', loadingBox(), null, false, 'dup', true);
      else if (v.dups.length) {
        const keep = state.dupKeep[f.id];
        html += grp('copy', 'Trùng lặp', `
          <div class="wx-dup keep"><span class="di">${IC(spr)}</span><div class="dm"><b>Bản này (đang xem)</b>${esc(v.path)}<br>${esc(v.size || '—')} · ${esc(v.mod)}</div><button class="tg">GIỮ</button></div>
          ${v.dups.map((d, i) => `<div class="wx-dup ${keep[i] ? 'keep' : ''}">
            <span class="di">${IC(spr)}</span><div class="dm"><b>Bản sao ${i + 1}${d.exact === false ? ' (cùng tên)' : ''}</b>${esc(d.path)}<br>${esc(d.size)} · ${esc(d.date)}</div>
            <button class="tg" data-act="dup-toggle" data-i="${i}">${keep[i] ? 'GIỮ' : 'XÓA?'}</button></div>`).join('')}
          <button class="wx-dupbtn" data-act="dup-delete">${IC('trash')} ${lbl('dup-delete', 'Xóa các bản không giữ (luôn giữ lại ít nhất 1 bản)')}</button>
          <div class="wx-note">Tệp xoá sẽ vào Thùng rác Google Drive, khôi phục được trong 30 ngày.</div>`,
          (v.dups.length + 1) + ' bản', true, 'dup', true);
      } else html += grp('copy', 'Trùng lặp', `<div class="wx-only">${IC('check-circle')} Không tìm thấy bản trùng lặp nào của tệp này.</div>`, null, false, 'dup', true);
    }

    html += storageSec(true);
    b.innerHTML = html;
    if (state.inline === 'rename') { const i = $('renameInput'); if (i) { i.focus(); i.select(); } }
  }

  function folderTree(f) {
    const folders = getVisibleItems().filter((i) => i.isFolder && (!f || i.id !== f.id));
    const nodes = [{ id: 'root', name: 'Drive của tôi', d: 0 }].concat(folders.map((x) => ({ id: x.id, name: x.name, d: 1 })));
    return nodes.map((n) => `<div class="wx-tnode ${state.pickedFolder && state.pickedFolder.id === n.id ? 'sel' : ''}" data-act="pick-folder" data-id="${esc(n.id)}" data-name="${esc(n.name)}"><span class="pad" style="width:${n.d * 15}px"></span>${IC('folder')} ${esc(n.name)}</div>`).join('')
      + (folders.length ? '' : `<div class="wx-tnote">Mở thư mục cha trên Drive để thấy thêm thư mục đích.</div>`);
  }

  /* ───────── HÀNH ĐỘNG ───────── */
  function setCurrent(it) {
    state.current = it; state.inline = null; state.pickedFolder = null; state.armed = null;
    ensureDetails(it.id);
    if (isOpen()) render();
  }
  function flash(el) {
    const o = el.style.outline, oo = el.style.outlineOffset;
    el.style.outline = '3px solid #058EF4'; el.style.outlineOffset = '2px';
    setTimeout(() => { el.style.outline = o; el.style.outlineOffset = oo; }, 1400);
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0';
      root.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (_) { /* */ } ta.remove(); return ok;
    }
  }
  const openUrl = (id, isFolder) => (isFolder ? `https://drive.google.com/drive/folders/${id}` : `https://drive.google.com/open?id=${id}`);
  function downloadUrl(it) {
    if (it.isFolder) return null;
    if (it.kind === 'gdoc') return `https://docs.google.com/document/d/${it.id}/export?format=docx`;
    if (it.kind === 'gsheet') return `https://docs.google.com/spreadsheets/d/${it.id}/export?format=xlsx`;
    if (it.kind === 'gslide') return `https://docs.google.com/presentation/d/${it.id}/export/pptx`;
    return `https://drive.google.com/uc?export=download&id=${it.id}`;
  }

  /* chạy 1 thao tác Drive thật: khoá nút, báo lỗi, làm mới dữ liệu */
  async function runLive(fn, okMsg, ids) {
    if (state.busy) return;
    state.busy = true; toast('Đang xử lý trên Google Drive…', 60000);
    try {
      const r = await fn();
      invalidate(ids);
      (ids || []).forEach((id) => { if (state.current && state.current.id === id) ensureDetails(id, true); });
      ensureScan(true);
      toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
    } catch (e) {
      handleAuthError(e);
      toast('Không thực hiện được: <b>' + esc(e.message) + '</b>');
    } finally { state.busy = false; if (isOpen()) render(); }
  }

  async function onAction(act, el) {
    const f = state.current;
    const v = f ? view(f) : null;
    switch (act) {
      case 'close': closePanel(); break;
      case 'dashboard': case 'transfer': window.open(CFG.dashboardUrl, '_blank', 'noopener'); break;
      case 'grp': state.open[el.dataset.id] = !state.open[el.dataset.id]; render(); break;
      case 'overview': state.current = null; state.inline = null; ensureScan(); render(); break;
      case 'retry': if (f) ensureDetails(f.id, true); render(); break;
      case 'pick': {
        const itEl = findItemEl(el.dataset.id);
        if (itEl) { itEl.scrollIntoView({ block: 'center', behavior: 'smooth' }); flash(itEl); setCurrent(readItem(itEl)); }
        else setCurrent({ id: el.dataset.id, name: el.dataset.name, type: 'Tệp', isFolder: false, kind: kindOf('', el.dataset.name, false), owner: '', mod: '', size: '' });
        break;
      }
      case 'quick': {
        hideQuick();
        const sec = el.dataset.sec;
        if (sec in state.open) state.open[sec] = true;
        if (sec === 'move') state.inline = 'move';
        openPanel(); render();
        setTimeout(() => { const s = root.getElementById(sec === 'move' ? 'inlineMove' : 'sec-' + sec); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 340);
        break;
      }

      /* kết nối Drive API */
      case 'connect': {
        if (state.busy) break;
        state.busy = true; render();
        try {
          const a = await api('connect');
          DS.mode = 'live'; DS.me = a.user; DS.quota = a.storageQuota; DS.setup = null; DS.details = {}; DS.scans = {};
          store.set('wx_mode', 'live');
          toast(`Đã kết nối Google Drive: <b>${esc(a.user.emailAddress)}</b>`);
          if (f) ensureDetails(f.id, true);
          ensureScan(true);
        } catch (e) {
          if (e.code === 'NO_CLIENT_ID') { const st = await api('status').catch(() => ({})); DS.setup = { extId: st.extId || (hasExt ? chrome.runtime.id : '') }; }
          else toast('Chưa kết nối được: <b>' + esc(e.message) + '</b>');
        } finally { state.busy = false; render(); }
        break;
      }
      case 'disconnect':
        await api('disconnect').catch(() => {});
        DS.mode = 'demo'; DS.me = null; DS.quota = null; DS.details = {}; DS.scans = {};
        store.set('wx_mode', 'demo'); updateBadge(); render();
        toast('Đã ngắt kết nối. Widget quay về dữ liệu mẫu.');
        break;
      case 'copy-extid': toast((await copyText(DS.setup ? DS.setup.extId : '')) ? 'Đã copy Item ID' : 'Không copy được'); break;

      /* làm thật ở cả 2 chế độ */
      case 'open': if (f) window.open(openUrl(f.id, f.isFolder), '_blank', 'noopener'); break;
      case 'copy': if (f) toast((await copyText(openUrl(f.id, f.isFolder))) ? `Đã copy link của <b>${esc(v.name)}</b>` : 'Không copy được link, hãy thử lại'); break;
      case 'download': { const u = f && downloadUrl(f); if (u) { window.open(u, '_blank', 'noopener'); toast(`Đang tải xuống <b>${esc(v.name)}</b>…`); } break; }

      case 'inline': state.inline = state.inline === el.dataset.which ? null : el.dataset.which; state.pickedFolder = null; render(); break;
      case 'bulk-move': state.inline = state.inline === 'bulk-move' ? null : 'bulk-move'; state.pickedFolder = null; render(); break;
      case 'inline-cancel': state.inline = null; render(); break;
      case 'pick-folder': state.pickedFolder = { id: el.dataset.id, name: el.dataset.name }; render(); break;

      case 'rename': {
        const nv = (($('renameInput') || {}).value || '').trim(); if (!nv || !f) break;
        const old = v.name; state.inline = null;
        if (live()) await runLive(() => api('rename', { id: f.id, name: nv }), `Đã đổi tên <b>${esc(old)}</b> thành <b>${esc(nv)}</b>`, [f.id]);
        else { setOverride(f.id, { name: nv }); render(); toast(`Đã đổi tên <b>${esc(old)}</b> thành <b>${esc(nv)}</b>`); }
        break;
      }
      case 'move': {
        if (!state.pickedFolder) { toast('Hãy chọn 1 thư mục đích trước'); break; }
        const dest = state.pickedFolder, bulk = el.dataset.bulk === '1';
        const ids = bulk ? state.bulk.map((x) => x.id) : [f.id];
        state.inline = null; state.pickedFolder = null;
        if (live()) await runLive(() => api('move', { ids, to: dest.id }), `Đã di chuyển <b>${bulk ? ids.length + ' tệp' : esc(v.name)}</b> tới <b>${esc(dest.name)}</b>`, ids);
        else {
          if (!bulk) setOverride(f.id, { path: dest.id === 'root' ? 'Drive của tôi' : 'Drive của tôi › ' + dest.name });
          render(); toast(`Đã di chuyển <b>${bulk ? ids.length + ' tệp' : esc(v.name)}</b> tới <b>${esc(dest.name)}</b>, không cần rời màn hình`);
        }
        break;
      }
      case 'star':
        if (!f) break;
        if (live()) await runLive(() => api('star', { id: f.id, starred: !v.starred }), v.starred ? `Đã bỏ dấu sao <b>${esc(v.name)}</b>` : `Đã gắn dấu sao cho <b>${esc(v.name)}</b>`, [f.id]);
        else { setOverride(f.id, { starred: !v.starred }); render(); toast(v.starred ? `Đã bỏ dấu sao <b>${esc(v.name)}</b>` : `Đã gắn dấu sao cho <b>${esc(v.name)}</b>`); }
        break;
      case 'trash':
        if (!f || needConfirm('trash')) break;
        if (live()) { const id = f.id; state.current = null; await runLive(() => api('trash', { ids: [id] }), `Đã chuyển <b>${esc(v.name)}</b> vào Thùng rác Google Drive (khôi phục được trong 30 ngày)`, [id]); }
        else toast(`Đã chuyển <b>${esc(v.name)}</b> vào Thùng rác Google Drive (khôi phục được trong 30 ngày)`);
        break;
      case 'revoke-public':
        if (needConfirm('revoke-public')) break;
        if (live()) await runLive(() => api('revokePublic', { ids: [f.id] }), `Đã thu hồi toàn bộ link công khai của <b>${esc(v.name)}</b>`, [f.id]);
        else { setOverride(f.id, { pub: false }); render(); updateBadge(); toast(`Đã thu hồi toàn bộ link công khai của <b>${esc(v.name)}</b>`); }
        break;
      case 'revoke-email': {
        const i = +el.dataset.i, x = v.emails[i]; if (!x) break;
        if (needConfirm('revoke-email:' + i)) break;
        if (live()) await runLive(() => api('revokePerm', { id: f.id, permId: x.permId }), `Đã thu hồi quyền của <b>${esc(x.e)}</b>`, [f.id]);
        else { const list = demoMeta(f).emails.slice(); list.splice(i, 1); setOverride(f.id, { emails: list }); render(); toast(`Đã thu hồi quyền của <b>${esc(x.e)}</b>`); }
        break;
      }
      case 'dup-toggle': { const k = state.dupKeep[f.id]; k[+el.dataset.i] = !k[+el.dataset.i]; render(); break; }
      case 'dup-delete': {
        const keep = state.dupKeep[f.id];
        const del = v.dups.filter((_, i) => !keep[i]);
        if (!del.length) { toast('Bạn đang giữ tất cả các bản, không có gì để xóa'); break; }
        if (needConfirm('dup-delete')) break;
        if (live()) await runLive(() => api('trash', { ids: del.map((d) => d.id) }), `Đã chuyển <b>${del.length} bản trùng</b> của <b>${esc(v.name)}</b> vào Thùng rác. Bản đang xem được giữ lại.`, [f.id]);
        else { setOverride(f.id, { dups: demoMeta(f).dups.filter((_, i) => keep[i]) }); delete state.dupKeep[f.id]; render(); updateBadge(); toast(`Đã chuyển <b>${del.length} bản trùng</b> của <b>${esc(v.name)}</b> vào Thùng rác. Luôn giữ lại ít nhất 1 bản.`); }
        break;
      }
      case 'bulk-revoke': {
        const ids = state.bulk.map((x) => x.id);
        if (needConfirm('bulk-revoke')) break;
        if (live()) await runLive(() => api('revokePublic', { ids }), (r) => `Đã thu hồi <b>${r.removed} link công khai</b> trên ${ids.length} tệp`, ids);
        else toast(`Đã thu hồi quyền chia sẻ của <b>${ids.length} tệp</b> cùng lúc`);
        break;
      }
      case 'bulk-trash': {
        const ids = state.bulk.map((x) => x.id);
        if (needConfirm('bulk-trash')) break;
        if (live()) await runLive(() => api('trash', { ids }), `Đã chuyển <b>${ids.length} tệp</b> vào Thùng rác Google Drive`, ids);
        else toast(`Đã chuyển <b>${ids.length} tệp</b> vào Thùng rác`);
        break;
      }
      case 'scan': {
        el.disabled = true;
        if (live()) {
          if (!currentFolderId()) { toast('Mở "Drive của tôi" hoặc một thư mục để quét'); el.disabled = false; break; }
          await ensureScan(true);
          const s = DS.scans[currentFolderId()];
          if (s && s.status === 'ok') {
            const iss = Object.values(s.data.issues);
            toast(`Quét xong <b>${esc(currentFolderName())}</b>: ${s.data.total} mục · ${iss.filter((x) => x.pub).length} công khai · ${iss.filter((x) => x.dup).length} tệp trùng · giải phóng được ~${fmtSize(s.data.freeBytes)}`);
          }
          if (isOpen()) render();
        } else {
          setTimeout(() => {
            el.disabled = false;
            const vis = getVisibleItems().filter((i) => !i.isFolder);
            toast(`Quét xong <b>${esc(currentFolderName())}</b>: ${vis.length} tệp · ${vis.filter((i) => demoMeta(i).pub).length} tệp công khai · ${vis.filter((i) => demoMeta(i).dups.length).length} nhóm trùng lặp`);
          }, 1200);
        }
        break;
      }
      default: break;
    }
  }

  function wireEvents() {
    root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled || el.tagName === 'SELECT') return;
      onAction(el.dataset.act, el);
    });
    root.addEventListener('change', (e) => {
      const el = e.target;
      if (!el.dataset || el.dataset.act !== 'expiry' || !state.current) return;
      const days = +el.value, f = state.current, label = el.options[el.selectedIndex].text;
      if (live()) runLive(() => api('setExpiry', { id: f.id, days }), (r) => (r.fail ? `Đặt thời hạn được ${r.ok}/${r.total} người. Lỗi: ${esc(r.lastErr)}` : `Đã đặt thời hạn chia sẻ <b>${esc(label)}</b> cho ${r.ok} người`), [f.id]);
      else toast(`Đã đặt thời hạn chia sẻ: <b>${esc(label)}</b>`);
    });
    root.addEventListener('keydown', (e) => {
      if (e.target && e.target.id === 'renameInput') {
        if (e.key === 'Enter') onAction('rename');
        if (e.key === 'Escape') { state.inline = null; render(); }
      }
    });
    // Không để phím/chuột trong widget lọt ra Drive (tránh phím tắt Drive và việc Drive bỏ chọn tệp)
    ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'pointerdown', 'pointerup', 'wheel', 'copy', 'paste', 'cut']
      .forEach((t) => host.addEventListener(t, (e) => e.stopPropagation()));

    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) closePanel(); });
    document.addEventListener('click', (e) => { if ($('wxQuick').classList.contains('show') && !e.composedPath().includes(host)) hideQuick(); }, true);
    document.addEventListener('dragstart', (e) => { const it = e.target && e.target.closest && e.target.closest(ITEM_SEL); state.dragItem = it ? readItem(it) : null; }, true);
    document.addEventListener('dragend', () => setTimeout(() => { state.dragItem = null; }, 50), true);
    window.addEventListener('resize', () => {
      bx = bx < window.innerWidth / 2 ? 14 : rightX();
      by = Math.max(74, Math.min(window.innerHeight - 72, by)); placeBubble();
    });
    if (hasExt && chrome.runtime.onMessage) chrome.runtime.onMessage.addListener((msg) => { if (msg && msg.type === 'wx-toggle') togglePanel(); });
  }

  /* ───────── THEO DÕI DRIVE ───────── */
  function updateBadge() {
    let n = 0;
    if (live()) { const fid = currentFolderId(), s = fid && DS.scans[fid]; n = s && s.status === 'ok' ? Object.keys(s.data.issues).length : 0; }
    else n = issueList().length;
    const bd = $('wxBadge'); bd.textContent = n > 99 ? '99+' : n; bd.style.display = n ? 'grid' : 'none';
  }
  let lastUrl = location.href;
  function sync(first) {
    const sel = getSelected();
    const key = sel.map((s) => s.id).join(',');
    let dirty = false;
    if (key !== state.lastSel) {
      state.lastSel = key;
      state.bulk = sel.length > 1 ? sel : [];
      if (sel.length >= 1 && (!state.current || state.current.id !== sel[0].id)) {
        state.current = sel[0]; state.inline = null; state.pickedFolder = null; state.armed = null;
        ensureDetails(sel[0].id);
        if (!first) { const b = $('wxBubble'); b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); }
      }
      dirty = true;
    }
    if (location.href !== lastUrl) { lastUrl = location.href; storageCache = null; ensureScan(); dirty = true; }
    if (dirty && isOpen()) render();
    updateBadge();
  }
  function observeDrive() {
    let t = null;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => sync(false), 120); })
      .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected'] });
  }

  /* ───────── TOAST ───────── */
  let toastT = null;
  function toast(msg, ms = 3400) {
    const t = $('wxToast'); t.innerHTML = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  const start = () => boot().catch((err) => console.error('[Wistorix] không khởi động được widget', err));
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
