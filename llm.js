/**
 * PWA 端 AI provider —— 浏览器内直接调用，key 仅存本机 localStorage，绝不外传。
 * 支持：local(Ollama) / gemini(免费) / custom(任意 OpenAI 兼容端点)
 */
const LLM = (() => {
  const LS = 'qm_llm_cfg';

  function getCfg() {
    try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; }
  }
  function saveCfg(cfg) { localStorage.setItem(LS, JSON.stringify(cfg)); }

  function stripThink(t) { return (t || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim(); }

  async function withTimeout(p, ms) {
    return await p; // fetch 自带 AbortController 在各 provider 内处理
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
          options: { temperature: 0.4, num_ctx: 8192 } })
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

  // 2) Gemini 免费版
  async function callGemini(cfg, system, user) {
    if (!cfg.geminiKey) throw new Error('未填写 Gemini API Key（在 Google AI Studio 免费获取）');
    const model = cfg.geminiModel || 'gemini-1.5-flash';
    // key 走请求头而非 URL query：避免密钥进入代理/服务器日志与浏览器历史
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs || 120000);
    try {
      const r = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiKey }, signal: ctrl.signal,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.4 }
        })
      });
      if (!r.ok) { const b = await r.text().catch(() => ''); throw new Error('Gemini HTTP ' + r.status + ' ' + b.slice(0, 160)); }
      const d = await r.json();
      const c = d.candidates && d.candidates[0];
      return c && c.content && c.content.parts ? c.content.parts.map(p => p.text || '').join('').trim() : '';
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
          temperature: 0.4,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
        })
      });
      if (!r.ok) { const b = await r.text().catch(() => ''); throw new Error('自定义端点 HTTP ' + r.status + ' ' + b.slice(0, 160)); }
      const d = await r.json();
      return stripThink(d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content || '');
    } finally { clearTimeout(timer); }
  }

  async function chat(system, user) {
    const cfg = getCfg();
    const provider = cfg.provider || 'gemini';
    if (provider === 'local') return callOllama(cfg, system, user);
    if (provider === 'custom') return callCustom(cfg, system, user);
    return callGemini(cfg, system, user);
  }

  function info() {
    const cfg = getCfg();
    const p = cfg.provider || 'gemini';
    const model = p === 'local' ? (cfg.ollamaModel || 'qwen3:latest') : p === 'custom' ? (cfg.customModel || '?') : (cfg.geminiModel || 'gemini-1.5-flash');
    return { provider: p, model };
  }

  return { getCfg, saveCfg, chat, info };
})();
