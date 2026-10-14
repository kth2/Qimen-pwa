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
var pending = [];   // 异步用例：收集起来最后统一等，免得 process.exit 先跑掉
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

console.log('== 自检必须打到对的端点（实测：它把每一路都打去了 Ollama） ==');

t('自检按 provider 分派，绝不因字段写错而全落进 Ollama', function () {
  // 这正是实测那次「四条全是 Failed to fetch、1~2ms」的真因：
  // buildChain 给的是 {provider}，probe 却读 step.kind（恒 undefined），于是每一路
  // 都掉进最后的 Ollama 分支去连 localhost:11434。自检给出的是**假情报**，比没有还坏。
  var chain = LLM._internals.buildChain({ provider: 'custom', customUrl: 'https://x/v1', customModel: 'm' });
  chain.forEach(function (s) {
    assert.ok(s.provider, '链路项必须带 provider 字段：' + JSON.stringify(s));
    assert.strictEqual(s.kind, undefined, 'buildChain 从来不产出 kind——probe 不得依赖它');
  });
});

console.log('== 截断必须说出来（实测：答案断在「须」字上，界面看不出来） ==');
var finalize = LLM._internals.finalize;

t('maxTokens 截断：附上未写完的提示与当前额度，并点出思考也占额度', function () {
  var out = finalize('答案到此', { truncated: true, truncReason: 'maxTokens' }, { maxTokens: 4096 }, 'Gemini ');
  assert.ok(/本次回答未写完/.test(out));
  assert.ok(/maxTokens 上限（当前 4096）/.test(out), '须写出当前额度，否则用户不知调多少');
  assert.ok(/思考预算/.test(out), '思考型模型的思考也占这份额度，须一并点出');
  assert.ok(out.indexOf('答案到此') === 0, '已生成的内容必须原样保留在最前');
});

t('安全策略中断与超时中断，措辞各不相同', function () {
  var safe = finalize('x', { truncated: true, truncReason: 'safety' }, {}, 'Gemini ');
  var idle = finalize('x', { truncated: true, truncReason: 'idle' }, {}, 'Gemini ');
  assert.ok(/安全策略/.test(safe));
  assert.ok(/空闲超时/.test(idle));
  assert.notStrictEqual(safe, idle);
});

t('未截断时原样返回，不加任何噪音', function () {
  assert.strictEqual(finalize('完整答案', { truncated: false }, {}, 'Gemini '), '完整答案');
  assert.strictEqual(finalize('完整答案', {}, {}, 'Gemini '), '完整答案');
});

t('finishReason 的判定：STOP/stop 不算截断，其余都算', function () {
  function gem(fr) {
    var sink = {};
    var c = { finishReason: fr };
    if (c.finishReason && c.finishReason !== 'STOP') {
      sink.truncated = true;
      sink.truncReason = c.finishReason === 'MAX_TOKENS' ? 'maxTokens'
        : /SAFETY|RECITATION|BLOCK/i.test(c.finishReason) ? 'safety' : 'other';
    }
    return sink;
  }
  assert.strictEqual(gem('STOP').truncated, undefined, 'STOP 是正常写完');
  assert.strictEqual(gem('MAX_TOKENS').truncReason, 'maxTokens');
  assert.strictEqual(gem('SAFETY').truncReason, 'safety');
  assert.strictEqual(gem('RECITATION').truncReason, 'safety');
  assert.strictEqual(gem('OTHER').truncReason, 'other');
});


/* ---------- probeRead：自检要看「有没有正文」，不能只看字节数 ---------- */
var probeRead = LLM._internals.probeRead;

t('probeRead：Gemini 非流式取正文与 finishReason', function () {
  var r = probeRead(JSON.stringify({
    candidates: [{ content: { parts: [{ text: '好' }] }, finishReason: 'STOP' }]
  }));
  assert.strictEqual(r.text, '好');
  assert.strictEqual(r.finish, 'STOP');
});

t('probeRead：Gemini SSE 流式逐块拼接', function () {
  var raw = 'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: '你' }] } }] }) + '\n' +
            'data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: '好' }] }, finishReason: 'STOP' }] }) + '\n';
  var r = probeRead(raw);
  assert.strictEqual(r.text, '你好');
  assert.strictEqual(r.finish, 'STOP');
});

t('probeRead：思考型模型额度被思考吃光——200 但正文为空', function () {
  var r = probeRead(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS' }] }));
  assert.strictEqual(r.text, '', '没有 parts 就是一个字都没返回');
  assert.strictEqual(r.finish, 'MAX_TOKENS', '空正文的原因必须留下来，否则自检等于什么也没查出');
});

t('probeRead：thought:true 的思考片段不算正文', function () {
  var r = probeRead(JSON.stringify({
    candidates: [{ content: { parts: [{ text: '我先想想', thought: true }, { text: '好' }] }, finishReason: 'STOP' }]
  }));
  assert.strictEqual(r.text, '好', '把思考当正文会让空答案看起来像正常答案');
});

t('probeRead：OpenAI 兼容端点，非流式与流式两种形状', function () {
  var a = probeRead(JSON.stringify({ choices: [{ message: { content: '好' }, finish_reason: 'stop' }] }));
  assert.strictEqual(a.text, '好');
  assert.strictEqual(a.finish, 'stop');
  var b = probeRead('data: ' + JSON.stringify({ choices: [{ delta: { content: '好' } }] }) + '\ndata: [DONE]\n');
  assert.strictEqual(b.text, '好');
});

t('probeRead：Ollama 的 NDJSON', function () {
  var raw = JSON.stringify({ message: { content: '你' } }) + '\n' +
            JSON.stringify({ message: { content: '好' }, done_reason: 'stop' }) + '\n';
  var r = probeRead(raw);
  assert.strictEqual(r.text, '你好');
  assert.strictEqual(r.finish, 'stop');
});

t('probeRead：空体与坏 JSON 不抛异常', function () {
  assert.deepStrictEqual(probeRead(''), { text: '', finish: '' });
  assert.deepStrictEqual(probeRead('<html>502</html>'), { text: '', finish: '' });
});

console.log('\n== 0 是合法取值，不许被当成「没填」吞掉 ==');
t('numOr0 认 0，numOr 不认——两者只差这一点', function () {
  assert.strictEqual(I.numOr0(0, 3), 0, '重试 0 次就是 0 次');
  assert.strictEqual(I.numOr(0, 3), 3, '超时/maxTokens 那一路，0 仍作「没填」');
  // 其余情形两者一致：空、非数、负数都回落默认
  [['', 3], [null, 3], [undefined, 3], ['abc', 3], [NaN, 3], [-1, 3]].forEach(function (c) {
    assert.strictEqual(I.numOr0(c[0], 3), c[1], 'numOr0(' + JSON.stringify(c[0]) + ')');
    assert.strictEqual(I.numOr(c[0], 3), c[1], 'numOr(' + JSON.stringify(c[0]) + ')');
  });
  assert.strictEqual(I.numOr0(2, 3), 2);
  assert.strictEqual(I.numOr0('2', 3), 2, '界面存的是字符串，也要认');
  assert.strictEqual(I.numOr0(0.35, 1), 0.35, '小数照旧');
});

console.log('\n== 重试次数填 0：得**真的**不重试 ==');
(function () {
  // 只验算式不够——这条 bug 的表现正是「算式看着对，行为不对」。故数实际请求次数。
  var store = {};
  global.localStorage = global.localStorage || {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); }
  };
  function countCalls(maxRetries) {
    var n = 0, realFetch = global.fetch;
    global.fetch = function () { n++; return Promise.resolve(new Response('busy', { status: 503 })); };
    LLM.saveCfg({ provider: 'gemini', geminiKey: 'K', geminiModel: 'm', fallbackProvider: 'none', maxRetries: maxRetries });
    return LLM.chat('s', 'u').then(
      function () { global.fetch = realFetch; throw new Error('本该失败'); },
      function () { global.fetch = realFetch; return n; });
  }
  // 必须**串行**跑：三者共用 global.fetch 与同一份配置，并发会互相踩，
  // 得出的次数是别人那一轮的（第一版就这么错过，看着像功能没修好）。
  function check(label, cfg, want) {
    return countCalls(cfg).then(function (n) {
      try { assert.strictEqual(n, want); pass++; console.log('  ✓ ' + label); }
      catch (e) { fail++; console.log('  ✗ ' + label + ' → 期望 ' + want + ' 次，实得 ' + n + ' 次'); }
    });
  }
  pending.push(
    check('maxRetries=0 → 只请求 1 次（修复前会打 4 次）', 0, 1)
      .then(function () { return check('maxRetries=1 → 请求 2 次（首发 + 1 次重试）', 1, 2); })
      .then(function () { return check('留空 → 请求 4 次（首发 + 默认 3 次重试）', '', 4); })
  );
})();

console.log('\n== 温度 0 同理（0 ＝ 尽量确定，不是「没填」） ==');
(function () {
  pending.push((function () {
    var seen = null, realFetch = global.fetch;
    global.fetch = function (u, o) {
      seen = JSON.parse(o.body);
      return Promise.resolve(new Response('data: ' + JSON.stringify(
        { candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'STOP' }] }) + '\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    };
    LLM.saveCfg({ provider: 'gemini', geminiKey: 'K', geminiModel: 'm', fallbackProvider: 'none', temperature: 0 });
    return LLM.chat('s', 'u').then(function () {
      global.fetch = realFetch;
      try {
        assert.strictEqual(seen.generationConfig.temperature, 0, '温度 0 被吞成了默认值');
        pass++; console.log('  ✓ temperature=0 原样送出（此前会变成 ' + LLM.DEF.temperature + '）');
      } catch (e) { fail++; console.log('  ✗ temperature=0 → ' + e.message); }
    });
  })());
})();

console.log('\n== 界面把 0 的含义说出来 ==');
t('设置面板写明「填 0 即不重试」', function () {
  var fs = require('fs');
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  var at = html.indexOf('cfgMaxRetries');
  var seg = html.slice(at, at + 400);
  assert.ok(/填 0 即不重试/.test(seg), '输入框写着 min="0"，就得告诉用户 0 是什么意思');
  assert.ok(/留空用默认/.test(seg), '也要说清留空是什么行为');
});

console.log('\n== 429 要读懂：每日额度用完不重试（实测：免费层每日额度用完后，一问连打 4 次） ==');
// Gemini 真实 429 的形状：message 之外，details 里有 QuotaFailure 与 RetryInfo
function gem429(quotaId, limit, model, delay) {
  return JSON.stringify({ error: {
    code: 429, status: 'RESOURCE_EXHAUSTED',
    message: 'You exceeded your current quota, please check your plan and billing details. ' +
      'For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits. ' +
      'To monitor your current usage, head to: https://ai.dev/rate-limit. \n* Quota exceeded for metric: ' +
      'generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: ' + limit + ', model: ' + model +
      '\nPlease retry in ' + delay + 's.',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.Help', links: [{ description: 'Learn more', url: 'https://ai.google.dev/gemini-api/docs/rate-limits' }] },
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{
        quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
        quotaId: quotaId, quotaDimensions: { location: 'global', model: model }, quotaValue: String(limit) }] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: delay + 's' }
    ] } });
}
var DAY = gem429('GenerateRequestsPerDayPerProjectPerModel-FreeTier', 20, 'gemini-3.8-flash', '37');
var MIN = gem429('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', 5, 'gemini-3.8-flash', '1');

t('parseQuota：每日额度——认出 scope/上限/模型/quotaId/等待秒数', function () {
  var q = I.parseQuota(DAY);
  assert.strictEqual(q.scope, 'day');
  assert.strictEqual(q.limit, 20);
  assert.strictEqual(q.model, 'gemini-3.8-flash');
  assert.strictEqual(q.quotaId, 'GenerateRequestsPerDayPerProjectPerModel-FreeTier');
  assert.strictEqual(q.retryDelaySec, 37);
  assert.strictEqual(I.parseQuota(MIN).scope, 'minute');
});
t('parseQuota：多条违规取最严的（每日压过每分钟）', function () {
  var j = JSON.parse(MIN);
  j.error.details[1].violations.push({ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' });
  assert.strictEqual(I.parseQuota(JSON.stringify(j)).scope, 'day');
});
t('parseQuota：没有 details 时退回读 message；limit: 0 判为「额度为 0」', function () {
  var q = I.parseQuota(JSON.stringify({ error: { code: 429,
    message: 'Quota exceeded for metric: x, limit: 0, model: gemini-x-pro. Please retry in 12.5s.' } }));
  assert.strictEqual(q.scope, 'none');
  assert.strictEqual(q.model, 'gemini-x-pro');
  assert.strictEqual(q.retryDelaySec, 13);
  // 流式端点有时回数组形状
  assert.strictEqual(I.parseQuota('[' + DAY + ']').scope, 'day');
});
t('parseQuota：非配额错误、坏 JSON 一律 null', function () {
  assert.strictEqual(I.parseQuota(''), null);
  assert.strictEqual(I.parseQuota('<html>429</html>'), null);
  assert.strictEqual(I.parseQuota(JSON.stringify({ error: { code: 429, message: 'Resource has been exhausted' } })), null);
});
t('分类：每日/额度为 0 不重试、不说成过载；每分钟照旧重试', function () {
  var day = { status: 429, quota: I.parseQuota(DAY) };
  var min = { status: 429, quota: I.parseQuota(MIN) };
  var none = { status: 429, quota: { scope: 'none' } };
  assert.ok(!I.isTransient(day) && !I.isTransient(none), '额度用完重试只会再耗配额');
  assert.ok(!I.isOverloaded(day), '额度用完不是服务方过载');
  assert.ok(I.isHardQuota(day) && I.isHardQuota(none) && !I.isHardQuota(min));
  assert.ok(I.isTransient(min) && I.isOverloaded(min));
  assert.ok(/今日配额用尽/.test(I.reasonOf(day)));
  assert.ok(/每分钟/.test(I.reasonOf(min)));
});
t('重置时刻：太平洋时间午夜，换算到本机（含夏令时）', function () {
  // 2026-10-14 03:16Z = PDT 20:16，距午夜 3h44m → 07:00Z
  var r = I.quotaResetLocal(new Date('2026-10-14T03:16:00Z'));
  assert.strictEqual(r.at.toISOString(), '2026-10-14T07:00:00.000Z');
  // 冬令时 PST = UTC-8：2026-01-10 20:00Z = PST 12:00 → 午夜在 2026-01-11 08:00Z
  assert.strictEqual(I.quotaResetLocal(new Date('2026-01-10T20:00:00Z')).at.toISOString(), '2026-01-11T08:00:00.000Z');
});
t('quotaText：说出模型、上限、quotaId 与何时恢复', function () {
  var s = I.quotaText(I.parseQuota(DAY));
  ['gemini-3.8-flash', '今日', '上限 20', 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', '太平洋时间午夜'].forEach(function (k) {
    assert.ok(s.indexOf(k) >= 0, '缺「' + k + '」：' + s);
  });
  assert.ok(/1 秒后再试/.test(I.quotaText(I.parseQuota(MIN))));
});
t('备用模型与主选同名不入链（同一份额度，必然同败）', function () {
  assert.strictEqual(I.buildChain({ provider: 'gemini', geminiModel: 'm1', geminiFallbackModel: 'm1' }).length, 1);
  assert.strictEqual(I.buildChain({ provider: 'gemini', geminiFallbackModel: 'gemini-3.5-flash' }).length, 1, '主选留空即默认模型，同名亦算');
  assert.strictEqual(I.buildChain({ provider: 'custom', customUrl: 'u', customModel: 'a', customFallbackModel: 'a' }).length, 1);
});

(function () {
  // 数实际请求次数——「不重试」要看行为，不看算式
  function run(cfg, responder) {
    var n = 0, realFetch = global.fetch;
    global.fetch = function (u) { n++; return Promise.resolve(responder(n, u)); };
    LLM.saveCfg(cfg);
    return LLM.chat('s', 'u').then(
      function (txt) { global.fetch = realFetch; return { n: n, txt: txt }; },
      function (e) { global.fetch = realFetch; return { n: n, err: e }; });
  }
  function rec(label, fn) {
    return function () {
      return Promise.resolve().then(fn).then(
        function () { pass++; console.log('  ✓ ' + label); },
        function (e) { fail++; console.log('  ✗ ' + label + '  ->  ' + e.message); });
    };
  }
  var sse = function () {
    return new Response('data: ' + JSON.stringify({ candidates: [{ content: { parts: [{ text: '好' }] }, finishReason: 'STOP' }] }) + '\n\n',
      { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  var day429 = function () { return new Response(DAY, { status: 429 }); };
  // 等前面那几组跑完再开始：大家共用 global.fetch 与同一份配置，并发会互相踩
  pending.push(Promise.all(pending.slice())
    .then(rec('每日额度用完：只请求 1 次（修复前 4 次），报错说清原因与出路、不说「过载」', function () {
      return run({ provider: 'gemini', geminiKey: 'K', geminiModel: 'gemini-3.8-flash', fallbackProvider: 'none' }, day429)
        .then(function (r) {
          assert.strictEqual(r.n, 1, '实得 ' + r.n + ' 次');
          var m = r.err && r.err.message || '';
          assert.ok(/今日请求额度已用完/.test(m) && /上限 20/.test(m), m);
          assert.ok(/ai\.dev\/rate-limit/.test(m) && /备用模型/.test(m), '须给出可操作的下一步：' + m);
          assert.ok(!/服务方临时过载/.test(m), '额度用完不是过载：' + m);
          assert.ok(!/Quota ex$/.test(m.split('\n')[0]), '不得截在半句');
        });
    }))
    .then(rec('每日额度用完：立刻交给备用模型，不在主选上空转', function () {
      return run({ provider: 'gemini', geminiKey: 'K', geminiModel: 'gemini-3.8-flash', geminiFallbackModel: 'gemini-3.6-flash',
        fallbackProvider: 'none' }, function (n) { return n === 1 ? day429() : sse(); })
        .then(function (r) {
          assert.ok(!r.err, r.err && r.err.message);
          assert.strictEqual(r.n, 2, '主选 1 次 + 备用 1 次，实得 ' + r.n);
          assert.strictEqual(LLM.lastUsed().model, 'gemini-3.6-flash');
        });
    }))
    .then(rec('每分钟限流：仍重试，且按 RetryInfo 等待', function () {
      var t0 = Date.now();
      return run({ provider: 'gemini', geminiKey: 'K', geminiModel: 'm', fallbackProvider: 'none', maxRetries: 1 },
        function (n) { return n === 1 ? new Response(MIN, { status: 429 }) : sse(); })
        .then(function (r) {
          assert.ok(!r.err, r.err && r.err.message);
          assert.strictEqual(r.n, 2);
          assert.ok(Date.now() - t0 >= 950, 'RetryInfo 给了 1s，应等满');
        });
    }))
    .then(rec('自检：非流式已确认每日额度用完，流式那行不再发请求', function () {
      var n = 0, realFetch = global.fetch;
      global.fetch = function () { n++; return Promise.resolve(day429()); };
      LLM.saveCfg({ provider: 'gemini', geminiKey: 'K', geminiModel: 'gemini-3.8-flash', fallbackProvider: 'none' });
      return LLM.probe(function () {}).then(function (rows) {
        global.fetch = realFetch;
        assert.strictEqual(n, 1, '实发 ' + n + ' 次');
        assert.strictEqual(rows.length, 2);
        assert.ok(/今日请求额度已用完/.test(rows[0].detail), '结论须在最前，不被截断：' + rows[0].detail);
        assert.ok(/未发请求/.test(rows[1].detail));
      });
    })));
})();

Promise.all(pending).then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
});
