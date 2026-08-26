/**
 * AI provider(llm.js) 单元测试（纯 Node，无框架）。
 * 运行：node core/llm.test.js
 *
 * 只测**纯逻辑**：错误分类、退避时长、Retry-After 解析、备用链构造、请求体形状。
 * 真实网络行为（流式、空闲超时、断流保留）由 mock 端点 + Playwright 覆盖，见 README。
 *
 * 这些用例钉住的是两个实测故障的修复：
 *   ① 自定义端点必须开流式——不开就只能整体生成，长回答必撞总超时；
 *   ② 503 必须多次退避重试，且 401/400 这类配置错不得白白重试。
 */
'use strict';
var path = require('path');
var assert = require('assert');

var LLM = require(path.join(__dirname, '..', 'llm.js'));
var I = LLM._internals;

var pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}

console.log('== 错误分类：该重试的重试，不该重试的立刻报 ==');
t('过载/限流/网关错误判为瞬时', function () {
  [429, 500, 502, 503, 504].forEach(function (s) {
    assert.ok(I.isTransient({ status: s }), s + ' 应判为瞬时');
  });
  assert.ok(I.isTransient({ message: 'Failed to fetch' }), '断网应判为瞬时');
});
t('配置类错误不判为瞬时（重试只是浪费用户时间）', function () {
  [400, 401, 403, 404].forEach(function (s) {
    assert.ok(!I.isTransient({ status: s }), s + ' 不应重试');
    assert.ok(I.isFatalConfig({ status: s }), s + ' 应判为配置错');
  });
  assert.ok(I.isFatalConfig({ message: '未填写 Gemini API Key（在 Google AI Studio 免费获取）' }));
});
t('503 与 high demand 判为过载（须对用户说明非其配置之过）', function () {
  assert.ok(I.isOverloaded({ status: 503 }));
  assert.ok(I.isOverloaded({ status: 429 }));
  assert.ok(I.isOverloaded({ message: 'This model is currently experiencing high demand.' }));
  assert.ok(!I.isOverloaded({ status: 400, message: 'bad request' }));
});

console.log('== 退避：指数递增、有抖动、有上限 ==');
t('退避随重试次数递增', function () {
  var prev = 0;
  [0, 1, 2, 3].forEach(function (a) {
    var lo = 1000 * Math.pow(2.2, a);
    var got = I.backoffMs(a);
    assert.ok(got >= lo, '第 ' + a + ' 次退避不应短于基数 ' + lo + '，实得 ' + got);
    assert.ok(got > prev || a === 0, '退避应递增');
    prev = got;
  });
});
t('退避有上限，不至于让用户干等几分钟', function () {
  for (var a = 0; a < 12; a++) assert.ok(I.backoffMs(a) <= 15000, '退避上限 15s');
});
t('退避含抖动，避免多端同时重试再次压垮服务', function () {
  var seen = {};
  for (var i = 0; i < 40; i++) seen[I.backoffMs(2)] = 1;
  assert.ok(Object.keys(seen).length > 1, '同一次数应有抖动，实测恒为同值');
});
t('服务端给了 Retry-After 就听它的（秒数与 HTTP 日期两种都认）', function () {
  assert.strictEqual(I.backoffMs(0, 7), 7000);
  assert.strictEqual(I.backoffMs(3, 2), 2000, 'Retry-After 应压过指数退避');
  assert.strictEqual(I.backoffMs(0, 999), 30000, 'Retry-After 亦有 30s 上限');
  assert.strictEqual(I.parseRetryAfter('5'), 5);
  var d = I.parseRetryAfter(new Date(Date.now() + 4000).toUTCString());
  assert.ok(d >= 3 && d <= 5, 'HTTP 日期形式应换算为秒，实得 ' + d);
  assert.strictEqual(I.parseRetryAfter(''), 0);
  assert.strictEqual(I.parseRetryAfter('乱写'), 0);
});

console.log('== 备用链：由用户配置，绝不硬编码模型名 ==');
t('未配备用时只有主选一项', function () {
  assert.deepStrictEqual(I.buildChain({ provider: 'gemini' }).map(function (s) { return s.provider; }), ['gemini']);
});
t('备用模型入链，且顺序在主选之后', function () {
  var c = I.buildChain({ provider: 'gemini', geminiModel: 'm1', geminiFallbackModel: 'm2' });
  assert.strictEqual(c.length, 2);
  assert.strictEqual(c[0].model, '');
  assert.strictEqual(c[1].model, 'm2');
});
t('备用 provider 未配好必填项则不入链（免得白报一次错）', function () {
  var noKey = I.buildChain({ provider: 'custom', customUrl: 'http://x', fallbackProvider: 'gemini' });
  assert.strictEqual(noKey.length, 1, '备用 gemini 无 key，不应入链');
  var ok = I.buildChain({ provider: 'custom', customUrl: 'http://x', fallbackProvider: 'gemini', geminiKey: 'k' });
  assert.strictEqual(ok.length, 2);
});
t('备用 provider 与主选相同则不重复入链', function () {
  var c = I.buildChain({ provider: 'custom', customUrl: 'http://x', fallbackProvider: 'custom' });
  assert.strictEqual(c.length, 1);
});
t('none 视为不启用', function () {
  assert.strictEqual(I.buildChain({ provider: 'gemini', fallbackProvider: 'none' }).length, 1);
});
t('源码中不得硬编码"备用模型名"——模型会退役，写死只会日后静默失效', function () {
  var src = require('fs').readFileSync(path.join(__dirname, '..', 'llm.js'), 'utf8');
  // 允许出现主默认模型；但不得出现"备用模型"的写死候选清单
  var fallbackHardcode = /fallbackModel\s*[:=]\s*['"][a-z0-9.\-]+['"]/i;
  assert.ok(!fallbackHardcode.test(src), '备用模型须由用户填写，不得写死');
});

console.log('== 默认值 ==');
t('暴露默认值供设置面板与调用方共用同一口径', function () {
  assert.ok(LLM.DEF.idleTimeoutMs >= 30000, '空闲超时不宜过短');
  assert.ok(LLM.DEF.totalTimeoutMs > LLM.DEF.idleTimeoutMs, '总时长须大于空闲超时');
  assert.ok(LLM.DEF.maxRetries >= 2, '过载重试次数不宜太少');
  assert.ok(LLM.DEF.maxTokens >= 8192, '思考型模型思考也占额度，给太小会截断');
});

console.log('== 请求体形状：本次修复的关键 ==');
t('自定义端点必须开流式（不开则长回答必撞总超时）', function () {
  var src = require('fs').readFileSync(path.join(__dirname, '..', 'llm.js'), 'utf8');
  var custom = src.slice(src.indexOf('async function callCustom'), src.indexOf('/* ---------------- 备用链'));
  assert.ok(/stream:\s*true/.test(custom), 'callCustom 请求体必须含 stream:true —— 这正是原「生成超时」的根因');
  assert.ok(/looksSSE/.test(custom), '须兼容端点忽略 stream 的情形，不能因此报错');
});
t('三个 provider 都改用空闲超时，不再是一刀切的总超时', function () {
  var src = require('fs').readFileSync(path.join(__dirname, '..', 'llm.js'), 'utf8');
  ['callOllama', 'callGemini', 'callCustom'].forEach(function (fn) {
    var body = src.slice(src.indexOf('async function ' + fn));
    body = body.slice(0, body.indexOf('\n  /* ----'));
    assert.ok(/makeIdleAbort/.test(body), fn + ' 应使用空闲超时');
  });
});
t('中止时若已有内容则交还内容，而非全丢', function () {
  var src = require('fs').readFileSync(path.join(__dirname, '..', 'llm.js'), 'utf8');
  assert.ok(/function abortOutcome/.test(src));
  var fn = src.slice(src.indexOf('function abortOutcome'));
  fn = fn.slice(0, fn.indexOf('\n  }') + 4);
  assert.ok(/sink\.full/.test(fn) && /return sink\.full/.test(fn), '有内容须返回内容');
});
t('超时文案指向界面上真实存在的设置项', function () {
  var src = require('fs').readFileSync(path.join(__dirname, '..', 'llm.js'), 'utf8');
  var html = require('fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(/空闲超时/.test(src), '错误文案应提到「空闲超时」');
  assert.ok(/id="cfgIdleTimeout"/.test(html), '「空闲超时」必须在设置面板里真实存在——旧版让用户改 timeoutMs，而界面根本没有该字段');
  ['cfgTotalTimeout', 'cfgMaxRetries', 'cfgMaxTokens', 'cfgFallbackProvider'].forEach(function (id) {
    assert.ok(html.indexOf('id="' + id + '"') >= 0, '设置面板缺字段 ' + id);
  });
});

console.log('== 失败原因必须说得出口（实测报障：只写「暂时失败」，无从判断） ==');
var reasonOf = LLM._internals.reasonOf;

t('各状态码各有其说法，且 429/503 与 500/502/504 分得开', function () {
  function E(s) { var e = new Error('x'); e.status = s; return e; }
  assert.ok(/429/.test(reasonOf(E(429))) && /配额|频率/.test(reasonOf(E(429))));
  assert.ok(/503/.test(reasonOf(E(503))) && /过载/.test(reasonOf(E(503))));
  assert.ok(/500/.test(reasonOf(E(500))) && /服务方内部/.test(reasonOf(E(500))));
  assert.ok(/502/.test(reasonOf(E(502))));
  assert.ok(/504/.test(reasonOf(E(504))));
  // 这一条正是实测那次报障的判据：显示「暂时失败」而非「繁忙」，说明不是 429/503
  assert.notStrictEqual(reasonOf(E(500)), reasonOf(E(503)));
});

t('网络层失败与「等了很久没有输出」分得开', function () {
  assert.ok(/网络不通|拦截/.test(reasonOf(new Error('Failed to fetch'))));
  assert.ok(/等待超时/.test(reasonOf(new Error('Gemini 等待 90 秒无任何输出（对方可能过载或未开启流式）'))));
});

t('未知错误不编造原因，截断原文即可', function () {
  assert.ok(reasonOf(new Error('某个没见过的错')).indexOf('某个没见过的错') >= 0);
  assert.strictEqual(reasonOf(null), '未知错误');
});

t('reasonOf 绝不返回「暂时失败」这类无信息量的词', function () {
  [429, 500, 502, 503, 504, 404, 0].forEach(function (s) {
    var e = new Error('x'); if (s) e.status = s;
    assert.ok(!/^暂时失败$/.test(reasonOf(e)), s + ' 的说法太空泛');
  });
});

console.log('== 连接自检 ==');

t('probe 已导出，且不依赖业务流程', function () {
  assert.strictEqual(typeof LLM.probe, 'function');
});

t('probe 对每个环节都跑「非流式」与「流式」两次——二者行为可能不同', function () {
  // llm.js 面向浏览器，saveCfg 走 localStorage；Node 下补一个最小垫片即可，不为测试改生产代码
  if (typeof global.localStorage === 'undefined') {
    var mem = {};
    global.localStorage = {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; }
    };
  }
  // 不实际发请求：只验证它按链路×模式展开。用一个必然失败的配置，看回了几行。
  var saved = LLM.getCfg();
  LLM.saveCfg({ provider: 'gemini', geminiKey: '', geminiModel: 'm', fallbackProvider: 'none' });
  return LLM.probe(function () {}).then(function (rows) {
    assert.strictEqual(rows.length, 2, '一个环节应有非流式与流式两行，实得 ' + rows.length);
    var modes = rows.map(function (r) { return r.mode; }).sort();
    assert.deepStrictEqual(modes, ['流式', '非流式']);
    rows.forEach(function (r) {
      assert.strictEqual(r.ok, false);
      assert.ok(/Key/.test(r.detail), '缺 Key 须如实说明：' + r.detail);
      assert.ok(typeof r.ms === 'number');
    });
    LLM.saveCfg(saved);
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
