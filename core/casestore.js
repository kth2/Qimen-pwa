/**
 * 奇门·案例存储(CaseStore) core —— 本机持久化，可注入后端、可移植。【Phase 5】
 *
 * 存哪儿：**只存在这台设备上**（浏览器 IndexedDB），不上传、不同步、不经过任何服务器。
 * 案例里含着用户问的私事（病、官司、感情），这类内容离开设备就收不回来了，
 * 故本模块**不提供任何联网写出口**；要带走数据只有一条路——用户自己点导出，拿到一份 JSON。
 *
 * 为什么把后端做成可注入：IndexedDB 只存在于浏览器，Node 里跑不了。若直接写死，
 * 这一层就永远无法单测，而它恰恰是最不能坏的一层（坏了＝用户攒的案例全没）。
 * 故定义一个极小的 KV 契约，浏览器用 IndexedDB 实现，测试用内存实现，两者跑同一套用例。
 *
 * 契约：backend = { get(key), set(key,val), del(key), keys(), clear() }，各返回 Promise。
 *
 * 边界：
 *   ① 不解释业务——记录长什么样、怎么统计，全在 core/casebook.js；本模块只管存取。
 *   ② 导入默认**合并而非覆盖**，且同 id 以「更新时间较新者」胜，避免一次误操作抹掉历史。
 *   ③ 容量有上限提示：手机存储写满会静默失败，故 save 失败必须抛出让界面看得见。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CaseStore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var VERSION = '5.0.0';
  var DB_NAME = 'qimen-casebook';
  var STORE = 'cases';
  var KEY_PREFIX = 'case:';
  var OVERLAY_KEY = 'overlay';
  var ACCEPTED_KEY = 'accepted';

  /* ---------- 内存后端：测试用，也作 IndexedDB 不可用时的兜底（当次会话有效） ---------- */
  function memoryBackend(seed) {
    var m = {};
    if (seed) for (var k in seed) m[k] = seed[k];
    return {
      name: 'memory',
      get: function (k) { return Promise.resolve(Object.prototype.hasOwnProperty.call(m, k) ? m[k] : null); },
      set: function (k, v) { m[k] = v; return Promise.resolve(true); },
      del: function (k) { delete m[k]; return Promise.resolve(true); },
      keys: function () { return Promise.resolve(Object.keys(m)); },
      clear: function () { m = {}; return Promise.resolve(true); }
    };
  }

  /* ---------- IndexedDB 后端：浏览器实际使用 ---------- */
  function idbBackend() {
    var idb = (typeof indexedDB !== 'undefined') ? indexedDB : null;
    if (!idb) return null;
    var dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (resolve, reject) {
        var req = idb.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
          var db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error || new Error('IndexedDB 打开失败')); };
      });
      return dbp;
    }
    function tx(mode, fn) {
      return open().then(function (db) {
        return new Promise(function (resolve, reject) {
          var t = db.transaction(STORE, mode);
          var s = t.objectStore(STORE);
          var out = fn(s);
          t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : true); };
          t.onerror = function () { reject(t.error || new Error('IndexedDB 事务失败')); };
          t.onabort = function () { reject(t.error || new Error('IndexedDB 事务中止（可能是存储配额已满）')); };
        });
      });
    }
    return {
      name: 'indexeddb',
      get: function (k) { return tx('readonly', function (s) { return s.get(k); }).then(function (v) { return v === undefined ? null : v; }); },
      set: function (k, v) { return tx('readwrite', function (s) { s.put(v, k); return null; }); },
      del: function (k) { return tx('readwrite', function (s) { s.delete(k); return null; }); },
      keys: function () { return tx('readonly', function (s) { return s.getAllKeys(); }); },
      clear: function () { return tx('readwrite', function (s) { s.clear(); return null; }); }
    };
  }

  /** 默认后端：浏览器取 IndexedDB，取不到（Node/隐私模式）退回内存并如实标明。 */
  function defaultBackend() { return idbBackend() || memoryBackend(); }

  function create(backend) {
    var be = backend || defaultBackend();
    var persistent = be.name === 'indexeddb';

    /** id 用时间戳 + 随机后缀：不依赖自增，导入合并时不会撞号。 */
    function newId(now) {
      var t = (now ? new Date(now) : new Date()).toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
      return 'c' + t + '-' + Math.random().toString(36).slice(2, 8);
    }

    function save(rec) {
      if (!rec || !rec.id) return Promise.reject(new Error('案例缺 id，拒绝写入'));
      return be.set(KEY_PREFIX + rec.id, rec).then(function () { return rec; })
        .catch(function (e) {
          // 配额写满时浏览器会抛；必须让界面看得见，否则用户以为存上了
          throw new Error('保存失败（可能是设备存储已满）：' + (e.message || e));
        });
    }
    function get(id) { return be.get(KEY_PREFIX + id); }
    function remove(id) { return be.del(KEY_PREFIX + id); }

    function list() {
      return be.keys().then(function (ks) {
        var caseKeys = (ks || []).filter(function (k) { return String(k).indexOf(KEY_PREFIX) === 0; });
        return Promise.all(caseKeys.map(function (k) { return be.get(k); }));
      }).then(function (rows) {
        return rows.filter(Boolean).sort(function (a, b) {
          return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));   // 新的在前
        });
      });
    }

    function getOverlay() { return be.get(OVERLAY_KEY); }
    function setOverlay(o) { return be.set(OVERLAY_KEY, o); }
    function getAccepted() { return be.get(ACCEPTED_KEY).then(function (v) { return v || []; }); }
    function setAccepted(list_) { return be.set(ACCEPTED_KEY, list_ || []); }

    /** 导出：本机数据的唯一出口，由用户主动触发。 */
    function exportAll(now) {
      return Promise.all([list(), getOverlay(), getAccepted()]).then(function (r) {
        return {
          format: 'qimen-casebook', version: VERSION,
          exportedAt: now || '', count: r[0].length,
          cases: r[0], overlay: r[1] || null, accepted: r[2] || []
        };
      });
    }

    /**
     * 导入。默认**合并**：同 id 取 feedback.recordedAt / createdAt 较新者，
     * 绝不因一次导入把本机历史整片覆盖掉。replace:true 才清空重建。
     */
    function importAll(data, opts) {
      opts = opts || {};
      if (!data || data.format !== 'qimen-casebook') {
        return Promise.reject(new Error('不是本应用导出的案例文件'));
      }
      var incoming = (data.cases || []).filter(function (c) { return c && c.id; });
      var start = opts.replace ? be.clear() : Promise.resolve();
      return start.then(function () { return opts.replace ? [] : list(); }).then(function (existing) {
        var have = {};
        existing.forEach(function (c) { have[c.id] = c; });
        var added = 0, updated = 0, skipped = 0;
        var ops = incoming.map(function (c) {
          var old = have[c.id];
          if (!old) { added++; return save(c); }
          var stampNew = (c.feedback && c.feedback.recordedAt) || c.createdAt || '';
          var stampOld = (old.feedback && old.feedback.recordedAt) || old.createdAt || '';
          if (String(stampNew) > String(stampOld)) { updated++; return save(c); }
          skipped++; return Promise.resolve();
        });
        return Promise.all(ops).then(function () {
          var tail = [];
          if (data.overlay && opts.replace) tail.push(setOverlay(data.overlay));
          if (data.accepted && opts.replace) tail.push(setAccepted(data.accepted));
          return Promise.all(tail).then(function () {
            return { added: added, updated: updated, skipped: skipped, total: incoming.length };
          });
        });
      });
    }

    function clear() { return be.clear(); }

    return {
      VERSION: VERSION,
      backendName: be.name,
      persistent: persistent,   // false 表示本次数据不落盘（Node 或隐私模式），界面须据此告警
      newId: newId,
      save: save, get: get, remove: remove, list: list,
      getOverlay: getOverlay, setOverlay: setOverlay,
      getAccepted: getAccepted, setAccepted: setAccepted,
      exportAll: exportAll, importAll: importAll, clear: clear
    };
  }

  return {
    VERSION: VERSION,
    create: create,
    memoryBackend: memoryBackend,
    idbBackend: idbBackend,
    defaultBackend: defaultBackend
  };
});
