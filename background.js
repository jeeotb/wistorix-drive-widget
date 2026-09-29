/* ================================================================
   WISTORIX · DRIVE WIDGET: service worker
   - Bấm icon extension: mở/đóng panel trên tab Drive
   - Gọi Google Drive API v3 thay cho content script (chrome.identity chỉ dùng được ở đây)
   ================================================================ */

const API = 'https://www.googleapis.com/drive/v3';
const ROLE_VI = { owner: 'Chủ sở hữu', organizer: 'Người quản lý', fileOrganizer: 'Người quản lý nội dung', writer: 'Người chỉnh sửa', commenter: 'Người bình luận', reader: 'Người xem' };
const FILE_FIELDS = 'id,name,mimeType,size,quotaBytesUsed,createdTime,modifiedTime,owners(emailAddress,displayName,me),ownedByMe,parents,starred,trashed,shared,md5Checksum,webViewLink,driveId,capabilities(canRename,canTrash,canShare,canMoveItemWithinDrive,canDownload)';

chrome.action.onClicked.addListener(async (tab) => {
  try { await chrome.tabs.sendMessage(tab.id, { type: 'wx-toggle' }); }
  catch (e) { chrome.tabs.create({ url: 'https://drive.google.com/drive/my-drive' }); }
});

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
        fields: 'nextPageToken,files(id,name,mimeType,size,md5Checksum,shared,ownedByMe,permissions(type,role))',
        includeItemsFromAllDrives: 'true', corpora: 'allDrives',
      },
    });
    files.push(...(r.files || []));
    pageToken = r.nextPageToken; if (!pageToken) break;
  }
  const byMd5 = {};
  files.forEach((f) => { if (f.md5Checksum) (byMd5[f.md5Checksum] = byMd5[f.md5Checksum] || []).push(f); });
  const issues = {};
  let freeBytes = 0;
  files.forEach((f) => {
    const pub = (f.permissions || []).some(isPublicPerm);
    const group = f.md5Checksum ? byMd5[f.md5Checksum] : null;
    const dup = group && group.length > 1 ? group.length : 0;
    if (pub || dup) issues[f.id] = { pub, dup, name: f.name, size: f.size ? +f.size : 0, shared: f.shared };
  });
  Object.values(byMd5).forEach((g) => { if (g.length > 1) freeBytes += (g.length - 1) * (+g[0].size || 0); });
  return { folderId, total: files.length, issues, freeBytes, at: Date.now() };
}

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
    const a = await gfetch('/about', { query: { fields: 'user(emailAddress,displayName),storageQuota(limit,usage,usageInDrive,usageInDriveTrash)' } });
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
  scanFolder: ({ folderId }) => scanFolder(folderId),
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
  if (!msg || msg.type !== 'wx-api') return false;
  const fn = OPS[msg.op];
  if (!fn) { sendResponse({ ok: false, error: 'Thao tác không hợp lệ: ' + msg.op }); return false; }
  Promise.resolve(fn(msg.args || {}))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((e) => sendResponse({ ok: false, error: e.message || String(e), status: e.status || 0, code: e.code || '' }));
  return true; // trả lời bất đồng bộ
});
