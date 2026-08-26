/**
 * PWA 端 AI provider —— 浏览器内直接调用，key 仅存本机 localStorage，绝不外传。
 * 支持：local(Ollama) / gemini(免费) / custom(任意 OpenAI 兼容端点)
 *
 * 【为什么这一版重写了超时与重试】实测暴露两类失败，根因都在客户端：
 *   ① 自定义端点「生成超时」：原实现请求体里**没有 stream:true**，是整体生成——
 *      必须等模型把全文吐完才有第一个字节。而本应用的提示词约 8K 字符、详尽解读动辄
 *      数千 token，120 秒总超时一到就整个掐断，用户连一个字都拿不到。
 *      现改为：**流式 + 空闲超时**——只要还在往外吐字就不算超时，真正卡住(默认 90s
 *      无新内容)才中止；即便中止，也把已生成的部分交还给用户，而不是全丢。
 *   ② Gemini 503「high demand」：原实现只重试 1 次、固定等 1.5 秒。Google 的过载尖峰
 *      常需更久。现改为：多次**指数退避 + 抖动**重试，并尊重服务端 Retry-After；
 *      仍失败则按用户配置的**备用模型/备用 provider**接力，全程在状态栏可见。
 *
 * 边界：不硬编码任何"备用模型名"——模型可用性会变，猜一个写死只会在日后静默失效。
 * 备用链完全由用户在设置里填，留空即不启用。
 */
const LLM = (() => {
  const LS = 'qm_llm_cfg';

  // 默认值集中一处，便于设置面板与调用方共用同一套口径
  const DEF = {
    idleTimeoutMs: 90000,    // 多久「没有新内容」才算卡死。流式下这才是真正的超时控制
    totalTimeoutMs: 600000,  // 兜底总时长，防止极端情况下无限挂起
    maxRetries: 3,           // 瞬时错误(503/429/504)的重试次数
    maxTokens: 16384,
    temperature: 0.35
  };

  function getCfg() {
    try {
      const cfg = JSON.parse(localStorage.getItem(LS)) || {};
      // 旧默认 gemini-1.5-flash 曾被 saveCfg 自动写进本机配置且已退役，读取时静默迁移到新默认
      if (cfg.geminiModel === 'gemini-1.5-flash') cfg.geminiModel = 'gemini-3.5-flash';
      return cfg;
    } catch (e) { return {}; }
  }
  function saveCfg(cfg) { localStorage.setItem(LS, JSON.stringify(cfg)); }

  function numOr(v, d) { const n = Number(v); return (v === '' || v == null || !isFinite(n) || n <= 0) ? d : n; }
  function stripThink(t) { return (t || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim(); }

  /* ---------------- 错误分类 ---------------- */

  /** 瞬时错误：值得重试。过载 503 / 限流 429 / 网关 504 / 断网 / 端点 500-502。 */
  function isTransient(e) {
    if (!e) return false;
    const s = e.status;
    if (s === 429 || s === 500 || s === 502 || s === 503 || s === 504) return true;
    return /Failed to fetch|NetworkError|network error|ECONNRESET|socket hang up/i.test(e.message || '');
  }
  /** 过载类：错误信息值得对用户另行说明「这不是你的 key 或配置的问题」。 */
  function isOverloaded(e) {
    return !!e && (e.status === 503 || e.status === 429 ||
      /high demand|overloaded|rate limit|quota/i.test(e.message || ''));
  }
  /**
   * 一句话说清「这次为什么失败」。状态行与最终报错都用它——
   * 「暂时失败」四个字把唯一的线索吞掉了，是此前一个真实的排障障碍。
   */
  function reasonOf(e) {
    if (!e) return '未知错误';
    const s = e.status;
    if (s === 429) return '配额/频率受限(429)';
    if (s === 503) return '服务方过载(503)';
    if (s === 500) return '服务方内部错误(500)';
    if (s === 502) return '网关错误(502)';
    if (s === 504) return '网关超时(504)';
    if (s) return `HTTP ${s}`;
    if (/Failed to fetch|NetworkError|network error/i.test(e.message || '')) return '网络不通或被拦截';
    if (/无任何输出/.test(e.message || '')) return '等待超时（未收到任何内容）';
    return (e.message || '未知错误').slice(0, 40);
  }

  /** 配置类：重试与换 provider 都没意义，应当立刻报给用户改。 */
  function isFatalConfig(e) {
    return !!e && (e.status === 400 || e.status === 401 || e.status === 403 || e.status === 404 ||
      /未填写/.test(e.message || ''));
  }

  /** 退避时长：指数 + 抖动；服务端给了 Retry-After 就听它的。 */
  function backoffMs(attempt, retryAfterSec) {
    if (retryAfterSec > 0) return Math.min(retryAfterSec * 1000, 30000);
    const base = 1000 * Math.pow(2.2, attempt);       // 1.0s → 2.2s → 4.8s → 10.6s
    return Math.round(Math.min(base + Math.random() * 600, 15000));
  }
  /** Retry-After 既可能是秒数，也可能是 HTTP 日期。两种都认。 */
  function parseRetryAfter(v) {
    if (!v) return 0;
    const n = Number(v);
    if (isFinite(n) && n >= 0) return n;
    const t = Date.parse(v);
    if (!isNaN(t)) return Math.max(0, Math.round((t - Date.now()) / 1000));
    return 0;
  }

  /* ---------------- 空闲超时：流式的正确超时姿势 ---------------- */

  /**
   * 只要还有新内容流出就不算超时（bump 重置计时），真正卡住才中止。
   * 另设一个很宽松的总时长兜底，防止服务端持续吐空白导致永不结束。
   */
  function makeIdleAbort(idleMs, totalMs) {
    const ctrl = new AbortController();
    let idleTimer = null, totalTimer = null, reason = '';
    const bump = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { reason = 'idle'; ctrl.abort(); }, idleMs);
    };
    bump();
    if (totalMs) totalTimer = setTimeout(() => { reason = 'total'; ctrl.abort(); }, totalMs);
    return {
      signal: ctrl.signal, bump: bump,
      reasonOf: () => reason,
      done: () => { if (idleTimer) clearTimeout(idleTimer); if (totalTimer) clearTimeout(totalTimer); }
    };
  }

  /* ---------------- SSE ---------------- */

  /**
   * 读取 SSE 流，累积文本，每到一块就以「累积全文」回调 onToken。
   * @param sink.get() 供上层在中止后取回**已生成的部分**——超时不该让用户血本无归。
   */
  async function readSSE(resp, onToken, extract, guard, sink) {
    const push = (piece) => {
      if (!piece) return;
      sink.full += piece;
      if (guard) guard.bump();
      if (onToken) onToken(sink.full);
    };
    if (!resp.body || !resp.body.getReader) {   // 极老浏览器无流式：退回整体解析
      const txt = await resp.text();
      txt.split('\n').forEach(line => {
        line = line.trim();
        if (!line.startsWith('data:')) return;
        const p = line.slice(5).trim(); if (!p || p === '[DONE]') return;
        try { push(extract(JSON.parse(p)) || ''); } catch (_) {}
      });
      return sink.full;
    }
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (guard) guard.bump();          // 收到任何字节都算「还活着」
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let obj; try { obj = JSON.parse(payload); } catch (_) { continue; }
        push(extract(obj));
      }
    }
    return sink.full;
  }

  function looksSSE(resp) {
    const ct = (resp.headers && resp.headers.get && resp.headers.get('content-type')) || '';
    return /text\/event-stream/i.test(ct);
  }

  async function httpError(r, label) {
    const b = await r.text().catch(() => '');
    const e = new Error(label + ' HTTP ' + r.status + (b ? ' ' + b.slice(0, 200) : ''));
    e.status = r.status;
    e.retryAfter = parseRetryAfter(r.headers && r.headers.get && r.headers.get('retry-after'));
    return e;
  }

  /** 中止时的统一处理：有内容就交还内容，没内容才报超时。 */
  function abortOutcome(guard, sink, label, cfg) {
    const why = guard.reasonOf();
    if (sink.full && sink.full.trim()) {
      sink.truncated = true;
      return sink.full;   // 已生成的部分照常交还，界面会标明未写完
    }
    const idleSec = Math.round(numOr(cfg.idleTimeoutMs, DEF.idleTimeoutMs) / 1000);
    throw new Error(label + (why === 'total'
      ? '生成总时长超限，且未收到任何内容'
      : `等待 ${idleSec} 秒无任何输出（对方可能过载或未开启流式）。可在设置调大「空闲超时」，或换用更快的模型`));
  }

  /* ---------------- 1) 本地 Ollama ---------------- */
  async function callOllama(cfg, system, user, onToken) {
    const url = (cfg.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
    const model = cfg.ollamaModel || 'qwen3:latest';
    const guard = makeIdleAbort(numOr(cfg.idleTimeoutMs, DEF.idleTimeoutMs), numOr(cfg.totalTimeoutMs, DEF.totalTimeoutMs));
    const sink = { full: '', truncated: false };
    try {
      const r = await fetch(url + '/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: guard.signal,
        body: JSON.stringify({
          model, stream: true, think: false,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
          options: { temperature: numOr(cfg.temperature, DEF.temperature), num_ctx: 8192 }
        })
      });
      if (!r.ok) throw await httpError(r, 'Ollama');
      // Ollama 的流是 NDJSON（每行一个 JSON），不是 SSE
      if (!r.body || !r.body.getReader) {
        const d = await r.json();
        sink.full = (d.message && d.message.content) || '';
      } else {
        const reader = r.body.getReader(), dec = new TextDecoder();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          guard.bump();
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
            if (!line) continue;
            let o; try { o = JSON.parse(line); } catch (_) { continue; }
            const piece = (o.message && o.message.content) || '';
            if (piece) { sink.full += piece; if (onToken) onToken(stripThink(sink.full) || sink.full); }
          }
        }
      }
      return stripThink(sink.full);
    } catch (e) {
      if (e.name === 'AbortError') return stripThink(abortOutcome(guard, sink, 'Ollama ', cfg));
      if (/Failed to fetch|NetworkError/i.test(e.message)) {
        throw new Error('无法连接 Ollama(' + url + ')。手机端通常无本机 Ollama，请改用 Gemini 或自定义端点。');
      }
      throw e;
    } finally { guard.done(); }
  }

  /* ---------------- 2) Gemini（SSE 流式） ---------------- */
  async function callGemini(cfg, system, user, onToken, isRetry, modelOverride) {
    if (!cfg.geminiKey) throw new Error('未填写 Gemini API Key（在 Google AI Studio 免费获取）');
    const model = modelOverride || cfg.geminiModel || 'gemini-3.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;
    const guard = makeIdleAbort(numOr(cfg.idleTimeoutMs, DEF.idleTimeoutMs), numOr(cfg.totalTimeoutMs, DEF.totalTimeoutMs));
    const sink = { full: '', truncated: false };
    // maxOutputTokens 对思考型模型是「思考+回答」的总额——思考会占额度，故默认给足。
    const genCfg = {
      temperature: numOr(cfg.temperature, DEF.temperature),
      maxOutputTokens: numOr(cfg.maxTokens, DEF.maxTokens)
    };
    if (cfg.geminiThinkingBudget != null && cfg.geminiThinkingBudget !== '')
      genCfg.thinkingConfig = { thinkingBudget: Number(cfg.geminiThinkingBudget) };
    if (isRetry && onToken) onToken('');   // 重试：清空上次流出的残缺内容
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiKey },
        signal: guard.signal,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: genCfg
        })
      });
      if (!r.ok) throw await httpError(r, 'Gemini');
      await readSSE(r, onToken, (obj) => {
        const c = obj.candidates && obj.candidates[0];
        return c && c.content && c.content.parts ? c.content.parts.map(p => p.text || '').join('') : '';
      }, guard, sink);
      return stripThink(sink.full);
    } catch (e) {
      if (e.name === 'AbortError') return stripThink(abortOutcome(guard, sink, 'Gemini ', cfg));
      throw e;
    } finally { guard.done(); }
  }

  /* ---------------- 3) 自定义 OpenAI 兼容端点 ---------------- */
  async function callCustom(cfg, system, user, onToken, isRetry, modelOverride) {
    if (!cfg.customUrl) throw new Error('未填写自定义端点 URL（OpenAI 兼容 /chat/completions）');
    const base = cfg.customUrl.replace(/\/$/, '');
    const url = base.endsWith('/chat/completions') ? base : base + '/chat/completions';
    const guard = makeIdleAbort(numOr(cfg.idleTimeoutMs, DEF.idleTimeoutMs), numOr(cfg.totalTimeoutMs, DEF.totalTimeoutMs));
    const sink = { full: '', truncated: false };
    if (isRetry && onToken) onToken('');
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' },
          cfg.customKey ? { Authorization: 'Bearer ' + cfg.customKey } : {}),
        signal: guard.signal,
        body: JSON.stringify({
          model: modelOverride || cfg.customModel || 'gpt-3.5-turbo',
          temperature: numOr(cfg.temperature, DEF.temperature),
          max_tokens: numOr(cfg.maxTokens, DEF.maxTokens),
          // 开流式是本次修复的关键：整体生成时长响应必然撞总超时，且用户全程看不到进展
          stream: true,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
        })
      });
      if (!r.ok) throw await httpError(r, '自定义端点');
      if (looksSSE(r)) {
        await readSSE(r, onToken, (obj) => {
          const c = obj.choices && obj.choices[0];
          if (!c) return '';
          // 流式取 delta.content；个别端点在流里回 message.content，一并兼容
          return (c.delta && c.delta.content) || (c.message && c.message.content) || '';
        }, guard, sink);
      } else {
        // 端点忽略了 stream:true，按普通 JSON 解析——不能因此报错，能出结果就行
        const d = await r.json();
        sink.full = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
        if (onToken && sink.full) onToken(sink.full);
      }
      return stripThink(sink.full);
    } catch (e) {
      if (e.name === 'AbortError') return stripThink(abortOutcome(guard, sink, '自定义端点 ', cfg));
      throw e;
    } finally { guard.done(); }
  }

  /* ---------------- 备用链 ---------------- */

  /**
   * 主选 + 备用。**不硬编码任何模型名**：模型可用性会变，写死只会在日后静默失效。
   * 备用完全由用户在设置里填；留空即不启用。
   */
  function buildChain(cfg) {
    const p = cfg.provider || 'gemini';
    const chain = [{ provider: p, model: '', label: labelOf(cfg, p, '') }];
    if (p === 'gemini' && cfg.geminiFallbackModel) {
      chain.push({ provider: 'gemini', model: cfg.geminiFallbackModel, label: 'Gemini/' + cfg.geminiFallbackModel });
    }
    if (p === 'custom' && cfg.customFallbackModel) {
      chain.push({ provider: 'custom', model: cfg.customFallbackModel, label: '自定义/' + cfg.customFallbackModel });
    }
    // 跨 provider 备用：仅当该 provider 的必填项已配好，否则加进来只会白白多报一次错
    const fb = cfg.fallbackProvider;
    if (fb && fb !== p && fb !== 'none') {
      const ready = fb === 'gemini' ? !!cfg.geminiKey : fb === 'custom' ? !!cfg.customUrl : true;
      if (ready) chain.push({ provider: fb, model: '', label: labelOf(cfg, fb, '') });
    }
    return chain;
  }
  function labelOf(cfg, p, model) {
    if (p === 'local') return 'Ollama/' + (model || cfg.ollamaModel || 'qwen3:latest');
    if (p === 'custom') return '自定义/' + (model || cfg.customModel || '?');
    return 'Gemini/' + (model || cfg.geminiModel || 'gemini-3.5-flash');
  }

  function callOne(step, cfg, system, user, onToken, isRetry) {
    if (step.provider === 'local') return callOllama(cfg, system, user, onToken);
    if (step.provider === 'custom') return callCustom(cfg, system, user, onToken, isRetry, step.model);
    return callGemini(cfg, system, user, onToken, isRetry, step.model);
  }

  /* ---------------- 主入口 ---------------- */

  /**
   * @param onToken(fullText) 可选，逐步回调「累积全文」
   * @param onStatus(text)    可选，回调重试/切换进度，让等待过程可见而非干等
   */
  async function chat(system, user, onToken, onStatus) {
    const cfg = getCfg();
    const chain = buildChain(cfg);
    const maxRetries = Math.max(0, Math.min(numOr(cfg.maxRetries, DEF.maxRetries), 6));
    const say = (t) => { try { if (onStatus) onStatus(t); } catch (_) {} };
    let lastErr = null;

    for (let ci = 0; ci < chain.length; ci++) {
      const step = chain[ci];
      if (ci > 0) say(`改用备用：${step.label}…`);
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await callOne(step, cfg, system, user, onToken, attempt > 0);
        } catch (e) {
          lastErr = e;
          // 配置错误：重试和换 provider 都没用，直接抛给用户去改
          if (isFatalConfig(e)) throw e;
          if (!isTransient(e) || attempt >= maxRetries) break;
          const wait = backoffMs(attempt, e.retryAfter);
          // 必须把**真实原因**说出来。此前只写「暂时失败」，用户与开发者都无从判断
          // 到底是 500 还是断网——那等于把唯一的线索吞掉了。
          say(`${step.label} ${reasonOf(e)}，${Math.round(wait / 1000)} 秒后第 ${attempt + 1} 次重试…`);
          try { console.warn('[llm] 重试前的原始错误：', e.status || '(无状态码)', e.message); } catch (_) {}
          await new Promise(r => setTimeout(r, wait));
        }
      }
    }
    // 全链用尽：把「这不是你的配置问题」说清楚，并给出可操作的下一步
    if (isOverloaded(lastErr)) {
      const tip = chain.length > 1
        ? '备用也未能接管。'
        : '可在 AI 设置里填一个「备用模型」或「备用 Provider」，下次繁忙时自动接管。';
      throw new Error((lastErr.message || '模型繁忙') +
        `\n—— 这是服务方临时过载，与你的 Key 或配置无关；已自动重试 ${maxRetries} 次。${tip}`);
    }
    if (lastErr && (lastErr.status === 500 || lastErr.status === 502 || lastErr.status === 504)) {
      throw new Error((lastErr.message || 'AI 调用失败') +
        `\n—— ${reasonOf(lastErr)}：这是服务方那一侧的故障，不是你的 Key 或配置错。` +
        `已重试 ${maxRetries} 次仍未成功。可试：① 换一个模型（同厂的 lite 版往往更稳）；` +
        `② 若用的是思考型模型，在设置里把「思考预算」调小或设 0；` +
        `③ 填一个「备用模型」或「备用 Provider」，下次自动接管。`);
    }
    throw lastErr || new Error('AI 调用失败');
  }

  /**
   * 连接自检：对当前配置发一次**最小**请求，把原始 HTTP 状态与响应体原样交还。
   * 这是把「暂时失败，重试中…」变成「HTTP 500，原文如下」的唯一办法——
   * 排障时先跑它，别猜。
   * @returns {Promise<Array>} 每项 { step, mode, ok, status, ms, detail }
   */
  async function probe(onStatus) {
    const cfg = getCfg();
    const say = (t) => { try { if (onStatus) onStatus(t); } catch (_) {} };
    const out = [];
    const chain = buildChain(cfg);
    for (const step of chain) {
      for (const mode of ['非流式', '流式']) {
        const t0 = Date.now();
        say(`自检 ${step.label}（${mode}）…`);
        try {
          const r = await oneProbe(step, cfg, mode === '流式');
          out.push(Object.assign({ step: step.label, mode: mode, ms: Date.now() - t0 }, r));
        } catch (e) {
          out.push({
            step: step.label, mode: mode, ms: Date.now() - t0, ok: false,
            status: e.status || 0, detail: (e.message || String(e)).slice(0, 300)
          });
        }
      }
    }
    return out;
  }

  async function oneProbe(step, cfg, stream) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30000);
    try {
      let url, headers, body;
      if (step.kind === 'gemini') {
        if (!cfg.geminiKey) throw new Error('未填写 Gemini API Key');
        const m = step.model || cfg.geminiModel || 'gemini-3.5-flash';
        url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:` +
          (stream ? 'streamGenerateContent?alt=sse' : 'generateContent');
        headers = { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.geminiKey };
        const gc = { maxOutputTokens: 16 };
        if (cfg.geminiThinkingBudget != null && cfg.geminiThinkingBudget !== '')
          gc.thinkingConfig = { thinkingBudget: Number(cfg.geminiThinkingBudget) };
        body = { contents: [{ role: 'user', parts: [{ text: '回一个字：好' }] }], generationConfig: gc };
      } else if (step.kind === 'custom') {
        if (!cfg.customUrl) throw new Error('未填写自定义端点 URL');
        const base = cfg.customUrl.replace(/\/$/, '');
        url = base.endsWith('/chat/completions') ? base : base + '/chat/completions';
        headers = { 'Content-Type': 'application/json' };
        if (cfg.customKey) headers.Authorization = 'Bearer ' + cfg.customKey;
        body = { model: step.model || cfg.customModel, stream: !!stream, max_tokens: 16,
          messages: [{ role: 'user', content: '回一个字：好' }] };
      } else {
        const base = (cfg.ollamaUrl || 'http://localhost:11434').replace(/\/$/, '');
        url = base + '/api/chat';
        headers = { 'Content-Type': 'application/json' };
        body = { model: cfg.ollamaModel, stream: !!stream, think: false,
          messages: [{ role: 'user', content: '回一个字：好' }] };
      }
      const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
      const text = await r.text().catch(() => '');
      return {
        ok: r.ok, status: r.status,
        detail: r.ok ? ('正常，返回 ' + text.length + ' 字节') : text.slice(0, 300)
      };
    } finally { clearTimeout(timer); }
  }

  function info() {
    const cfg = getCfg();
    const p = cfg.provider || 'gemini';
    return { provider: p, model: labelOf(cfg, p, '').split('/').slice(1).join('/') };
  }

  return {
    getCfg, saveCfg, chat, info, probe, DEF,
    // 供单测与诊断使用的纯函数（不参与业务流程）
    _internals: { isTransient, isOverloaded, isFatalConfig, backoffMs, parseRetryAfter, buildChain, labelOf, reasonOf }
  };
})();

if (typeof module === 'object' && module.exports) module.exports = LLM;
