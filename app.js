/* 奇门遁甲 PWA 控制器 + 渲染（client-side） */
(function () {
  const QM = window.QM;
  const $ = (id) => document.getElementById(id);
  let school = 'zhuanpan';

  /* ---------- 五行配色 ---------- */
  const ganColor = (g) => ({ '戊': 'wuxing-tu', '己': 'wuxing-tu', '庚': 'wuxing-jin', '辛': 'wuxing-jin', '壬': 'wuxing-shui', '癸': 'wuxing-shui', '丁': 'wuxing-huo', '丙': 'wuxing-huo', '乙': 'wuxing-mu', '甲': 'wuxing-mu' }[g] || '');
  function xingColor(x) { x = x || ''; if (x.includes('蓬')) return 'wuxing-shui'; if (x.includes('冲') || x.includes('辅')) return 'wuxing-mu'; if (x.includes('英')) return 'wuxing-huo'; if (x.includes('柱') || x.includes('心')) return 'wuxing-jin'; return 'wuxing-tu'; }
  function menColor(m) { return ({ '休门': 'wuxing-shui', '生门': 'wuxing-tu', '伤门': 'wuxing-mu', '杜门': 'wuxing-mu', '景门': 'wuxing-huo', '死门': 'wuxing-tu', '惊门': 'wuxing-jin', '开门': 'wuxing-jin' })[m] || ''; }
  function shenColor(s) { return ({ '值符': 'wuxing-mu', '腾蛇': 'wuxing-huo', '太阴': 'wuxing-jin', '六合': 'wuxing-mu', '白虎': 'wuxing-jin', '玄武': 'wuxing-shui', '九地': 'wuxing-tu', '九天': 'wuxing-jin' })[s] || ''; }
  function gongColor(n) { return ({ '震': 'wuxing-mu', '巽': 'wuxing-mu', '离': 'wuxing-huo', '坤': 'wuxing-tu', '艮': 'wuxing-tu', '中': 'wuxing-tu', '乾': 'wuxing-jin', '兑': 'wuxing-jin', '坎': 'wuxing-shui' })[n] || ''; }
  const SHEN_SHORT = { '值符': '符', '腾蛇': '蛇', '太阴': '阴', '六合': '合', '勾陈': '勾', '太常': '常', '朱雀': '雀', '九地': '地', '九天': '天', '白虎': '虎', '玄武': '玄' };
  const NUM_CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const GRID_ORDER = ['4', '9', '2', '3', '5', '7', '8', '1', '6'];

  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  /* ---------- 转盘宫格 ---------- */
  function cellZhuanpan(pan, g) {
    const JG = QM.JIU_GONG[g] || {};
    const ja = (pan.jiuGongAnalysis || {})[g] || {};
    const kong = (pan.kongWangGong || []).includes(g);
    const ma = pan.maStar && pan.maStar.gong === g;
    const xing = (pan.jiuXing || {})[g] || '', men = (pan.baMen || {})[g] || '', shen = (pan.baShen || {})[g] || '';
    const tg = (pan.tianPan || {})[g] || '', dg = (pan.diPan || {})[g] || '', dz = (pan.anGan || {})[g] || '';
    const cls = ['gong', 'gong' + g, ja.jiXiong || 'ping', pan.zhiFuGong === g ? 'zhifu' : '', pan.zhiShiGong === g ? 'zhishi' : ''].join(' ');
    return `<div class="${cls}"><div class="gong-content">
      <div class="gong-dizhi di-zhi">${esc(dz)}</div>
      <div class="gong-bashen ${shenColor(shen)}">${esc(shen)}</div>
      <div class="gong-tianganfang">${ma ? '<span class="circle-mark green-circle">马</span>' : ''}${kong ? '<span class="circle-mark yellow-circle">空</span>' : ''}</div>
      <div class="gong-bamen ${menColor(men)}">${esc(men)}</div>
      <div class="gong-jiuxing ${xingColor(xing)}">${esc(xing)}</div>
      <div class="gong-tiangan ${ganColor(tg)}">${esc(tg)}</div>
      <div class="gong-gongname ${gongColor(JG.name)}">${esc(JG.name)}</div>
      <div class="gong-number">${NUM_CN[+g]}</div>
      <div class="gong-dipan ${ganColor(dg)}">${esc(dg)}</div>
    </div></div>`;
  }

  /* ---------- 飞盘宫格（十大元素） ---------- */
  function cellFeipan(pan, g) {
    const JG = QM.JIU_GONG[g] || {};
    const kong = (pan.kongWangGong || []).includes(g);
    const ma = pan.maStar && pan.maStar.gong === g;
    const star = ((pan.tianPanXing || {})[g] || '').replace('天', '');
    const sh = s => SHEN_SHORT[s] || s || '';
    const tShen = sh((pan.tianPanShen || {})[g]), tYi = (pan.tianPanYi || {})[g] || '', tAn = (pan.tianPanAnGan || {})[g] || '';
    const mMen = ((pan.renPanMen || {})[g] || '').replace('门', ''), aMen = ((pan.renPanAnMen || {})[g] || '').replace('门', ''), rAn = (pan.renPanAnGan || {})[g] || '';
    const dShen = sh((pan.diPanShen || {})[g]), dYi = (pan.diPan || {})[g] || '', dAn = (pan.diPanAnGan || {})[g] || '';
    const cls = ['gong', 'gong' + g, pan.zhiFuLuoGong === g ? 'zhifu' : '', pan.zhiShiGong === g ? 'zhishi' : ''].join(' ');
    return `<div class="${cls}"><div class="feipan-gong-content kuonang">
      ${(kong || ma) ? `<div class="fp-marks">${ma ? '<span class="circle-mark green-circle">马</span>' : ''}${kong ? '<span class="circle-mark yellow-circle">空</span>' : ''}</div>` : ''}
      <div class="fp-xing ${xingColor(pan.tianPanXing && pan.tianPanXing[g])}">${esc(star)}</div>
      <div class="fp-row fp-tian"><span class="fp-shen">${esc(tShen)}</span><span class="fp-gan ${ganColor(tYi)}">${esc(tYi)}</span><span class="fp-an">${esc(tAn)}</span></div>
      <div class="fp-row fp-ren"><span class="fp-men fp-ming">${esc(mMen)}</span><span class="fp-men fp-an-men">${esc(aMen)}</span><span class="fp-an">${esc(rAn)}</span></div>
      <div class="fp-row fp-di"><span class="fp-shen">${esc(dShen)}</span><span class="fp-gan ${ganColor(dYi)}">${esc(dYi)}</span><span class="fp-an">${esc(dAn)}</span></div>
      <div class="fp-gongname">${esc(JG.name)}${NUM_CN[+g]}</div>
    </div></div>`;
  }

  function renderChart(pan) {
    const cellFn = school === 'feipan' ? cellFeipan : cellZhuanpan;
    const cls = school === 'feipan' ? 'pan-grid feipan-grid' : 'pan-grid';
    $('chart').innerHTML = `<div class="qimen-pan"><div class="pan-outer"><div class="${cls}">${GRID_ORDER.map(g => cellFn(pan, g)).join('')}</div></div></div>`;
  }

  function renderBasicInfo(pan) {
    const bi = pan.basicInfo || {}, sz = pan.siZhu || {};
    const zfGong = pan.zhiFuLuoGong || pan.zhiFuGong;
    $('basicInfo').style.display = 'block';
    $('basicInfo').innerHTML = [
      `<span class="item"><b>公历</b> ${esc(bi.date)}</span>`,
      `<span class="item"><b>四柱</b> ${esc(sz.year)} ${esc(sz.month)} ${esc(sz.day)} ${esc(sz.time)}</span>`,
      `<span class="item"><b>局</b> ${esc(pan.juShu && pan.juShu.fullName)}</span>`,
      `<span class="item"><b>旬首</b> ${esc(pan.xunShou || pan.xunShouYi)}</span>`,
      `<span class="item"><b>值符</b> ${esc(pan.zhiFuXing)}(${esc(zfGong)}宫)</span>`,
      `<span class="item"><b>值使</b> ${esc(pan.zhiShiMen)}(${esc(pan.zhiShiGong)}宫)</span>`
    ].join('');
  }

  function renderAnalysis(pan) {
    const a = pan.analysis || {}, ja = pan.jiuGongAnalysis || {};
    const purpose = (pan.basicInfo && pan.basicInfo.purpose) || '综合';
    let html = '';
    if (school === 'feipan') html += `<p class="muted">飞盘解断复用通用奇门基线(五行生克/十干克应/门迫/空亡/格局/用神)，飞盘专法(遁干81格/三乙四宫)以 AI 占断为准。</p>`;
    // 分析与建议
    html += `<div class="panel"><h3>分析与建议 · 目的：${esc(purpose)}</h3>`;
    if (a.yongShen) html += `<p>用神（${esc(purpose)}）：<b>${esc(a.yongShen.name)}</b> 落 <b>${esc(a.yongShen.direction)}方(${esc(a.yongShen.gongName)}宫，${esc(a.yongShen.jiXiongText)})</b> <span class="muted">${esc(a.yongShen.tip)}</span></p>`;
    else html += `<p class="muted">目的「${esc(purpose)}」无专一用神，综观全盘。</p>`;
    if (Array.isArray(a.suggestions) && a.suggestions.length) html += `<b>建议:</b><ul class="suggestion-list">${a.suggestions.map(s => `<li>${esc(s)}</li>`).join('')}</ul>`;
    html += `</div>`;
    // 格局
    html += `<div class="panel"><h3>格局</h3>`;
    if (Array.isArray(pan.geju) && pan.geju.length) html += `<ul class="geju-list">${pan.geju.map(g => `<li><b>${esc(g.name)}</b>${g.gong ? '(' + g.gong + '宫)' : ''} — ${esc(g.explain || (g.jiXiong === 'ji' ? '吉' : g.jiXiong === 'xiong' ? '凶' : '平'))}</li>`).join('')}</ul>`;
    else html += `<p class="muted">本盘未见显著格局。</p>`;
    html += `</div>`;
    // 九宫详解
    html += `<div class="panel"><h3>九宫详解</h3><div class="gong-details">`;
    for (let i = 1; i <= 9; i++) { const d = ja[i]; if (!d) continue;
      html += `<div style="border-bottom:1px solid #eee;padding:4px 0;font-size:13px;"><b>${i}-${esc(d.gongName)}</b> <span class="muted">${esc(d.direction)}</span> · ${esc(d.jiXiongText || '')} ${d.isYongShen ? '<b style="color:#3c763d;">【用神·' + esc(d.yongShenName) + '】</b>' : ''}${d.keYing ? '['+esc(d.keYing.name)+']' : ''}${d.menPo ? ' [门迫]' : ''}${d.kongWang ? ' [空亡]' : ''}${d.yiMa ? ' [驿马]' : ''}<br><span class="muted">${esc(d.explain || '')}</span></div>`;
    }
    html += `</div></div>`;
    $('analysis').innerHTML = html;
  }

  /* ---------- 排盘 ---------- */
  function getDate() {
    const d = $('inDate').value, t = $('inTime').value;
    if (d && t) { const dt = new Date(d + 'T' + t); if (!isNaN(dt)) return dt; }
    return new Date();
  }
  function cast() {
    const date = getDate(), purpose = $('inPurpose').value;
    const pan = school === 'feipan'
      ? QM.feipanQimen.calculate(date, { method: '时家', purpose })
      : QM.qimen.calculate(date, { type: '四柱', method: '时家', purpose, location: '默认位置' });
    if (pan.error) { $('analysis').innerHTML = `<div class="panel">排盘出错：${esc(pan.message)}</div>`; return; }
    if (!pan.jiuGongAnalysis) pan.jiuGongAnalysis = {};
    window._pan = pan;
    renderBasicInfo(pan); renderChart(pan); renderAnalysis(pan);
  }

  /* ---------- AI 设置 ---------- */
  function loadCfgForm() {
    const c = LLM.getCfg();
    $('cfgProvider').value = c.provider || 'gemini';
    $('cfgGeminiKey').value = c.geminiKey || ''; $('cfgGeminiModel').value = c.geminiModel || '';
    $('cfgOllamaUrl').value = c.ollamaUrl || ''; $('cfgOllamaModel').value = c.ollamaModel || '';
    $('cfgCustomUrl').value = c.customUrl || ''; $('cfgCustomKey').value = c.customKey || ''; $('cfgCustomModel').value = c.customModel || '';
    showProvFields(); updateProviderTag();
  }
  function showProvFields() {
    const p = $('cfgProvider').value;
    document.querySelectorAll('.prov').forEach(el => el.style.display = el.classList.contains('prov-' + p) ? '' : 'none');
  }
  function saveCfg() {
    LLM.saveCfg({
      provider: $('cfgProvider').value,
      geminiKey: $('cfgGeminiKey').value.trim(), geminiModel: $('cfgGeminiModel').value.trim() || 'gemini-1.5-flash',
      ollamaUrl: $('cfgOllamaUrl').value.trim() || 'http://localhost:11434', ollamaModel: $('cfgOllamaModel').value.trim() || 'qwen3:latest',
      customUrl: $('cfgCustomUrl').value.trim(), customKey: $('cfgCustomKey').value.trim(), customModel: $('cfgCustomModel').value.trim() || 'gpt-3.5-turbo'
    });
    $('cfgSavedTag').textContent = '已保存 ✓'; setTimeout(() => $('cfgSavedTag').textContent = '', 2000); updateProviderTag();
  }
  function updateProviderTag() { const i = LLM.info(); $('aiProviderTag').textContent = `（${i.provider} / ${i.model}）`; }

  /* ---------- AI 占断 ---------- */
  let _methodCache = {};
  async function getMethodText() {
    const key = school === 'feipan' ? 'feipan' : 'zhuanpan';
    if (_methodCache[key]) return _methodCache[key];
    try { const r = await fetch('assets/' + key + '-method.md'); _methodCache[key] = await r.text(); } catch (e) { _methodCache[key] = ''; }
    return _methodCache[key];
  }
  async function runAI() {
    const pan = window._pan; if (!pan) { $('aiStatus').textContent = '请先排盘'; return; }
    const q = $('aiQuestion').value.trim(); if (!q) { $('aiStatus').textContent = '请填写占问'; return; }
    const btn = $('aiBtn'); btn.disabled = true; $('aiAnswer').style.display = 'none';
    $('aiStatus').textContent = 'AI 解读中…(云端约 10-30s，本机模型更久)';
    try {
      const methodText = await getMethodText();
      // 占类：先按问句关键词自动识别；识别不出时回退到排盘所选「目的」
      const opts = { nianMingGan: $('aiNianMing').value, methodText, fallbackCategory: $('inPurpose').value };
      const builder = school === 'feipan' ? QM.feipanPredict : QM.zhuanpanPredict;
      const prompt = builder.buildPrompt(pan, q, opts);
      const answer = await LLM.chat(prompt.system, prompt.user);
      const head = `【占类：${prompt.context.category || '综合'}　模型：${LLM.info().provider}/${LLM.info().model}】\n\n`;
      $('aiAnswer').textContent = head + (answer || '(无内容)'); $('aiAnswer').style.display = 'block';
      $('aiStatus').textContent = '完成';
    } catch (e) { $('aiStatus').textContent = '出错：' + (e.message || e); }
    finally { btn.disabled = false; }
  }

  /* ---------- init ---------- */
  function init() {
    const now = new Date();
    // 必须用本地时区格式化：toISOString() 是 UTC，在 UTC+8 的 00:00-07:59 会给出昨天的日期 → 日柱全错
    const p2 = (n) => String(n).padStart(2, '0');
    $('inDate').value = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
    $('inTime').value = now.toTimeString().slice(0, 5);
    $('schoolSeg').addEventListener('click', e => {
      const b = e.target.closest('button[data-school]'); if (!b) return;
      school = b.dataset.school;
      [...$('schoolSeg').children].forEach(x => x.classList.toggle('on', x === b));
      cast();
    });
    $('castBtn').addEventListener('click', cast);
    $('cfgProvider').addEventListener('change', showProvFields);
    $('cfgSaveBtn').addEventListener('click', saveCfg);
    $('aiBtn').addEventListener('click', runAI);
    loadCfgForm();
    cast();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
