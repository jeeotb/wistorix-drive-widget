/* ================================================================
   WISTORIX · DRIVE WIDGET: tiện ích dùng chung
   Nạp ở cả content script (trang Drive) và side panel.
   ================================================================ */
(() => {
  if (self.WX) return;
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const IC = (n) => `<svg class="ic"><use href="#i-${n}"/></svg>`;
  const LOGO = '<svg class="wslogo"><use href="#ws-logo"/></svg>';
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
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

  /* dữ liệu mẫu, ổn định theo id tệp */
  const EMAIL_POOL = [
    ['minhanh.design@gmail.com', 'Người chỉnh sửa'], ['trungkien.mkt@gmail.com', 'Người xem'],
    ['ketoan.wistorix@gmail.com', 'Người chỉnh sửa'], ['phulong.dev@gmail.com', 'Người xem'],
    ['agency.media.vn@gmail.com', 'Người xem'], ['thuha.review@gmail.com', 'Người bình luận'],
  ];
  const DUP_PLACES = ['00_Backup', 'Archive', 'Bản cũ', '08_Share', 'Tải lên từ máy tính'];
  function demoMeta(item, overrides) {
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
    return Object.assign(base, (overrides && overrides[item.id]) || {});
  }
  function demoIssues(items, overrides) {
    return items.filter((i) => !i.isFolder).map((i) => ({ it: i, m: demoMeta(i, overrides) }))
      .filter((x) => x.m.pub || x.m.dups.length)
      .map((x) => ({ id: x.it.id, name: x.m.name || x.it.name, pub: x.m.pub, emails: x.m.emails.length, dup: x.m.dups.length ? x.m.dups.length + 1 : 0, size: x.it.size }));
  }

  /* gọi Drive API qua background */
  async function api(op, args) {
    const r = await chrome.runtime.sendMessage({ type: 'wx-api', op, args });
    if (!r || !r.ok) { const e = new Error((r && r.error) || 'Lỗi không xác định'); e.code = r && r.code; e.status = r && r.status; throw e; }
    return r.data;
  }
  const store = {
    async get(key, dflt) { try { const o = await chrome.storage.local.get(key); return o[key] ?? dflt; } catch (e) { return dflt; } },
    set(key, val) { try { chrome.storage.local.set({ [key]: val }); } catch (e) { /* bỏ qua */ } },
  };

  self.WX = { esc, IC, LOGO, hash, parseSize, fmtSize, fmtDate, kindOf, SPRITE_OF, demoMeta, demoIssues, api, store };
})();
