/* 奇门遁甲 PWA 控制器 + 渲染（client-side） */
(function () {
  const QM = window.QM;
  const SX = window.ShanXiang;
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
      geminiKey: $('cfgGeminiKey').value.trim(), geminiModel: $('cfgGeminiModel').value.trim() || 'gemini-3.5-flash',
      ollamaUrl: $('cfgOllamaUrl').value.trim() || 'http://localhost:11434', ollamaModel: $('cfgOllamaModel').value.trim() || 'qwen3:latest',
      customUrl: $('cfgCustomUrl').value.trim(), customKey: $('cfgCustomKey').value.trim(), customModel: $('cfgCustomModel').value.trim() || 'gpt-3.5-turbo'
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
      let methodText;
      try { methodText = await getMethodText(); }
      catch (me) { throw new Error(me.message + '。为避免 AI 脱离流派纲要自行发挥，已中止本次解读，请检查网络后重试。'); }
      // 占类：先按问句关键词自动识别；识别不出时回退到排盘所选「目的」
      const opts = { nianMingGan: $('aiNianMing').value, methodText, fallbackCategory: $('inPurpose').value };
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
      const userMsg = prompt.user + (school !== 'feipan' ? riShiGanBlock(pan) : '') + wsBlock + sxBlock;
      const answer = await LLM.chat(prompt.system + '\n' + AI_DISCIPLINE, userMsg, (full) => {
        streamed = true; $('aiAnswer').textContent = head + (full || '');
      });
      if (!streamed || !answer) $('aiAnswer').textContent = head + (answer || '(无内容)');
      else $('aiAnswer').textContent = head + answer; // 收尾用清理后的完整文本(去 <think> 等)
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
    loadCfgForm();
    cast();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
