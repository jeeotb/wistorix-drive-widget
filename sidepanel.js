/* ================================================================
   WISTORIX · DRIVE WIDGET: SIDE PANEL (bản 1.5, giao diện gộp 3 tab)
   Tab TỆP: tệp đang chọn, thao tác nhanh, ai có quyền, trùng lặp, hoạt động gần đây.
   Tab BẢO MẬT: điểm an toàn của thư mục đang xem, rủi ro, việc nên làm, lịch sử đổi quyền, dung lượng.
   Tab HIỆU QUẢ: số liệu hoạt động từ Google Drive (bạn và người khác, theo 30/90 ngày).
   Nhận "snapshot" từ content.js và gọi Drive API qua background.js.
   Hai chế độ: DỮ LIỆU MẪU (mặc định) · DRIVE THẬT (bấm "Kết nối").
   ================================================================ */
(() => {
  'use strict';
  const { esc, IC, LOGO, fmtSize, fmtDate, kindOf, SPRITE_OF, demoMeta, demoIssues, api, store } = self.WX;

  const CFG = {
    dashboardUrl: 'https://ws-extension-demo.vercel.app/',
    // bản miễn phí chỉ hiện N mục đầu của danh sách "Tệp đang chia sẻ"; xem hết thì mở bản trả phí
    freeListLimit: 5,
    proName: 'Wistorix Pro',
    proUrl: 'https://ws-extension-demo.vercel.app/',
  };
  const TABS = ['tep', 'baomat', 'hieuqua'];

  const $ = (id) => document.getElementById(id);

  /* ───────── TAB DRIVE ĐANG XEM ───────── */
  let tabId = null;
  let snap = null; // snapshot mới nhất từ content.js
  const env = {
    visible: () => (snap ? snap.visible : []),
    folderId: () => (snap ? snap.folderId : null),
    folderName: () => (snap ? snap.folderName : ''),
    path: () => (snap ? snap.path : 'Drive của tôi'),
    account: () => (snap ? snap.account : ''),
    storage: () => (snap ? snap.storage : null),
  };

  /* ───────── DỮ LIỆU ───────── */
  const DS = { mode: 'demo', me: null, quota: null, details: {}, scans: {}, acts: {}, setup: null };
  const live = () => DS.mode === 'live';
  let overrides = {};
  function setOverride(id, patch) { overrides[id] = Object.assign({}, overrides[id] || {}, patch); store.set('wx_overrides', overrides); }

  const state = {
    tab: 'tep', range: 90, // khoảng thời gian của số liệu hoạt động: 30 | 90 | 365 ngày
    current: null, bulk: [], lastSel: '',
    open: { info: false, perm: true, dup: true, act: true, files: true, shared: true, permlog: true },
    dupKeep: {}, pickedFolder: null, inline: null, armed: null, busy: false, demoScanAt: Date.now(),
  };

  function view(item) {
    const me = (DS.me && DS.me.emailAddress) || env.account();
    const base = {
      id: item.id, isFolder: item.isFolder, kind: item.kind, name: item.name, type: item.type,
      size: item.size, mod: item.mod || '—', created: '—', path: env.path(),
      owner: !item.owner || /^(tôi|me)$/i.test(item.owner) ? `Bạn${me ? ' (' + me + ')' : ''}` : item.owner,
      pub: false, publicLabel: '', emails: [], dups: [], starred: false, canSeePerms: true,
    };
    if (!live()) {
      const m = demoMeta(item, overrides);
      return Object.assign(base, {
        name: m.name || item.name, path: m.path || base.path, created: m.created, pub: m.pub,
        publicLabel: 'Bất kỳ ai có đường liên kết đều xem được', emails: m.emails, dups: m.dups, starred: !!m.starred,
      });
    }
    const d = DS.details[item.id];
    if (!d || d.status === 'loading') return Object.assign(base, { loading: true });
    if (d.status === 'error') return Object.assign(base, { error: d.error });
    const f = d.data.file, perms = d.data.perms || [];
    const pubPerms = perms.filter((p) => p.type === 'anyone' || p.type === 'domain');
    const owner = (f.owners || [])[0];
    return Object.assign(base, {
      name: f.name, type: item.type || f.mimeType,
      size: f.size ? fmtSize(f.size) : (f.quotaBytesUsed && +f.quotaBytesUsed ? fmtSize(f.quotaBytesUsed) : (item.isFolder ? '—' : 'Không tính dung lượng')),
      mod: fmtDate(f.modifiedTime), created: fmtDate(f.createdTime), path: d.data.path, starred: !!f.starred,
      owner: owner ? (owner.me ? `Bạn (${owner.emailAddress})` : `${owner.displayName || ''} (${owner.emailAddress || ''})`) : 'Bộ nhớ dùng chung',
      pub: pubPerms.length > 0,
      publicLabel: pubPerms.map((p) => (p.type === 'anyone' ? 'Bất kỳ ai có đường liên kết' : `Mọi người trong ${p.domain}`) + ` (${p.roleVi.toLowerCase()})`).join(' · '),
      emails: perms.filter((p) => (p.type === 'user' || p.type === 'group') && p.role !== 'owner')
        .map((p) => ({ e: p.emailAddress || p.displayName || '—', r: p.roleVi + (p.expirationTime ? ' · hết hạn ' + fmtDate(p.expirationTime) : ''), permId: p.id })),
      dups: (d.data.dups || []).map((x) => ({ id: x.id, path: x.path, size: x.size ? fmtSize(x.size) : '—', date: fmtDate(x.modifiedTime), exact: x.exact })),
      canSeePerms: d.data.canSeePerms,
    });
  }

  function ensureDetails(id, force) {
    if (!live() || !id) return;
    const d = DS.details[id];
    if (!force && d && (d.status === 'loading' || (d.status === 'ok' && Date.now() - d.at < 30e3))) return;
    DS.details[id] = { status: 'loading', at: Date.now() };
    api('details', { id })
      .then((data) => { DS.details[id] = { status: 'ok', data, at: Date.now() }; })
      .catch((e) => { DS.details[id] = { status: 'error', error: e.message, at: Date.now() }; handleAuthError(e); })
      .finally(() => { if (state.current && state.current.id === id) render(); });
  }
  function ensureScan(force) {
    if (!live()) return Promise.resolve();
    const fid = env.folderId(); if (!fid) return Promise.resolve();
    const s = DS.scans[fid];
    if (!force && s && (s.status === 'loading' || (s.status === 'ok' && Date.now() - s.at < 60e3))) return Promise.resolve();
    DS.scans[fid] = { status: 'loading', at: Date.now() };
    return api('scanFolder', { folderId: fid, force: !!force })
      .then((data) => { DS.scans[fid] = { status: 'ok', data, at: Date.now() }; })
      .catch((e) => { DS.scans[fid] = { status: 'error', error: e.message, at: Date.now() }; handleAuthError(e); })
      .finally(() => render());
  }
  function refreshAbout() {
    if (!live()) return;
    api('about').then((a) => { DS.me = a.user; DS.quota = a.storageQuota; render(); }).catch(handleAuthError);
  }
  function handleAuthError(e) {
    if (e && e.code === 'AUTH') { DS.mode = 'demo'; store.set('wx_mode', 'demo'); toast('Phiên đăng nhập Google Drive đã hết. Bấm <b>Kết nối</b> để đăng nhập lại.'); render(); }
  }
  function invalidate(ids) {
    (ids || []).forEach((id) => { delete DS.details[id]; dropActs(id); });
    const fid = env.folderId(); if (fid) { delete DS.scans[fid]; dropActs(fid); }
    store.set('wx_bump', Date.now()); // báo bong bóng cập nhật badge
  }
  function issueList() {
    if (!live()) return demoIssues(env.visible(), overrides);
    const fid = env.folderId(); const s = fid && DS.scans[fid];
    if (!s || s.status !== 'ok') return [];
    return Object.entries(s.data.issues).map(([id, x]) => ({ id, name: x.name, pub: x.pub, emails: (s.data.shared && s.data.shared[id] ? s.data.shared[id].emails : 0), dup: x.dup, size: x.size ? fmtSize(x.size) : '' }))
      .sort((a, b) => (b.pub - a.pub) || (b.dup - a.dup));
  }
  const folderItem = () => (env.folderId() ? { id: env.folderId(), isFolder: true, name: env.folderName() || 'Drive của tôi', kind: 'folder' } : null);

  /* ───────── BẢO MẬT: tổng hợp cho thư mục đang xem ───────── */
  function secData() {
    if (!live()) {
      const files = env.visible().filter((i) => !i.isFolder).map((i) => ({ it: i, m: demoMeta(i, overrides) }));
      const people = new Set(), shared = [];
      let free = 0;
      env.visible().forEach((i) => { const m = demoMeta(i, overrides); m.emails.forEach((x) => people.add(x.e)); if (m.emails.length) shared.push({ id: i.id, name: m.name || i.name, emails: m.emails.length, isFolder: i.isFolder }); });
      files.forEach(({ it, m }) => { if (m.dups.length) free += self.WX.parseSize(it.size) * m.dups.length; });
      return {
        status: 'ok', total: env.visible().length, at: state.demoScanAt,
        pub: files.filter((x) => x.m.pub).map((x) => ({ id: x.it.id, name: x.m.name || x.it.name })),
        people: people.size, shared, dupGroups: files.filter((x) => x.m.dups.length).length, free,
      };
    }
    const fid = env.folderId(), s = fid && DS.scans[fid];
    if (!fid) return { status: 'nofolder' };
    if (!s || s.status === 'loading') return { status: 'loading' };
    if (s.status === 'error') return { status: 'error', error: s.error };
    const d = s.data;
    return {
      status: 'ok', total: d.total, at: d.at || s.at,
      pub: Object.entries(d.issues).filter(([, x]) => x.pub).map(([id, x]) => ({ id, name: x.name })),
      people: (d.people || []).length,
      shared: Object.entries(d.shared || {}).map(([id, x]) => ({ id, name: x.name, emails: x.emails, isFolder: x.isFolder })),
      dupGroups: d.dupGroups != null ? d.dupGroups : Object.values(d.issues).filter((x) => x.dup).length,
      free: d.freeBytes || 0,
    };
  }
  function scoreOf(sd) {
    if (!sd.total) return 100;
    return Math.max(10, 100 - Math.min(48, sd.pub.length * 12) - Math.min(24, sd.people * 3) - Math.min(16, sd.dupGroups * 4));
  }
  const levelOf = (n) => (n >= 85 ? ['ok', 'Mức an toàn: Tốt', '#16A34A'] : n >= 60 ? ['mid', 'Mức an toàn: Trung bình', '#D97706'] : ['bad', 'Mức an toàn: Cần xử lý gấp', '#D92D20']);
  function badgeCount() {
    const sd = secData();
    return sd.status === 'ok' ? sd.pub.length + sd.dupGroups : 0;
  }

  /* ───────── HOẠT ĐỘNG & SỐ LIỆU ───────── */
  const ACT_IC = { create: 'file', edit: 'edit', move: 'folder-in', rename: 'edit', delete: 'trash', restore: 'refresh', permissionChange: 'key', comment: 'users', other: 'info' };
  function relTime(iso) {
    if (!iso) return '—';
    const s = (Date.now() - new Date(iso).getTime()) / 1000;
    if (s < 60) return 'vừa xong';
    if (s < 3600) return Math.floor(s / 60) + ' phút trước';
    if (s < 86400) return Math.floor(s / 3600) + ' giờ trước';
    if (s < 86400 * 30) return Math.floor(s / 86400) + ' ngày trước';
    return fmtDate(iso);
  }
  const rangeLabel = (d) => (d >= 365 ? '12 tháng' : d + ' ngày');
  const actKey = (id) => id + '|' + state.range;
  const dropActs = (id) => Object.keys(DS.acts).forEach((k) => { if (k.split('|')[0] === id) delete DS.acts[k]; });
  /** chia hoạt động theo ngày / tuần / tháng (giống background.js) */
  function seriesOf(events, days) {
    const unit = days <= 31 ? 'day' : days <= 120 ? 'week' : 'month';
    const startOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); if (unit === 'week') x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); if (unit === 'month') x.setDate(1); return x; };
    const next = (d) => { const x = new Date(d); if (unit === 'day') x.setDate(x.getDate() + 1); else if (unit === 'week') x.setDate(x.getDate() + 7); else x.setMonth(x.getMonth() + 1); return x; };
    const series = [];
    for (let t = startOf(Date.now() - days * 864e5); t <= new Date(); t = next(t)) series.push({ t: t.toISOString(), mine: 0, others: 0 });
    const idx = new Map(series.map((b, i) => [b.t, i]));
    events.forEach((e) => { const i = idx.get(startOf(e.time).toISOString()); if (i != null) series[i][e.actor === 'Bạn' ? 'mine' : 'others']++; });
    return { unit, series };
  }
  function demoActivity(item) {
    const days = state.range;
    const h = self.WX.hash(item.id + 'act');
    const people = ['minhanh.design', 'trungkien.mkt', 'ketoan.wistorix', 'phulong.dev', 'agency.media.vn', 'thuha.review'];
    const types = ['edit', 'comment', 'permissionChange', 'edit', 'move', 'create', 'rename', 'comment'];
    const kids = env.visible().filter((x) => !x.isFolder).map((x) => x.name);
    const n = Math.max(4, Math.round((6 + (h % 14)) * days / 40)), events = [];
    for (let i = 0; i < n; i++) {
      const hh = self.WX.hash(item.id + ':' + i);
      const type = types[hh % types.length];
      const actor = hh % 3 === 0 ? 'Bạn' : people[(hh >>> 3) % people.length];
      const time = new Date(Date.now() - ((hh >>> 5) % (days * 24)) * 3600e3).toISOString();
      const detail = type === 'permissionChange' ? (hh % 2 ? `+ ${people[(hh >>> 7) % 6]}@gmail.com (xem)` : '+ Bất kỳ ai có link (xem)') : type === 'rename' ? 'Bản nháp → Bản chính thức' : '';
      events.push({ time, type, label: { edit: 'Chỉnh sửa', comment: 'Bình luận', permissionChange: 'Thay đổi quyền', move: 'Di chuyển', create: 'Tạo mới', rename: 'Đổi tên' }[type], actor, detail, target: item.isFolder && kids.length ? kids[hh % kids.length] : '' });
    }
    events.sort((a, b) => (b.time > a.time ? 1 : -1));
    const d30 = Date.now() - 30 * 864e5, r = events.filter((e) => new Date(e.time).getTime() >= d30);
    const c = (arr, t) => arr.filter((e) => e.type === t).length;
    const m = demoMeta(item, overrides);
    const split = (arr) => ({ all: arr.length, edit: c(arr, 'edit'), comment: c(arr, 'comment'), share: c(arr, 'permissionChange'), move: c(arr, 'move') + c(arr, 'rename'), create: c(arr, 'create') });
    const o30 = r.filter((e) => e.actor !== 'Bạn'), ac = {};
    o30.forEach((e) => { ac[e.actor] = (ac[e.actor] || 0) + 1; });
    const top = {};
    events.forEach((e) => { if (e.target) { top[e.target] = top[e.target] || { title: e.target, n: 0 }; top[e.target].n++; } });
    const sr = seriesOf(events, days);
    return {
      days, events, unit: sr.unit, series: sr.series,
      rangeMine: events.filter((e) => e.actor === 'Bạn').length, rangeOthers: events.filter((e) => e.actor !== 'Bạn').length,
      stats: {
        total: events.length, last30: { all: r.length, edit: c(r, 'edit'), comment: c(r, 'comment'), share: c(r, 'permissionChange'), move: c(r, 'move') + c(r, 'rename'), create: c(r, 'create') },
        uniqueActors: new Set(events.map((e) => e.actor).filter((a) => a !== 'Bạn')).size, anonymousActs: 0,
        lastActivity: events[0] && events[0].time,
        revisions: item.isFolder ? 0 : 3 + (h % 20), editors: ['Bạn', people[h % 6]], comments: item.isFolder ? 0 : h % 9, openComments: h % 3,
        commenters: item.isFolder ? [] : [people[(h >>> 2) % 6]], peopleWithAccess: m.emails.length, canSeePerms: true, isPublic: m.pub,
        viewedByMeTime: new Date(Date.now() - (h % 72) * 3600e3).toISOString(),
        topFiles: Object.values(top).sort((a, b) => b.n - a.n).slice(0, 5),
        filesTouched: Object.keys(top).length,
        mine30: split(r.filter((e) => e.actor === 'Bạn')), others30: split(o30),
        othersActors30: Object.keys(ac).length,
        topActors: Object.entries(ac).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 5),
        sharedWith: m.emails.length, truncated: false,
      },
    };
  }
  function ensureActivity(it, force) {
    if (!live() || !it) return;
    const k = actKey(it.id), a = DS.acts[k];
    if (!force && a && (a.status === 'loading' || Date.now() - a.at < 60e3)) return;
    DS.acts[k] = { status: 'loading', at: Date.now() };
    api('activity', { id: it.id, isFolder: !!it.isFolder, days: state.range })
      .then((data) => { DS.acts[k] = { status: 'ok', data, at: Date.now() }; })
      .catch((e) => { DS.acts[k] = { status: 'error', error: e.message, code: e.code, at: Date.now() }; handleAuthError(e); })
      .finally(() => render());
  }
  /** {data} | {loading} | {error} */
  function activityOf(it) {
    if (!it) return { none: true };
    if (!live()) return { data: demoActivity(it) };
    ensureActivity(it);
    const a = DS.acts[actKey(it.id)];
    if (!a || a.status === 'loading') return { loading: true };
    if (a.status === 'error') return { error: a.error };
    return { data: a.data };
  }
  const evRow = (e) => `<div class="sp-ev ${e.type === 'permissionChange' ? 'perm' : ''}"><span class="dot">${IC(ACT_IC[e.type] || 'info')}</span>
    <div class="m"><b>${esc(e.actor)}</b> · ${esc(e.label)}${e.target ? ` <span class="tg">${esc(e.target)}</span>` : ''}
    ${e.detail ? `<div class="dt">${esc(e.detail)}</div>` : ''}<div class="tm">${esc(relTime(e.time))}</div></div></div>`;

  /* ───────── KHỐI GIAO DIỆN ───────── */
  const isArmed = (key) => state.armed && state.armed.key === key && Date.now() - state.armed.t < 4000;
  function arm(key) {
    state.armed = { key, t: Date.now() }; render();
    setTimeout(() => { if (state.armed && state.armed.key === key) { state.armed = null; render(); } }, 4000);
  }
  const lbl = (key, normal, confirm = 'Bấm lần nữa để xác nhận') => (isArmed(key) ? confirm : normal);
  function needConfirm(key) { if (!live()) return false; if (isArmed(key)) { state.armed = null; return false; } arm(key); return true; }

  const loadingBox = () => `<div class="sp-loading"><i></i><i></i><i></i> Đang tải từ Google Drive…</div>`;
  const tag = () => (live() ? '<span class="sp-tag live">DRIVE THẬT</span>' : '<span class="sp-tag">MẪU</span>');
  /** tiêu đề mục, có thể thu gọn */
  function sec(id, title, body, meta, collapsible) {
    const closed = collapsible && !state.open[id];
    return `<section class="sp-sec" id="sec-${id}">
      <h2 class="sp-h2 ${collapsible ? 'tog' : ''} ${closed ? 'closed' : ''}" ${collapsible ? `data-act="grp" data-id="${id}"` : ''}>
        ${title}${meta != null ? `<span class="meta">${meta}</span>` : ''}${collapsible ? `<span class="chev" ${meta == null ? 'style="margin-left:auto"' : ''}>▾</span>` : ''}</h2>
      ${closed ? '' : body}</section>`;
  }
  const errBox = (msg, act) => `<div class="sp-notice err" style="margin:0">${IC('alert')}<div class="t"><b>Không tải được</b>${esc(msg)}${act ? `<br><button class="sp-btn" data-act="${act}">${IC('refresh')} Thử lại</button>` : ''}</div></div>`;

  function topNotices() {
    let h = '';
    if (DS.setup) {
      h += `<div class="sp-notice">${IC('key')}<div class="t"><b>Cần 1 bước cấu hình trước khi nối Drive thật</b>
        <ol><li>Google Cloud Console → <i>APIs &amp; Services → Credentials</i> → <i>Create credentials → OAuth client ID</i></li>
        <li>Application type: <b>Chrome Extension</b>, Item ID:<br><code>${esc(DS.setup.extId)}</code> <a data-act="copy-extid">Copy</a></li>
        <li>Dán Client ID vào <code>manifest.json</code> → <code>oauth2.client_id</code>, rồi bấm ↻ tải lại extension</li></ol>
        <button class="sp-btn" data-act="connect" ${state.busy ? 'disabled' : ''}>Thử kết nối lại</button></div></div>`;
    }
    if (!live() && !DS.setup) {
      h += `<div class="sp-notice info row">${IC('database')}<div class="t"><b>Đang xem dữ liệu mẫu</b>Kết nối Google Drive để dùng số liệu thật.</div>
        <button class="sp-btn blue" data-act="connect" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Đang mở…' : 'Kết nối'}</button></div>`;
    }
    const acc = env.account();
    if (live() && DS.me && acc && DS.me.emailAddress.toLowerCase() !== acc.toLowerCase()) {
      h += `<div class="sp-notice err">${IC('alert')}<div class="t"><b>Khác tài khoản</b>Wistorix đang kết nối <b>${esc(DS.me.emailAddress)}</b>, còn tab Drive đang mở <b>${esc(acc)}</b>. Kết quả có thể không khớp với tệp bạn thấy.</div></div>`;
    }
    return h;
  }

  /* ═════════ TAB TỆP ═════════ */
  function tabTep() {
    let html = '';
    if (state.bulk.length > 1) {
      const n = state.bulk.length;
      html += `<div class="sp-bulk"><b>${IC('check')} ${n} mục đang chọn trên Drive</b>
        <div class="row">
          <button data-act="bulk-move">${IC('folder-in')} Di chuyển</button>
          <button data-act="bulk-revoke">${IC('lock')} ${lbl('bulk-revoke', 'Thu hồi link', 'Bấm lần nữa')}</button>
          <button data-act="bulk-trash">${IC('trash')} ${lbl('bulk-trash', 'Xóa', 'Bấm lần nữa')}</button>
        </div>
        ${state.inline === 'bulk-move' ? `<div class="sp-inline"><div class="sp-tree">${folderTree(null)}</div>
          <div class="row"><button class="sp-btn" data-act="inline-cancel">Hủy</button><button class="sp-btn blue" data-act="move" data-bulk="1">Di chuyển ${n} mục tới đây</button></div></div>` : ''}
      </div>`;
    }

    const f = state.current;
    if (!f) {
      html += `<div class="sp-empty">${IC('file')}<b>Chọn 1 tệp trên Drive</b> để xem ai đang có quyền, bản trùng và thao tác nhanh.<br>Hoặc kéo tệp thả vào bong bóng Wistorix.</div>`;
      const n = badgeCount();
      if (n) html += `<div class="sp-notice err" style="cursor:pointer" data-act="tab" data-tab="baomat">${IC('shield')}<div class="t"><b>${n} vấn đề cần xử lý trong thư mục này</b>Xem ở tab Bảo mật ${IC('chev-r')}</div></div>`;
      const items = env.visible().slice(0, 14);
      const rows = items.map((it) => {
        const m = live() ? null : demoMeta(it, overrides);
        const sub = it.isFolder ? 'Thư mục' : [it.size, it.mod].filter(Boolean).join(' · ') || it.type || 'Tệp';
        return `<div class="sp-row click" data-act="pick" data-id="${esc(it.id)}"><div class="sp-ri ${it.isFolder ? 'fold' : 'blue'}">${IC(SPRITE_OF[it.kind] || 'file')}</div>
          <div class="sp-rm"><b>${esc((m && m.name) || it.name)}</b><span>${esc(sub)}</span></div>
          ${m && m.pub ? `<span class="sp-chip red">${IC('globe')}CÔNG KHAI</span>` : ''}<span class="sp-go">${IC('chev-r')}</span></div>`;
      }).join('');
      html += sec('files', `Trong thư mục ${esc(env.folderName() || 'này')}`, rows ? `<div class="sp-card sp-rows">${rows}</div>` + (env.visible().length > 14 ? `<div class="sp-note">…và ${env.visible().length - 14} mục khác.</div>` : '')
        : `<div class="sp-card sp-only">${IC('info')} Chưa thấy tệp nào trong khung Drive đang mở.</div>`, env.visible().length ? env.visible().length + ' mục' : null);
      return html;
    }

    const v = view(f);
    if (!(f.id in state.dupKeep) || state.dupKeep[f.id].length !== v.dups.length) state.dupKeep[f.id] = v.dups.map(() => false);
    const spr = SPRITE_OF[v.kind] || 'file';

    html += `<button class="sp-back" data-act="overview">${IC('chev-r')} Tất cả tệp trong thư mục</button>`;
    html += `<div class="sp-file"><div class="sp-ftile ${v.isFolder ? 'folder' : ''}">${IC(spr)}</div><div style="min-width:0">
      <h1>${esc(v.name)}</h1>
      <div class="p">${esc(v.path)} · <a data-act="open">Mở ${IC('external')}</a></div>
      <div class="sp-chips">
        ${v.loading ? '<span class="sp-chip">ĐANG TẢI…</span>'
          : v.pub ? `<span class="sp-chip red">${IC('globe')}CÔNG KHAI</span>`
          : v.emails.length ? `<span class="sp-chip amb">${IC('users')}CHIA SẺ ${v.emails.length}</span>`
          : `<span class="sp-chip grn">${IC('lock')}RIÊNG TƯ</span>`}
        ${v.dups.length ? `<span class="sp-chip blue">${IC('copy')}TRÙNG ×${v.dups.length + 1}</span>` : ''}
        ${v.starred ? `<span class="sp-chip amb">${IC('star')}CÓ SAO</span>` : ''}
      </div></div></div>`;

    const on = (w) => (state.inline === w ? 'on' : '');
    html += `<div class="sp-tools">
        <button class="sp-tool" data-act="copy" title="Copy link">${IC('link')}<span>Copy link</span></button>
        <button class="sp-tool ${on('rename')}" data-act="inline" data-which="rename" title="Đổi tên">${IC('edit')}<span>Đổi tên</span></button>
        <button class="sp-tool ${on('move')}" data-act="inline" data-which="move" title="Di chuyển">${IC('folder-in')}<span>Chuyển</span></button>
        <button class="sp-tool" data-act="star" title="${v.starred ? 'Bỏ sao' : 'Gắn dấu sao'}">${IC('star')}<span>${v.starred ? 'Bỏ sao' : 'Gắn sao'}</span></button>
        <button class="sp-tool" data-act="download" title="Tải về" ${v.isFolder ? 'disabled' : ''}>${IC('download')}<span>Tải về</span></button>
        <button class="sp-tool dngr ${isArmed('trash') ? 'armed' : ''}" data-act="trash" title="Chuyển vào thùng rác">${IC('trash')}<span>${lbl('trash', 'Xóa', 'Chắc chắn?')}</span></button>
      </div>`;
    if (state.inline === 'rename') html += `<div class="sp-inline" id="inlineRename"><input id="renameInput" value="${esc(v.name)}" spellcheck="false" aria-label="Tên mới">
        <div class="row"><button class="sp-btn" data-act="inline-cancel">Hủy</button><button class="sp-btn blue" data-act="rename">Lưu tên mới</button></div></div>`;
    if (state.inline === 'move') html += `<div class="sp-inline" id="inlineMove"><div class="sp-tree">${folderTree(f)}</div>
        <div class="row"><button class="sp-btn" data-act="inline-cancel">Hủy</button><button class="sp-btn blue" data-act="move">Di chuyển tới đây</button></div></div>`;

    // Ai có quyền truy cập
    let perm = '';
    if (v.loading) perm = `<div class="sp-card">${loadingBox()}</div>`;
    else if (v.error) perm = errBox(v.error, 'retry');
    else if (!v.canSeePerms) perm = `<div class="sp-card sp-only warn">${IC('info')} Bạn không xem được danh sách chia sẻ của mục này (chỉ chủ sở hữu hoặc người chỉnh sửa mới xem được).</div>`;
    else {
      const rows = [];
      rows.push(`<div><div class="sp-av me">B</div><div class="sp-pm"><b>${esc(v.owner)}</b><span>Chủ sở hữu</span></div></div>`);
      if (v.pub) rows.push(`<div><div class="sp-av pub">${IC('globe')}</div><div class="sp-pm"><b>${esc(v.publicLabel)}</b><span>Link công khai</span></div>
        <button class="sp-rv ${isArmed('revoke-public') ? 'armed' : ''}" data-act="revoke-public">${lbl('revoke-public', 'Tắt link', 'Chắc chắn?')}</button></div>`);
      v.emails.forEach((x, i) => rows.push(`<div><div class="sp-av">${esc((x.e[0] || '?').toUpperCase())}</div>
        <div class="sp-pm"><b>${esc(x.e)}</b><span>${esc(x.r)}</span></div>
        <button class="sp-rv ${isArmed('revoke-email:' + i) ? 'armed' : ''}" data-act="revoke-email" data-i="${i}">${lbl('revoke-email:' + i, 'Thu hồi', 'Chắc chắn?')}</button></div>`));
      perm = `<div class="sp-card"><div class="sp-people">${rows.join('')}</div>
        ${!v.pub && !v.emails.length ? `<div class="sp-only" style="border-top:1px solid var(--line2)">${IC('check-circle')} Chỉ mình bạn có quyền truy cập.</div>` : ''}
        <div class="sp-permfoot">${IC('clock')} Thời hạn chia sẻ
          <select data-act="expiry" ${v.emails.length ? '' : 'disabled'} aria-label="Thời hạn chia sẻ"><option value="0">Không giới hạn</option><option value="7">7 ngày</option><option value="30">30 ngày</option><option value="90">90 ngày</option></select></div>
        <div class="sp-permfoot">${IC('crown')} Chuyển quyền sở hữu <a data-act="transfer">Mở ${IC('chev-r')}</a></div></div>`;
    }
    html += sec('perm', 'Ai có quyền truy cập', perm, v.loading || v.error ? null : (v.emails.length + (v.pub ? 1 : 0) ? (v.emails.length + (v.pub ? 1 : 0)) + ' người/link' : null), true);

    // Trùng lặp
    if (!v.isFolder) {
      let dup;
      if (v.loading) dup = `<div class="sp-card">${loadingBox()}</div>`;
      else if (v.dups.length) {
        const keep = state.dupKeep[f.id];
        dup = `<div class="sp-card">
          <div class="sp-dup keep"><div class="sp-ri blue" style="width:30px;height:30px;font-size:14px">${IC(spr)}</div><div class="dm"><b>Bản này (đang xem)</b>${esc(v.path)} · ${esc(v.size || '—')}</div><button class="tg" disabled>GIỮ</button></div>
          ${v.dups.map((d, i) => `<div class="sp-dup ${keep[i] ? 'keep' : ''}"><div class="sp-ri" style="width:30px;height:30px;font-size:14px">${IC(spr)}</div>
            <div class="dm"><b>Bản sao ${i + 1}${d.exact === false ? ' (cùng tên)' : ''}</b>${esc(d.path)} · ${esc(d.size)} · ${esc(d.date)}</div>
            <button class="tg" data-act="dup-toggle" data-i="${i}">${keep[i] ? 'GIỮ' : 'XÓA'}</button></div>`).join('')}
          <div class="sp-dupfoot"><button class="sp-btn ${isArmed('dup-delete') ? 'red' : ''}" style="width:100%" data-act="dup-delete">${IC('trash')} ${lbl('dup-delete', 'Xóa các bản đánh dấu XÓA')}</button>
          <div class="sp-note">Luôn giữ lại ít nhất 1 bản. Tệp xoá vào Thùng rác, khôi phục được trong 30 ngày.</div></div></div>`;
      } else dup = `<div class="sp-card sp-only">${IC('check-circle')} Không có bản trùng nào của tệp này.</div>`;
      html += sec('dup', 'Bản trùng', dup, v.dups.length ? (v.dups.length + 1) + ' bản' : null, true);
    }

    // Hoạt động gần đây
    const a = activityOf(f);
    let act;
    if (a.loading) act = `<div class="sp-card">${loadingBox()}</div>`;
    else if (a.error) act = errBox(a.error, 'act-retry');
    else {
      const ev = a.data.events.slice(0, 4);
      act = ev.length ? `<div class="sp-tl">${ev.map(evRow).join('')}</div>` : `<div class="sp-card sp-only">${IC('check-circle')} Không có hoạt động nào trong ${rangeLabel(a.data.days)} qua.</div>`;
      act += `<button class="sp-btn ghost" data-act="tab" data-tab="hieuqua">Xem số liệu đầy đủ ${IC('chev-r')}</button>`;
    }
    html += sec('act', 'Hoạt động gần đây', act, a.data ? a.data.stats.last30.all + ' lần / 30 ngày' : null, true);

    // Thông tin
    html += sec('info', 'Thông tin', `<div class="sp-card" style="padding:2px 12px">
      <div class="sp-kv"><span class="k">Loại</span><span class="v">${esc(v.type)}</span></div>
      <div class="sp-kv"><span class="k">Kích thước</span><span class="v">${esc(v.size || (v.isFolder ? '—' : (live() ? '…' : 'Xem ở chế độ danh sách')))}</span></div>
      <div class="sp-kv"><span class="k">Chủ sở hữu</span><span class="v">${esc(v.owner)}</span></div>
      <div class="sp-kv"><span class="k">Ngày tạo</span><span class="v">${esc(v.created)}</span></div>
      <div class="sp-kv"><span class="k">Sửa đổi gần nhất</span><span class="v">${esc(v.mod)}</span></div>
      <div class="sp-kv"><span class="k">Vị trí</span><span class="v">${esc(v.path)}</span></div></div>`, null, true);

    return html;
  }

  function folderTree(f) {
    const folders = env.visible().filter((i) => i.isFolder && (!f || i.id !== f.id));
    const nodes = [{ id: 'root', name: 'Drive của tôi', d: 0 }].concat(folders.map((x) => ({ id: x.id, name: x.name, d: 1 })));
    return nodes.map((n) => `<div class="sp-tnode ${state.pickedFolder && state.pickedFolder.id === n.id ? 'sel' : ''}" data-act="pick-folder" data-id="${esc(n.id)}" data-name="${esc(n.name)}"><span style="width:${n.d * 15}px"></span>${IC('folder')} ${esc(n.name)}</div>`).join('')
      + (folders.length ? '' : `<div class="sp-tnote">Mở thư mục cha trên Drive để thấy thêm thư mục đích.</div>`);
  }

  /* ═════════ TAB BẢO MẬT ═════════ */
  function tabBaoMat() {
    const sd = secData();
    let html = '';
    if (sd.status === 'nofolder') return html + `<div class="sp-empty">${IC('folder')}<b>Mở "Drive của tôi" hoặc một thư mục</b> để Wistorix chấm điểm an toàn và tìm tệp công khai, bản trùng.</div>` + storageBlock();
    if (sd.status === 'loading') return html + `<div class="sp-sec"><div class="sp-card">${loadingBox()}</div></div>` + storageBlock();
    if (sd.status === 'error') return html + `<div class="sp-sec">${errBox(sd.error, 'scan')}</div>` + storageBlock();

    const score = scoreOf(sd), [lv, lvText, color] = levelOf(score);
    const t = new Date(sd.at);
    html += `<div class="sp-score">
      <div class="sp-ring" style="background:conic-gradient(${color} 0 ${score}%, #EEF0F4 ${score}% 100%)" role="img" aria-label="Điểm an toàn ${score} trên 100"><div><b>${score}</b><span>/ 100</span></div></div>
      <div style="min-width:0"><div class="sp-over">THƯ MỤC ĐANG XEM</div><h1>${esc(env.folderName() || 'Drive của tôi')}</h1>
        <p class="sp-lvl ${lv}">${lvText}</p>
        <div class="sp-scan">Quét lúc ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')} · ${sd.total} mục <a data-act="scan">${IC('refresh')} Quét lại</a></div></div></div>`;

    html += `<div class="sp-risks">
      <button class="sp-risk ${sd.pub.length ? 'red' : 'ok'}" data-act="jump" data-to="sec-todo"><b>${sd.pub.length}</b><span>Tệp công khai</span></button>
      <button class="sp-risk ${sd.people ? 'amb' : 'ok'}" data-act="jump" data-to="sec-shared"><b>${sd.people}</b><span>Người được chia sẻ</span></button>
      <button class="sp-risk ${sd.dupGroups ? 'blue' : 'ok'}" data-act="jump" data-to="sec-todo"><b>${sd.free ? esc(fmtSize(sd.free)) : sd.dupGroups}</b><span>${sd.free ? `Bản trùng (${sd.dupGroups} nhóm)` : 'Nhóm tệp trùng'}</span></button>
    </div>`;

    // Việc nên làm ngay
    const todo = [];
    if (sd.pub.length) todo.push(`<div class="sp-row"><div class="sp-ri red">${IC('globe')}</div><div class="sp-rm"><b>Tắt link công khai</b><span>${esc(sd.pub[0].name)}${sd.pub.length > 1 ? ` và ${sd.pub.length - 1} tệp khác` : ''}</span></div>
      <button class="sp-btn red" data-act="fix-public">${lbl('fix-public', 'Thu hồi', 'Chắc chắn?')}</button></div>`);
    if (sd.dupGroups) todo.push(`<div class="sp-row"><div class="sp-ri blue">${IC('layers')}</div><div class="sp-rm"><b>Rà soát ${sd.dupGroups} nhóm tệp trùng</b><span>${sd.free ? 'giải phóng khoảng ' + esc(fmtSize(sd.free)) : 'dọn bớt bản sao thừa'}</span></div>
      <button class="sp-btn" data-act="fix-dup">Xem</button></div>`);
    if (sd.people) todo.push(`<div class="sp-row"><div class="sp-ri amb">${IC('users')}</div><div class="sp-rm"><b>Kiểm tra ${sd.people} người được chia sẻ</b><span>thu hồi hoặc đặt thời hạn cho người không còn cần</span></div>
      <button class="sp-btn" data-act="jump" data-to="sec-shared">Xem</button></div>`);
    html += sec('todo', 'Việc nên làm ngay', todo.length ? `<div class="sp-card sp-rows">${todo.join('')}</div>`
      : `<div class="sp-card sp-only">${IC('check-circle')} Thư mục này đang an toàn. Không có việc gì cần xử lý.</div>`, todo.length ? todo.length + ' việc' : null);

    // Tệp đang chia sẻ / có vấn đề
    const iss = issueList(), seen = new Set();
    const rows = [];
    iss.forEach((x) => { seen.add(x.id); rows.push({ id: x.id, name: x.name, ic: x.pub ? 'globe' : 'copy', cls: x.pub ? 'red' : 'blue', sub: [x.pub ? 'đang công khai' : '', x.emails ? x.emails + ' người có quyền' : '', x.dup ? 'trùng ×' + x.dup : ''].filter(Boolean).join(' · ') }); });
    sd.shared.forEach((x) => { if (!seen.has(x.id)) rows.push({ id: x.id, name: x.name, ic: x.isFolder ? 'folder' : 'users', cls: x.isFolder ? 'fold' : 'amb', sub: x.emails + ' người có quyền' }); });
    const LIM = CFG.freeListLimit, more = Math.max(0, rows.length - LIM);
    const list = rows.slice(0, LIM).map((x) => `<div class="sp-row click" data-act="pick" data-id="${esc(x.id)}" data-name="${esc(x.name)}"><div class="sp-ri ${x.cls}">${IC(x.ic)}</div>
      <div class="sp-rm"><b>${esc(x.name)}</b><span>${esc(x.sub)}</span></div><span class="sp-go">${IC('chev-r')}</span></div>`).join('');
    const lockedRows = more ? `<div class="sp-row sp-ghost" aria-hidden="true"><div class="sp-ri"></div><div class="sp-rm"><i style="width:62%"></i><i style="width:38%"></i></div></div>
      <div class="sp-row sp-ghost" aria-hidden="true"><div class="sp-ri"></div><div class="sp-rm"><i style="width:48%"></i><i style="width:30%"></i></div></div>` : '';
    const upsell = more ? `<div class="sp-upsell">
        <div class="h">${IC('lock')}<b>Còn ${more} mục nữa</b><span class="sp-tag pro">PRO</span></div>
        <p>Bản miễn phí hiện ${LIM} mục rủi ro nhất. Mở <b>${esc(CFG.proName)}</b> để xem toàn bộ ${rows.length} mục, lọc theo người được chia sẻ và thu hồi hàng loạt.</p>
        <button class="sp-btn pri block" data-act="pro">${IC('external')} Xem tổng quan trên ${esc(CFG.proName)}</button></div>` : '';
    html += sec('shared', 'Tệp đang chia sẻ hoặc cần chú ý', list ? `<div class="sp-card sp-rows ${more ? 'has-more' : ''}">${list}${lockedRows}</div>${upsell}`
      : `<div class="sp-card sp-only">${IC('check-circle')} Không có tệp nào đang chia sẻ ra ngoài.</div>`, rows.length ? rows.length + ' mục' : null, true);

    // Lịch sử thay đổi quyền (hoạt động của cả thư mục)
    const a = activityOf(folderItem());
    let log;
    if (a.loading) log = `<div class="sp-card">${loadingBox()}</div>`;
    else if (a.error) log = errBox(a.error, 'folder-act-retry');
    else {
      const ev = a.data.events.filter((e) => e.type === 'permissionChange').slice(0, 6);
      log = ev.length ? `<div class="sp-tl">${ev.map(evRow).join('')}</div>` : `<div class="sp-card sp-only">${IC('check-circle')} Không có thay đổi quyền nào trong ${rangeLabel(a.data.days)} qua.</div>`;
      if (a.data.activityError) log += `<div class="sp-note">Nhật ký chưa lấy được: ${esc(a.data.activityError.message)}${a.data.activityError.code === 'SCOPE' ? ' · <a data-act="connect">Kết nối lại</a> để cấp quyền xem hoạt động.' : ''}</div>`;
    }
    const nPerm = a.data ? a.data.events.filter((e) => e.type === 'permissionChange').length : null;
    html += sec('permlog', `Thay đổi quyền ${rangeLabel(a.data ? a.data.days : state.range)}`, log, nPerm != null ? nPerm + ' lần' : null, true);

    html += storageBlock();
    return html;
  }

  function storageBlock() {
    let body;
    if (live() && DS.quota) {
      const lim = +DS.quota.limit || 0, use = +DS.quota.usage || 0, pct = lim ? Math.min(100, Math.round((use / lim) * 100)) : 0;
      body = `<div class="sp-snum"><span class="sp-muted">Đã dùng</span><span><b>${fmtSize(use)}</b> <span class="sp-muted">/ ${lim ? fmtSize(lim) : 'Không giới hạn'}</span></span></div>
        <div class="sp-bar ${pct >= 90 ? 'bad' : pct >= 75 ? 'warn' : ''}"><i style="width:${pct}%"></i></div>
        ${+DS.quota.usageInDriveTrash ? `<div class="sp-note">Thùng rác đang chiếm ${fmtSize(DS.quota.usageInDriveTrash)}.</div>` : ''}`;
    } else {
      const s = env.storage();
      body = s ? `<div class="sp-snum"><span class="sp-muted">Đã dùng</span><span><b>${esc(s.used)}</b> <span class="sp-muted">/ ${esc(s.total)}</span></span></div><div class="sp-bar ${s.pct >= 90 ? 'bad' : s.pct >= 75 ? 'warn' : ''}"><i style="width:${s.pct}%"></i></div>`
        : `<div class="sp-note" style="margin:0">Không đọc được dung lượng. Mở mục "Bộ nhớ" ở thanh bên trái của Drive.</div>`;
    }
    return sec('storage', 'Dung lượng Drive', body);
  }

  /* ═════════ TAB HIỆU QUẢ ═════════ */
  function tabHieuQua() {
    const subj = state.current || folderItem();
    let html = '';
    if (!subj) return `<div class="sp-empty">${IC('chart')}<b>Chọn 1 tệp hoặc mở 1 thư mục</b> để xem số liệu hoạt động.</div>`;
    const sv = state.current ? view(state.current) : null;
    html += `<div class="sp-subj"><div class="sp-ri ${subj.isFolder ? 'fold' : 'blue'}">${IC(SPRITE_OF[subj.kind] || (subj.isFolder ? 'folder' : 'file'))}</div>
      <div class="t"><b>${esc((sv && sv.name) || subj.name)}</b><span>${state.current ? (subj.isFolder ? 'Thư mục đang chọn' : 'Tệp đang chọn') : 'Cả thư mục đang xem'}</span></div>
      ${state.current ? `<button class="sp-btn ghost" data-act="overview">Cả thư mục</button>` : ''}</div>`;

    // 1) Số liệu từ Google Drive
    const a = activityOf(subj);
    let body;
    if (a.loading) body = `<div class="sp-card">${loadingBox()}</div>`;
    else if (a.error) body = errBox(a.error, 'act-retry');
    else {
      const st = a.data.stats, l = st.last30;
      const me = st.mine30 || l, ot = st.others30 || { all: 0, edit: 0, comment: 0, share: 0, move: 0, create: 0 };
      const isCurFolder = subj.isFolder && subj.id === env.folderId();
      const sd = isCurFolder ? secData() : null;
      const pubInside = sd && sd.status === 'ok' ? sd.pub.length : null;
      const plus = st.truncated ? '+' : '';
      const what = subj.isFolder ? 'thư mục này' : 'tệp này';
      // 1 câu diễn giải bằng lời
      const TYPE_VI = { create: 'tạo mới hoặc tải lên', edit: 'chỉnh sửa', move: 'di chuyển, đổi tên', comment: 'bình luận', share: 'đổi quyền' };
      const topMine = Object.keys(TYPE_VI).sort((x, y) => (me[y] || 0) - (me[x] || 0))[0];
      let insight;
      if (!l.all) insight = `Không có hoạt động nào trên ${what} trong 30 ngày qua.`;
      else if (!ot.all) insight = `Trong 30 ngày, <b>chưa ai ngoài bạn</b> sửa, bình luận hay đổi quyền ${what}. ${me.all}${plus} hoạt động đều do bạn, chủ yếu là ${TYPE_VI[topMine]} (${me[topMine]}).`;
      else {
        const t = st.topActors && st.topActors[0];
        insight = `Trong 30 ngày, <b>${st.othersActors30} người khác</b> đã tương tác ${ot.all} lần với ${what}${t ? `, nhiều nhất là <b>${esc(t.name)}</b> (${t.n} lần)` : ''}. Bạn có thêm ${me.all}${plus} hoạt động của riêng mình.`;
      }
      body = `<div class="sp-insight">${IC('info')}<div>${insight}<span>Lượt xem không có trong số liệu này vì Google không cung cấp cho tài khoản Gmail.</span></div></div>`;

      const tile = (n, lb, warn, sub) => `<div class="sp-tile ${warn ? 'warn' : ''}"><b>${n}</b><span>${lb}</span>${sub ? `<div class="d" style="color:var(--mut)">${sub}</div>` : ''}</div>`;
      body += `<div class="sp-tiles" style="margin-top:10px">
        ${tile(st.othersActors30 != null ? st.othersActors30 : st.uniqueActors, 'Người khác tương tác', false, '30 ngày')}
        ${tile(ot.all, 'Lượt tương tác của người khác', false, '30 ngày')}
        ${tile(st.canSeePerms === false ? '—' : (st.sharedWith != null ? st.sharedWith : st.peopleWithAccess), 'Người được chia sẻ', false, 'không tính bạn')}
        ${subj.isFolder ? tile(st.filesTouched != null ? st.filesTouched : st.topFiles.length, 'Tệp có thay đổi', false, rangeLabel(a.data.days)) : tile(st.revisions, 'Phiên bản đã lưu')}
        ${subj.isFolder ? tile(l.share, 'Lần đổi quyền', l.share > 0, '30 ngày') : tile(st.comments, 'Bình luận', false, st.openComments ? st.openComments + ' chưa xử lý' : '')}
        ${subj.isFolder && pubInside != null ? tile(pubInside, 'Tệp công khai bên trong', pubInside > 0, pubInside ? 'xem tab Bảo mật' : '') : tile(st.isPublic ? 'Có' : 'Không', subj.isFolder ? 'Thư mục công khai' : 'Link công khai', st.isPublic)}
      </div>`;
      body += chartBlock(a.data);
      const rowsT = [['Tạo mới / tải lên', 'create'], ['Chỉnh sửa', 'edit'], ['Di chuyển / đổi tên', 'move'], ['Bình luận', 'comment'], ['Đổi quyền', 'share']];
      body += `<div class="sp-card sp-split" style="margin-top:10px"><div class="hd"><span>Hoạt động 30 ngày</span><b>Bạn</b><b>Người khác</b></div>
        ${rowsT.map(([k, key]) => `<div class="r"><span>${k}</span><b class="${me[key] ? '' : 'z'}">${me[key] || 0}</b><b class="${ot[key] ? 'o' : 'z'}">${ot[key] || 0}</b></div>`).join('')}
        <div class="r t"><span>Tổng</span><b>${me.all}${plus}</b><b class="${ot.all ? 'o' : 'z'}">${ot.all}</b></div></div>`;
      if (st.topActors && st.topActors.length) {
        body += `<h2 class="sp-h2" style="margin-top:14px">Người tương tác nhiều nhất<span class="meta">30 ngày</span></h2><div class="sp-card sp-rows">${st.topActors.map((t) => `<div class="sp-row"><div class="sp-av">${esc((t.name[0] || '?').toUpperCase())}</div><div class="sp-rm"><b>${esc(t.name)}</b></div><b>${t.n}</b></div>`).join('')}</div>`;
      }
      body += `<div class="sp-card" style="padding:2px 12px;margin-top:10px">
        <div class="sp-kv"><span class="k">Hoạt động gần nhất</span><span class="v">${esc(relTime(st.lastActivity))}</span></div>
        <div class="sp-kv"><span class="k">Lần cuối bạn xem</span><span class="v">${esc(relTime(st.viewedByMeTime))}</span></div>
        ${st.anonymousActs ? `<div class="sp-kv"><span class="k">Thao tác ẩn danh (qua link)</span><span class="v">${st.anonymousActs}</span></div>` : ''}
        ${st.editors && st.editors.length ? `<div class="sp-kv"><span class="k">Người đã sửa</span><span class="v">${esc(st.editors.slice(0, 4).join(', '))}</span></div>` : ''}
        ${st.commenters && st.commenters.length ? `<div class="sp-kv"><span class="k">Người bình luận</span><span class="v">${esc(st.commenters.slice(0, 4).join(', '))}</span></div>` : ''}</div>`;
      if (subj.isFolder && st.topFiles.length) {
        body += `<h2 class="sp-h2" style="margin-top:14px">Tệp có nhiều thay đổi nhất<span class="meta">${rangeLabel(a.data.days)}</span></h2><div class="sp-card sp-rows">${st.topFiles.map((t) => `<div class="sp-row"><div class="sp-ri blue">${IC('file')}</div><div class="sp-rm"><b>${esc(t.title)}</b></div><b>${t.n}</b></div>`).join('')}</div>`;
      }
      const ev = a.data.events.slice(0, 12);
      body += `<h2 class="sp-h2" style="margin-top:14px">Nhật ký gần nhất<span class="meta">${Math.min(12, a.data.events.length)} / ${(a.data.rangeMine || 0) + (a.data.rangeOthers || 0) || a.data.events.length} sự kiện</span></h2>`;
      body += ev.length ? `<div class="sp-tl">${ev.map(evRow).join('')}</div>` : `<div class="sp-card sp-only">${IC('check-circle')} Không có hoạt động nào trong ${rangeLabel(a.data.days)} qua.</div>`;
      if (a.data.activityError) body += `<div class="sp-note">Nhật ký chi tiết chưa lấy được: ${esc(a.data.activityError.message)}${a.data.activityError.code === 'SCOPE' ? ' · <a data-act="connect">Kết nối lại</a> để cấp quyền xem hoạt động.' : ''}</div>`;
    }
    html += sec('drivestats', `Số liệu từ Google Drive ${tag()}`, body);

    return html;
  }

  /* ───────── BIỂU ĐỒ HOẠT ĐỘNG THEO THỜI GIAN ─────────
     Cột chồng: Bạn (xanh nhạt, dưới) + Người khác (xanh thương hiệu, trên). Bảng Bạn/Người khác bên dưới là bản số. */
  const C_ME = '#7FA7E8', C_OT = '#0052CD';
  function bucketLabel(t, unit, long) {
    const d = new Date(t), dd = String(d.getDate()).padStart(2, '0'), mm = d.getMonth() + 1;
    if (unit === 'month') return long ? `Tháng ${mm}/${d.getFullYear()}` : `T${mm}/${String(d.getFullYear()).slice(2)}`;
    if (unit === 'week') return long ? `Tuần từ ${dd}/${mm}` : `${dd}/${mm}`;
    return `${dd}/${mm}`;
  }
  function chartBlock(data) {
    const seg = `<div class="sp-seg" role="group" aria-label="Khoảng thời gian">${[[30, '30 ngày'], [90, '90 ngày'], [365, '12 tháng']]
      .map(([d, t]) => `<button data-act="range" data-d="${d}" aria-pressed="${state.range === d}">${t}</button>`).join('')}</div>`;
    const ser = data.series || [];
    if (!ser.length) return `<div class="sp-card sp-chartc">${seg}<div class="sp-note">Chưa có dữ liệu theo thời gian. Bấm ↻ tải lại extension.</div></div>`;
    const W = 340, H = 132, L = 26, R = 4, T = 8, B = 20, pw = W - L - R, ph = H - T - B;
    const max = Math.max(1, ...ser.map((b) => b.mine + b.others));
    const step = max <= 4 ? 1 : Math.pow(10, Math.floor(Math.log10(max / 2)));
    const top = Math.ceil(max / 2 / step) * step * 2 || 2;
    const y = (v) => T + ph - (v / top) * ph;
    const slot = pw / ser.length, bw = Math.max(2, Math.min(18, slot - 2));
    let bars = '', hits = '';
    ser.forEach((b, i) => {
      const x = L + i * slot + (slot - bw) / 2, tot = b.mine + b.others;
      const r = Math.min(3, bw / 2);
      const topPath = (x0, y0, w, h) => (h <= 0 ? '' : `M${x0} ${y0 + h}V${y0 + r}Q${x0} ${y0} ${x0 + r} ${y0}H${x0 + w - r}Q${x0 + w} ${y0} ${x0 + w} ${y0 + r}V${y0 + h}Z`);
      const hMe = b.mine ? Math.max(1.5, (b.mine / top) * ph) : 0, hOt = b.others ? Math.max(1.5, (b.others / top) * ph) : 0;
      const gap = hMe && hOt ? 2 : 0;
      const yMe = T + ph - hMe, yOt = yMe - gap - hOt;
      if (hMe) bars += hOt ? `<rect x="${x}" y="${yMe}" width="${bw}" height="${hMe}" fill="${C_ME}"/>` : `<path d="${topPath(x, yMe, bw, hMe)}" fill="${C_ME}"/>`;
      if (hOt) bars += `<path d="${topPath(x, yOt, bw, hOt)}" fill="${C_OT}"/>`;
      const tip = `<b>${esc(bucketLabel(b.t, data.unit, true))}</b><br>Bạn: ${b.mine}<br>Người khác: ${b.others}`;
      hits += `<rect class="hit" x="${L + i * slot}" y="${T}" width="${slot}" height="${ph}" fill="transparent" data-tip="${esc(tip)}"><title>${esc(bucketLabel(b.t, data.unit, true))}: bạn ${b.mine}, người khác ${b.others}</title></rect>`;
      void tot;
    });
    const grid = [0, top / 2, top].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#EEF0F4"/><text x="${L - 6}" y="${y(v) + 3.5}" text-anchor="end">${v}</text>`).join('');
    const xi = [0, Math.floor((ser.length - 1) / 2), ser.length - 1];
    const xl = [...new Set(xi)].map((i, k, arr) => `<text x="${L + i * slot + slot / 2}" y="${H - 5}" text-anchor="${k === 0 ? 'start' : k === arr.length - 1 ? 'end' : 'middle'}">${esc(bucketLabel(ser[i].t, data.unit, false))}</text>`).join('');
    const per = { day: 'mỗi cột 1 ngày', week: 'mỗi cột 1 tuần', month: 'mỗi cột 1 tháng' }[data.unit] || '';
    const trunc = data.stats && data.stats.truncated;
    return `<div class="sp-card sp-chartc" style="margin-top:10px">
      <div class="sp-charth"><div><b>Theo thời gian</b><span>${esc(per)}</span></div>${seg}</div>
      <svg viewBox="0 0 ${W} ${H}" class="sp-chart" role="img" aria-label="Biểu đồ hoạt động ${esc(rangeLabel(data.days))}: bạn ${data.rangeMine || 0}, người khác ${data.rangeOthers || 0}">${grid}${bars}${xl}${hits}</svg>
      <div class="sp-legend"><span><i style="background:${C_ME}"></i>Bạn <b>${data.rangeMine || 0}</b></span><span><i style="background:${C_OT}"></i>Người khác <b>${data.rangeOthers || 0}</b></span></div>
      ${trunc ? `<div class="sp-note">Thư mục có rất nhiều hoạt động: biểu đồ tính trên 1.000 hoạt động gần nhất, giai đoạn cũ hơn có thể thiếu.</div>` : ''}
    </div>`;
  }

  /* ───────── RENDER ───────── */
  function render() {
    $('wxAcct').textContent = (live() && DS.me && DS.me.emailAddress) || env.account() || 'Tài khoản Google';
    const stt = $('wxStatus');
    stt.classList.toggle('live', live());
    stt.lastElementChild.textContent = live() ? 'Drive thật' : 'Dữ liệu mẫu';
    $('wxFootNote').innerHTML = live() ? `Đã kết nối Drive · <a data-act="disconnect">Ngắt</a>` : `Chưa kết nối · <a data-act="connect">Kết nối</a>`;
    document.querySelectorAll('.sp-tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === state.tab)));
    const bc = snap ? badgeCount() : 0, bd = $('wxBadge');
    bd.hidden = !bc; bd.textContent = bc > 9 ? '9+' : String(bc);

    const b = $('wxBody'), keep = b.dataset.tab === state.tab ? b.scrollTop : 0;
    let html = topNotices();
    if (!snap) {
      html += `<div class="sp-empty">${IC('external')}<b>Mở Google Drive</b> ở tab hiện tại để dùng Wistorix. Panel sẽ tự nhận tệp bạn chọn trên Drive.</div>
        <div style="padding:12px 16px"><button class="sp-btn pri block" data-act="open-drive">Mở Google Drive</button></div>`;
    } else if (state.tab === 'baomat') html += tabBaoMat();
    else if (state.tab === 'hieuqua') html += tabHieuQua();
    else html += tabTep();
    b.innerHTML = html;
    b.dataset.tab = state.tab;
    b.scrollTop = keep;
    if (state.inline === 'rename') { const i = $('renameInput'); if (i && document.activeElement !== i) { i.focus(); i.select(); } }
  }

  function setTab(t) {
    if (!TABS.includes(t)) return;
    state.tab = t; state.inline = null; state.armed = null; store.set('wx_tab', t);
    if (t === 'baomat') ensureScan();
    render();
    $('wxBody').scrollTop = 0;
  }
  function jump(id) { setTimeout(() => { const el = $(id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60); }

  /* ───────── HÀNH ĐỘNG ───────── */
  function setCurrent(it) {
    state.current = it; state.inline = null; state.pickedFolder = null; state.armed = null;
    ensureDetails(it.id); render();
  }
  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; }
    catch (e) {
      const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (_) { /* */ } ta.remove(); return ok;
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
  const newTab = (url) => chrome.tabs.create({ url });

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
    } finally { state.busy = false; render(); }
  }
  function pickById(id, name) {
    if (tabId) chrome.tabs.sendMessage(tabId, { type: 'wx-flash', id }).catch(() => {});
    const it = env.visible().find((x) => x.id === id) || { id, name: name || 'Tệp', type: 'Tệp', isFolder: false, kind: kindOf('', name || '', false), owner: '', mod: '', size: '' };
    state.tab = 'tep'; store.set('wx_tab', 'tep');
    setCurrent(it);
    $('wxBody').scrollTop = 0;
  }

  async function onAction(act, el) {
    const f = state.current;
    const v = f ? view(f) : null;
    switch (act) {
      case 'close': window.close(); break;
      case 'tab': setTab(el.dataset.tab); break;
      case 'jump': jump(el.dataset.to); break;
      case 'dashboard': case 'transfer': newTab(CFG.dashboardUrl); break;
      case 'pro': newTab(CFG.proUrl); break;
      case 'range': { const d = +el.dataset.d; if (d && d !== state.range) { state.range = d; store.set('wx_range', d); render(); } break; }
      case 'open-drive': newTab('https://drive.google.com/drive/my-drive'); break;
      case 'grp': state.open[el.dataset.id] = !state.open[el.dataset.id]; render(); break;
      case 'overview': state.current = null; state.inline = null; ensureScan(); render(); $('wxBody').scrollTop = 0; break;
      case 'retry': if (f) ensureDetails(f.id, true); render(); break;
      case 'act-retry': { const s = state.current || folderItem(); if (s) ensureActivity(s, true); render(); break; }
      case 'folder-act-retry': { const s = folderItem(); if (s) ensureActivity(s, true); render(); break; }
      case 'pick': pickById(el.dataset.id, el.dataset.name); break;

      case 'connect': {
        if (state.busy) break;
        state.busy = true; render();
        try {
          const a = await api('connect');
          DS.mode = 'live'; DS.me = a.user; DS.quota = a.storageQuota; DS.setup = null; DS.details = {}; DS.scans = {}; DS.acts = {};
          store.set('wx_mode', 'live');
          toast(`Đã kết nối Google Drive: <b>${esc(a.user.emailAddress)}</b>`);
          if (f) ensureDetails(f.id, true);
          ensureScan(true);
        } catch (e) {
          if (e.code === 'NO_CLIENT_ID') { const st = await api('status').catch(() => ({})); DS.setup = { extId: st.extId || chrome.runtime.id }; }
          else toast('Chưa kết nối được: <b>' + esc(e.message) + '</b>');
        } finally { state.busy = false; render(); }
        break;
      }
      case 'disconnect':
        await api('disconnect').catch(() => {});
        DS.mode = 'demo'; DS.me = null; DS.quota = null; DS.details = {}; DS.scans = {}; DS.acts = {};
        store.set('wx_mode', 'demo'); render();
        toast('Đã ngắt kết nối. Wistorix quay về dữ liệu mẫu.');
        break;
      case 'copy-extid': toast((await copyText(DS.setup ? DS.setup.extId : '')) ? 'Đã copy Item ID' : 'Không copy được'); break;

      case 'open': if (f) newTab(openUrl(f.id, f.isFolder)); break;
      case 'copy': if (f) toast((await copyText(openUrl(f.id, f.isFolder))) ? `Đã copy link của <b>${esc(v.name)}</b>` : 'Không copy được link, hãy thử lại'); break;
      case 'download': { const u = f && downloadUrl(f); if (u) { newTab(u); toast(`Đang tải xuống <b>${esc(v.name)}</b>…`); } break; }

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
        if (live()) await runLive(() => api('move', { ids, to: dest.id }), `Đã di chuyển <b>${bulk ? ids.length + ' mục' : esc(v.name)}</b> tới <b>${esc(dest.name)}</b>`, ids);
        else {
          if (!bulk) setOverride(f.id, { path: dest.id === 'root' ? 'Drive của tôi' : 'Drive của tôi › ' + dest.name });
          render(); toast(`Đã di chuyển <b>${bulk ? ids.length + ' mục' : esc(v.name)}</b> tới <b>${esc(dest.name)}</b>`);
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
        if (live()) { const id = f.id; state.current = null; await runLive(() => api('trash', { ids: [id] }), `Đã chuyển <b>${esc(v.name)}</b> vào Thùng rác (khôi phục được trong 30 ngày)`, [id]); }
        else toast(`Đã chuyển <b>${esc(v.name)}</b> vào Thùng rác (khôi phục được trong 30 ngày)`);
        break;
      case 'revoke-public':
        if (needConfirm('revoke-public')) break;
        if (live()) await runLive(() => api('revokePublic', { ids: [f.id] }), `Đã tắt link công khai của <b>${esc(v.name)}</b>`, [f.id]);
        else { setOverride(f.id, { pub: false }); render(); toast(`Đã tắt link công khai của <b>${esc(v.name)}</b>`); }
        break;
      case 'revoke-email': {
        const i = +el.dataset.i, x = v.emails[i]; if (!x) break;
        if (needConfirm('revoke-email:' + i)) break;
        if (live()) await runLive(() => api('revokePerm', { id: f.id, permId: x.permId }), `Đã thu hồi quyền của <b>${esc(x.e)}</b>`, [f.id]);
        else { const list = demoMeta(f, overrides).emails.slice(); list.splice(i, 1); setOverride(f.id, { emails: list }); render(); toast(`Đã thu hồi quyền của <b>${esc(x.e)}</b>`); }
        break;
      }
      case 'dup-toggle': { const k = state.dupKeep[f.id]; k[+el.dataset.i] = !k[+el.dataset.i]; render(); break; }
      case 'dup-delete': {
        const keep = state.dupKeep[f.id];
        const del = v.dups.filter((_, i) => !keep[i]);
        if (!del.length) { toast('Bạn đang giữ tất cả các bản, không có gì để xóa'); break; }
        if (needConfirm('dup-delete')) break;
        if (live()) await runLive(() => api('trash', { ids: del.map((d) => d.id) }), `Đã chuyển <b>${del.length} bản trùng</b> của <b>${esc(v.name)}</b> vào Thùng rác. Bản đang xem được giữ lại.`, [f.id]);
        else { setOverride(f.id, { dups: demoMeta(f, overrides).dups.filter((_, i) => keep[i]) }); delete state.dupKeep[f.id]; render(); toast(`Đã chuyển <b>${del.length} bản trùng</b> của <b>${esc(v.name)}</b> vào Thùng rác.`); }
        break;
      }
      case 'bulk-revoke': {
        const ids = state.bulk.map((x) => x.id);
        if (needConfirm('bulk-revoke')) break;
        if (live()) await runLive(() => api('revokePublic', { ids }), (r) => `Đã thu hồi <b>${r.removed} link công khai</b> trên ${ids.length} mục`, ids);
        else { ids.forEach((id) => setOverride(id, { pub: false })); render(); toast(`Đã thu hồi link công khai của <b>${ids.length} mục</b> cùng lúc`); }
        break;
      }
      case 'bulk-trash': {
        const ids = state.bulk.map((x) => x.id);
        if (needConfirm('bulk-trash')) break;
        if (live()) await runLive(() => api('trash', { ids }), `Đã chuyển <b>${ids.length} mục</b> vào Thùng rác`, ids);
        else toast(`Đã chuyển <b>${ids.length} mục</b> vào Thùng rác`);
        break;
      }

      /* tab Bảo mật */
      case 'fix-public': {
        const sd = secData(); const ids = sd.pub.map((x) => x.id); if (!ids.length) break;
        if (needConfirm('fix-public')) break;
        if (live()) await runLive(() => api('revokePublic', { ids }), (r) => `Đã tắt <b>${r.removed} link công khai</b> trên ${ids.length} tệp`, ids);
        else { ids.forEach((id) => setOverride(id, { pub: false })); store.set('wx_bump', Date.now()); render(); toast(`Đã tắt link công khai của <b>${ids.length} tệp</b>`); }
        break;
      }
      case 'fix-dup': {
        const d = issueList().find((x) => x.dup);
        if (!d) { toast('Không còn nhóm trùng nào'); break; }
        state.open.dup = true; pickById(d.id, d.name); jump('sec-dup');
        break;
      }
      case 'scan': {
        if (live()) {
          if (!env.folderId()) { toast('Mở "Drive của tôi" hoặc một thư mục để quét'); break; }
          await ensureScan(true);
          const sd = secData();
          if (sd.status === 'ok') toast(`Quét xong <b>${esc(env.folderName())}</b>: ${sd.total} mục · ${sd.pub.length} công khai · ${sd.dupGroups} nhóm trùng · ${sd.people} người được chia sẻ`);
          store.set('wx_bump', Date.now());
        } else {
          state.demoScanAt = Date.now(); render();
          const sd = secData();
          toast(`Quét xong <b>${esc(env.folderName())}</b>: ${sd.total} mục · ${sd.pub.length} công khai · ${sd.dupGroups} nhóm trùng`);
        }
        break;
      }

      default: break;
    }
  }

  /* ───────── NHẬN SNAPSHOT TỪ TAB DRIVE ───────── */
  let lastUrl = '';
  const SEC_TAB = { perm: 'tep', dup: 'tep', info: 'tep', move: 'tep', act: 'hieuqua', storage: 'baomat' };
  function applySnapshot(s) {
    snap = s;
    const sel = s.selected || [];
    const key = sel.map((x) => x.id).join(',');
    if (key !== state.lastSel) {
      state.lastSel = key;
      state.bulk = sel.length > 1 ? sel : [];
      if (sel.length >= 1 && (!state.current || state.current.id !== sel[0].id)) {
        state.current = sel[0]; state.inline = null; state.pickedFolder = null; state.armed = null;
        ensureDetails(sel[0].id);
      }
    }
    if (s.pinned && (!state.current || state.current.id !== s.pinned.id)) { state.current = s.pinned; ensureDetails(s.pinned.id); }
    if (s.url !== lastUrl) { lastUrl = s.url; ensureScan(); }
    const pend = s.pendingSec;
    if (pend) {
      state.tab = SEC_TAB[pend] || 'tep';
      if (pend in state.open) state.open[pend] = true;
      if (pend === 'move') state.inline = 'move';
      chrome.tabs.sendMessage(tabId, { type: 'wx-sec-consumed' }).catch(() => {});
    }
    render();
    if (pend) jump(pend === 'move' ? 'inlineMove' : pend === 'act' ? 'sec-drivestats' : 'sec-' + pend);
  }

  const FORCED_TAB = +new URLSearchParams(location.search).get('tabId') || null; // gỡ lỗi: sidepanel.html?tabId=123
  async function attachToActiveTab() {
    let tab;
    try { tab = FORCED_TAB ? await chrome.tabs.get(FORCED_TAB) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0]; } catch (e) { tab = null; }
    if (!tab) { snap = null; render(); return; }
    tabId = tab.id;
    try {
      const s = await chrome.tabs.sendMessage(tabId, { type: 'wx-get-snapshot' });
      if (s) applySnapshot(s); else { snap = null; render(); }
    } catch (e) { snap = null; state.current = null; render(); } // không phải tab Drive
  }

  /* ───────── TOAST ───────── */
  let toastT = null;
  function toast(msg, ms = 3400) {
    const t = $('wxToast'); t.innerHTML = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  /* ───────── KHỞI ĐỘNG ───────── */
  async function boot() {
    const sprite = await fetch('sprite.svg').then((r) => r.text());
    document.body.insertAdjacentHTML('afterbegin', sprite);
    document.querySelectorAll('[data-logo]').forEach((e) => { e.innerHTML = LOGO; });
    document.querySelectorAll('[data-ic]').forEach((e) => { e.innerHTML = IC(e.dataset.ic); });

    overrides = await store.get('wx_overrides', {});
    state.tab = await store.get('wx_tab', 'tep');
    if (!TABS.includes(state.tab)) state.tab = 'tep';
    state.range = [30, 90, 365].includes(await store.get('wx_range', 90)) ? await store.get('wx_range', 90) : 90;
    if ((await store.get('wx_mode', 'demo')) === 'live') {
      try {
        const st2 = await api('status');
        if (st2.ready && st2.connected) { DS.mode = 'live'; refreshAbout(); }
      } catch (e) { /* ở lại chế độ mẫu */ }
    }

    document.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (!el || el.disabled || el.tagName === 'SELECT') return;
      onAction(el.dataset.act, el);
    });
    const tipEl = document.createElement('div'); tipEl.id = 'spTip'; document.body.appendChild(tipEl);
    document.addEventListener('pointermove', (e) => {
      const h = e.target.closest && e.target.closest('rect.hit');
      if (!h) { tipEl.classList.remove('show'); return; }
      tipEl.innerHTML = h.dataset.tip; tipEl.classList.add('show');
      const w = tipEl.offsetWidth, x = Math.min(window.innerWidth - w - 8, Math.max(8, e.clientX - w / 2));
      tipEl.style.left = x + 'px'; tipEl.style.top = Math.max(8, e.clientY - tipEl.offsetHeight - 12) + 'px';
    });
    document.addEventListener('change', (e) => {
      const el = e.target;
      if (!el.dataset || el.dataset.act !== 'expiry' || !state.current) return;
      const days = +el.value, f = state.current, label = el.options[el.selectedIndex].text;
      if (live()) runLive(() => api('setExpiry', { id: f.id, days }), (r) => (r.fail ? `Đặt thời hạn được ${r.ok}/${r.total} người. Lỗi: ${esc(r.lastErr)}` : `Đã đặt thời hạn chia sẻ <b>${esc(label)}</b> cho ${r.ok} người`), [f.id]);
      else toast(`Đã đặt thời hạn chia sẻ: <b>${esc(label)}</b>`);
    });
    document.addEventListener('keydown', (e) => {
      if (e.target && e.target.id === 'renameInput') {
        if (e.key === 'Enter') onAction('rename');
        if (e.key === 'Escape') { state.inline = null; render(); }
      }
      // ← → chuyển tab khi đang đứng ở thanh tab
      if (e.target && e.target.classList && e.target.classList.contains('sp-tab') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        const i = (TABS.indexOf(state.tab) + (e.key === 'ArrowRight' ? 1 : 2)) % 3;
        setTab(TABS[i]); document.querySelector(`.sp-tab[data-tab="${TABS[i]}"]`).focus();
      }
    });

    chrome.runtime.onMessage.addListener((msg, sender) => {
      if (msg && msg.type === 'wx-snapshot' && sender.tab && sender.tab.id === tabId) applySnapshot(msg.snapshot);
      return false;
    });
    chrome.tabs.onActivated.addListener(() => { state.current = null; state.lastSel = ''; attachToActiveTab(); });
    chrome.tabs.onUpdated.addListener((id, info) => { if (id === tabId && info.status === 'complete') attachToActiveTab(); });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && ch.wx_overrides && !live()) { overrides = ch.wx_overrides.newValue || {}; render(); }
    });

    await attachToActiveTab();
  }
  boot().catch((e) => { document.body.textContent = 'Không khởi động được Wistorix: ' + e.message; });
})();
