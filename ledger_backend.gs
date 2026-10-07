const SESSION_DAYS = 30;
const TZ = 'Asia/Taipei';

const ACTIONS = {
  register: register_,
  login: login_,
  logout: logout_,
  me: me_,
  getBootstrap: getBootstrap_,
  getLedger: getLedger_,
  addTransaction: addTransaction_
};

// ---------- 入口 ----------
function doGet() {
  return json_({ ok: true, data: 'family ledger api is running' });
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const handler = ACTIONS[req.action];
    if (!handler) throw new Error('unknown_action');
    return json_({ ok: true, data: handler(req) });
  } catch (err) {
    return json_({ ok: false, error: err.message || String(err) });
  }
}

// ---------- 自動感應 Sheet 手動修改 ----------
// 當你在 Google Sheet 介面上手動修改/刪除任何內容時，自動使快取失效
function onEdit(e) {
  invalidateLedgerCache_();
}

// ---------- 快取管理工具 ----------
function getLedgerVersion_() {
  const cache = CacheService.getScriptCache();
  let ver = cache.get('ledger_version');
  if (!ver) {
    ver = String(Date.now());
    cache.put('ledger_version', ver, 21600); // 預設存 6 小時
  }
  return ver;
}

function invalidateLedgerCache_() {
  CacheService.getScriptCache().put('ledger_version', String(Date.now()), 21600);
}

// ---------- 一般工具 ----------
let CATEGORIES_CACHE = null;

function getCategoriesMap_() {
  if (CATEGORIES_CACHE) return CATEGORIES_CACHE;
  const rows = rows_('Categories');
  CATEGORIES_CACHE = {};
  rows.forEach(c => { CATEGORIES_CACHE[c.category_id] = c; });
  return CATEGORIES_CACHE;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function sheet_(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

// 讀取指定工作表全表轉物件陣列
function rows_(name) {
  const sh = sheet_(name);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];
  const head = values.shift();
  return values.map((r, i) => {
    const o = { _row: i + 2 };
    head.forEach((h, j) => { o[h] = r[j]; });
    return o;
  });
}

function hash_(salt, password) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, salt + password, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

function newToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function today_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

function itemKey_(s) {
  return String(s).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

// 建立 Session 時同步寫入 display_name，加速後續 auth 查詢
function createSession_(userId, displayName) {
  const token = newToken_();
  const expires = Date.now() + SESSION_DAYS * 24 * 3600 * 1000;
  sheet_('Sessions').appendRow([token, userId, expires, displayName]);
  
  const user = { user_id: userId, display_name: displayName };
  CacheService.getScriptCache().put('s_' + token, JSON.stringify(user), 21600); // 6小時
  return { token: token, expires_at: expires, user: user };
}

// 身份驗證
function auth_(token) {
  if (!token) throw new Error('unauthorized');
  const cache = CacheService.getScriptCache();
  const hit = cache.get('s_' + token);
  if (hit) return JSON.parse(hit);

  // 快取未命中時，只需查 Sessions 頁
  const s = rows_('Sessions').find(x => String(x.token) === String(token));
  if (!s || Number(s.expires_at) < Date.now()) throw new Error('unauthorized');

  const user = { user_id: s.user_id, display_name: s.display_name || '' };
  cache.put('s_' + token, JSON.stringify(user), 21600);
  return user;
}

// ---------- 帳號 API ----------
function register_(req) {
  const username = String(req.username || '').trim();
  const password = String(req.password || '');
  const displayName = String(req.display_name || '').trim() || username;
  const invite = String(req.invite_code || '');

  if (username.length < 2 || username.length > 20) throw new Error('username_length');
  if (password.length < 6) throw new Error('password_too_short');
  if (invite !== PropertiesService.getScriptProperties().getProperty('INVITE_CODE')) {
    throw new Error('bad_invite_code');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const taken = rows_('Users').some(
      u => String(u.username).toLowerCase() === username.toLowerCase());
    if (taken) throw new Error('username_taken');

    const userId = 'u' + Utilities.getUuid().slice(0, 8);
    const salt = Utilities.getUuid();
    sheet_('Users').appendRow([userId, username, hash_(salt, password), salt, displayName, new Date()]);
    
    const session = createSession_(userId, displayName);
    return {
      ...session,
      bootstrap: getBootstrap_({ token: session.token }),
      ledger: getLedger_({ token: session.token, limit: 10 })
    };
  } finally {
    lock.releaseLock();
  }
}

function login_(req) {
  const username = String(req.username || '').trim().toLowerCase();
  const password = String(req.password || '');
  const u = rows_('Users').find(x => String(x.username).toLowerCase() === username);
  if (!u || hash_(String(u.salt), password) !== String(u.password_hash)) {
    throw new Error('invalid_credentials');
  }
  const session = createSession_(u.user_id, u.display_name);
  
  // 併包回傳：一次給齊 session、bootstrap 與初始 ledger 資料
  return {
    ...session,
    bootstrap: getBootstrap_({ token: session.token }),
    ledger: getLedger_({ token: session.token, limit: 10 })
  };
}

function logout_(req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const s = rows_('Sessions').find(x => String(x.token) === String(req.token));
    CacheService.getScriptCache().remove('s_' + req.token);
    if (s) sheet_('Sessions').deleteRow(s._row);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function me_(req) {
  return auth_(req.token);
}

// ---------- 記帳相關 API ----------
function getLedger_(req) {
  auth_(req.token);
  const from = String(req.from || '0000-00-00'), to = String(req.to || '9999-99-99');
  const offset = Math.max(0, Number(req.offset) || 0);
  const limit = Math.min(50, Math.max(1, Number(req.limit) || 10));

  // 動態版本快取 Key
  const ver = getLedgerVersion_();
  const cacheKey = `ledger_${ver}_${from}_${to}_${offset}_${limit}`;
  const cache = CacheService.getScriptCache();
  const cachedData = cache.get(cacheKey);
  
  if (cachedData) {
    return JSON.parse(cachedData); // 極速回傳！
  }

  const r2 = x => Math.round(x * 100) / 100;
  const sh = sheet_('Transactions');
  const n = sh.getLastRow() - 1;
  const vals = n > 0 ? sh.getRange(2, 1, n, 9).getValues() : [];

  let total = 0, income = 0, expense = 0;
  const hit = [];
  vals.forEach((r, i) => {
    const date = r[1] instanceof Date ? Utilities.formatDate(r[1], TZ, 'yyyy-MM-dd') : String(r[1]);
    const amt = Number(r[6]) || 0, sign = r[3] === 'income' ? 1 : -1;
    total += sign * amt;
    if (date >= from && date <= to) {
      if (sign > 0) income += amt; else expense += amt;
      hit.push({ i: i, date: date, r: r });
    }
  });

  hit.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : b.i - a.i);
  const rows = hit.slice(offset, offset + limit).map(h => ({
    tx_id: h.r[0], date: h.date, user_id: h.r[2], type: h.r[3], category_id: h.r[4],
    item_name: h.r[5], amount: Number(h.r[6]), note: h.r[7]
  }));

  const result = {
    rows: rows,
    has_more: offset + limit < hit.length,
    summary: { income: r2(income), expense: r2(expense), balance: r2(income - expense) },
    total_balance: r2(total)
  };

  // 寫入快取
  cache.put(cacheKey, JSON.stringify(result), 3600);
  return result;
}

function getBootstrap_(req) {
  const user = auth_(req.token);

  const categories = rows_('Categories')
    .sort((a, b) => Number(a.sort) - Number(b.sort))
    .map(c => ({ category_id: c.category_id, name: c.name, type: c.type, icon: c.icon }));

  const items = rows_('Items')
    .sort((a, b) => Number(b.use_count) - Number(a.use_count) || String(a.name).localeCompare(String(b.name)))
    .map(i => ({ item_id: i.item_id, category_id: i.category_id, name: i.name, use_count: Number(i.use_count) }));

  const users = rows_('Users').map(u => ({
    user_id: u.user_id, display_name: u.display_name
  }));

  return { user: user, categories: categories, items: items, users: users };
}

function touchItem_(categoryId, name, userId) {
  const sh = sheet_('Items');
  const key = itemKey_(name);
  const found = rows_('Items').find(i => i.category_id === categoryId && itemKey_(i.name) === key);
  const now = Date.now();

  if (found) {
    const count = Number(found.use_count || 0) + 1;
    sh.getRange(found._row, 5, 1, 2).setValues([[count, now]]);
    return { item_id: found.item_id, category_id: categoryId, name: found.name, use_count: count, is_new: false };
  }

  const item = {
    item_id: 'i' + Utilities.getUuid().replace(/-/g, '').slice(0, 8),
    category_id: categoryId, name: name, use_count: 1, is_new: true
  };
  sh.appendRow([item.item_id, categoryId, name, userId, 1, now]);
  return item;
}

function addTransaction_(req) {
  const user = auth_(req.token);

  const date = req.date ? String(req.date) : today_();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime())) {
    throw new Error('bad_date');
  }

  const amount = Math.round(Number(req.amount) * 100) / 100;
  if (!isFinite(amount) || amount <= 0) throw new Error('bad_amount');

  const itemName = String(req.item_name || '').trim().slice(0, 30);
  const note = String(req.note || '').trim().slice(0, 100);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const catMap = getCategoriesMap_();
    const cat = catMap[req.category_id];
    if (!cat) throw new Error('bad_category');

    const item = itemName ? touchItem_(cat.category_id, itemName, user.user_id) : null;

    const tx = {
      tx_id: 't' + Utilities.getUuid().replace(/-/g, '').slice(0, 12),
      date: date,
      user_id: user.user_id,
      type: cat.type,
      category_id: cat.category_id,
      item_name: item ? item.name : '',
      amount: amount,
      note: note,
      created_at: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss')
    };
    sheet_('Transactions').appendRow([
      tx.tx_id, tx.date, tx.user_id, tx.type, tx.category_id,
      tx.item_name, tx.amount, tx.note, tx.created_at
    ]);

    // 透過 App 新增帳目時，自動更新版本號，使歷史快取全面作廢
    invalidateLedgerCache_();
    
    return { transaction: tx, item: item };
  } finally {
    lock.releaseLock();
  }
}