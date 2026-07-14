/**
 * PWA 端 AI provider —— 浏览器内直接调用，key 仅存本机 localStorage，绝不外传。
 * 支持：local(Ollama) / gemini(免费) / custom(任意 OpenAI 兼容端点)
 *
 * 性能：Gemini 走 SSE 流式端点(streamGenerateContent)，边生成边回传——
 * 既避免长响应在 Google 网关侧 504，也让答案逐字显示；并对瞬时 503/504/429 自动重试一次。
 */
const LLM = (() => {
  const LS = 'qm_llm_cfg';

  function getCfg() {
    try {
      const cfg = JSON.parse(localStorage.getItem(LS)) || {};
      // 旧默认 gemini-1.5-flash 曾被 saveCfg 自动写进本机配置且已退役，读取时静默迁移到新默认
      if (cfg.geminiModel === 'gemini-1.5-flash') cfg.geminiModel = 'gemini-3.5-flash';
      return cfg;
    } catch (e) { return {}; }
  }
  function saveCfg(cfg) { localStorage.setItem(LS, JSON.stringify(cfg)); }

  function stripThink(t) { return (t || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim(); }

  // 瞬时错误(网关 504 / 过载 503 / 限流 429 / 断网)自动重试一次
  function isTransient(e) {
    return e && (e.status === 503 || e.status === 504 || e.status === 429 || /Failed to fetch|NetworkError|network error/i.test(e.message || ''));
  }
  async function withRetry(fn) {
    try { return await fn(false); }
    catch (e) {
      if (!isTransient(e)) throw e;
      await new Promise(r => setTimeout(r, 1500));
      return await fn(true); // 重试标记：让下游重置已流出的残缺内容
    }
  }

  // 读取 SSE 流(data: {json})，累积文本，每到一块就以「累积全文」回调 onToken
  async function readSSE(resp, onToken, extract) {
    if (!resp.body || !resp.body.getReader) { // 极老浏览器无流式：退回整体解析
      const txt = await resp.text();
      let full = '';
      txt.split('\n').forEach(line => {
        line = line.trim();
        if (!line.startsWith('data:')) return;
        const p = line.slice(5).trim(); if (!p || p === '[DONE]') return;
        try { full += extract(JSON.parse(p)) || ''; } catch (_) {}
      });
      if (onToken && full) onToken(full);
      return full;
    }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '', full = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let obj; try { obj = JSON.parse(payload); } catch (_) { continue; }
        const piece = extract(obj);
        if (piece) { full += piece; if (onToken) onToken(full); }
      }
    }
    return full;
  }

  // 1) 本地 Ollama（PC 上跑 qwen3；手机一般连不到本机 Ollama）
  async function callOllama(cfg, system, user) {
    const url = (cfg.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
    const model = cfg.ollamaModel || 'qwen3:latest';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs || 300000);
    try {
      const r = await fetch(url + '/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
        body: JSON.stringify({ model, stream: false, think: false,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          options: { temperature: 0.2, num_ctx: 8192 } })
      });
      if (!r.ok) throw new Error('Ollama HTTP ' + r.status);
      const d = await r.json();
      return stripThink(d.message && d.message.content || '');
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Ollama 生成超时');
      if (/Failed to fetch|NetworkError/i.test(e.message)) throw new Error('无法连接 Ollama(' + url + ')。手机端通常无本机 Ollama，请改用 Gemini 或自定义。');
      throw e;
    } finally { clearTimeout(timer); }
  }

  // 2) Gemini 免费版 —— SSE 流式，规避网关 504、逐字显示
  async function callGemini(cfg, system, user, onToken, isRetry) {
    if (!cfg.geminiKey) throw new Error('未填写 Gemini API Key（在 Google AI Studio 免费获取）');
    const model = cfg.geminiModel || 'gemini-3.5-flash';
    // 流式端点 + key 走请求头(不进 URL query/日志/历史)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs || 180000);
    // 限定输出长度以收敛延迟；thinkingBudget 仅在用户显式配置时下发(不同模型字段支持不一，默认不发以免 400)
    const genCfg = { temperature: 0.2, maxOutputTokens: Number(cfg.maxTokens) || 2048 };
    if (cfg.geminiThinkingBudget != null && cfg.geminiThinkingBudget !== '')
      genCfg.thinkingConfig = { thinkingBudget: Number(cfg.geminiThinkingBudget) };
    if (isRetry && onToken) onToken(''); // 重试：清空上次流出的残缺内容
    try {
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiKey }, signal: ctrl.signal,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: genCfg
        })
      });
      if (!r.ok) {
        const b = await r.text().catch(() => '');
        const e = new Error('Gemini HTTP ' + r.status + ' ' + b.slice(0, 160)); e.status = r.status; throw e;
      }
      const full = await readSSE(r, onToken, (obj) => {
        const c = obj.candidates && obj.candidates[0];
        return c && c.content && c.content.parts ? c.content.parts.map(p => p.text || '').join('') : '';
      });
      return stripThink(full);
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('Gemini 生成超时（可在设置调大 timeoutMs 或降低 maxTokens/换更快模型）');
      throw e;
    } finally { clearTimeout(timer); }
  }

  // 3) 自定义 OpenAI 兼容端点（Groq / OpenRouter / OpenAI / 任意）
  async function callCustom(cfg, system, user) {
    if (!cfg.customUrl) throw new Error('未填写自定义端点 URL（OpenAI 兼容 /chat/completions）');
    const base = cfg.customUrl.replace(/\/$/, '');
    const url = base.endsWith('/chat/completions') ? base : base + '/chat/completions';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs || 120000);
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, cfg.customKey ? { Authorization: 'Bearer ' + cfg.customKey } : {}),
        signal: ctrl.signal,
        body: JSON.stringify({
          model: cfg.customModel || 'gpt-3.5-turbo',
          temperature: 0.2,
          max_tokens: Number(cfg.maxTokens) || 2048,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
        })
      });
      if (!r.ok) { const b = await r.text().catch(() => ''); const e = new Error('自定义端点 HTTP ' + r.status + ' ' + b.slice(0, 160)); e.status = r.status; throw e; }
      const d = await r.json();
      return stripThink(d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '');
    } finally { clearTimeout(timer); }
  }

  // onToken(fullText) 可选：传入则逐步回调「累积全文」(目前 Gemini 真流式；其余在完成后一次性回调)
  async function chat(system, user, onToken) {
    const cfg = getCfg();
    const provider = cfg.provider || 'gemini';
    if (provider === 'local') { const t = await callOllama(cfg, system, user); if (onToken) onToken(t); return t; }
    if (provider === 'custom') { const t = await withRetry(() => callCustom(cfg, system, user)); if (onToken) onToken(t); return t; }
    return withRetry((isRetry) => callGemini(cfg, system, user, onToken, isRetry));
  }

  function info() {
    const cfg = getCfg();
    const p = cfg.provider || 'gemini';
    const model = p === 'local' ? (cfg.ollamaModel || 'qwen3:latest') : p === 'custom' ? (cfg.customModel || '?') : (cfg.geminiModel || 'gemini-3.5-flash');
    return { provider: p, model };
  }

  return { getCfg, saveCfg, chat, info };
})();
