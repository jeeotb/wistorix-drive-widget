/* ================================================================
   WISTORIX · DRIVE WIDGET: content script cho drive.google.com (bản 1.4)
   Trong trang Drive chỉ còn BONG BÓNG (kéo thả, hít mép, badge) và menu nhanh.
   Panel chi tiết mở bằng SIDE PANEL gốc của Chrome (sidepanel.html), đứng cạnh trang
   Drive nên không che nội dung.

   File này đọc giao diện Drive (tệp đang chọn, thư mục, tài khoản, dung lượng),
   rồi gửi "snapshot" cho side panel mỗi khi có thay đổi.
   ================================================================ */
(() => {
  'use strict';
  if (window.top !== window || window.__wistorixWidget) return;
  window.__wistorixWidget = true;
  const { IC, LOGO, demoIssues, api, store } = self.WX;

  const CFG = { rightGap: 64 }; // chừa cột icon Google (Lịch, Keep…) ở mép phải Drive

  /* ================================================================
     ĐỌC GIAO DIỆN DRIVE (đã kiểm trên Drive tiếng Việt, 29/09/2026)
     - Lưới:      div[role=gridcell][data-target=doc][data-id], aria-label="Tên Loại Thông tin khác (…)"
     - Danh sách: tr[role=row][data-target=doc][data-id], [data-tooltip]="Tên Loại" + aria-label phụ
     - Đang chọn: aria-selected="true"
     ================================================================ */
  const ITEM_SEL = '[data-id][data-target="doc"]';
  const FOLDER_RE = /\s+(Thư mục dùng chung|Thư mục|Shared folder|Folder)$/i;
  const MORE_RE = /\s*(Thông tin khác|More info)\s*\(.*\)\s*$/i;
  const visible = (el) => !!(el && el.isConnected && el.getClientRects().length);

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
      id, isFolder, sharedFolder, name: label || 'Không rõ tên', type,
      owner: (pick(/^(Người sở hữu|Owner)\s*:/i) || '').split(':').slice(1).join(':').trim(),
      mod: (pick(/^(Lần sửa đổi gần đây nhất|Last modified)/i) || '').replace(/^(Lần sửa đổi gần đây nhất|Last modified)\s*/i, '').trim(),
      size: (((pick(/^(Kích thước|Size)\s*:/i) || '').split('\n')[0].split(':')[1]) || '').trim(),
      kind: self.WX.kindOf(type, label, isFolder),
    };
  }
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
    return null; // Gần đây, Được chia sẻ, Tìm kiếm… không quét theo thư mục được
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
    const P = self.WX.parseSize;
    storageCache = m ? { used: m[1], total: m[2], pct: Math.min(100, Math.round((P(m[1]) / (P(m[2]) || 1)) * 100)) } : null;
    storageAt = Date.now();
    return storageCache;
  }

  /* ───────── SNAPSHOT gửi cho side panel ───────── */
  let pendingSec = null;   // mục cần mở sẵn khi panel bật lên (từ menu nhanh)
  let pinned = null;       // tệp vừa thả vào bong bóng
  function snapshot() {
    return {
      url: location.href, folderId: currentFolderId(), folderName: currentFolderName(), path: currentPath(),
      account: accountEmail(), storage: domStorage(),
      selected: getSelected(), visible: getVisibleItems(), pinned, pendingSec, at: Date.now(),
    };
  }
  let lastKey = '', lastSelKey = '';
  function push(force) {
    const s = snapshot();
    const selKey = s.selected.map((x) => x.id).join(',');
    const key = JSON.stringify([s.url, selKey, s.visible.length, s.pinned && s.pinned.id, s.pendingSec, s.account]);
    if (!force && key === lastKey) return;
    lastKey = key;
    chrome.runtime.sendMessage({ type: 'wx-snapshot', snapshot: s }).catch(() => { /* panel chưa mở */ });
    updateBadge(s);
    if (selKey && selKey !== lastSelKey) pulse();
    lastSelKey = selKey;
  }

  /* ───────── BADGE: số tệp cần xử lý trong thư mục đang mở ───────── */
  let mode = 'demo', overrides = {}, badgeSeq = 0;
  async function updateBadge(s) {
    s = s || snapshot();
    const seq = ++badgeSeq;
    let n = 0;
    if (mode === 'live') {
      if (s.folderId) {
        try { const r = await api('scanFolder', { folderId: s.folderId }); n = Object.keys(r.issues).length; }
        catch (e) { n = 0; }
      }
    } else n = demoIssues(s.visible, overrides).length;
    if (seq !== badgeSeq || !$('wxBadge')) return;
    const bd = $('wxBadge'); bd.textContent = n > 99 ? '99+' : n; bd.style.display = n ? 'grid' : 'none';
  }

  /* ================================================================
     BONG BÓNG (Shadow DOM, không đụng CSS của Drive)
     ================================================================ */
  const host = document.createElement('wistorix-widget');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483600;';
  const root = host.attachShadow({ mode: 'open' });
  const $ = (id) => root.getElementById(id);

  let bx = 0, by = 0, dragItem = null;
  const rightX = () => window.innerWidth - 58 - CFG.rightGap;
  function placeBubble() { const b = $('wxBubble'); b.style.left = bx + 'px'; b.style.top = by + 'px'; }
  function pulse() { const b = $('wxBubble'); if (!b) return; b.classList.remove('pulse'); void b.offsetWidth; b.classList.add('pulse'); }

  function openPanel(sec) {
    pendingSec = sec || null;
    // gửi ngay trong lúc người dùng bấm: Chrome chỉ cho mở side panel khi có thao tác người dùng
    chrome.runtime.sendMessage({ type: 'wx-open-panel' }).catch(() => {});
    push(true);
  }

  async function boot() {
    const st = document.createElement('style');
    st.id = 'wistorix-font';
    st.textContent = `@font-face{font-family:'WX Manrope';src:url('${chrome.runtime.getURL('fonts/Manrope-Variable.woff2')}') format('woff2');font-weight:200 800;font-style:normal;font-display:swap}`;
    (document.head || document.documentElement).appendChild(st);
    const [css, sprite] = await Promise.all([
      fetch(chrome.runtime.getURL('widget.css')).then((r) => r.text()),
      fetch(chrome.runtime.getURL('sprite.svg')).then((r) => r.text()),
    ]);
    mode = await store.get('wx_mode', 'demo');
    overrides = await store.get('wx_overrides', {});
    const pos = await store.get('wx_bubble', null);

    root.innerHTML = `<style>${css}</style>${sprite}
      <div id="wxBubble" role="button" aria-label="Wistorix">${LOGO}<span id="wxBadge" style="display:none">0</span></div>
      <div id="wxTip"></div>
      <div id="wxQuick">
        <div class="qh">${IC('file')}<span id="wxQuickName">—</span></div>
        <button data-sec="move">${IC('folder-in')} Di chuyển tới thư mục…</button>
        <button data-sec="perm">${IC('key')} Quản lý quyền truy cập</button>
        <button data-sec="dup">${IC('layers')} Kiểm tra trùng lặp</button>
        <button data-sec="info">${IC('info')} Xem thông tin chi tiết</button>
      </div>
      <div id="wxToast"></div>`;
    document.documentElement.appendChild(host);

    initBubble(pos);
    wireEvents();
    let t = null;
    new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => push(false), 150); })
      .observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected'] });
    push(true);
  }

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
      if (!moved) { openPanel(null); return; }
      b.classList.add('snap');
      const left = bx + 29 < window.innerWidth / 2;
      bx = left ? 14 : rightX();
      by = Math.max(74, Math.min(window.innerHeight - 72, by));
      placeBubble();
      store.set('wx_bubble', { side: left ? 'left' : 'right', y: by });
    });
    b.addEventListener('mouseenter', () => {
      if (drag) return;
      const sel = getSelected()[0];
      const tip = $('wxTip');
      tip.textContent = sel ? 'Wistorix: ' + sel.name : 'Wistorix: bấm để mở panel';
      const r = b.getBoundingClientRect(), onRight = r.left > window.innerWidth / 2;
      tip.style.top = (r.top + 18) + 'px';
      tip.style.left = onRight ? 'auto' : (r.right + 10) + 'px';
      tip.style.right = onRight ? (window.innerWidth - r.left + 10) + 'px' : 'auto';
      tip.style.opacity = 1;
    });
    b.addEventListener('mouseleave', () => { $('wxTip').style.opacity = 0; });

    // kéo tệp trên Drive thả vào bong bóng thì mở menu nhanh
    b.addEventListener('dragenter', (e) => { e.preventDefault(); b.classList.add('dropTarget'); });
    b.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; b.classList.add('dropTarget'); });
    b.addEventListener('dragleave', () => b.classList.remove('dropTarget'));
    b.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation(); b.classList.remove('dropTarget');
      $('wxTip').style.opacity = 0;
      let it = dragItem;
      if (!it && e.dataTransfer) {
        const raw = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '';
        const id = (raw.match(/[-\w]{25,}/) || [])[0];
        const el = id && findItemEl(id);
        if (el) it = readItem(el);
      }
      dragItem = null;
      if (!it) { toast('Không nhận được tệp. Hãy chọn tệp rồi bấm vào bong bóng.'); return; }
      pinned = it; push(true);
      const q = $('wxQuick'), r = b.getBoundingClientRect();
      $('wxQuickName').textContent = it.name;
      q.classList.add('show');
      q.style.top = Math.min(window.innerHeight - 210, r.top) + 'px';
      q.style.left = r.left > window.innerWidth / 2 ? (r.left - 264) + 'px' : (r.right + 12) + 'px';
    });
  }

  function wireEvents() {
    root.addEventListener('click', (e) => {
      const btn = e.target.closest('#wxQuick button[data-sec]');
      if (!btn) return;
      $('wxQuick').classList.remove('show');
      openPanel(btn.dataset.sec);
    });
    // phím/chuột trong widget không lọt ra Drive (tránh phím tắt Drive và việc Drive bỏ chọn tệp)
    ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'pointerdown', 'pointerup']
      .forEach((t) => host.addEventListener(t, (e) => e.stopPropagation()));
    document.addEventListener('click', (e) => { if ($('wxQuick').classList.contains('show') && !e.composedPath().includes(host)) $('wxQuick').classList.remove('show'); }, true);
    document.addEventListener('dragstart', (e) => { const it = e.target && e.target.closest && e.target.closest(ITEM_SEL); dragItem = it ? readItem(it) : null; }, true);
    document.addEventListener('dragend', () => setTimeout(() => { dragItem = null; }, 50), true);
    window.addEventListener('resize', () => {
      bx = bx < window.innerWidth / 2 ? 14 : rightX();
      by = Math.max(74, Math.min(window.innerHeight - 72, by)); placeBubble();
    });

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!msg) return false;
      if (msg.type === 'wx-get-snapshot') { sendResponse(snapshot()); return false; }
      if (msg.type === 'wx-sec-consumed') { pendingSec = null; pinned = null; return false; }
      if (msg.type === 'wx-flash') {
        const el = findItemEl(msg.id);
        if (el) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          const o = el.style.outline, oo = el.style.outlineOffset;
          el.style.outline = '3px solid #058EF4'; el.style.outlineOffset = '2px';
          setTimeout(() => { el.style.outline = o; el.style.outlineOffset = oo; }, 1400);
        }
        sendResponse({ found: !!el }); return false;
      }
      return false;
    });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local') return;
      if (ch.wx_mode) mode = ch.wx_mode.newValue || 'demo';
      if (ch.wx_overrides) overrides = ch.wx_overrides.newValue || {};
      if (ch.wx_mode || ch.wx_overrides || ch.wx_bump) updateBadge();
    });
  }

  let toastT = null;
  function toast(msg, ms = 3400) {
    const t = $('wxToast'); t.innerHTML = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  const start = () => boot().catch((err) => console.error('[Wistorix] không khởi động được bong bóng', err));
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
