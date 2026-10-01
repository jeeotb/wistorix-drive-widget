/* ================================================================
   WISTORIX · DRIVE WIDGET: service worker
   - Mở Side Panel (bấm icon extension hoặc bấm bong bóng trên Drive)
   - Gọi Google Drive API v3 thay cho content script (chrome.identity chỉ dùng được ở đây)
   ================================================================ */

const API = 'https://www.googleapis.com/drive/v3';
const ROLE_VI = { owner: 'Chủ sở hữu', organizer: 'Người quản lý', fileOrganizer: 'Người quản lý nội dung', writer: 'Người chỉnh sửa', commenter: 'Người bình luận', reader: 'Người xem' };
const FILE_FIELDS = 'id,name,mimeType,size,quotaBytesUsed,createdTime,modifiedTime,owners(emailAddress,displayName,me),ownedByMe,parents,starred,trashed,shared,md5Checksum,webViewLink,driveId,capabilities(canRename,canTrash,canShare,canMoveItemWithinDrive,canDownload)';

/* Bấm icon extension trên thanh Chrome: mở Side Panel Wistorix cạnh trang */
function initSidePanel() { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {}); }
chrome.runtime.onInstalled.addListener(initSidePanel);
chrome.runtime.onStartup.addListener(initSidePanel);

/* ───────── OAuth ───────── */
function clientIdReady() {
  const id = (chrome.runtime.getManifest().oauth2 || {}).client_id || '';
  return /\.apps\.googleusercontent\.com$/.test(id) && !/^YOUR_/i.test(id);
}
function getToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (res) => {
      const err = chrome.runtime.lastError;
      const token = res && typeof res === 'object' ? res.token : res;
      if (err || !token) reject(new Error((err && err.message) || 'Chưa đăng nhập Google Drive'));
      else resolve(token);
    });
  });
}
function dropToken(token) { return new Promise((r) => chrome.identity.removeCachedAuthToken({ token }, r)); }

class ApiError extends Error { constructor(msg, status, code) { super(msg); this.status = status; this.code = code; } }

async function gfetch(path, { method = 'GET', query = {}, body, interactive = false } = {}, retried = false) {
  let token;
  try { token = await getToken(interactive); }
  catch (e) { throw new ApiError(e.message, 401, 'AUTH'); }
  const qs = new URLSearchParams({ ...(path.startsWith('/files') ? { supportsAllDrives: 'true' } : {}), ...query });
  const res = await fetch(`${API}${path}?${qs}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !retried) { await dropToken(token); return gfetch(path, { method, query, body, interactive }, true); }
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = (data.error && data.error.message) || res.statusText;
    throw new ApiError(m, res.status, (data.error && data.error.errors && data.error.errors[0] && data.error.errors[0].reason) || '');
  }
  return data;
}
const qEsc = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

/* ───────── Đường dẫn thư mục (có cache) ───────── */
const folderCache = new Map(); // id -> {name, parent}
let rootId = null;
async function getRootId() {
  if (!rootId) rootId = (await gfetch('/files/root', { query: { fields: 'id' } })).id;
  return rootId;
}
async function folderInfo(id) {
  if (folderCache.has(id)) return folderCache.get(id);
  const f = await gfetch(`/files/${id}`, { query: { fields: 'id,name,parents' } });
  const v = { name: f.name, parent: (f.parents || [])[0] || null };
  folderCache.set(id, v);
  return v;
}
async function pathOf(parents) {
  if (!parents || !parents.length) return 'Được chia sẻ với tôi';
  const root = await getRootId().catch(() => null);
  const names = [];
  let cur = parents[0];
  for (let i = 0; i < 8 && cur; i++) {
    if (cur === root) { names.unshift('Drive của tôi'); return names.join(' › '); }
    try { const f = await folderInfo(cur); names.unshift(f.name); cur = f.parent; }
    catch (e) { names.unshift('…'); break; }
  }
  if (names.length > 4) names.splice(1, names.length - 3, '…');
  return names.join(' › ');
}

/* ───────── Quyền chia sẻ ───────── */
async function listPerms(fileId) {
  try {
    const r = await gfetch(`/files/${fileId}/permissions`, { query: { fields: 'permissions(id,type,role,emailAddress,displayName,domain,expirationTime,deleted)', pageSize: '100' } });
    return { canSee: true, perms: (r.permissions || []).filter((p) => !p.deleted) };
  } catch (e) {
    if (e.status === 403) return { canSee: false, perms: [] };
    throw e;
  }
}
const isPublicPerm = (p) => p.type === 'anyone' || p.type === 'domain';

/* ───────── Trùng lặp ───────── */
const normName = (n) => String(n || '').toLowerCase().replace(/^(bản sao của|copy of)\s+/, '').replace(/\s*\(\d+\)(?=(\.[^.]+)?$)/, '').trim();
async function findDups(file) {
  if (file.mimeType === 'application/vnd.google-apps.folder') return [];
  const stem = file.name.replace(/\.[^.]+$/, '').replace(/^(Bản sao của|Copy of)\s+/i, '').replace(/\s*\(\d+\)$/, '').trim().slice(0, 80);
  if (!stem) return [];
  const q = `trashed = false and mimeType = '${qEsc(file.mimeType)}' and name contains '${qEsc(stem)}'`;
  const r = await gfetch('/files', { query: { q, pageSize: '100', fields: 'files(id,name,size,md5Checksum,modifiedTime,createdTime,parents,ownedByMe)', includeItemsFromAllDrives: 'true', corpora: 'allDrives' } });
  const same = (r.files || []).filter((f) => f.id !== file.id && (file.md5Checksum ? f.md5Checksum === file.md5Checksum : normName(f.name) === normName(file.name)));
  const out = [];
  for (const f of same.slice(0, 10)) {
    out.push({ id: f.id, name: f.name, size: f.size ? +f.size : 0, modifiedTime: f.modifiedTime, ownedByMe: f.ownedByMe, exact: !!file.md5Checksum, path: await pathOf(f.parents).catch(() => '…') });
  }
  return out;
}

/* ───────── Quét 1 thư mục (badge + "Cần xử lý") ───────── */
async function scanFolder(folderId) {
  const files = [];
  let pageToken;
  for (let i = 0; i < 3; i++) {
    const r = await gfetch('/files', {
      query: {
        q: `'${qEsc(folderId)}' in parents and trashed = false`,
        pageSize: '200', ...(pageToken ? { pageToken } : {}),
        fields: 'nextPageToken,files(id,name,mimeType,size,md5Checksum,shared,ownedByMe,permissions(type,role,emailAddress,domain))',
        includeItemsFromAllDrives: 'true', corpora: 'allDrives',
      },
    });
    files.push(...(r.files || []));
    pageToken = r.nextPageToken; if (!pageToken) break;
  }
  const byMd5 = {};
  files.forEach((f) => { if (f.md5Checksum) (byMd5[f.md5Checksum] = byMd5[f.md5Checksum] || []).push(f); });
  const issues = {}, shared = {}, people = new Set();
  let freeBytes = 0;
  files.forEach((f) => {
    const pub = (f.permissions || []).some(isPublicPerm);
    const group = f.md5Checksum ? byMd5[f.md5Checksum] : null;
    const dup = group && group.length > 1 ? group.length : 0;
    if (pub || dup) issues[f.id] = { pub, dup, name: f.name, size: f.size ? +f.size : 0, shared: f.shared };
    const who = (f.permissions || []).filter((p) => (p.type === 'user' || p.type === 'group') && p.role !== 'owner' && p.emailAddress);
    who.forEach((p) => people.add(p.emailAddress.toLowerCase()));
    if (who.length) shared[f.id] = { name: f.name, emails: who.length, isFolder: f.mimeType === 'application/vnd.google-apps.folder' };
  });
  Object.values(byMd5).forEach((g) => { if (g.length > 1) freeBytes += (g.length - 1) * (+g[0].size || 0); });
  const dupGroups = Object.values(byMd5).filter((g) => g.length > 1).length;
  return { folderId, total: files.length, issues, shared, people: [...people], dupGroups, freeBytes, at: Date.now() };
}

/* ================================================================
   HOẠT ĐỘNG & SỐ LIỆU
   - Drive Activity API v2: sửa, bình luận, chia sẻ/thu hồi quyền, di chuyển, đổi tên, tạo, xoá, khôi phục
     (thư mục: lấy hoạt động của mọi tệp bên trong, qua ancestorName)
   - Drive API: revisions (lịch sử chỉnh sửa, ai sửa), comments (bình luận, người tương tác), permissions,
     viewedByMeTime (lần cuối BẠN xem)
   LƯU Ý: Google KHÔNG trả số lượt xem của người khác qua API cho tài khoản Gmail thường.
   Chỉ Google Workspace mới có "Activity dashboard" (xem trong giao diện Drive) và Admin Reports API.
   ================================================================ */
async function authFetch(url, { method = 'GET', body } = {}, retried = false) {
  let token;
  try { token = await getToken(false); } catch (e) { throw new ApiError(e.message, 401, 'AUTH'); }
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401 && !retried) { await dropToken(token); return authFetch(url, { method, body }, true); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = (data.error && data.error.message) || res.statusText;
    const reason = (data.error && data.error.status) || '';
    throw new ApiError(m, res.status, res.status === 403 && /insufficient|scope/i.test(m) ? 'SCOPE' : reason);
  }
  return data;
}

const ACT_VI = {
  create: 'Tạo mới', edit: 'Chỉnh sửa', move: 'Di chuyển', rename: 'Đổi tên', delete: 'Xoá', restore: 'Khôi phục',
  permissionChange: 'Thay đổi quyền', comment: 'Bình luận', dlpChange: 'Chính sách DLP', reference: 'Liên kết', settingsChange: 'Đổi cài đặt', appliedLabelChange: 'Gắn nhãn',
};
const actType = (d) => Object.keys(d || {})[0] || 'other';

async function activityOf({ id, isFolder, days = 90 }) {
  const since = new Date(Date.now() - days * 864e5).toISOString();
  const [me, perm, file, revs, comments] = await Promise.all([
    gfetch('/about', { query: { fields: 'user(emailAddress,displayName,permissionId)' } }).then((a) => a.user).catch(() => null),
    listPerms(id),
    gfetch(`/files/${id}`, { query: { fields: 'id,name,mimeType,createdTime,modifiedTime,viewedByMeTime,sharedWithMeTime,shared,ownedByMe,sharingUser(displayName,emailAddress),lastModifyingUser(displayName,emailAddress)' } }),
    isFolder ? Promise.resolve([]) : gfetch(`/files/${id}/revisions`, { query: { pageSize: '200', fields: 'revisions(id,modifiedTime,lastModifyingUser(displayName,emailAddress,permissionId,me))' } }).then((r) => r.revisions || []).catch(() => []),
    isFolder ? Promise.resolve([]) : gfetch(`/files/${id}/comments`, { query: { pageSize: '100', includeDeleted: 'false', fields: 'comments(id,createdTime,resolved,author(displayName,emailAddress,me),replies(author(displayName,me)))' } }).then((r) => r.comments || []).catch(() => []),
  ]);

  // Drive Activity API: tối đa 3 trang x 100 sự kiện
  let activities = [], activityError = null, pageToken;
  try {
    for (let i = 0; i < 3; i++) {
      const body = { [isFolder ? 'ancestorName' : 'itemName']: `items/${file.id || id}`, pageSize: 100, filter: `time >= "${since}"`, ...(pageToken ? { pageToken } : {}) };
      const r = await authFetch('https://driveactivity.googleapis.com/v2/activity:query', { method: 'POST', body });
      activities.push(...(r.activities || []));
      pageToken = r.nextPageToken; if (!pageToken) break;
    }
  } catch (e) { pageToken = null; activityError = { message: e.message, code: e.code || '' }; }

  // people/<id> -> tên. permission.id của người dùng trùng với id người (Gaia ID)
  const people = {};
  if (me && me.permissionId) people[me.permissionId] = { name: 'Bạn', email: me.emailAddress, me: true };
  perm.perms.forEach((p) => { if (p.type === 'user' || p.type === 'group') people[p.id] = people[p.id] || { name: p.displayName || p.emailAddress, email: p.emailAddress }; });
  revs.forEach((r) => { const u = r.lastModifyingUser; if (u && u.permissionId) people[u.permissionId] = people[u.permissionId] || { name: u.me ? 'Bạn' : (u.displayName || u.emailAddress), email: u.emailAddress, me: u.me }; });
  const who = (u) => {
    if (!u) return 'Không rõ';
    if (u.knownUser) {
      if (u.knownUser.isCurrentUser) return 'Bạn';
      const pid = String(u.knownUser.personName || '').replace('people/', '');
      return (people[pid] && people[pid].name) || 'Người dùng khác';
    }
    if (u.deletedUser) return 'Tài khoản đã xoá';
    if (u.unknownUser) return 'Người dùng ẩn danh';
    return 'Không rõ';
  };
  const actorOf = (a) => {
    const x = (a.actors || [])[0] || {};
    if (x.user) return who(x.user);
    if (x.anonymous) return 'Người ẩn danh (qua link công khai)';
    if (x.administrator) return 'Quản trị viên';
    if (x.system) return 'Hệ thống';
    if (x.impersonation) return who(x.impersonation.impersonatedUser);
    return 'Không rõ';
  };
  const permTarget = (p) => (p.user ? who(p.user) : p.group ? (p.group.email || p.group.title) : p.domain ? 'Mọi người trong ' + p.domain.name : p.anyone ? 'Bất kỳ ai có link' : '?');
  const roleVi = (r) => ({ OWNER: 'chủ sở hữu', ORGANIZER: 'quản lý', FILE_ORGANIZER: 'quản lý nội dung', EDITOR: 'chỉnh sửa', COMMENTER: 'bình luận', VIEWER: 'xem', PUBLISHED_VIEWER: 'xem bản công bố' }[r] || String(r || '').toLowerCase());

  const events = activities.map((a) => {
    const d = a.primaryActionDetail || {};
    const type = actType(d);
    const t = (a.targets || [])[0] || {};
    const item = t.driveItem || {};
    let detail = '';
    if (type === 'permissionChange') {
      const add = (d.permissionChange.addedPermissions || []).map((p) => `+ ${permTarget(p)} (${roleVi(p.role)})`);
      const rm = (d.permissionChange.removedPermissions || []).map((p) => `− ${permTarget(p)}`);
      detail = add.concat(rm).join(', ');
    } else if (type === 'rename') detail = `${d.rename.oldTitle || ''} → ${d.rename.newTitle || ''}`;
    else if (type === 'comment') detail = d.comment.post ? 'Bình luận' : d.comment.assignment ? 'Giao việc' : d.comment.suggestion ? 'Đề xuất' : 'Bình luận';
    else if (type === 'create') detail = d.create.upload ? 'Tải lên' : d.create.copy ? 'Tạo bản sao' : 'Tạo mới';
    else if (type === 'move') detail = 'Đổi thư mục';
    return {
      time: a.timestamp || (a.timeRange && a.timeRange.endTime) || '',
      type, label: ACT_VI[type] || type, actor: actorOf(a), detail,
      target: item.title || '', targetId: String(item.name || '').replace('items/', ''), mime: item.mimeType || '',
    };
  }).sort((x, y) => (y.time > x.time ? 1 : -1));

  // số liệu
  const d30 = Date.now() - 30 * 864e5;
  const recent = events.filter((e) => new Date(e.time).getTime() >= d30);
  const count = (arr, type) => arr.filter((e) => e.type === type).length;
  const actorSet = new Set(events.map((e) => e.actor).filter((x) => x && x !== 'Bạn'));
  const topFiles = {};
  if (isFolder) events.forEach((e) => { if (e.targetId && e.targetId !== id && e.targetId !== file.id) { const k = e.targetId; topFiles[k] = topFiles[k] || { id: k, title: e.target, n: 0 }; topFiles[k].n++; } });
  const commenters = new Set();
  comments.forEach((c) => { if (c.author && !c.author.me) commenters.add(c.author.displayName); (c.replies || []).forEach((r) => { if (r.author && !r.author.me) commenters.add(r.author.displayName); }); });
  const editors = new Set(revs.map((r) => r.lastModifyingUser && (r.lastModifyingUser.me ? 'Bạn' : r.lastModifyingUser.displayName)).filter(Boolean));
  const accessPeople = perm.perms.filter((p) => p.type === 'user' || p.type === 'group');
  // tách hoạt động của BẠN và của NGƯỜI KHÁC: tab Hiệu quả chỉ có nghĩa khi nhìn phần người khác
  const isMe = (e) => e.actor === 'Bạn';
  const split = (arr) => ({ all: arr.length, edit: count(arr, 'edit'), comment: count(arr, 'comment'), share: count(arr, 'permissionChange'), move: count(arr, 'move') + count(arr, 'rename'), create: count(arr, 'create') });
  const others30 = recent.filter((e) => !isMe(e));
  const actorCount = {};
  others30.forEach((e) => { actorCount[e.actor] = (actorCount[e.actor] || 0) + 1; });

  return {
    days, since, activityError,
    events: events.slice(0, 60),
    stats: {
      total: events.length,
      last30: { all: recent.length, edit: count(recent, 'edit'), comment: count(recent, 'comment'), share: count(recent, 'permissionChange'), move: count(recent, 'move') + count(recent, 'rename'), create: count(recent, 'create') },
      byType: Object.fromEntries(Object.keys(ACT_VI).map((k) => [k, count(events, k)]).filter(([, n]) => n)),
      uniqueActors: actorSet.size,
      anonymousActs: events.filter((e) => /ẩn danh/.test(e.actor)).length,
      lastActivity: events[0] ? events[0].time : null,
      revisions: revs.length, editors: [...editors],
      comments: comments.length, openComments: comments.filter((c) => !c.resolved).length, commenters: [...commenters],
      peopleWithAccess: accessPeople.length, canSeePerms: perm.canSee,
      isPublic: perm.perms.some(isPublicPerm),
      viewedByMeTime: file.viewedByMeTime || null, sharedWithMeTime: file.sharedWithMeTime || null,
      sharingUser: file.sharingUser || null, createdTime: file.createdTime, modifiedTime: file.modifiedTime,
      topFiles: Object.values(topFiles).sort((a, b) => b.n - a.n).slice(0, 5),
      filesTouched: Object.keys(topFiles).length,
      mine30: split(recent.filter(isMe)), others30: split(others30),
      othersActors30: Object.keys(actorCount).length,
      topActors: Object.entries(actorCount).map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 5),
      sharedWith: accessPeople.filter((p) => p.role !== 'owner').length,
      truncated: !!pageToken,
    },
  };
}

const scanCache = new Map(); // folderId -> {at, data}: bong bóng và side panel dùng chung
const MUTATING = new Set(['revokePerm', 'revokePublic', 'setExpiry', 'rename', 'star', 'trash', 'move']);

/* ───────── Các thao tác ───────── */
const OPS = {
  async status() {
    if (!clientIdReady()) return { ready: false, reason: 'NO_CLIENT_ID', extId: chrome.runtime.id };
    try { await getToken(false); return { ready: true, connected: true }; }
    catch (e) { return { ready: true, connected: false }; }
  },
  async connect() {
    if (!clientIdReady()) throw new ApiError('Chưa cấu hình OAuth Client ID trong manifest.json', 0, 'NO_CLIENT_ID');
    await getToken(true);
    return OPS.about();
  },
  async disconnect() {
    try {
      const t = await getToken(false);
      await fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t), { method: 'POST' }).catch(() => {});
      await dropToken(t);
    } catch (e) { /* đã ngắt */ }
    return { ok: true };
  },
  async about() {
    const a = await gfetch('/about', { query: { fields: 'user(emailAddress,displayName,permissionId),storageQuota(limit,usage,usageInDrive,usageInDriveTrash)' } });
    return a;
  },
  async details({ id }) {
    const f = await gfetch(`/files/${id}`, { query: { fields: FILE_FIELDS } });
    const [perm, path, dups] = await Promise.all([
      listPerms(id),
      pathOf(f.parents).catch(() => '…'),
      findDups(f).catch(() => []),
    ]);
    return {
      file: f, path, dups,
      canSeePerms: perm.canSee,
      perms: perm.perms.map((p) => ({ ...p, roleVi: ROLE_VI[p.role] || p.role })),
    };
  },
  async scanFolder({ folderId, force }) {
    const c = scanCache.get(folderId);
    if (!force && c && Date.now() - c.at < 60e3) return c.data;
    const data = await scanFolder(folderId);
    scanCache.set(folderId, { at: Date.now(), data });
    return data;
  },
  activity: (args) => activityOf(args),
  async revokePerm({ id, permId }) { await gfetch(`/files/${id}/permissions/${permId}`, { method: 'DELETE' }); return { ok: true }; },
  async revokePublic({ ids }) {
    let n = 0;
    for (const id of ids) {
      const { perms } = await listPerms(id);
      for (const p of perms.filter(isPublicPerm)) { await gfetch(`/files/${id}/permissions/${p.id}`, { method: 'DELETE' }); n++; }
    }
    return { removed: n };
  },
  async setExpiry({ id, days }) {
    const { perms } = await listPerms(id);
    const targets = perms.filter((p) => (p.type === 'user' || p.type === 'group') && p.role !== 'owner');
    let ok = 0, fail = 0, lastErr = '';
    for (const p of targets) {
      try {
        if (days) await gfetch(`/files/${id}/permissions/${p.id}`, { method: 'PATCH', body: { role: p.role, expirationTime: new Date(Date.now() + days * 864e5).toISOString() } });
        else await gfetch(`/files/${id}/permissions/${p.id}`, { method: 'PATCH', query: { removeExpiration: 'true' }, body: { role: p.role } });
        ok++;
      } catch (e) { fail++; lastErr = e.message; }
    }
    return { ok, fail, lastErr, total: targets.length };
  },
  async rename({ id, name }) { return gfetch(`/files/${id}`, { method: 'PATCH', body: { name }, query: { fields: 'id,name' } }); },
  async star({ id, starred }) { return gfetch(`/files/${id}`, { method: 'PATCH', body: { starred }, query: { fields: 'id,starred' } }); },
  async trash({ ids }) {
    for (const id of ids) await gfetch(`/files/${id}`, { method: 'PATCH', body: { trashed: true }, query: { fields: 'id' } });
    return { trashed: ids.length };
  },
  async move({ ids, to }) {
    const dest = to === 'root' ? await getRootId() : to;
    for (const id of ids) {
      const f = await gfetch(`/files/${id}`, { query: { fields: 'parents' } });
      await gfetch(`/files/${id}`, { method: 'PATCH', query: { addParents: dest, removeParents: (f.parents || []).join(','), fields: 'id,parents' }, body: {} });
    }
    return { moved: ids.length };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'wx-open-panel' && sender.tab) {
    // gọi ngay (đồng bộ) để còn giữ thao tác bấm của người dùng
    chrome.sidePanel.open({ windowId: sender.tab.windowId }).catch((e) => console.warn('[Wistorix] không mở được side panel', e));
    return false;
  }
  if (!msg || msg.type !== 'wx-api') return false;
  if (MUTATING.has(msg.op)) scanCache.clear();
  const fn = OPS[msg.op];
  if (!fn) { sendResponse({ ok: false, error: 'Thao tác không hợp lệ: ' + msg.op }); return false; }
  Promise.resolve(fn(msg.args || {}))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: e.message || String(e), status: e.status || 0, code: e.code || '' }));
  return true; // trả lời bất đồng bộ
});
