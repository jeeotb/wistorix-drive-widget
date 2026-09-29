/* ================================================================
   WISTORIX · DRIVE WIDGET: SIDE PANEL (bản 1.4)
   Chạy trong Side Panel gốc của Chrome, đứng cạnh tab Drive (không che trang).
   Nhận "snapshot" từ content.js (tệp đang chọn, thư mục, tài khoản…) và gọi Drive API qua background.js.
   Hai chế độ: DỮ LIỆU MẪU (mặc định) · DRIVE THẬT (bấm "Kết nối").
   ================================================================ */
(() => {
  'use strict';
  const { esc, IC, LOGO, fmtSize, fmtDate, kindOf, SPRITE_OF, demoMeta, demoIssues, api, store } = self.WX;

  const CFG = {
    dashboardUrl: 'https://ws-extension-demo.vercel.app/',
    showDemoPill: true,    // false: ẩn nhãn "DỮ LIỆU MẪU" và thanh "Kết nối" (khi quay video demo)
  };

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
    current: null, bulk: [], lastSel: '',
    open: { perm: false, dup: false, storage: false, act: true },
    dupKeep: {}, pickedFolder: null, inline: null, armed: null, busy: false,
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
      .finally(() => { if (!state.current) render(); });
  }
  function refreshAbout() {
    if (!live()) return;
    api('about').then((a) => { DS.me = a.user; DS.quota = a.storageQuota; render(); }).catch(handleAuthError);
  }
  function handleAuthError(e) {
    if (e && e.code === 'AUTH') { DS.mode = 'demo'; store.set('wx_mode', 'demo'); toast('Phiên đăng nhập Google Drive đã hết. Bấm <b>Kết nối</b> để đăng nhập lại.'); render(); }
  }
  function invalidate(ids) {
    (ids || []).forEach((id) => { delete DS.details[id]; delete DS.acts[id]; });
    const fid = env.folderId(); if (fid) delete DS.scans[fid];
    store.set('wx_bump', Date.now()); // báo bong bóng cập nhật badge
  }
  function issueList() {
    if (!live()) return demoIssues(env.visible(), overrides);
    const fid = env.folderId(); const s = fid && DS.scans[fid];
    if (!s || s.status !== 'ok') return [];
    return Object.entries(s.data.issues).map(([id, x]) => ({ id, name: x.name, pub: x.pub, emails: 0, dup: x.dup, size: x.size ? fmtSize(x.size) : '' }))
      .sort((a, b) => (b.pub - a.pub) || (b.dup - a.dup));
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
  function demoActivity(item) {
    const h = self.WX.hash(item.id + 'act');
    const people = ['minhanh.design', 'trungkien.mkt', 'ketoan.wistorix', 'phulong.dev', 'agency.media.vn', 'thuha.review'];
    const types = ['edit', 'comment', 'permissionChange', 'edit', 'move', 'create', 'rename', 'comment'];
    const kids = env.visible().filter((x) => !x.isFolder).map((x) => x.name);
    const n = 6 + (h % 14), events = [];
    for (let i = 0; i < n; i++) {
      const hh = self.WX.hash(item.id + ':' + i);
      const type = types[hh % types.length];
      const actor = hh % 3 === 0 ? 'Bạn' : people[(hh >>> 3) % people.length];
      const time = new Date(Date.now() - ((hh >>> 5) % (40 * 24)) * 3600e3).toISOString();
      const detail = type === 'permissionChange' ? (hh % 2 ? `+ ${people[(hh >>> 7) % 6]}@gmail.com (xem)` : '+ Bất kỳ ai có link (xem)') : type === 'rename' ? 'Bản nháp → Bản chính thức' : '';
      events.push({ time, type, label: { edit: 'Chỉnh sửa', comment: 'Bình luận', permissionChange: 'Thay đổi quyền', move: 'Di chuyển', create: 'Tạo mới', rename: 'Đổi tên' }[type], actor, detail, target: item.isFolder && kids.length ? kids[hh % kids.length] : '' });
    }
    events.sort((a, b) => (b.time > a.time ? 1 : -1));
    const d30 = Date.now() - 30 * 864e5, r = events.filter((e) => new Date(e.time).getTime() >= d30);
    const c = (arr, t) => arr.filter((e) => e.type === t).length;
    const m = demoMeta(item, overrides);
    const top = {};
    events.forEach((e) => { if (e.target) { top[e.target] = top[e.target] || { title: e.target, n: 0 }; top[e.target].n++; } });
    return {
      days: 90, events,
      stats: {
        total: events.length, last30: { all: r.length, edit: c(r, 'edit'), comment: c(r, 'comment'), share: c(r, 'permissionChange'), move: c(r, 'move') + c(r, 'rename'), create: c(r, 'create') },
        uniqueActors: new Set(events.map((e) => e.actor).filter((a) => a !== 'Bạn')).size, anonymousActs: 0,
        lastActivity: events[0] && events[0].time,
        revisions: item.isFolder ? 0 : 3 + (h % 20), editors: ['Bạn', people[h % 6]], comments: item.isFolder ? 0 : h % 9, openComments: h % 3,
        commenters: item.isFolder ? [] : [people[(h >>> 2) % 6]], peopleWithAccess: m.emails.length, canSeePerms: true, isPublic: m.pub,
        viewedByMeTime: new Date(Date.now() - (h % 72) * 3600e3).toISOString(),
        topFiles: Object.values(top).sort((a, b) => b.n - a.n).slice(0, 5),
      },
    };
  }
  function ensureActivity(it, force) {
    if (!live() || !it) return;
    const a = DS.acts[it.id];
    if (!force && a && (a.status === 'loading' || Date.now() - a.at < 60e3)) return;
    DS.acts[it.id] = { status: 'loading', at: Date.now() };
    api('activity', { id: it.id, isFolder: !!it.isFolder })
      .then((data) => { DS.acts[it.id] = { status: 'ok', data, at: Date.now() }; })
      .catch((e) => { DS.acts[it.id] = { status: 'error', error: e.message, code: e.code, at: Date.now() }; handleAuthError(e); })
      .finally(() => { if (state.current && state.current.id === it.id) render(); });
  }
  function activitySec(f) {
    if (state.open.act) ensureActivity(f);
    let data = null, body = '';
    if (!live()) data = demoActivity(f);
    else {
      const a = DS.acts[f.id];
      if (!a || a.status === 'loading') body = loadingBox();
      else if (a.status === 'error') body = `<div class="wx-warn">${IC('alert')}<div><b>Không tải được hoạt động</b>${esc(a.error)}<button data-act="act-retry">${IC('refresh')} Thử lại</button></div></div>`;
      else data = a.data;
    }
    if (data) {
      const st = data.stats;
      const tile = (n, l, warn) => `<div class="wx-tile ${warn ? 'warn' : ''}"><b>${n}</b><span>${l}</span></div>`;
      body += `<div class="wx-tiles">
        ${tile(st.last30.all, 'Hoạt động 30 ngày')}
        ${tile(st.uniqueActors, 'Người tương tác')}
        ${tile(st.canSeePerms === false ? '—' : st.peopleWithAccess, 'Người có quyền')}
        ${f.isFolder ? tile(st.topFiles.length, 'Tệp có hoạt động') : tile(st.revisions, 'Lần chỉnh sửa')}
        ${f.isFolder ? tile(st.last30.share, 'Đổi quyền 30 ngày', st.last30.share > 0) : tile(st.comments, 'Bình luận' + (st.openComments ? ` (${st.openComments} mở)` : ''))}
        ${tile(st.isPublic ? 'Có' : 'Không', 'Link công khai', st.isPublic)}
      </div>`;
      body += `<div class="wx-kv"><span class="k">Lượt xem của người khác</span><span class="v wx-muted">Google không cung cấp*</span></div>
        <div class="wx-kv"><span class="k">Lần cuối bạn xem</span><span class="v">${esc(relTime(st.viewedByMeTime))}</span></div>
        <div class="wx-kv"><span class="k">Hoạt động gần nhất</span><span class="v">${esc(relTime(st.lastActivity))}</span></div>`;
      if (st.anonymousActs) body += `<div class="wx-kv"><span class="k">Thao tác ẩn danh (qua link)</span><span class="v">${st.anonymousActs}</span></div>`;
      if (st.editors && st.editors.length) body += `<div class="wx-kv"><span class="k">Người đã sửa</span><span class="v">${esc(st.editors.slice(0, 4).join(', '))}</span></div>`;
      if (st.commenters && st.commenters.length) body += `<div class="wx-kv"><span class="k">Người bình luận</span><span class="v">${esc(st.commenters.slice(0, 4).join(', '))}</span></div>`;
      const l = st.last30;
      body += `<div class="wx-bars">${[['Sửa', l.edit], ['Bình luận', l.comment], ['Chia sẻ', l.share], ['Di chuyển/đổi tên', l.move], ['Tạo mới', l.create]]
        .map(([k, n]) => `<div class="wx-barrow"><span>${k}</span><i><em style="width:${l.all ? Math.round((n / l.all) * 100) : 0}%"></em></i><b>${n}</b></div>`).join('')}</div>`;
      if (f.isFolder && st.topFiles.length) {
        body += `<div class="wx-subh">Tệp hoạt động nhiều nhất</div>` + st.topFiles.map((t) => `<div class="wx-kv"><span class="k">${esc(t.title)}</span><span class="v">${t.n} lần</span></div>`).join('');
      }
      const ev = data.events.slice(0, 15);
      body += `<div class="wx-subh">Nhật ký ${data.days} ngày gần nhất</div>`;
      body += ev.length ? `<div class="wx-timeline">${ev.map((e) => `<div class="wx-ev ${e.type === 'permissionChange' ? 'perm' : ''}"><span class="dot">${IC(ACT_IC[e.type] || 'info')}</span>
          <div><b>${esc(e.actor)}</b> · ${esc(e.label)}${e.target ? ` <span class="tg">${esc(e.target)}</span>` : ''}
          ${e.detail ? `<div class="dt">${esc(e.detail)}</div>` : ''}<div class="tm">${esc(relTime(e.time))}</div></div></div>`).join('')}</div>`
        : `<div class="wx-only">${IC('check-circle')} Không có hoạt động nào trong ${data.days} ngày qua.</div>`;
      if (data.activityError) body += `<div class="wx-note">Nhật ký chi tiết chưa lấy được: ${esc(data.activityError.message)}${data.activityError.code === 'SCOPE' ? ' Bấm <a data-act="connect">Kết nối lại</a> để cấp quyền xem hoạt động.' : ''}</div>`;
      body += `<div class="wx-note">* Google chỉ ghi lượt xem và người xem trên tài khoản Google Workspace (Activity dashboard). Với Gmail thường, muốn đo lượt xem/reach cần chia sẻ qua link theo dõi của Wistorix.</div>`;
    }
    return grp('chart', 'Hoạt động & số liệu', body, null, false, 'act', true);
  }

  /* ───────── RENDER ───────── */
  const isArmed = (key) => state.armed && state.armed.key === key && Date.now() - state.armed.t < 4000;
  function arm(key) {
    state.armed = { key, t: Date.now() }; render();
    setTimeout(() => { if (state.armed && state.armed.key === key) { state.armed = null; render(); } }, 4000);
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
      const s = env.storage();
      body = s ? `<div class="wx-snum"><span>Đã dùng <b>${esc(s.used)}</b> / ${esc(s.total)}</span><span>${s.pct}%</span></div><div class="wx-sbar"><i style="width:${s.pct}%"></i></div>`
        : `<div class="wx-note">Không đọc được dung lượng. Mở mục "Bộ nhớ" ở thanh bên trái của Drive.</div>`;
    }
    let free = 0, label;
    if (live()) {
      const fid = env.folderId(), s = fid && DS.scans[fid];
      if (!fid) label = 'Mở 1 thư mục để quét trùng lặp';
      else if (!s || s.status === 'loading') label = 'Đang quét thư mục này…';
      else if (s.status === 'error') label = 'Chưa quét được thư mục này';
      else { free = s.data.freeBytes; label = free ? 'Có thể giải phóng ~' + fmtSize(free) : `Không có bản trùng trong ${s.data.total} mục`; }
    } else {
      env.visible().filter((i) => !i.isFolder).forEach((i) => { const m = demoMeta(i, overrides); if (m.dups.length) free += self.WX.parseSize(i.size) * m.dups.length; });
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
    const acc = env.account();
    if (live() && DS.me && acc && DS.me.emailAddress.toLowerCase() !== acc.toLowerCase()) {
      h += `<div class="wx-warn">${IC('alert')}<div><b>Khác tài khoản</b>Widget đang kết nối <b>${esc(DS.me.emailAddress)}</b> (tài khoản Chrome), còn tab Drive đang mở <b>${esc(acc)}</b>. Kết quả có thể không khớp với tệp bạn thấy.</div></div>`;
    }
    return h;
  }

  function render() {
    $('wxAcct').textContent = (live() && DS.me && DS.me.emailAddress) || env.account() || 'Tài khoản Google';
    const pill = $('wxPill');
    pill.textContent = live() ? 'DRIVE THẬT' : 'DỮ LIỆU MẪU';
    pill.style.display = live() || CFG.showDemoPill ? '' : 'none';
    $('wxFootNote').innerHTML = live() ? `Đã kết nối Google Drive · <a data-act="disconnect">Ngắt kết nối</a>` : '';
    const b = $('wxBody');

    if (!snap) {
      b.innerHTML = topNotices() + `<div class="wx-empty"><b>Mở Google Drive</b> ở tab hiện tại để dùng Wistorix. Panel sẽ tự nhận tệp bạn chọn trên Drive.</div>
        <button class="wx-dash" data-act="open-drive" style="margin-top:4px">${IC('external')} Mở Google Drive</button>`;
      return;
    }

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
    if (!f) {
      const list = issueList();
      const fid = env.folderId(), sc = live() && fid ? DS.scans[fid] : null;
      html += `<div class="wx-empty">Chưa chọn tệp nào. <b>Bấm chọn 1 tệp trên Drive</b> hoặc <b>kéo tệp thả vào bong bóng</b> để xem chi tiết và thao tác nhanh.</div>`;
      let body;
      if (live() && !fid) body = `<div class="wx-note">Mở "Drive của tôi" hoặc một thư mục để Wistorix quét tệp công khai và trùng lặp.</div>`;
      else if (sc && sc.status === 'loading') body = loadingBox();
      else if (sc && sc.status === 'error') body = `<div class="wx-note">Không quét được: ${esc(sc.error)}</div>`;
      else {
        body = list.slice(0, 12).map((x) => {
          const desc = x.pub ? `đang công khai${x.emails ? ' · chia sẻ với ' + x.emails + ' email' : ''}${x.dup ? ' · trùng ×' + x.dup : ''}` : `trùng lặp ×${x.dup}${x.size ? ' · ' + esc(x.size) + ' mỗi bản' : ''}`;
          return `<div class="wx-alert" data-act="pick" data-id="${esc(x.id)}" data-name="${esc(x.name)}"><div class="ai ${x.pub ? 'r' : 'a'}">${IC(x.pub ? 'globe' : 'copy')}</div>
            <div class="am"><b>${esc(x.name)}</b>${desc}</div><span class="go">${IC('chev-r')}</span></div>`;
        }).join('') || `<div class="wx-only">${IC('check-circle')} Không có tệp nào cần xử lý trong thư mục đang xem.</div>`;
        if (list.length > 12) body += `<div class="wx-note">…và ${list.length - 12} tệp khác. Xem hết trên dashboard.</div>`;
      }
      html += grp('alert', `Cần xử lý · ${esc(env.folderName())}`, body, list.length || null, list.length > 0);
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

    html += activitySec(f);

    let perm = '';
    if (v.loading) perm = loadingBox();
    else if (v.error) perm = `<div class="wx-warn">${IC('alert')}<div><b>Không tải được</b>${esc(v.error)}<button data-act="retry">${IC('refresh')} Thử lại</button></div></div>`;
    else if (!v.canSeePerms) perm = `<div class="wx-only">${IC('info')} Bạn không có quyền xem danh sách chia sẻ của mục này (chỉ chủ sở hữu hoặc người chỉnh sửa mới xem được).</div>`;
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
    const folders = env.visible().filter((i) => i.isFolder && (!f || i.id !== f.id));
    const nodes = [{ id: 'root', name: 'Drive của tôi', d: 0 }].concat(folders.map((x) => ({ id: x.id, name: x.name, d: 1 })));
    return nodes.map((n) => `<div class="wx-tnode ${state.pickedFolder && state.pickedFolder.id === n.id ? 'sel' : ''}" data-act="pick-folder" data-id="${esc(n.id)}" data-name="${esc(n.name)}"><span class="pad" style="width:${n.d * 15}px"></span>${IC('folder')} ${esc(n.name)}</div>`).join('')
      + (folders.length ? '' : `<div class="wx-tnote">Mở thư mục cha trên Drive để thấy thêm thư mục đích.</div>`);
  }

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

  async function onAction(act, el) {
    const f = state.current;
    const v = f ? view(f) : null;
    switch (act) {
      case 'close': window.close(); break;
      case 'dashboard': case 'transfer': newTab(CFG.dashboardUrl); break;
      case 'open-drive': newTab('https://drive.google.com/drive/my-drive'); break;
      case 'grp': state.open[el.dataset.id] = !state.open[el.dataset.id]; render(); break;
      case 'overview': state.current = null; state.inline = null; ensureScan(); render(); break;
      case 'retry': if (f) ensureDetails(f.id, true); render(); break;
      case 'act-retry': if (f) ensureActivity(f, true); render(); break;
      case 'pick': {
        const id = el.dataset.id;
        if (tabId) chrome.tabs.sendMessage(tabId, { type: 'wx-flash', id }).catch(() => {});
        const it = env.visible().find((x) => x.id === id) || { id, name: el.dataset.name, type: 'Tệp', isFolder: false, kind: kindOf('', el.dataset.name, false), owner: '', mod: '', size: '' };
        setCurrent(it);
        break;
      }

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
        toast('Đã ngắt kết nối. Widget quay về dữ liệu mẫu.');
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
        else { setOverride(f.id, { pub: false }); render(); toast(`Đã thu hồi toàn bộ link công khai của <b>${esc(v.name)}</b>`); }
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
        else { setOverride(f.id, { dups: demoMeta(f, overrides).dups.filter((_, i) => keep[i]) }); delete state.dupKeep[f.id]; render(); toast(`Đã chuyển <b>${del.length} bản trùng</b> của <b>${esc(v.name)}</b> vào Thùng rác. Luôn giữ lại ít nhất 1 bản.`); }
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
          if (!env.folderId()) { toast('Mở "Drive của tôi" hoặc một thư mục để quét'); el.disabled = false; break; }
          await ensureScan(true);
          const s = DS.scans[env.folderId()];
          if (s && s.status === 'ok') {
            const iss = Object.values(s.data.issues);
            toast(`Quét xong <b>${esc(env.folderName())}</b>: ${s.data.total} mục · ${iss.filter((x) => x.pub).length} công khai · ${iss.filter((x) => x.dup).length} tệp trùng · giải phóng được ~${fmtSize(s.data.freeBytes)}`);
          }
          store.set('wx_bump', Date.now());
          render();
        } else {
          setTimeout(() => {
            el.disabled = false;
            const vis = env.visible().filter((i) => !i.isFolder);
            toast(`Quét xong <b>${esc(env.folderName())}</b>: ${vis.length} tệp · ${vis.filter((i) => demoMeta(i, overrides).pub).length} tệp công khai · ${vis.filter((i) => demoMeta(i, overrides).dups.length).length} nhóm trùng lặp`);
          }, 1200);
        }
        break;
      }
      default: break;
    }
  }

  /* ───────── NHẬN SNAPSHOT TỪ TAB DRIVE ───────── */
  let lastUrl = '';
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
    const sec = s.pendingSec;
    if (sec) {
      if (sec in state.open) state.open[sec] = true;
      if (sec === 'move') state.inline = 'move';
      chrome.tabs.sendMessage(tabId, { type: 'wx-sec-consumed' }).catch(() => {});
    }
    render();
    if (sec) setTimeout(() => { const el = $(sec === 'move' ? 'inlineMove' : 'sec-' + sec); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 120);
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
    const [css, sprite] = await Promise.all([
      fetch('widget.css').then((r) => r.text()),
      fetch('sprite.svg').then((r) => r.text()),
    ]);
    // widget.css viết cho Shadow DOM (:host); trong side panel dùng :root
    const st = document.createElement('style');
    st.textContent = css.replace(':host{all:initial;', ':root{');
    document.head.appendChild(st);
    document.body.insertAdjacentHTML('afterbegin', sprite);
    document.querySelectorAll('[data-logo]').forEach((e) => { e.innerHTML = LOGO; });
    document.querySelectorAll('[data-ic]').forEach((e) => { e.innerHTML = IC(e.dataset.ic); });

    overrides = await store.get('wx_overrides', {});
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
    });

    chrome.runtime.onMessage.addListener((msg, sender) => {
      if (msg && msg.type === 'wx-snapshot' && sender.tab && sender.tab.id === tabId) applySnapshot(msg.snapshot);
      return false;
    });
    chrome.tabs.onActivated.addListener(() => { state.current = null; state.lastSel = ''; attachToActiveTab(); });
    chrome.tabs.onUpdated.addListener((id, info) => { if (id === tabId && info.status === 'complete') attachToActiveTab(); });
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area === 'local' && ch.wx_overrides && !live()) { overrides = ch.wx_overrides.newValue || {}; }
    });

    await attachToActiveTab();
  }
  boot().catch((e) => { document.body.textContent = 'Không khởi động được Wistorix: ' + e.message; });
})();
