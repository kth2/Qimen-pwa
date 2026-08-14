/* 奇门遁甲 PWA 控制器 + 渲染（client-side） */
(function () {
  const QM = window.QM;
  const SX = window.ShanXiang;
  const YS = window.YongShen;   // 结构化用神层（可缺失：缺则退回原有流程）
  const XY = window.XiangYi;    // 占类象义推理层（Phase 2；缺则证据包不含 READING，其余照旧）
  const TM = window.Timing;     // 应期时间线层（Phase 4；缺则不含 TIMING，yingqi 块照常承载应期）
  const CB = window.Casebook;   // 案例本·经验层（Phase 5；只统计与建议，绝不改写教义规则）
  const CSTORE = window.CaseStore;
  const EV = window.Evidence;   // 结构化证据层（同上）
  const $ = (id) => document.getElementById(id);
  let school = 'zhuanpan';
  let mode = 'shijia'; // 'shijia'(时家) | 'shanxiang'(山向/宅盘)

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
    const sx = pan.shanXiang;
    $('basicInfo').style.display = 'block';
    $('basicInfo').innerHTML = [
      sx ? `<span class="item" style="color:#8a6d3b;"><b>山向/宅盘</b> 坐${esc(sx.sitting.name)}(${esc(sx.sitting.gua)})向${esc(sx.facing.name)}(${esc(sx.facing.gua)}) · 定局据 ${esc(sx.juBasis.jieqi)}${esc(sx.juBasis.yuan)}</span>` : '',
      sx ? `<span class="item muted">时间激活：${esc(sx.activation.source)}</span>` : '',
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
  // 自定义局：把 select 的 "yang-3" 解析成引擎起局对象；空串=跟随日期自动起局。
  // 该对象注入 calculate(opts.juShu)，引擎据此重排地盘并连带重算值符/值使/天盘等，
  // 四柱/旬首/空亡等由时辰决定者不变（强制局仅换地盘底，符合手工指定局的做法）。
  function getJuShuOverride() {
    const v = $('inJuShu').value;
    if (!v) return null;
    const [type, number] = v.split('-');
    return { type, number, yuan: '',
      fullName: `${type === 'yin' ? '阴遁' : '阳遁'}${number}局（自定义）`, formatCode: v };
  }
  // 山向盘：坐山定局，日期作时间激活层。复用转盘引擎机器(经 core/shanxiang.js)。
  function castShanXiang() {
    const purpose = $('inPurpose').value;
    const sitting = $('inSitting').value;         // 二十四山名
    const facing = $('inFacing').value || null;   // 空=自动取冲
    const method = $('inSxMethod').value || 'standard';
    // 有填日期时间则作激活时间(混合盘)，否则默认当下
    const d = $('inDate').value, t = $('inTime').value;
    const date = (d && t) ? new Date(d + 'T' + t) : undefined;
    return SX.generateShanXiangChart({ sitting, facing, date, method, purpose }, QM);
  }
  function cast() {
    let pan;
    if (mode === 'shanxiang') {
      pan = castShanXiang();
    } else {
      const date = getDate(), purpose = $('inPurpose').value, juShu = getJuShuOverride();
      const opts = school === 'feipan'
        ? { method: '时家', purpose }
        : { type: '四柱', method: '时家', purpose, location: '默认位置' };
      if (juShu) opts.juShu = juShu;
      pan = school === 'feipan'
        ? QM.feipanQimen.calculate(date, opts)
        : QM.qimen.calculate(date, opts);
    }
    if (pan.error) { $('analysis').innerHTML = `<div class="panel">排盘出错：${esc(pan.message)}</div>`; return; }
    if (!pan.jiuGongAnalysis) pan.jiuGongAnalysis = {};
    window._pan = pan;
    // 换了盘就作废上一次解读的存档素材：否则「存为案例」还挂在旧盘上，
    // 存下来的是另一张盘的象义
    _lastReading = null;
    if ($('caseSaveBar')) { $('caseSaveBar').style.display = 'none'; $('caseSaveTag').textContent = ''; }
    renderBasicInfo(pan); renderChart(pan); renderAnalysis(pan);
  }

  /* ---------- AI 设置 ---------- */
  function loadCfgForm() {
    const c = LLM.getCfg();
    $('cfgProvider').value = c.provider || 'gemini';
    $('cfgGeminiKey').value = c.geminiKey || ''; $('cfgGeminiModel').value = c.geminiModel || '';
    $('cfgOllamaUrl').value = c.ollamaUrl || ''; $('cfgOllamaModel').value = c.ollamaModel || '';
    $('cfgCustomUrl').value = c.customUrl || ''; $('cfgCustomKey').value = c.customKey || ''; $('cfgCustomModel').value = c.customModel || '';
    $('cfgGeminiFallbackModel').value = c.geminiFallbackModel || '';
    $('cfgCustomFallbackModel').value = c.customFallbackModel || '';
    // 超时与重试：留空即用 LLM.DEF 的默认值，故此处不回填默认数字（placeholder 已示意）
    const sec = (ms) => (ms ? String(Math.round(ms / 1000)) : '');
    $('cfgIdleTimeout').value = sec(c.idleTimeoutMs);
    $('cfgTotalTimeout').value = sec(c.totalTimeoutMs);
    $('cfgMaxRetries').value = (c.maxRetries === 0 || c.maxRetries) ? String(c.maxRetries) : '';
    $('cfgMaxTokens').value = c.maxTokens ? String(c.maxTokens) : '';
    $('cfgFallbackProvider').value = c.fallbackProvider || 'none';
    showProvFields(); updateProviderTag();
  }
  function showProvFields() {
    const p = $('cfgProvider').value;
    document.querySelectorAll('.prov').forEach(el => el.style.display = el.classList.contains('prov-' + p) ? '' : 'none');
  }
  function saveCfg() {
    LLM.saveCfg({
      provider: $('cfgProvider').value,
      geminiKey: $('cfgGeminiKey').value.trim(), geminiModel: $('cfgGeminiModel').value.trim() || 'gemini-3.5-flash',
      ollamaUrl: $('cfgOllamaUrl').value.trim() || 'http://localhost:11434', ollamaModel: $('cfgOllamaModel').value.trim() || 'qwen3:latest',
      customUrl: $('cfgCustomUrl').value.trim(), customKey: $('cfgCustomKey').value.trim(), customModel: $('cfgCustomModel').value.trim() || 'gpt-3.5-turbo',
      geminiFallbackModel: $('cfgGeminiFallbackModel').value.trim(),
      customFallbackModel: $('cfgCustomFallbackModel').value.trim(),
      fallbackProvider: $('cfgFallbackProvider').value,
      // 秒 → 毫秒；留空存 0，LLM 侧 numOr() 会回落默认值
      idleTimeoutMs: (Number($('cfgIdleTimeout').value) || 0) * 1000,
      totalTimeoutMs: (Number($('cfgTotalTimeout').value) || 0) * 1000,
      maxRetries: $('cfgMaxRetries').value === '' ? '' : Number($('cfgMaxRetries').value),
      maxTokens: Number($('cfgMaxTokens').value) || 0
    });
    $('cfgSavedTag').textContent = '已保存 ✓'; setTimeout(() => $('cfgSavedTag').textContent = '', 2000); updateProviderTag();
  }
  function updateProviderTag() { const i = LLM.info(); $('aiProviderTag').textContent = `（${i.provider} / ${i.model}）`; }

  /* ---------- AI 占断 ---------- */
  let _methodCache = {};
  async function getMethodText() {
    // 山向/宅盘有专属纲要（阳宅方位断法），不再借用时家转盘纲要
    const key = mode === 'shanxiang' ? 'shanxiang' : (school === 'feipan' ? 'feipan' : 'zhuanpan');
    if (_methodCache[key]) return _methodCache[key];
    // 必须校验 r.ok 且只缓存成功结果：SW 离线时会回 503 "offline" 正文，
    // 若把它(或空串)当纲要缓存，AI 将失去理论载荷、只凭模型自身知识臆断
    const r = await fetch('assets/' + key + '-method.md');
    if (!r.ok) throw new Error('解断纲要加载失败(HTTP ' + r.status + ')');
    const text = (await r.text()).trim();
    if (!text) throw new Error('解断纲要内容为空');
    _methodCache[key] = text;
    return text;
  }

  /* ---------- 结构化知识库（象义 + 占类用神） ---------- */
  // 两份 JSON 随 SW 预缓存，离线可用。加载失败不是致命错误：
  // 证据层只是"增益"，缺失时 runAI 自动退回原有的纯文本纲要流程，功能不减。
  let _kbReady = false;
  let _rulesReady = false;      // 象义规则库单独计：它缺席只减 READING，不该拖垮整个证据层
  let _timingReady = false;     // 应期规则库同理：缺席只减 TIMING
  async function loadKnowledge() {
    if (!YS || !EV) return false;
    const get = (p) => fetch(p).then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)));
    if (!_kbReady) {
      try {
        const [d, s] = await Promise.all([get('knowledge/domains.json'), get('knowledge/symbols.json')]);
        _kbReady = YS.load(d) && EV.load(s);
      } catch (e) {
        console.warn('[evidence] 知识库加载失败，本次按原有流程解读：', e.message);
        _kbReady = false;
      }
    }
    // 规则库单独重试：首次失败不该把它永久钉死，下一次解读仍可补上 READING
    if (_kbReady && XY && !_rulesReady) {
      try { _rulesReady = XY.load(await get('knowledge/domain-rules.json')); }
      catch (e) { console.warn('[xiangyi] 占类规则库加载失败，本次不作象义判读：', e.message); _rulesReady = false; }
    }
    // 应期规则库同样单独计：它缺席只减 TIMING，应期仍由 yingqi 块承载
    if (_kbReady && TM && !_timingReady) {
      try { _timingReady = TM.load(await get('knowledge/timing-rules.json')); }
      catch (e) { console.warn('[timing] 应期规则库加载失败，本次不排应期时间线：', e.message); _timingReady = false; }
    }
    return _kbReady;
  }

  // 追加在引擎 system prompt 之后的硬性纪律：把"参考纲要"收紧为"只许按纲要断"，
  // 防止模型引入纲要之外的门派理论或自创断法
  const AI_DISCIPLINE = [
    '',
    '=== 解读要求（须逐条遵守）===',
    '【依据·防臆造】',
    '1. 推理依据仅限：①上方《解断方法纲要》所载规则与衍象；②盘面/引擎给出的数据（各宫九星/八门/八神/天盘干/地盘干/暗干、格局、九宫吉凶、用神落宫）。不得引入八字、六爻、梅花易数、紫微、塔罗、星座、心理学等纲要之外的体系，也不得自创或"综合各家"。训练知识与本纲要冲突时，一律以本纲要为准。',
    '2. 用神以【用神落宫】所列为准，不得另取；吉凶格局以盘面/引擎已判者为准，不得推翻或另判。',
    '3. 每一处论断都要落到具体盘面元素并附纲要依据，如「依据：生门落坎一宫得令，纲要·用神取用/旺衰」。',
    '【深度·质量——须充分展开，不得笼统敷衍】',
    '4. 逐宫详析关键宫位：用神宫、值符宫、值使宫、日干宫、时干宫、年命宫（若提供）——分别说明其九星/八门/八神/天盘干/地盘干/暗干/格局/旺衰/空亡/驿马，再论各宫之间的生克、盗泄、比和、刑冲合害，交代其对所占之事的具体含义。',
    '5. 推理要一步步写清"为什么"，把纲要规则套到本盘的具体元素上，避免只下结论不给过程；衍象须落到具体的人/物/事/方位/时机，不停在抽象吉凶。',
    '6. 趋避建议须由盘面推出、具体可行（往何方位、何时机、借何门何神之象、忌何宫），并注明所据宫位；不写与本盘无关的泛泛套话与免责声明。',
    '7. 纲要与盘面确未直接载明处，可据纲要衍象作合理延伸并标注「（据×宫×象推）」；仅在毫无盘面依据时才写「纲要未载，不予推断」，不得以此搪塞本可分析之处。',
    '【结构——每节都要展开充分，理由部分尤须详尽】',
    '8. 按骨架输出：① 结论（一句断吉凶成败）② 用神与关键宫位逐宫详析 ③ 生克成败推理 ④ 方位 ⑤ 应期/数字 ⑥ 趋避建议。'
  ].join('\n');
  // 仅在证据包可用时追加。与上文纲要纪律互补：纲要管"按哪派理论断"，
  // 这段管"哪些内容是既定事实、哪些可由你推理"，二者不重复。
  const EVIDENCE_DISCIPLINE = [
    '',
    '=== 结构化证据（Evidence）使用规则 ===',
    '用户消息中的《结构化证据包》是本次解读的首要事实依据，含三类条目：',
    'FACT：由排盘引擎算得的盘面事实。RULE：应用生成的确定性分析。SYMBOL：应用知识库中的传统象义。',
    'E1. 不得改动任何 FACT，不得虚构证据包中不存在的盘面元素（宫位、门、星、神、干）。',
    'E2. 衍象优先采用所给 SYMBOL；可将多个 SYMBOL 组合成合理解释，但不得以自创象义取而代之。',
    'E3. 用神以证据包所列【用神映射】为准，不得另立一套用神体系。',
    'E4. 应期优先采用 RULE 中 yingqi 的确定性结果，不得另推。',
    'E5. 明确区分「事实」与「推断」：属于你的推理请标注（据×宫×象推）。',
    'E6. 证据互相矛盾或不足时，如实说明不确定，不得强作确定之断。',
    'E7. 标为「盘上未见」的元素即为未见，须据此论断（如空亡/不上盘之意），不得代为安置落宫。',
    'E8. 健康类只作传统奇门象义解读，明确声明非医学诊断，不给诊疗建议，劝其就医。',
    'E9. 依所选占类作答，不要跑题到其他占类。',
    // 以下三条对应 Phase 2 的 READING 层。要点：判读是"该占类下这个符号怎么读"，不是结论；
    // 权重决定详略；"规则未建"不等于"盘上无碍"——这三处一旦被模型误读，本层反成噪音。
    'E10. READING 是本占类下的象义判读（已注明依据），凡涉及其所断元素，须优先采用其读法，不得改用与占类无关的泛化解释；其 [助]/[阻] 只表倾向，**不是成败断语**，成败仍须结合引擎吉凶与全盘旺衰自行推断，不得以"助多于阻"直接下结论。',
    'E11. 【关注点与权重】的 ★ 决定着墨详略：★★★★★ 者须逐条展开，★★ 者点到为止，不要平均用力。标为「盘上未见」者按未见论。',
    'E12. 若证据包声明本占类「规则未建」，那是应用尚未收录该占类规则，**不等于盘上没有阻碍**；此时按《解断方法纲要》正常推断，不得以"未见判读"为由声称一切顺遂。',
    // Phase 4：应期锚点。要点是"只在候选里选"与"位次不是天数"——这两处一旦被误读，应期就会重新开始瞎猜。
    'E13. 断应期只许在 TIMING 所列锚点中选取，不得自造日辰；其干支与上方 yingqi 同源，二者不是两套推算，不要并列陈述或相互印证。填实/冲实/冲墓/马星只能是**地支日**，宫干定日只能是**天干日**，两者不可互换。',
    'E14. TIMING 的"距今位次"只表同一循环内的先到后到，**不是"几天后"**，不得换算成具体天数或日期。断日/断月/断年须按问事远近自行判定（近事看日时、中事看月、远事看年），并说明所据。',
    'E15. TIMING 的 [★强]/[★中]/[★参考] 表示该机制与本占用神的关系强弱，不是应验概率；不得写成"某日必应"，应表述为"应期多在…"或"须待…方应"。'
  ].join('\n');
  // 转盘断局补充：日干(求测人)/时干(所占之事)天盘落宫。
  // 引擎序列化只给四柱与九宫干，不点明二者落宫；此处算好喂给 AI，
  // 配合纲要新增的「日干为人、时干为事」总纲落地。甲不上天盘，遁于旬首、以值符落宫论。
  function riShiGanBlock(pan) {
    const sz = pan.siZhu || {}, tianPan = pan.tianPan || {};
    const riGan = (sz.day || '').charAt(0), shiGan = (sz.time || '').charAt(0);
    if (!riGan || !shiGan) return '';
    const fmt = (label, gan) => {
      if (gan === '甲') {
        const zf = pan.zhiFuLuoGong || pan.zhiFuGong, JG = QM.JIU_GONG[zf] || {};
        return `  - ${label}甲：甲遁于旬首，以值符落宫论 → ${zf}宫(${JG.name || '?'}·${JG.direction || '?'})`;
      }
      for (const g in tianPan) if (tianPan[g] === gan) {
        const JG = QM.JIU_GONG[g] || {};
        return `  - ${label}${gan}：天盘落${g}宫(${JG.name || '?'}·${JG.direction || '?'})，同宫地盘干${(pan.diPan || {})[g] || '?'}`;
      }
      return `  - ${label}${gan}：天盘未见，以地盘${gan}所在宫论`;
    };
    return ['', '【日干/时干落宫（转盘断局补充）】',
      fmt('日干(求测人)', riGan),
      fmt('时干(所占之事/对方)', shiGan),
      '请按纲要「日干为人、时干为事」：先审时干宫对日干宫(或年命宫)的生克盗泄定成败，再合值符值使、用神宫参断。'].join('\n');
  }

  async function runAI() {
    const pan = window._pan; if (!pan) { $('aiStatus').textContent = '请先排盘'; return; }
    const q = $('aiQuestion').value.trim(); if (!q) { $('aiStatus').textContent = '请填写占问'; return; }
    const btn = $('aiBtn'); btn.disabled = true; $('aiAnswer').style.display = 'none';
    $('aiStatus').textContent = 'AI 解读中…(云端约 10-30s，本机模型更久)';
    try {
      await loadKnowledge();   // 先备好知识库：fallbackCategory 的占类换算依赖它
      let methodText;
      try { methodText = await getMethodText(); }
      catch (me) { throw new Error(me.message + '。为避免 AI 脱离流派纲要自行发挥，已中止本次解读，请检查网络后重试。'); }
      // 占类：先按问句关键词自动识别；识别不出时回退到排盘所选「目的」
      // fallbackCategory 必须传【引擎占类名】而非界面「目的」值：二者并不同名
      // （财运↔求财、健康↔疾病、学业↔功名），直传界面值会静默回落「综合」、丢掉该占类的专用用神。
      // 知识库未加载时 toEngineCategory 原样返回，行为与修复前一致。
      const uiPurpose = $('inPurpose').value;
      const fallbackCategory = (YS && YS.toEngineCategory) ? YS.toEngineCategory(uiPurpose) : uiPurpose;
      const opts = { nianMingGan: $('aiNianMing').value, methodText, fallbackCategory };
      const builder = school === 'feipan' ? QM.feipanPredict : QM.zhuanpanPredict;
      const prompt = builder.buildPrompt(pan, q, opts);
      const head = `【占类：${prompt.context.category || '综合'}　模型：${LLM.info().provider}/${LLM.info().model}】\n\n`;
      // 流式：边生成边显示，既提升观感也避免长响应在网关侧 504
      $('aiStatus').textContent = 'AI 解读中…(边生成边显示)';
      $('aiAnswer').style.display = 'block'; $('aiAnswer').textContent = head;
      let streamed = false;
      const sx = pan.shanXiang;
      const sxBlock = sx ? ['', '【山向/宅盘背景】',
        `此为宅盘：坐${sx.sitting.name}山(${sx.sitting.gua}宫)、向${sx.facing.name}(${sx.facing.gua}宫)，据${sx.juBasis.jieqi}${sx.juBasis.yuan}坐山定局得${pan.juShu && pan.juShu.fullName || ''}，时间激活层由所给日期起符。`,
        '请以阳宅/风水视角断：向首宫为纳气之口(看门/开门/生门旺相为吉)，坐山宫为宅主根基，中五为宅心；结合各方位九宫吉凶给出宜忌与调整方位。仍严守纲要，不得引入纲要外体系。'].join('\n') : '';
      // 旺衰与四害：引擎不算，此处补全后注入——断强弱成败的关键依据
      const wsBlock = (window.WangShuai && window.WangShuai.toPromptBlock)
        ? window.WangShuai.toPromptBlock(pan, { JIU_GONG: QM.JIU_GONG }) : '';
      // 应期与数字：引擎虽算出空亡"地支"，序列化却只写宫号，AI 只能臆造填实/冲实之日。
      // 此处把空亡支、填实/冲实日、驿马、冲墓日、各宫干→日辰/河图数全部算好写明。
      const ysGongs = ((prompt.context && prompt.context.yong && prompt.context.yong.located) || [])
        .map(x => x && x.gong).filter(Boolean);
      const yqBlock = (window.YingQi && window.YingQi.toPromptBlock)
        ? window.YingQi.toPromptBlock(pan, { JIU_GONG: QM.JIU_GONG, yongShenGongs: ysGongs }) : '';
      // 结构化推理层：占类 → 用神 → 证据包。复用上面已算好的分析结果，不重复排盘、不二次调用引擎。
      // 证据包接管 wangshuai/yingqi 的呈现，故二者不再单独拼接，避免同一内容进两次提示词；山向段另行保留。
      let evBlock = '', sysExtra = '';
      // 按次作用域收集本轮的结构化产物。**不能靠 window._xiangyi 之类的全局量**：
      // 知识库加载失败或证据构建抛错时那些全局量不会被更新，仍留着上一次解读的值，
      // 存案例就会把「别的盘」的象义记进这一条里——统计从此全错。
      const runOut = { yongshen: null, xiangyi: null, timing: null, evidence: null, domain: '' };
      window._evidence = window._xiangyi = window._timing = null;   // 先清干净，宁可为空也不串盘
      if (await loadKnowledge()) {
        try {
          // 占类优先取引擎按问句识别的结果（比下拉框更贴合实际所问），识别不出再回落界面「目的」
          const domain = YS.normalizeDomain((prompt.context && prompt.context.category) || fallbackCategory);
          const yongshen = YS.resolve({
            domain, chart: pan,
            options: {
              engineYong: prompt.context && prompt.context.yong,
              nianMingGan: $('aiNianMing').value,
              school: school === 'feipan' ? 'feipan' : 'zhuanpan'   // 盘别显式下传，杜绝两派取用互串
            }
          });
          // 占类象义判读（Phase 2）：把「该占类下这个符号怎么读」算成可溯源的判读条目。
          // 规则库未加载、占类规则未建、或本盘为飞盘时，xiangyi 自行停用并说明原因，
          // 证据包随之不含 READING——其余部分照旧，解读不受影响。
          let xiangyi = null;
          if (_rulesReady && XY) {
            try {
              xiangyi = XY.analyze({
                domain, chart: pan,
                // 传 wangshuai 的**分析结果**（非文本块）：旺衰与四害由它单一供给，
                // 象义层只读不重算，避免与 wangshuai 出现两套说法。
                wangshuai: (window.WangShuai && window.WangShuai.analyze) ? window.WangShuai.analyze(pan) : null,
                options: { school: school === 'feipan' ? 'feipan' : 'zhuanpan' }
              });
            } catch (xe) { console.warn('[xiangyi] 判读失败，本次不含 READING：', xe.message); xiangyi = null; }
          }
          // 应期时间线（Phase 4）：把 yingqi 已算好的干支按「与本占用神的关系」筛选、定强弱、排先后。
          // 干支一律取自上面同一份 yingqi 计算，绝不重算——两处若各推一套，模型必然选错日子。
          let timing = null;
          if (_timingReady && TM) {
            try {
              const ysGongsForTiming = (xiangyi && xiangyi.applicable)
                ? xiangyi.focus.map(f => f.gong)
                : ysGongs;   // 飞盘/象义层停用时退回引擎自算的用神宫
              timing = TM.analyze({
                chart: pan,
                yingqi: window.YingQi.analyze(pan, { yongShenGongs: ysGongsForTiming }),
                xiangyi, wangshuai: (window.WangShuai && window.WangShuai.analyze) ? window.WangShuai.analyze(pan) : null,
                options: { domain, school: school === 'feipan' ? 'feipan' : 'zhuanpan', yongShenGongs: ysGongsForTiming }
              });
            } catch (te) { console.warn('[timing] 排应期失败，本次不含 TIMING：', te.message); timing = null; }
          }
          // 不传 shanxiang：山向背景与阳宅断法要求仍由 sxBlock 原样承载（那段含解读指引而不止事实），
          // 若再进证据包会造成同一内容重复入提示词。
          // 经验层（Phase 5）：把本机历史反馈里已达样本门槛的规则附一条说明。
          // 只是附注——不参与规则求值，故规则层的确定性与跨设备可复现不受影响。
          let calibration = [];
          if (store && CB && xiangyi) {
            try {
              const overlay = await store.getOverlay();
              calibration = CB.calibrationFor(overlay, xiangyi);
            } catch (ce) { console.warn('[casebook] 读取经验层失败，本次不附经验：', ce.message); }
          }
          const evidence = EV.build({
            question: q, domain, chart: pan, yongshen, xiangyi, timing, calibration,
            wangshuai: wsBlock, yingqi: yqBlock
          });
          runOut.yongshen = yongshen; runOut.xiangyi = xiangyi;
          runOut.timing = timing; runOut.evidence = evidence; runOut.domain = domain;
          window._evidence = evidence;                 // 便于在控制台核对喂给模型的内容
          window._xiangyi = xiangyi;                   // 同上：逐条核对判读命中了哪些规则
          window._timing = timing;                     // 同上：核对应期锚点与其机制
          evBlock = EV.toPromptBlock(evidence);
          if (evBlock) sysExtra = '\n' + EVIDENCE_DISCIPLINE;
        } catch (ee) {
          console.warn('[evidence] 构建失败，本次按原有流程解读：', ee.message);
          evBlock = '';
        }
      }
      // 证据包可用时由它承载旺衰/应期；不可用则退回原有的两段拼接。山向段始终保留。
      const analysisBlocks = evBlock || (wsBlock + yqBlock);
      const userMsg = prompt.user + (school !== 'feipan' ? riShiGanBlock(pan) : '')
        + analysisBlocks + sxBlock;
      const answer = await LLM.chat(prompt.system + '\n' + AI_DISCIPLINE + sysExtra, userMsg, (full) => {
        streamed = true; $('aiAnswer').textContent = head + (full || '');
      // onStatus：把重试与备用切换过程显示出来。干等两分钟再报错，是最劝退的体验
      }, (msg) => { $('aiStatus').textContent = msg; });
      if (!streamed || !answer) $('aiAnswer').textContent = head + (answer || '(无内容)');
      else $('aiAnswer').textContent = head + answer; // 收尾用清理后的完整文本(去 <think> 等)
      $('aiStatus').textContent = '完成';
      // 备好「存为案例」的素材。答案截断到 8000 字：全文可能极长，手机存储不该被单条撑爆
      if (store && CB) {
        // 一律取本轮的 runOut，不读全局量——见上文「不能靠 window._xiangyi」的说明
        _lastReading = {
          question: q, domain: runOut.domain,
          school, mode, chart: pan, dateISO: $('inDate').value + ' ' + $('inTime').value,
          yongshen: runOut.yongshen, xiangyi: runOut.xiangyi,
          timing: runOut.timing, evidence: runOut.evidence,
          answer: String(answer || '').slice(0, 8000)
        };
        $('caseSaveBar').style.display = 'block';
        $('caseSaveTag').textContent = '';
      }
    } catch (e) { $('aiStatus').textContent = '出错：' + (e.message || e); }
    finally { btn.disabled = false; }
  }

  /* ---------- 案例本（Phase 5·经验层） ----------
   * 边界：本层只记录、统计、建议。反馈**永不改写** knowledge/*.json——
   * 那会让每条规则的 basis 变成假话，并使「同盘同占类必得同一结果」不再成立
   * （各机权重不同则跨设备无法复现）。经验以 CALIBRATION 条目单独送达模型。 */
  const store = (CSTORE && CSTORE.create) ? CSTORE.create() : null;
  let _lastReading = null;      // 最近一次解读的素材，供「存为案例」取用
  let _caseTab = 'list';

  async function refreshCaseCount() {
    if (!store) return;
    try {
      const rows = await store.list();
      const graded = rows.filter(r => CB && CB.graded(r)).length;
      $('caseCountTag').textContent = `共 ${rows.length} 例，已回填 ${graded} 例`
        + (store.persistent ? '' : '　⚠ 本设备无法持久化，关闭即丢失');
    } catch (e) { $('caseCountTag').textContent = '读取失败：' + e.message; }
  }

  async function saveCurrentCase() {
    if (!store || !CB || !_lastReading) return;
    const btn = $('caseSaveBtn'); btn.disabled = true;
    try {
      // 传 yongshen/evidence 进去，makeCase 才抽得出「盘面象义」那一段
      const rec = CB.makeCase(Object.assign({ id: store.newId(), now: new Date().toISOString() }, _lastReading));
      await store.save(rec);
      $('caseSaveTag').textContent = '已存档，事后可在「案例本」回填实际结果';
      await refreshCaseCount(); await renderCases();
    } catch (e) {
      $('caseSaveTag').textContent = '保存失败：' + e.message;
    } finally { btn.disabled = false; }
  }

  const rec_hasAnswer = (r) => !!(r && r.answer && r.answer.length);

  const OUTCOME_BTNS = [
    ['happened', '完全应验'], ['partial', '部分应验'],
    ['not_happened', '未应验'], ['opposite', '结果相反']
  ];

  async function renderCases() {
    if (!store || !CB) return;
    const host = $('caseListView');
    let rows;
    try { rows = await store.list(); } catch (e) { host.innerHTML = `<span class="muted">读取失败：${esc(e.message)}</span>`; return; }
    if (!rows.length) {
      host.innerHTML = '<span class="muted">还没有案例。解读之后点「存为案例」，等事情有了结果再回来回填——积累到一定数量才谈得上统计。</span>';
      return;
    }
    host.innerHTML = rows.map(r => {
      const fb = r.feedback;
      const tag = fb
        ? `<b style="color:${fb.outcome === 'happened' ? '#3c763d' : fb.outcome === 'opposite' ? '#a94442' : '#8a6d3b'}">${esc(fb.label)}</b>`
        : '<span class="muted">待回填</span>';
      const hit = r.timingHits && r.timingHits.hits.length
        ? `　<span style="color:#3c763d">应期命中 ${r.timingHits.hits.length} 条</span>` : '';
      const actual = fb && fb.actual ? `<div class="muted" style="margin-top:2px;">实况：${esc(fb.actual.slice(0, 80))}</div>` : '';
      const misTag = fb && (fb.misreads || []).length ? `　<span style="color:#a94442">断错分析 ${fb.misreads.length} 条</span>` : '';
      const noAns = rec_hasAnswer(r) ? '' : '　<span class="muted">（未存解读全文）</span>';
      const marked = fb ? (Object.keys(fb.ruleVerdicts || {}).length + Object.keys(fb.symbolVerdicts || {}).length) : 0;
      return `<div style="border-bottom:1px solid #eee;padding:6px 0;font-size:13px;">
        <div><b>${esc(r.question || '(未填问题)')}</b> <span class="muted">${esc(r.domain || '')}　${esc(r.chartRef.siZhu || '')}</span></div>
        <div class="muted">${esc((r.createdAt || '').slice(0, 10))}　判读 ${r.fired.rules.length} 条　锚点 ${r.fired.anchors.length} 个　${tag}${marked ? `　已逐条标注 ${marked} 条` : ''}${hit}${misTag}${noAns}</div>
        ${actual}
        <div style="margin-top:4px;">
          <button class="btn" style="background:#3c763d;padding:3px 8px;font-size:12px;" data-open="${esc(r.id)}">${fb ? '查看/修改复盘' : '📝 填写实况并复盘'}</button>
          <button class="btn" style="background:#a94442;padding:3px 8px;font-size:12px;" data-del="${esc(r.id)}">删除</button></div>
      </div>`;
    }).join('');
  }

  /* ---------- 复盘表单：实况文本 + 实际日期 + 逐条标注 + AI 复盘 ---------- */
  let _reviewRec = null;

  const VERDICT_OPTS = [['', '未标注'], ['happened', '相符'], ['partial', '部分'], ['not_happened', '不符'], ['opposite', '相反']];

  async function openReview(id) {
    if (!store || !CB) return;
    const rec = await store.get(id);
    if (!rec) return;
    _reviewRec = rec;
    const fb = rec.feedback || {};
    const vs = fb.ruleVerdicts || {};
    const svs = fb.symbolVerdicts || {};
    const sel = (attr, key, cur) => `<select data-${attr}="${esc(key)}" style="font-size:12px;margin-top:2px;">
      ${VERDICT_OPTS.map(([v, label]) => `<option value="${v}"${cur === v || (!cur && !v) ? ' selected' : ''}>${label}</option>`).join('')}
    </select>`;
    // ① 盘面象义：用神落宫与同宫之象。各盘别、各占类都有，是「当时这盘说了什么」的原始层
    const symsHtml = (rec.fired.symbols || []).map(s => `
      <div style="border-bottom:1px solid #f2f2f2;padding:4px 0;font-size:12px;">
        <div><b>${esc(s.label)}</b></div>
        <div class="muted">同宫：${esc(s.withEls.join('/'))}</div>
        <div class="muted">象义：${esc(s.words.join('、'))}</div>
        ${sel('symverdict', s.key, svs[s.key])}
      </div>`).join('');
    // ② 规则判读：domain-rules.json 命中项，有出处、可回查、可驱动校准
    const rulesHtml = rec.fired.rules.length ? rec.fired.rules.map(r => `
      <div style="border-bottom:1px solid #f2f2f2;padding:4px 0;font-size:12px;">
        <div>${esc(r.label || r.id)} <span class="muted">→ ${esc(r.concept || '')}</span>
          <span class="muted">[${r.polarity === '+' ? '助' : r.polarity === '-' ? '阻' : '中'}]</span></div>
        ${sel('verdict', r.id, vs[r.id])}
      </div>`).join('')
      : '<div class="muted" style="font-size:12px;padding:4px 0;">本占类的规则库尚未覆盖（如综合占类、或飞盘），故无规则判读条目——这不代表盘上无象，上面的盘面象义照常可标。</div>';
    const mis = (fb.misreads || []);
    $('reviewBody').innerHTML = `
      <div style="font-size:13px;">
        <div><b>${esc(rec.question || '')}</b> <span class="muted">${esc(rec.chartRef.siZhu || '')}</span></div>
        ${rec.answer ? `<details style="margin-top:6px;"><summary>📄 当时的解读全文（打分前先对照一下）</summary>
          <div style="white-space:pre-wrap;background:#f7f7f7;border-radius:6px;padding:8px;margin-top:4px;max-height:240px;overflow:auto;font-size:12px;">${esc(rec.answer)}</div>
        </details>` : '<div class="muted" style="margin-top:6px;">（本条案例未记录解读全文——存档前的旧案例会这样）</div>'}
        <div style="margin-top:6px;">
          <div class="muted">① 实际发生了什么？（用你自己的话写，越具体越有用）</div>
          <textarea id="reviewActual" rows="3" style="width:100%;">${esc(fb.actual || '')}</textarea>
        </div>
        <div style="margin-top:6px;">
          <span class="muted">② 实际发生日期</span>
          <input type="date" id="reviewDate" value="${esc(fb.happenedAt || '')}">
          <span class="muted" id="reviewHitTag"></span>
        </div>
        <div style="margin-top:6px;">
          <span class="muted">③ 整体判断</span>
          ${OUTCOME_BTNS.map(([k, label]) =>
            `<label style="margin-right:8px;font-size:12px;"><input type="radio" name="reviewOutcome" value="${k}"${fb.outcome === k ? ' checked' : ''}>${label}</label>`).join('')}
        </div>
        <div style="margin-top:8px;">
          <span class="muted">④ 逐条标注（这一步做了，统计才谈得上可信——否则只能按"整案归因"粗算）</span>
          <button class="btn" id="reviewAiBtn" style="background:#666;padding:3px 8px;font-size:12px;">🤖 让 AI 依实况给出建议</button>
          <span class="muted" id="reviewAiTag"></span>
          <div style="max-height:420px;overflow:auto;margin-top:4px;">
            <div style="margin:4px 0;font-weight:bold;">盘面象义（当时这盘的用神落宫与同宫之象）</div>
            ${symsHtml}
            <div style="margin:10px 0 4px;font-weight:bold;">规则判读（按纲要命中的条目，有出处）</div>
            ${rulesHtml}
          </div>
        </div>
        <div id="reviewMisreads" style="margin-top:8px;">${mis.length ? renderMisreads(mis) : ''}</div>
        <div id="reviewObs" class="muted" style="margin-top:6px;"></div>
        <div style="margin-top:8px;">
          <button class="btn" id="reviewSaveBtn">保存复盘</button>
          <button class="btn" id="reviewCancelBtn" style="background:#999;">关闭</button>
          <span class="muted" id="reviewSaveTag"></span>
        </div>
      </div>`;
    $('reviewPanel').style.display = 'block';
    $('reviewDate').addEventListener('change', previewTimingHits);
    $('reviewAiBtn').addEventListener('click', aiReview);
    $('reviewSaveBtn').addEventListener('click', saveReview);
    $('reviewCancelBtn').addEventListener('click', () => { $('reviewPanel').style.display = 'none'; _reviewRec = null; });
    previewTimingHits();
  }

  /** 断错分析：AI 指出的「哪句断错了、依据哪条、实际如何」。这是「规则错在哪」最直接的线索。 */
  function renderMisreads(list) {
    if (!list || !list.length) return '';
    return `<div style="border:1px solid #e0c9c9;border-radius:6px;padding:6px;background:#fdf7f7;">
      <b style="font-size:12px;">断错分析</b> <span class="muted">（AI 依实况指出，供你核对；basedOn 为其所依据的条目）</span>
      ${list.map(m => `<div style="font-size:12px;margin-top:4px;">
        · 断言：「${esc(m.claim)}」<br>
        &nbsp;&nbsp;实际：${esc(m.actual || '—')}
        ${m.basedOn ? `<br>&nbsp;&nbsp;<span class="muted">依据：<code>${esc(m.basedOn)}</code></span>` : ''}
      </div>`).join('')}
    </div>`;
  }

  /** 应期反推：确定性比对，实时显示命中了哪条机制。 */
  function previewTimingHits() {
    if (!_reviewRec || !CB) return;
    const d = $('reviewDate').value;
    if (!d) { $('reviewHitTag').textContent = ''; return; }
    const sz = QM.qimen.calculate(new Date(d + 'T12:00:00'), { type: '四柱', method: '时家', purpose: '综合' }).siZhu;
    const der = CB.deriveTimingHits(_reviewRec, sz);
    $('reviewHitTag').innerHTML = der.hits.length
      ? `　<span style="color:#3c763d">${esc(sz.day)}日 — 命中：${der.hits.map(h => esc(h.mechanism + '·' + h.value + '(' + h.level + ')')).join('、')}</span>
         <span class="muted">（随机基准 ${Math.round(der.chance * 100)}%，命中率与基准相当即不算准）</span>`
      : `　<span class="muted">${esc(sz.day)}日 — 当时的锚点无一命中（随机基准 ${Math.round(der.chance * 100)}%）</span>`;
  }

  /** AI 复盘：只让模型把实况映射到当时的判读上，输出经严格校验后填进表单，由用户过目再存。 */
  async function aiReview() {
    if (!_reviewRec || !CB) return;
    const actual = $('reviewActual').value.trim();
    if (!actual) { $('reviewAiTag').textContent = '请先填写实际情况'; return; }
    const btn = $('reviewAiBtn'); btn.disabled = true; $('reviewAiTag').textContent = 'AI 复盘中…';
    try {
      const sys = '你是奇门占例复盘助手。只做判读与实况的比对标注，不重新断卦、不新增断法。只输出 JSON。';
      const out = await LLM.chat(sys, CB.reviewPrompt(_reviewRec, actual), null);
      const parsed = CB.parseReview(out, _reviewRec);
      if (!parsed.ok) { $('reviewAiTag').textContent = '解析失败：' + parsed.error + '（可手动标注）'; return; }
      let n = 0;
      Object.keys(parsed.verdicts).forEach(id => {
        const el = document.querySelector(`select[data-verdict="${CSS.escape(id)}"]`);
        if (el) { el.value = parsed.verdicts[id]; n++; }
      });
      Object.keys(parsed.symbolVerdicts || {}).forEach(k => {
        const el = document.querySelector(`select[data-symverdict="${CSS.escape(k)}"]`);
        if (el) { el.value = parsed.symbolVerdicts[k]; n++; }
      });
      _reviewRec._aiObservations = parsed.observations;
      _reviewRec._aiMisreads = parsed.misreads || [];
      $('reviewMisreads').innerHTML = renderMisreads(_reviewRec._aiMisreads);
      $('reviewObs').innerHTML = parsed.observations.length
        ? '观察（供参考，非结论）：<br>' + parsed.observations.map(o => '· ' + esc(o)).join('<br>') : '';
      $('reviewAiTag').textContent = `已填入 ${n} 条标注建议`
        + ((parsed.misreads || []).length ? `、${parsed.misreads.length} 条断错分析` : '')
        + (parsed.dropped.length ? `，丢弃 ${parsed.dropped.length} 条无效项` : '') + '——请过目后再保存';
    } catch (e) {
      $('reviewAiTag').textContent = 'AI 复盘失败：' + (e.message || e);
    } finally { btn.disabled = false; }
  }

  async function saveReview() {
    if (!_reviewRec || !store || !CB) return;
    const picked = document.querySelector('input[name="reviewOutcome"]:checked');
    if (!picked) { $('reviewSaveTag').textContent = '请先选择整体判断'; return; }
    const verdicts = {}, symbolVerdicts = {};
    let anyManual = false;
    document.querySelectorAll('select[data-verdict]').forEach(sel => {
      if (sel.value) { verdicts[sel.dataset.verdict] = sel.value; anyManual = true; }
    });
    document.querySelectorAll('select[data-symverdict]').forEach(sel => {
      if (sel.value) { symbolVerdicts[sel.dataset.symverdict] = sel.value; anyManual = true; }
    });
    const happenedAt = $('reviewDate').value;
    try {
      let rec = CB.applyFeedback(_reviewRec, {
        outcome: picked.value,
        actual: $('reviewActual').value.trim(),
        happenedAt,
        ruleVerdicts: verdicts,
        symbolVerdicts,
        // 用户在界面上过目并可改动过，故一律记为 manual；AI 只是预填
        verdictSource: anyManual ? 'manual' : '',
        observations: _reviewRec._aiObservations || [],
        misreads: _reviewRec._aiMisreads || (_reviewRec.feedback && _reviewRec.feedback.misreads) || [],
        now: new Date().toISOString()
      });
      if (happenedAt) {
        const sz = QM.qimen.calculate(new Date(happenedAt + 'T12:00:00'), { type: '四柱', method: '时家', purpose: '综合' }).siZhu;
        rec = CB.applyTimingDerivation(rec, CB.deriveTimingHits(rec, sz));
      }
      delete rec._aiObservations; delete rec._aiMisreads;
      await store.save(rec);
      $('reviewSaveTag').textContent = '已保存';
      $('reviewPanel').style.display = 'none'; _reviewRec = null;
      await refreshCaseCount(); await renderCases(); await rebuildOverlay();
    } catch (e) { $('reviewSaveTag').textContent = '保存失败：' + e.message; }
  }

  /** 由已达门槛的统计重建经验层 overlay。只产出附注，不改任何规则。 */
  async function rebuildOverlay() {
    if (!store || !CB) return null;
    try {
      const rows = await store.list();
      const cal = CB.calibrate(rows);
      const overlay = CB.buildOverlay(CB.proposals(cal), cal);
      await store.setOverlay(overlay);
      return overlay;
    } catch (e) { console.warn('[casebook] 重建经验层失败：', e.message); return null; }
  }

  async function renderStats() {
    if (!store || !CB) return;
    const host = $('caseStatsView');
    const rows = await store.list();
    const cal = CB.calibrate(rows);
    const ps = CB.proposals(cal);
    if (!cal.totals.graded) {
      host.innerHTML = `<span class="muted">已存 ${cal.totals.cases} 例，但还没有回填过结果。<br>
        统计需要已回填的案例；单条规则要满 ${cal.minSamples} 例才会给出符合率——样本太少的百分比会误导人，故不显示。</span>`;
      return;
    }
    const domHtml = cal.domains.map(d =>
      `<div>${esc(d.domain)}：${esc(d.display)}${d.opposite ? `　<span style="color:#a94442">相反 ${d.opposite} 例</span>` : ''}</div>`).join('');
    const ruleHtml = cal.rules.slice(0, 30).map(r =>
      `<div style="font-size:12px;border-bottom:1px solid #f0f0f0;padding:2px 0;">
        <code>${esc(r.ruleId)}</code>　${esc(r.display)}${r.opposite ? `　<span style="color:#a94442">相反 ${r.opposite}</span>` : ''}${r.misreadN ? `　<span style="color:#a94442">被指为断错依据 ${r.misreadN} 次</span>` : ''}
      </div>`).join('');
    // 应期机制命中率：必须连随机基准一起显示，否则「命中」会被当成灵验
    const tc = CB.timingCalibration(rows);
    const hi = tc.high || {};
    const hiHtml = tc.cases
      ? `<div style="margin:4px 0;padding:4px 8px;background:#fafafa;font-size:12px;">
           <b>★强锚点</b>（纲要明言「须待此时方应」者，数量少、才有信息量）：${esc(hi.display || '—')}
           ${hi.baseline != null ? `　随机基准 ${Math.round(hi.baseline * 100)}%` : ''}
           ${hi.enough && hi.baseline != null ? (hi.rate > hi.baseline
             ? '　<span style="color:#3c763d">高于基准，这条线有效</span>'
             : '　<span style="color:#a94442">未高于基准——应期在你这儿暂无证据说准</span>') : ''}
         </div>` : '';
    const tcHtml = tc.cases
      ? `<div style="margin-top:8px;"><b>应期机制命中率</b>
           <span class="muted">（已反推 ${tc.cases} 例；全量锚点随机基准 ${Math.round((tc.baseline || 0) * 100)}%——候选一多几乎必中，故须看下面的★强子集）</span></div>`
        + hiHtml
        + tc.mechanisms.map(m => {
          const better = m.enough && tc.baseline != null && m.rate > tc.baseline;
          return `<div style="font-size:12px;">${esc(m.mechanism)}：${esc(m.display)}${m.enough ? (better ? '　<span style="color:#3c763d">高于基准</span>' : '　<span class="muted">未高于基准</span>') : ''}</div>`;
        }).join('')
      : '<div class="muted" style="margin-top:8px;">还没有填过实际发生日期，无法反推应期。</div>';
    const symStatHtml = (cal.symbols || []).length
      ? cal.symbols.slice(0, 30).map(s =>
        `<div style="font-size:12px;border-bottom:1px solid #f0f0f0;padding:2px 0;">
          ${esc(s.label || s.key)}　${esc(s.display)}${s.opposite ? `　<span style="color:#a94442">相反 ${s.opposite}</span>` : ''}
        </div>`).join('')
      : '<span class="muted">暂无</span>';
    const psHtml = ps.length ? ps.map(p =>
      `<div style="border-left:3px solid ${p.severity === 'high' ? '#a94442' : '#8a6d3b'};padding:4px 8px;margin:6px 0;background:#fafafa;font-size:12px;">
        <b>${esc(p.title)}</b>${p.ruleId ? `　<code>${esc(p.ruleId)}</code>` : ''}<br>
        <span class="muted">${esc(p.detail)}</span>
      </div>`).join('') : '<span class="muted">暂无建议（需满足更高的样本门槛）。</span>';
    host.innerHTML = `
      <div style="font-size:13px;">
        <div><b>总计</b>：${cal.totals.cases} 例，已回填 ${cal.totals.graded} 例</div>
        <div style="margin-top:6px;"><b>按占类</b></div>${domHtml}
        <div style="margin-top:8px;"><b>按盘面象义</b>
          <span class="muted">（键为「元素@宫」，如 生门@2＝生门临坤二。这是象的配置统计，不是纲要规则）</span></div>
        <div style="max-height:200px;overflow:auto;margin-top:4px;">${symStatHtml}</div>
        <div style="margin-top:8px;"><b>按规则</b>（符合率低者在前，便于复核；不足 ${cal.minSamples} 例不给百分比）</div>
        <div style="max-height:200px;overflow:auto;margin-top:4px;">${ruleHtml}</div>
        ${tcHtml}
        <div style="margin-top:10px;"><b>校订建议</b>
          <span class="muted">——建议而已，不会自动改规则。规则库是按纲要写的，要改请改 knowledge/domain-rules.json 并补出处。</span>
        </div>${psHtml}
      </div>`;
  }

  async function exportCases() {
    if (!store) return;
    const dump = await store.exportAll(new Date().toISOString());
    const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `qimen-casebook-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function importCases(file) {
    if (!store || !file) return;
    try {
      const data = JSON.parse(await file.text());
      const r = await store.importAll(data);          // 默认合并，不覆盖本机较新的记录
      $('caseCountTag').textContent = `导入完成：新增 ${r.added}、更新 ${r.updated}、跳过 ${r.skipped}`;
      await renderCases(); await rebuildOverlay();
      if (_caseTab === 'stats') await renderStats();
    } catch (e) { $('caseCountTag').textContent = '导入失败：' + e.message; }
  }

  /* ---------- init ---------- */
  function init() {
    const now = new Date();
    // 必须用本地时区格式化：toISOString() 是 UTC，在 UTC+8 的 00:00-07:59 会给出昨天的日期 → 日柱全错
    const p2 = (n) => String(n).padStart(2, '0');
    $('inDate').value = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
    $('inTime').value = now.toTimeString().slice(0, 5);
    // 填充二十四山下拉(坐山/向首)——数据来自纯核心模块，默认坐子(北)
    if (SX && SX.MOUNTAINS) {
      const optsHtml = SX.MOUNTAINS.map(m => `<option value="${m.name}">${m.name}（${m.gua} ${m.center}°）</option>`).join('');
      $('inSitting').innerHTML = optsHtml; $('inSitting').value = '子';
      $('inFacing').innerHTML = '<option value="">（自动取冲）</option>' + optsHtml;
    }
    // 模式切换：时家 / 山向。山向复用转盘引擎，故强制 school=zhuanpan 并隐藏无关控件。
    function applyMode() {
      const sx = mode === 'shanxiang';
      $('shanxiangInputs').style.display = sx ? '' : 'none';
      $('schoolSeg').style.display = sx ? 'none' : '';
      $('inJuShu').closest('label').style.display = sx ? 'none' : '';
      if (sx && school === 'feipan') { // 山向不支持飞盘渲染，回退转盘
        school = 'zhuanpan';
        [...$('schoolSeg').children].forEach(x => x.classList.toggle('on', x.dataset.school === 'zhuanpan'));
      }
    }
    $('modeSeg').addEventListener('click', e => {
      const b = e.target.closest('button[data-mode]'); if (!b) return;
      mode = b.dataset.mode;
      [...$('modeSeg').children].forEach(x => x.classList.toggle('on', x === b));
      applyMode(); cast();
    });
    $('schoolSeg').addEventListener('click', e => {
      const b = e.target.closest('button[data-school]'); if (!b) return;
      school = b.dataset.school;
      [...$('schoolSeg').children].forEach(x => x.classList.toggle('on', x === b));
      cast();
    });
    $('castBtn').addEventListener('click', cast);
    $('inJuShu').addEventListener('change', cast);
    ['inSitting', 'inFacing', 'inSxMethod'].forEach(id => $(id).addEventListener('change', cast));
    $('cfgProvider').addEventListener('change', showProvFields);
    $('cfgSaveBtn').addEventListener('click', saveCfg);
    $('aiBtn').addEventListener('click', runAI);
    // SW 更新后自动刷新一次：消除"首开跑旧代码"的窗口，测到的永远是最新版。
    // 仅在「更新」时刷(首次安装 hadController=false 不刷)；AI 生成中或答案正在阅读时
    // 不打断，只提示，下次打开自然生效
    if ('serviceWorker' in navigator) {
      const hadController = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (!e.data || e.data.type !== 'sw-updated' || !hadController || reloaded) return;
        const busy = $('aiBtn').disabled || $('aiAnswer').style.display === 'block';
        if (busy) { $('aiStatus').textContent = '发现新版本，下次打开自动生效'; return; }
        reloaded = true; location.reload();
      });
    }
    // 案例本
    if (store && CB) {
      $('caseSaveBtn').addEventListener('click', saveCurrentCase);
      $('caseExportBtn').addEventListener('click', exportCases);
      $('caseImportInput').addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) importCases(f);
        e.target.value = '';                       // 允许连续导入同一文件
      });
      $('caseTabSeg').addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-tab]'); if (!b) return;
        _caseTab = b.dataset.tab;
        [...$('caseTabSeg').children].forEach(x => x.classList.toggle('on', x === b));
        $('caseListView').style.display = _caseTab === 'list' ? 'block' : 'none';
        $('caseStatsView').style.display = _caseTab === 'stats' ? 'block' : 'none';
        if (_caseTab === 'stats') await renderStats();
      });
      // 反馈与删除用事件委托：列表是动态重绘的，逐个绑定会在重绘后失效
      $('caseListView').addEventListener('click', async (e) => {
        const open = e.target.closest('button[data-open]');
        if (open) { await openReview(open.dataset.open); return; }
        const del = e.target.closest('button[data-del]');
        if (del && confirm('删除这条案例？删除后它不再计入统计。')) {
          await store.remove(del.dataset.del);
          await refreshCaseCount(); await renderCases(); await rebuildOverlay();
        }
      });
      refreshCaseCount(); renderCases();
    }
    loadCfgForm();
    cast();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
