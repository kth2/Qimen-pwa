/**
 * 「列出可用模型」（Phase 37）单元测试（纯 Node，无框架）。
 * 运行：node core/models.test.js
 *
 * 起因：AI 设置里的模型名全靠用户手写，拼错一个字就 404。
 * 现由 provider 自己的「模型列表」接口取回可用模型，做成下拉让用户选；手写仍可。
 *   · Gemini：GET /v1beta/models（分页），只收支持 generateContent 的；
 *   · 自定义（OpenAI 兼容）：GET {base}/models；
 *   · Ollama：GET {base}/api/tags。
 * 不硬编码任何模型名——列表以服务端当下返回为准。
 */
'use strict';
var path = require('path');
var fs = require('fs');
var assert = require('assert');

var LLM = require(path.join(__dirname, '..', 'llm.js'));
var I = LLM._internals || {};
var APP = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
var HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

var pass = 0, fail = 0, pending = [];
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '  ->  ' + e.message); }
}
function ta(name, fn) { pending.push({ name: name, fn: fn }); }

console.log('== 解析各家的模型列表 ==');
t('Gemini：去掉 models/ 前缀，只收 generateContent，剔除嵌入/语音/出图', function () {
  var r = I.parseGeminiModels({ models: [
    { name: 'models/gemini-3.5-flash', displayName: 'Gemini 3.5 Flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
    { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.5-pro', displayName: 'Gemini 3.5 Pro', supportedGenerationMethods: ['generateContent'] }
  ] });
  assert.deepStrictEqual(r.map(function (m) { return m.id; }), ['gemini-3.5-flash', 'gemini-3.5-pro']);
  assert.strictEqual(r[0].label, 'Gemini 3.5 Flash');
});
t('OpenAI 兼容：data[].id，去重排序；也认裸数组与 models[]', function () {
  assert.deepStrictEqual(I.parseOpenAIModels({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] }).map(function (m) { return m.id; }), ['a', 'b']);
  assert.deepStrictEqual(I.parseOpenAIModels([{ id: 'x' }]).map(function (m) { return m.id; }), ['x']);
  assert.deepStrictEqual(I.parseOpenAIModels({ models: [{ name: 'y' }] }).map(function (m) { return m.id; }), ['y']);
});
t('Ollama：models[].name', function () {
  assert.deepStrictEqual(I.parseOllamaModels({ models: [{ name: 'qwen3:latest' }, { name: 'llama3.1:8b' }] }).map(function (m) { return m.id; }),
    ['llama3.1:8b', 'qwen3:latest']);
});
t('坏输入不抛异常，返回空列表', function () {
  [null, {}, 'x', { data: 'x' }, { models: [null, 1] }].forEach(function (bad) {
    assert.deepStrictEqual(I.parseGeminiModels(bad), []);
    assert.deepStrictEqual(I.parseOpenAIModels(bad), []);
    assert.deepStrictEqual(I.parseOllamaModels(bad), []);
  });
});
t('自定义端点的 models 地址：去掉结尾的 /chat/completions 与斜杠', function () {
  assert.strictEqual(I.modelsUrl('https://api.groq.com/openai/v1/'), 'https://api.groq.com/openai/v1/models');
  assert.strictEqual(I.modelsUrl('https://x.ai/v1/chat/completions'), 'https://x.ai/v1/models');
});

console.log('== listModels：用表单上的配置去取（不必先保存） ==');
function withFetch(fake, fn) {
  var real = global.fetch; global.fetch = fake;
  return Promise.resolve().then(fn).then(function (v) { global.fetch = real; return v; },
    function (e) { global.fetch = real; throw e; });
}
function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json' } }); }
ta('Gemini：带 key 头、跟着 nextPageToken 翻页', function () {
  var seen = [];
  return withFetch(function (u, o) {
    seen.push({ u: u, key: o && o.headers && o.headers['x-goog-api-key'] });
    return Promise.resolve(/pageToken=P2/.test(u)
      ? json({ models: [{ name: 'models/gemini-b', supportedGenerationMethods: ['generateContent'] }] })
      : json({ models: [{ name: 'models/gemini-a', supportedGenerationMethods: ['generateContent'] }], nextPageToken: 'P2' }));
  }, function () { return LLM.listModels('gemini', { geminiKey: 'K' }); }).then(function (r) {
    assert.deepStrictEqual(r.map(function (m) { return m.id; }), ['gemini-a', 'gemini-b']);
    assert.strictEqual(seen.length, 2);
    assert.ok(seen.every(function (s) { return s.key === 'K'; }), 'key 须放请求头');
    assert.ok(seen.every(function (s) { return !/key=K/.test(s.u); }), 'key 不得出现在网址里');
  });
});
ta('自定义：Bearer 头、打 /models', function () {
  var seen = null;
  return withFetch(function (u, o) { seen = { u: u, auth: o.headers.Authorization }; return Promise.resolve(json({ data: [{ id: 'm1' }] })); },
    function () { return LLM.listModels('custom', { customUrl: 'https://e.com/v1', customKey: 'S' }); }).then(function (r) {
    assert.strictEqual(seen.u, 'https://e.com/v1/models');
    assert.strictEqual(seen.auth, 'Bearer S');
    assert.strictEqual(r[0].id, 'm1');
  });
});
ta('Ollama：打 /api/tags', function () {
  var seen = null;
  return withFetch(function (u) { seen = u; return Promise.resolve(json({ models: [{ name: 'qwen3:latest' }] })); },
    function () { return LLM.listModels('local', { ollamaUrl: 'http://pc:11434/' }); }).then(function (r) {
    assert.strictEqual(seen, 'http://pc:11434/api/tags');
    assert.strictEqual(r[0].id, 'qwen3:latest');
  });
});
ta('缺 key / 缺 URL：直接报错，不发请求', function () {
  var n = 0;
  return withFetch(function () { n++; return Promise.resolve(json({})); }, function () {
    return LLM.listModels('gemini', {}).then(function () { throw new Error('本该报错'); }, function (e) {
      assert.ok(/Key/.test(e.message));
      return LLM.listModels('custom', {}).then(function () { throw new Error('本该报错'); }, function (e2) {
        assert.ok(/URL/.test(e2.message)); assert.strictEqual(n, 0);
      });
    });
  });
});
ta('HTTP 出错：报出状态码与响应摘要', function () {
  return withFetch(function () { return Promise.resolve(new Response('API key not valid', { status: 400 })); },
    function () { return LLM.listModels('gemini', { geminiKey: 'bad' }); }).then(function () { throw new Error('本该报错'); },
    function (e) { assert.ok(/400/.test(e.message) && /API key not valid/.test(e.message), e.message); });
});

console.log('== 界面 ==');
t('三家各有「列出可用模型」按钮', function () {
  ['gemini', 'custom', 'local'].forEach(function (p) {
    assert.ok(new RegExp('data-listmodels="' + p + '"').test(HTML), '缺 ' + p);
  });
});
t('取到的列表填进每个模型框下方的下拉；选中即写入该框并保存', function () {
  assert.ok(/MODEL_FIELDS\s*=/.test(APP));
  ['cfgGeminiModel', 'cfgGeminiFallbackModel', 'cfgCustomModel', 'cfgCustomFallbackModel', 'cfgOllamaModel'].forEach(function (id) {
    assert.ok(APP.indexOf("'" + id + "'") > 0, 'MODEL_FIELDS 缺 ' + id);
  });
  assert.ok(/LLM\.listModels\(/.test(APP));
  assert.ok(/saveCfg\(\)/.test(APP.slice(APP.indexOf('function fillModelPicks'))), '选中后须保存');
});
t('下拉选项用 new Option 建，不把外部模型名拼进 HTML', function () {
  var F = APP.slice(APP.indexOf('function fillModelPicks'), APP.indexOf('async function listModelsFor'));
  assert.ok(/new Option\(/.test(F));
  assert.ok(!/innerHTML/.test(F), 'fillModelPicks 不得用 innerHTML');
});
t('用表单上当下的值去取（填了 key 不必先保存）', function () {
  assert.ok(/function formCfg\(/.test(APP));
  assert.ok(/LLM\.listModels\(p, formCfg\(\)\)/.test(APP));
});
t('取到的列表存本机，下次打开设置直接有下拉', function () {
  assert.ok(/qm_llm_models/.test(APP));
});

(async function () {
  for (var i = 0; i < pending.length; i++) {
    try { await pending[i].fn(); pass++; console.log('  ✓ ' + pending[i].name); }
    catch (e) { fail++; console.log('  ✗ ' + pending[i].name + '  ->  ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
