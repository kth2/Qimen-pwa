/* 奇门遁甲 PWA 控制器 + 渲染（client-side） */
(function () {
  const QM = window.QM;
  const SX = window.ShanXiang;
  const YS = window.YongShen;   // 结构化用神层（可缺失：缺则退回原有流程）
  const XY = window.XiangYi;    // 占类象义推理层（Phase 2；缺则证据包不含 READING，其余照旧）
  const TM = window.Timing;     // 应期时间线层（Phase 4；缺则不含 TIMING，yingqi 块照常承载应期）
  const LX = window.LeiXiang;   // 类象取用层（Phase 8；转盘专有，缺则不含类象用神）
  const SV = window.Severity;   // 力量校验层（Phase 9；缺则不含禁令，力量仍由 wangshuai 块承载）
  const CV = window.Converge;   // 证据合流层（Phase 13；缺则不含档位与弃权）
  const YJ = window.YinJu;      // 伏吟／反吟层（Phase 14；缺则不含吟局判定）
  const GJ = window.GeJu;       // 八十一格层（Phase 15；缺则格名仍只是宫格行里的裸标签）
  const SG = window.ShiGe;      // 时格层（Phase 16：五不遇时／天显时格；缺则不判时格）
  const QS = window.QuShu;      // 取数层（Phase 21：河图数＋先天/后天宫数；缺则取数仍只有河图数一路）
  const FR = window.Framing;    // 问句方向（Phase 38：检出「怕发生之事」；缺则不提示，判读照旧）
  const WX = window.WuXing;     // 五行推理（Phase 40/41：是非方向另一路断语；两派都用、取用分派，缺则不提示）
  const MD = window.MdLite;     // 极简 Markdown 渲染（Phase 25；缺则答案退回纯文本，功能不受影响）
  const CB = window.Casebook;   // 案例本·经验层（Phase 5；只统计与建议，绝不改写教义规则）
  const CSTORE = window.CaseStore;
  const RV = window.Revise;     // 复盘正解与规则修订（Phase 6）
  const EV = window.Evidence;   // 结构化证据层（同上）
  const RD = window.QimenReading;   // AI 解读的共用编排（Phase 45；与奇门穿壬共用）
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

  /* ---------- 四害在九宫格里的标记（Phase 22） ----------
   * 门迫、击刑、入墓此前**在盘面上一个字都没有**：它们只出现在下方「九宫详解」的
   * 文字里与喂给模型的证据包里，看盘的人从格子里看不出来。而纲要把这四样并称四害、
   * 明令「断成败必须称量」——盘上不显，等于每次都要低头去别处对。
   *
   * 配色不动五行：格子里的门/星/干本来就按五行着色（木绿火红土褐金橙水蓝），
   * 再拿颜色改字就把五行读乱了。故一律另加**角标 + 该字的描边**，五行色照旧。
   *   迫（门迫）暗红 · 刑（击刑）橙红 · 墓（入墓）深紫 · 空（空亡）沿用原黄圈 · 马沿用原绿圈
   * 入墓与击刑是**某个干**的事，故标在那个干上（天盘干、地盘干各标各的），
   * 不是整宫一个牌子——从前证据包里也吃过这个亏：门/星的墓刑其实是「所落之宫内有干墓刑」。
   */
  const HARM_TXT = { mu: '墓', xing: '刑', po: '迫' };
  const HARM_TIP = {
    mu: '入墓：仅余两成力，事多滞塞，须待冲墓方发',
    xing: '击刑：六仪落其刑宫，力减半，主别扭拧劲、彼此掣肘',
    po: '门迫：门克宫，吉门受迫吉不成、凶门受迫凶更烈，力减半'
  };
  const HARM_ORDER = ['mu', 'xing', 'po'];   // 墓最重（仅余两成）故居首，角标配色亦取首项
  /**
   * 一个字上的诸害合成**一个**角标（如既入墓又击刑写作「墓刑」）。
   * 初版每害各出一个角标，两个角标 30px 加上字身 18px，把 36px 宽的右列整个撑破了——
   * 实机截图上「壬墓刑」直接溢出格子。合成一个既装得下，也更贴合纲要「多害减力相乘」
   * 的说法：那本就是一件事的两个由头，不是两件事。
   */
  function harmBadge(kinds) {
    if (!kinds.length) return '';
    const ks = HARM_ORDER.filter(k => kinds.indexOf(k) >= 0);
    return `<sup class="harm-mark harm-${ks[0]}" title="${ks.map(k => HARM_TIP[k]).join('；')}">` +
      ks.map(k => HARM_TXT[k]).join('') + '</sup>';
  }
  /** 把一个字连同它的诸害包成一个可描边的行内块。无害则原样输出，不多套一层标签。 */
  function glyph(text, kinds) {
    if (!text || !kinds.length) return esc(text);
    const ks = HARM_ORDER.filter(k => kinds.indexOf(k) >= 0);
    return `<span class="hg ${ks.map(k => 'harm-box-' + k).join(' ')}">${esc(text)}${harmBadge(ks)}</span>`;
  }
  /** 某个干落某宫是否入墓/击刑。WangShuai 缺席时一律返回空——宁可不标，不可乱标。 */
  function ganHarms(gan, g) {
    const W = window.WangShuai;
    if (!W || !gan) return [];
    const out = [];
    if (W.isRuMu(gan, String(g))) out.push('mu');
    if (W.isJiXing(gan, String(g))) out.push('xing');
    return out;
  }
  /** 门迫取引擎的 jiuGongAnalysis.menPo（wangshuai 亦读同一处，两边同源不另算）。 */
  function menPoAt(pan, g) { return !!(((pan.jiuGongAnalysis || {})[g] || {}).menPo); }

  // 图例每一害并列**角标与色环**两样：窄屏飞盘腾不出角标的空间，只留描边，
  // 那时就得靠颜色认——图例里没有色环，颜色便无从对照。
  const HARM_LEGEND = '<div class="harm-legend">' +
    '<span class="lg"><span class="lg-ring harm-box-po"></span><sup class="harm-mark harm-po lg-mark">迫</sup>门迫</span>' +
    '<span class="lg"><span class="lg-ring harm-box-xing"></span><sup class="harm-mark harm-xing lg-mark">刑</sup>击刑</span>' +
    '<span class="lg"><span class="lg-ring harm-box-mu"></span><sup class="harm-mark harm-mu lg-mark">墓</sup>入墓</span>' +
    '<span class="lg"><span class="circle-mark yellow-circle">空</span>空亡</span>' +
    '<span class="lg"><span class="circle-mark green-circle">马</span>驿马</span>' +
    '<span class="lg muted">四害减力：门迫/击刑各减半，空亡吉凶皆减半且须待填实冲实，入墓仅余两成</span>' +
    '</div>';

  /* ---------- 转盘宫格 ---------- */
  function cellZhuanpan(pan, g) {
    const JG = QM.JIU_GONG[g] || {};
    const ja = (pan.jiuGongAnalysis || {})[g] || {};
    const kong = (pan.kongWangGong || []).includes(g);
    const ma = pan.maStar && pan.maStar.gong === g;
    const xing = (pan.jiuXing || {})[g] || '', men = (pan.baMen || {})[g] || '', shen = (pan.baShen || {})[g] || '';
    const tg = (pan.tianPan || {})[g] || '', dg = (pan.diPan || {})[g] || '', dz = (pan.anGan || {})[g] || '';
    const po = menPoAt(pan, g) ? ['po'] : [], ht = ganHarms(tg, g), hd = ganHarms(dg, g);
    const cls = ['gong', 'gong' + g, ja.jiXiong || 'ping', pan.zhiFuGong === g ? 'zhifu' : '',
      pan.zhiShiGong === g ? 'zhishi' : '', kong ? 'gong-kong' : ''].join(' ');
    return `<div class="${cls}"><div class="gong-content">
      <div class="gong-dizhi di-zhi">${esc(dz)}</div>
      <div class="gong-bashen ${shenColor(shen)}">${esc(shen)}</div>
      <div class="gong-tianganfang">${ma ? '<span class="circle-mark green-circle">马</span>' : ''}${kong ? '<span class="circle-mark yellow-circle">空</span>' : ''}</div>
      <div class="gong-bamen ${menColor(men)}">${glyph(men, po)}</div>
      <div class="gong-jiuxing ${xingColor(xing)}">${esc(xing)}</div>
      <div class="gong-tiangan ${ganColor(tg)}">${glyph(tg, ht)}</div>
      <div class="gong-gongname ${gongColor(JG.name)}">${esc(JG.name)}</div>
      <div class="gong-number">${NUM_CN[+g]}</div>
      <div class="gong-dipan ${ganColor(dg)}">${glyph(dg, hd)}</div>
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
    // 四害两派通用：飞盘纲要「四害（门迫/击刑/空亡/入墓）」一节与转盘同一口径，
    // 故这里照标。零串味说的是取用与断法，不是这四条盘面事实。
    //
    // 飞盘一格里天/人/地三行贴得极紧（12px 字、行距 1.3，行间只余 1px），角标浮在字头上
    // 就会压住上一行——实测截图里「心」被「墓刑」盖掉大半、「英」被「墓」盖住。
    // 故凡带角标的那一行另加一个 fp-row-harm，由 CSS 给它腾出上方空间。
    // 只给带角标的行加，无害之盘的排版一点不动。
    const po = menPoAt(pan, g) ? ['po'] : [], ht = ganHarms(tYi, g), hd = ganHarms(dYi, g);
    const cls = ['gong', 'gong' + g, pan.zhiFuLuoGong === g ? 'zhifu' : '',
      pan.zhiShiGong === g ? 'zhishi' : '', kong ? 'gong-kong' : ''].join(' ');
    return `<div class="${cls}"><div class="feipan-gong-content kuonang">
      ${(kong || ma) ? `<div class="fp-marks">${ma ? '<span class="circle-mark green-circle">马</span>' : ''}${kong ? '<span class="circle-mark yellow-circle">空</span>' : ''}</div>` : ''}
      <div class="fp-xing ${xingColor(pan.tianPanXing && pan.tianPanXing[g])}">${esc(star)}</div>
      <div class="fp-row fp-tian${ht.length ? ' fp-row-harm' : ''}"><span class="fp-shen">${esc(tShen)}</span><span class="fp-gan ${ganColor(tYi)}">${glyph(tYi, ht)}</span><span class="fp-an">${esc(tAn)}</span></div>
      <div class="fp-row fp-ren${po.length ? ' fp-row-harm' : ''}"><span class="fp-men fp-ming">${glyph(mMen, po)}</span><span class="fp-men fp-an-men">${esc(aMen)}</span><span class="fp-an">${esc(rAn)}</span></div>
      <div class="fp-row fp-di${hd.length ? ' fp-row-harm' : ''}"><span class="fp-shen">${esc(dShen)}</span><span class="fp-gan ${ganColor(dYi)}">${glyph(dYi, hd)}</span><span class="fp-an">${esc(dAn)}</span></div>
      <div class="fp-gongname">${esc(JG.name)}${NUM_CN[+g]}</div>
    </div></div>`;
  }

  function renderChart(pan) {
    const cellFn = school === 'feipan' ? cellFeipan : cellZhuanpan;
    const cls = school === 'feipan' ? 'pan-grid feipan-grid' : 'pan-grid';
    $('chart').innerHTML = `<div class="qimen-pan"><div class="pan-outer"><div class="${cls}">${GRID_ORDER.map(g => cellFn(pan, g)).join('')}</div></div></div>` + HARM_LEGEND;
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

  /**
   * 引擎本盘分析不认的占类（股市、行人、终身局、异梦……），「分析与建议」原先只写「无专一用神」，
   * 而 AI 解读其实拿得到用神（股市按求财取生门、行人取开门、终身局取年命……）。
   * 这里照 AI 解读同一路取：引擎 buildPrompt 的用神 → YongShen.resolve → pickMain（第一个落在盘上的）。
   * 只补显示，不改引擎分析；山向盘、知识库未载、出错都返回 null，照旧显示「无专一用神」。
   */
  function mainYongFor(pan, ui) {
    if (mode === 'shanxiang' || !YS || !YS.isLoaded || !YS.isLoaded() || !YS.pickMain) return null;
    try {
      const sch = school === 'feipan' ? 'feipan' : 'zhuanpan';
      const ec = YS.toEngineCategory(ui, sch);
      const cm = YS.categoryMap(ui, sch);
      const nm = effectiveNianMing(cm && cm.ruleDomain, pan);
      const builder = sch === 'feipan' ? QM.feipanPredict : QM.zhuanpanPredict;
      const ctx = (builder.buildPrompt(pan, '', { category: ec, fallbackCategory: ec, nianMingGan: nm }) || {}).context || {};
      return YS.pickMain(YS.resolve({ domain: ui, chart: pan, options: { engineYong: ctx.yong, school: sch, nianMingGan: nm } }));
    } catch (e) { console.warn('[analysis] 取主用神失败：', e.message); return null; }
  }

  function renderAnalysis(pan) {
    const a = pan.analysis || {}, ja = pan.jiuGongAnalysis || {};
    const purpose = (pan.basicInfo && pan.basicInfo.purpose) || '综合';
    let html = '';
    if (school === 'feipan') html += `<p class="muted">飞盘解断复用通用奇门基线(五行生克/十干克应/门迫/空亡/格局/用神)，飞盘专法(遁干81格/三乙四宫)以 AI 占断为准。</p>`;
    // 分析与建议
    html += `<div class="panel"><h3>分析与建议 · 目的：${esc(purpose)}</h3>`;
    const mainYs = a.yongShen ? null : mainYongFor(pan, purpose);
    if (a.yongShen) html += `<p>用神（${esc(purpose)}）：<b>${esc(a.yongShen.name)}</b> 落 <b>${esc(a.yongShen.direction)}方(${esc(a.yongShen.gongName)}宫，${esc(a.yongShen.jiXiongText)})</b> <span class="muted">${esc(a.yongShen.tip)}</span></p>`;
    else if (mainYs) html += `<p>用神（${esc(purpose)}）：<b>${esc(mainYs.name)}</b> 落 <b>${esc(mainYs.direction)}方(${esc(mainYs.gongName)}宫)</b> `
      + `<span class="muted">${mainYs.source === 'engine' ? '按引擎占类「' + esc(mainYs.category) + '」取' : '按占类表取（引擎无此占类）'}，与 AI 解读所用同一取用；引擎本盘分析未给此占类的吉凶提示</span></p>`;
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
  // 排盘所用的「目的」。原先另有一个排盘栏的「目的」下拉，自 Phase 17 起它对解读
  // 已不起作用（真正决定取用与判读的是 AI 面板的「占类」，走 opts.category 那一路），
  // 留着只会让人以为改它有用。Phase 22 撤掉那个下拉，此处改为向占类下拉要值——
  // 一件事只留一个开关。占类留「自动判定」时按综合排，与从前默认值一致。
  function purposeNow() {
    return ($('aiDomain') && $('aiDomain').value) || '综合';
  }
  function castShanXiang() {
    const purpose = purposeNow();
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
      const date = getDate(), purpose = purposeNow(), juShu = getJuShuOverride();
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

  /**
   * 占类改了 → 只把「分析与建议」按新目的重画。
   *
   * 星门神仪与四害都跟目的无关，变的只是**哪个算用神**，故不必也不该整盘重排：
   * 重排会把 window._pan 换掉，连带作废「存为案例」的素材（那份素材是上一次
   * 解读的，与目的无关，不该因为改了个下拉就丢）。这里另排一张同时刻的盘只取
   * 它的分析结果来渲染，_pan 一动不动。
   */
  function refreshAnalysisForPurpose() {
    if (!window._pan) return;
    try {
      const p = mode === 'shanxiang' ? castShanXiang() : (() => {
        const date = getDate(), purpose = purposeNow(), juShu = getJuShuOverride();
        const opts = school === 'feipan'
          ? { method: '时家', purpose }
          : { type: '四柱', method: '时家', purpose, location: '默认位置' };
        if (juShu) opts.juShu = juShu;
        return school === 'feipan' ? QM.feipanQimen.calculate(date, opts) : QM.qimen.calculate(date, opts);
      })();
      if (!p || p.error) return;              // 排不出就维持原样，不拿错误盖掉已有的分析
      renderAnalysis(p);
    } catch (e) { console.warn('[analysis] 按新占类重画失败，维持原分析：', e.message); }
  }

  /* ---------- AI 设置 ---------- */
  function loadCfgForm() {
    const c = LLM.getCfg();
    $('cfgProvider').value = c.provider || 'gemini';
    $('cfgGeminiKey').value = c.geminiKey || ''; $('cfgGeminiModel').value = c.geminiModel || '';
    $('cfgOllamaUrl').value = c.ollamaUrl || ''; $('cfgOllamaModel').value = c.ollamaModel || '';
    $('cfgCustomUrl').value = c.customUrl || ''; $('cfgCustomKey').value = c.customKey || ''; $('cfgCustomModel').value = c.customModel || '';
    $('cfgGeminiFallbackModel').value = c.geminiFallbackModel || '';
    $('cfgGeminiThinkingBudget').value = (c.geminiThinkingBudget === 0 || c.geminiThinkingBudget) ? c.geminiThinkingBudget : '';
    $('cfgCustomFallbackModel').value = c.customFallbackModel || '';
    // 超时与重试：留空即用 LLM.DEF 的默认值，故此处不回填默认数字（placeholder 已示意）
    const sec = (ms) => (ms ? String(Math.round(ms / 1000)) : '');
    $('cfgIdleTimeout').value = sec(c.idleTimeoutMs);
    $('cfgTotalTimeout').value = sec(c.totalTimeoutMs);
    $('cfgMaxRetries').value = (c.maxRetries === 0 || c.maxRetries) ? String(c.maxRetries) : '';
    $('cfgMaxTokens').value = c.maxTokens ? String(c.maxTokens) : '';
    $('cfgFallbackProvider').value = c.fallbackProvider || 'none';
    showProvFields(); updateProviderTag(); restoreModelPicks();
  }
  function showProvFields() {
    const p = $('cfgProvider').value;
    document.querySelectorAll('.prov').forEach(el => el.style.display = el.classList.contains('prov-' + p) ? '' : 'none');
  }
  /** 表单上当下的配置（尚未保存也算）——「列出可用模型」要用刚填进去的 key，不该逼人先按保存。 */
  function formCfg() {
    return {
      provider: $('cfgProvider').value,
      geminiKey: $('cfgGeminiKey').value.trim(), geminiModel: $('cfgGeminiModel').value.trim() || 'gemini-3.5-flash',
      ollamaUrl: $('cfgOllamaUrl').value.trim() || 'http://localhost:11434', ollamaModel: $('cfgOllamaModel').value.trim() || 'qwen3:latest',
      customUrl: $('cfgCustomUrl').value.trim(), customKey: $('cfgCustomKey').value.trim(), customModel: $('cfgCustomModel').value.trim() || 'gpt-3.5-turbo',
      geminiFallbackModel: $('cfgGeminiFallbackModel').value.trim(),
      // 空串＝不指定，交模型自定；0 是有效值（关闭思考），故不能用真值判断
      geminiThinkingBudget: $('cfgGeminiThinkingBudget').value.trim() === ''
        ? '' : Number($('cfgGeminiThinkingBudget').value),
      customFallbackModel: $('cfgCustomFallbackModel').value.trim(),
      fallbackProvider: $('cfgFallbackProvider').value,
      // 秒 → 毫秒；留空存 0，LLM 侧 numOr() 会回落默认值
      idleTimeoutMs: (Number($('cfgIdleTimeout').value) || 0) * 1000,
      totalTimeoutMs: (Number($('cfgTotalTimeout').value) || 0) * 1000,
      maxRetries: $('cfgMaxRetries').value === '' ? '' : Number($('cfgMaxRetries').value),
      maxTokens: Number($('cfgMaxTokens').value) || 0
    };
  }
  function saveCfg() {
    LLM.saveCfg(formCfg());
    $('cfgSavedTag').textContent = '已保存 ✓'; setTimeout(() => $('cfgSavedTag').textContent = '', 2000); updateProviderTag();
  }
  /* ---------- 可用模型下拉（Phase 37） ----------
   * 模型名此前全靠手写。按「📋 列出可用模型」向 provider 要当下可用的模型，
   * 填进每个模型框下方的下拉；选中即写入该框并保存。手写照旧可用（端点不给列表时就靠它）。
   * 取到的列表存本机，下次打开设置直接有下拉；自定义/Ollama 换了地址则不沿用旧列表。 */
  const MODEL_FIELDS = {
    gemini: ['cfgGeminiModel', 'cfgGeminiFallbackModel'],
    custom: ['cfgCustomModel', 'cfgCustomFallbackModel'],
    local: ['cfgOllamaModel']
  };
  const MODELS_LS = 'qm_llm_models';
  function readModelCache() { try { return JSON.parse(localStorage.getItem(MODELS_LS)) || {}; } catch (e) { return {}; } }
  function writeModelCache(p, entry) {
    try { const c = readModelCache(); c[p] = entry; localStorage.setItem(MODELS_LS, JSON.stringify(c)); } catch (e) { /* 存不下也不影响这次选用 */ }
  }
  function modelSrc(p, c) { return p === 'custom' ? (c.customUrl || '') : p === 'local' ? (c.ollamaUrl || '') : ''; }
  /** 列表填进该 provider 各模型框下方的下拉；返回「框里填的却不在列表里」的名字，供提示拼错。 */
  function fillModelPicks(p, list) {
    const stray = [];
    (MODEL_FIELDS[p] || []).forEach(id => {
      const inp = $(id);
      if (!inp) return;
      const fallback = /Fallback/.test(id);
      let sel = $(id + 'Pick');
      if (!sel) {
        sel = document.createElement('select');
        sel.id = id + 'Pick';
        sel.style.cssText = 'display:block;margin-left:92px;font-size:12px;';
        inp.insertAdjacentElement('afterend', sel);
        sel.addEventListener('change', () => {
          if (!sel.value) return;
          inp.value = sel.value === '__none__' ? '' : sel.value;
          saveCfg();
          const tag = document.querySelector(`[data-modelstag="${p}"]`);
          if (tag) tag.textContent = inp.value ? `已选用 ${inp.value} 并保存` : '已关闭备用模型并保存';
        });
      }
      const cur = inp.value.trim();
      if (cur && !list.some(m => m.id === cur)) stray.push(cur);
      // 模型名来自外部端点：用 new Option 逐个建，不拼 HTML（esc 不转引号，放进属性里不安全）
      sel.textContent = '';
      sel.add(new Option(`— 从列表选${fallback ? '备用' : ''}模型（${list.length} 个）—`, ''));
      if (fallback) sel.add(new Option('（不启用备用）', '__none__'));
      list.forEach(m => sel.add(new Option(m.id + (m.label && m.label !== m.id ? '　' + m.label : ''), m.id, false, m.id === cur)));
    });
    return stray;
  }
  async function listModelsFor(p, btn) {
    const tag = document.querySelector(`[data-modelstag="${p}"]`);
    const say = (t) => { if (tag) tag.textContent = t; };
    btn.disabled = true; say('取模型列表中…');
    try {
      const list = await LLM.listModels(p, formCfg());
      if (!list.length) { say('服务端没列出任何可用模型——仍可手填模型名'); return; }
      writeModelCache(p, { at: new Date().toISOString(), src: modelSrc(p, formCfg()), list });
      const stray = fillModelPicks(p, list);
      say(`取到 ${list.length} 个，在模型框下方的下拉里选`
        + (stray.length ? `。⚠ 你填的「${stray.join('」「')}」不在列表里，可能拼错或已下线` : ''));
    } catch (e) {
      const m = e.message || String(e);
      say('取不到：' + m + (/Failed to fetch|NetworkError/i.test(m)
        ? '（网络不通，或该端点不许浏览器直接取列表——仍可手填模型名）' : ''));
    } finally { btn.disabled = false; }
  }
  /** 打开设置时：本机存过列表、且地址没换，就直接铺好下拉。 */
  function restoreModelPicks() {
    const cache = readModelCache(), c = formCfg();
    Object.keys(MODEL_FIELDS).forEach(p => {
      const e = cache[p];
      if (e && Array.isArray(e.list) && e.list.length && e.src === modelSrc(p, c)) fillModelPicks(p, e.list);
    });
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

  /* ---------- 结构化知识库、纪律、落宫段、收尾锚 ----------
   * 已搬到 core/reading.js（QimenReading），与奇门穿壬共用。这里只留同名的引用，其余代码不用改。 */
  const loadKnowledge = () => RD.loadKnowledge();
  const AI_DISCIPLINE = RD.AI_DISCIPLINE, riShiGanBlock = RD.riShiGanBlock, tailAnchor = RD.tailAnchor;

  /* ---------- AI 答案的显示：渲染 Markdown（Phase 25） ----------
   * 模型的解读本来就是 Markdown——骨架里就要求「### ① 结论」「- 逐条」，遇到逐宫对照、
   * 应期候选这类内容它还会写表格。而答案框一直是 textContent + pre-wrap，表格于是
   * 原样显示成一堆竖线。
   *
   * 不反过来禁止模型用表格：逐宫对照这类内容，表格本就是更该用的形式。
   *
   * 两条分寸：
   *   ① **流式期间照旧用纯文本**。边生成边渲染既费性能，也会把写到一半的表格
   *      （表头有了、对齐行还没写）渲染成奇形怪状，一行一跳。收尾再渲染一次即可。
   *   ② **原文随时可看**。渲染器是本仓自己写的小东西，万一它把某段弄拧了，
   *      得让人一眼能对回原文；何况复制原文去别处用也是常事。
   * 存进案例本的始终是**原文**，渲染只是显示层的事。 */
  let _answerRaw = '', _answerShowRaw = false;
  function paintAnswer() {
    const box = $('aiAnswer'), bar = $('aiAnswerBar');
    if (!box) return;
    const canRender = !!(MD && MD.render) && MD.looksMarkdown(_answerRaw);
    if (bar) {
      bar.style.display = canRender ? 'block' : 'none';
      if ($('aiRawToggle')) $('aiRawToggle').textContent = _answerShowRaw ? '显示表格' : '查看原文';
      if ($('aiRawHint')) $('aiRawHint').textContent = _answerShowRaw
        ? '　原文即模型所写的 Markdown，存进案例本的也是这一份'
        : '　表格与分节已渲染；点左键可看模型写的原文';
    }
    if (canRender && !_answerShowRaw) {
      box.classList.add('md-on');
      // 只放本模块自产的标签：MdLite 先转义再生成，不放行任何外来标签
      box.innerHTML = MD.render(_answerRaw);
    } else {
      box.classList.remove('md-on');
      box.textContent = _answerRaw;
    }
  }
  /** 流式途中：不渲染，纯文本直出，避免把写到一半的表格画成怪样 */
  function streamAnswer(text) {
    _answerRaw = text;
    const box = $('aiAnswer');
    if (!box) return;
    box.classList.remove('md-on');
    box.textContent = text;
  }

  /**
   * 解读框顶端的【占类·模型】一行。模型按**实际作答**那一路写（u 取 LLM.current() 或 LLM.lastUsed()），
   * 备用接管时注明主选是谁——否则「Gemini 过载、自定义端点接的班」看上去就像 Gemini 答的。
   * u 缺席（尚未开始作答）时退回配置值。
   */
  function answerHead(category, u, info) {
    const cat = category || '综合';
    if (!u) return `【占类：${cat}　模型：${info.provider}/${info.model}】\n\n`;
    const fb = u.fellBack ? `（备用接管；主选 ${info.provider}/${info.model} 未能作答）` : '';
    return `【占类：${cat}　模型：${u.provider}/${u.model}${fb}】\n\n`;
  }

  /** 本次解读所用的年命（Phase 42）。用户选了就用他选的；**终身局**按出生年月日时起盘，
   *  命主之年命即本盘年柱——没选时自动取（甲年连年支，才定得了所遁之仪）。别的占类没选就是没有，
   *  绝不拿占时的年柱去顶：那是起盘这一年，不是求测人出生那一年。 */
  function effectiveNianMing(ruleDomain, pan) {
    const v = ($('aiNianMing') && $('aiNianMing').value) || '';
    if (v || ruleDomain !== 'lifetime') return v;
    const y = String((pan && pan.siZhu && pan.siZhu.year) || '');
    return y.charAt(0) === '甲' ? y.slice(0, 2) : y.charAt(0);
  }

  async function runAI() {
    const pan = window._pan; if (!pan) { $('aiStatus').textContent = '请先排盘'; return; }
    const q = $('aiQuestion').value.trim(); if (!q) { $('aiStatus').textContent = '请填写占问'; return; }
    const btn = $('aiBtn'); btn.disabled = true; $('aiAnswer').style.display = 'none';
    if ($('aiAnswerBar')) $('aiAnswerBar').style.display = 'none';
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
      // 占类以 AI 面板的显式选择为先，其次才是排盘「目的」。
      // 二者都留默认时，引擎按问句关键词自动判定——那正是实测里出错最多的一环：
      // 「钱包丢了能不能找到」被判成求财、「另找合作方」被判成失物，整篇解读遂建在错的用神上。
      const rc = resolveCategory();
      const fallbackCategory = rc.category || '综合';
      const opts = { nianMingGan: $('aiNianMing').value, methodText, fallbackCategory };
      // 显式选择必须走 opts.category：buildPrompt 不认 fallbackCategory，
      // 只把它当 classifyQuestion 的备胎——只传 fallbackCategory 等于没选。
      if (rc.explicit) opts.category = rc.category;
      // 三层解析随证据包一起交给模型：引擎认不认、规则有没有专条，都不该只有界面知道
      // 必须传**界面选项**而非已转换的引擎占类：「股市」与「财运」都映到引擎「求财」，
      // 传引擎占类进去就又绕回 wealth，股市专条依旧跑不到——正是这一步我先前写错过。
      const catMap = (YS && YS.categoryMap)
        ? YS.categoryMap(rc.uiPick || rc.category || fallbackCategory, school === 'feipan' ? 'feipan' : 'zhuanpan') : null;
      const nianMing = effectiveNianMing(rc.explicit && catMap ? catMap.ruleDomain : '', pan);
      opts.nianMingGan = nianMing;
      const builder = school === 'feipan' ? QM.feipanPredict : QM.zhuanpanPredict;
      const prompt = builder.buildPrompt(pan, q, opts);
      // 标题按**实际作答**那一路写：流式途中取 current()，答完取 lastUsed()。
      // 此前一律写配置值，备用接管后仍挂着主选的名（统计本就取 lastUsed，未受影响，但看的人会被误导）。
      const catName = prompt.context.category || '综合';
      const headNow = () => answerHead(catName, (LLM.current && LLM.current()) || null, LLM.info());
      let head = headNow();
      // 流式：边生成边显示，既提升观感也避免长响应在网关侧 504
      $('aiStatus').textContent = 'AI 解读中…(边生成边显示)';
      $('aiAnswer').style.display = 'block';
      _answerShowRaw = false; streamAnswer(head);
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
      // 各层分析的编排与证据包已搬到 core/reading.js（与奇门穿壬共用）；这里只传入本轮的量、取回结果。
      window._evidence = window._xiangyi = window._timing = window._leixiang = window._severity = null;   // 先清干净，宁可为空也不串盘
      const rd = await RD.evidenceFor({
        pan, q, school, prompt, rc, catMap, nianMing, fallbackCategory, ysGongs, wsBlock, yqBlock,
        revisions: _revIndex, getOverlay: store ? () => store.getOverlay() : null
      });
      const evBlock = rd.evBlock, sysExtra = rd.sysExtra, runOut = rd.runOut;
      if (runOut.evidence) {
        window._wuxing = runOut.wuxing;              // 核对五行推理断了什么
        window._evidence = runOut.evidence;          // 便于在控制台核对喂给模型的内容
        window._xiangyi = runOut.xiangyi;            // 同上：逐条核对判读命中了哪些规则
        window._timing = runOut.timing;              // 同上：核对应期锚点与其机制
        window._leixiang = runOut.leixiang;          // 同上：核对所问之物取了哪个象作用神
        window._severity = runOut.severity;          // 同上：核对触发了哪几条力量禁令
        window._converge = runOut.converge;          // 同上：核对各维度有几路独立证据
        window._yinju = runOut.yinju;                // 同上：核对本盘成了什么吟局
        window._geju = runOut.geju;                  // 同上：核对逐宫查到了哪个格
        window._shige = runOut.shige;                // 同上：核对本时辰是否五不遇／天显
        window._qushu = runOut.qushu;                // 同上：核对本盘取数可达哪些数、共几个
      }
      // 证据包可用时由它承载旺衰/应期；不可用则退回原有的两段拼接。山向段始终保留。
      const analysisBlocks = evBlock || (wsBlock + yqBlock);
      const userMsg = prompt.user + (school !== 'feipan' ? riShiGanBlock(pan, nianMing) : '')
        + analysisBlocks + sxBlock + tailAnchor(q, rc, catMap);
      const answer = await LLM.chat(prompt.system + '\n' + AI_DISCIPLINE + sysExtra, userMsg, (full) => {
        streamed = true; streamAnswer(headNow() + (full || ''));
      // onStatus：把重试与备用切换过程显示出来。干等两分钟再报错，是最劝退的体验
      }, (msg) => { $('aiStatus').textContent = msg; });
      // 收尾用清理后的完整文本（去 <think> 等），并在此**一次性**渲染 Markdown
      head = answerHead(catName, (LLM.lastUsed && LLM.lastUsed()) || null, LLM.info());
      _answerRaw = head + ((!streamed || !answer) ? (answer || '(无内容)') : answer);
      paintAnswer();
      $('aiStatus').textContent = '完成';
      // 备好「存为案例」的素材。答案截断到 8000 字：全文可能极长，手机存储不该被单条撑爆
      if (store && CB) {
        // 一律取本轮的 runOut，不读全局量——见上文「不能靠 window._xiangyi」的说明
        _lastReading = {
          question: q, domain: runOut.domain,
          school, mode, chart: pan, dateISO: $('inDate').value + ' ' + $('inTime').value,
          yongshen: runOut.yongshen, xiangyi: runOut.xiangyi,
          timing: runOut.timing, evidence: runOut.evidence,
          converge: runOut.converge,          // 存下档位，日后才算得出「A 级准不准」
          // 同理：这四层不存进案例，「伏吟局的盘是不是更容易久拖」之类就永远无从考核。
          // 之前漏了它们——层做好了、也确实喂给了 AI，却没有一条案例带得上这些标记。
          yinju: runOut.yinju, geju: runOut.geju, shige: runOut.shige, severity: runOut.severity,
          // 取数层同理：不存，「宫数入候选之后数字题是不是更准」就永远考核不了——
          // 而这正是本层唯一还欠着的那个问题。
          qushu: runOut.qushu,
          wuxing: runOut.wuxing,             // Phase 40：存下五行断语，日后才算得出它在 app 里准不准
          answer: String(answer || '').slice(0, 8000),
          // 哪个模型答的。取 LLM.lastUsed() 而非 LLM.info()——备用链接管时后者仍报主选那一路，
          // 拿它记账会把「Gemini 过载、自定义端点接的班」记成 Gemini。
          // 要比较两家的应验率，记错等于白记。fellBack 一并留下，日后能把接管的那些单拎出来看。
          meta: (function () {
            const u = (LLM.lastUsed && LLM.lastUsed()) || null;
            const i = LLM.info();
            return u
              ? { provider: u.provider, model: u.model, label: u.label,
                  fellBack: !!u.fellBack, configured: u.configured, retries: u.retries }
              : { provider: i.provider, model: i.model, label: i.provider + '/' + i.model,
                  fellBack: false, configured: i.provider, _note: 'lastUsed 缺席，退回配置值' };
          })()
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
  let _revIndex = null;         // 本机修订集（索引后），参与规则求值

  /* 修订集以一条特殊记录存放（id 固定、createdAt 置 '0000' 使其排在列表末尾），
     这样它随导出一并带走，换机不丢。修订独立于纲要层，只做收窄/降权/停用。 */
  const REV_ID = '__revisions__';
  async function getRevisionList() {
    if (!store) return [];
    try { const rec = await store.get(REV_ID); return (rec && rec.list) || []; }
    catch (e) { return []; }
  }
  async function loadRevisions() {
    if (!store || !RV) return null;
    try { _revIndex = RV.indexRevisions(await getRevisionList()); }
    catch (e) { console.warn('[revise] 载入修订集失败：', e.message); _revIndex = null; }
    return _revIndex;
  }
  async function saveRevisions(list) {
    if (!store) return;
    await store.save({ id: REV_ID, schema: 'revisions', list: list, createdAt: '0000', question: '（本机规则修订集）' });
    await loadRevisions();
  }

  async function refreshCaseCount() {
    if (!store) return;
    try {
      const rows = (await store.list()).filter(r => r.id !== REV_ID);
      const graded = rows.filter(r => CB && CB.graded(r)).length;
      $('caseCountTag').textContent = `共 ${rows.length} 例：待回填 ${rows.length - graded} · 已归档 ${graded}`
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
      await refreshCaseCount(); await renderCaseViews();
    } catch (e) {
      $('caseSaveTag').textContent = '保存失败：' + e.message;
    } finally { btn.disabled = false; }
  }

  const rec_hasAnswer = (r) => !!(r && r.answer && r.answer.length);

  const OUTCOME_BTNS = [
    ['happened', '完全应验'], ['partial', '部分应验'],
    ['not_happened', '未应验'], ['opposite', '结果相反']
  ];

  /* ---------- 案例两分：待回填 / 已归档 ----------
   * 案例本只增不减，若一列到底，「还没回填的有哪几条」很快就淹没在几百条已结案里，
   * 页面也随之无限拉长。故按「是否已回填结果」分两页：待回填是待办清单（天然短），
   * 已归档是资料库（可筛可搜、分页加载）。两页共用同一条渲染，避免两套样式各自漂移。 */
  const PAGE_SIZE = 20;
  let _archFilter = 'all';                 // all | happened | partial | not_happened | opposite
  let _archQuery = '';
  let _pendShown = PAGE_SIZE;
  let _archShown = PAGE_SIZE;

  const OUTCOME_COLOR = { happened: '#3c763d', opposite: '#a94442' };
  const outcomeColor = (o) => OUTCOME_COLOR[o] || '#8a6d3b';

  function caseRowHtml(r) {
    const fb = r.feedback;
    const tag = fb
      ? `<b style="color:${outcomeColor(fb.outcome)}">${esc(fb.label)}</b>`
      : '<span class="muted">待回填</span>';
    const hit = r.timingHits && r.timingHits.hits.length
      ? `　<span style="color:#3c763d">应期命中 ${r.timingHits.hits.length} 条</span>` : '';
    const actual = fb && fb.actual ? `<div class="muted" style="margin-top:2px;">实况：${esc(fb.actual.slice(0, 80))}</div>` : '';
    const misTag = fb && (fb.misreads || []).length ? `　<span style="color:#a94442">断错分析 ${fb.misreads.length} 条</span>` : '';
    const fixTag = r.correction ? '　<span style="color:#8a6d3b">已反推</span>' : '';
      const pn = (r.parts && r.parts.items) ? r.parts.items.length : 0;
      const pd = fb && fb.partOutcomes ? Object.keys(fb.partOutcomes).length : 0;
      const partTag = pn ? (r.parts.confirmed
        ? `　<span style="color:#3c763d">逐问 ${pd}/${pn}</span>`
        : `　<span class="muted">可拆 ${pn} 问</span>`) : '';
    const noAns = rec_hasAnswer(r) ? '' : '　<span class="muted">（未存解读全文）</span>';
    const marked = fb ? (Object.keys(fb.ruleVerdicts || {}).length + Object.keys(fb.symbolVerdicts || {}).length) : 0;
    return `<div style="border-bottom:1px solid #eee;padding:6px 0;font-size:13px;">
      <div><b>${esc(r.question || '(未填问题)')}</b> <span class="muted">${esc(r.domain || '')}　${esc((r.chartRef && r.chartRef.siZhu) || '')}</span></div>
      <div class="muted">${esc((r.createdAt || '').slice(0, 10))}　判读 ${((r.fired && r.fired.rules) || []).length} 条　锚点 ${((r.fired && r.fired.anchors) || []).length} 个　${tag}${marked ? `　已逐条标注 ${marked} 条` : ''}${hit}${misTag}${fixTag}${partTag}${noAns}</div>
      ${actual}
      <div style="margin-top:4px;">
        <button class="btn" style="background:#3c763d;padding:3px 8px;font-size:12px;" data-open="${esc(r.id)}">${fb ? '查看/修改复盘' : '📝 填写实况并复盘'}</button>
        <button class="btn" style="background:#a94442;padding:3px 8px;font-size:12px;" data-del="${esc(r.id)}">删除</button></div>
    </div>`;
  }

  /** 只截取要显示的一段并补一个「显示更多」。列表长到几百条时，
   *  一次性 innerHTML 全量重绘会明显卡顿，而这里每次只铺 20 条。 */
  function pagedHtml(rows, shown, moreAttr) {
    const slice = rows.slice(0, shown);
    const rest = rows.length - slice.length;
    return slice.map(caseRowHtml).join('')
      + (rest > 0
        ? `<div style="text-align:center;margin-top:8px;">
             <button class="btn" style="background:#666;padding:4px 14px;font-size:13px;" ${moreAttr}>显示更多（还有 ${rest} 例）</button>
           </div>`
        : '');
  }

  async function allCases() {
    return (await store.list()).filter(r => r.id !== REV_ID);
  }

  async function renderCases() {
    if (!store || !CB) return;
    const host = $('caseListView');
    let rows;
    try { rows = await allCases(); } catch (e) { host.innerHTML = `<span class="muted">读取失败：${esc(e.message)}</span>`; return; }
    const pending = rows.filter(r => !CB.graded(r));
    if (!rows.length) {
      host.innerHTML = '<span class="muted">还没有案例。解读之后点「存为案例」，等事情有了结果再回来回填——积累到一定数量才谈得上统计。</span>';
      return;
    }
    if (!pending.length) {
      host.innerHTML = `<span class="muted">待回填的案例都清完了。${rows.length} 例已全部回填，在「已归档」页翻阅。</span>`;
      return;
    }
    if (_pendShown < PAGE_SIZE) _pendShown = PAGE_SIZE;
    host.innerHTML = `<div class="muted" style="margin-bottom:6px;">
        还有 <b>${pending.length}</b> 例等着回填结果。回填之后它们会移到「已归档」，并计入校准统计。
      </div>` + pagedHtml(pending, _pendShown, 'data-more="pending"');
  }

  async function renderArchive() {
    if (!store || !CB) return;
    const host = $('caseArchiveView');
    let rows;
    try { rows = await allCases(); } catch (e) { host.innerHTML = `<span class="muted">读取失败：${esc(e.message)}</span>`; return; }
    const graded = rows.filter(r => CB.graded(r));
    if (!graded.length) {
      host.innerHTML = `<span class="muted">还没有回填过结果的案例。先去「待回填」把已经有结果的事填上——
        归档、统计、以及规则修订的反推，全都只认已回填的案例。</span>`;
      return;
    }
    // 结果分布：这是归档页唯一该给的「统计」——分子分母都在眼前，不做任何外推
    const byOutcome = {};
    graded.forEach(r => { const o = r.feedback.outcome; byOutcome[o] = (byOutcome[o] || 0) + 1; });
    const chips = OUTCOME_BTNS.map(([v, label]) => {
      const n = byOutcome[v] || 0;
      const on = _archFilter === v;
      return `<button class="btn" data-archfilter="${v}" style="padding:3px 10px;font-size:12px;background:${on ? outcomeColor(v) : '#eee'};color:${on ? '#fff' : '#333'};">${label} ${n}</button>`;
    }).join(' ');
    const allOn = _archFilter === 'all';
    const allChip = `<button class="btn" data-archfilter="all" style="padding:3px 10px;font-size:12px;background:${allOn ? '#3c763d' : '#eee'};color:${allOn ? '#fff' : '#333'};">全部 ${graded.length}</button>`;

    let list = _archFilter === 'all' ? graded : graded.filter(r => r.feedback.outcome === _archFilter);
    const q = _archQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(r => [r.question, r.domain, (r.feedback && r.feedback.actual) || '', (r.chartRef && r.chartRef.siZhu) || '']
        .join(' ').toLowerCase().indexOf(q) >= 0);
    }
    const hitRate = graded.length
      ? Math.round(((byOutcome.happened || 0) / graded.length * 100)) : 0;
    // 「完全应验占比」是描述这一堆案例本身的，不是准确率——占类混杂、问题难度不一，
    // 拿它当命中率会高估。规则一级的符合率在「校准统计」页，那里才有样本门槛把关。
    const summary = `<div style="font-size:12px;background:#fafafa;border-radius:6px;padding:6px 8px;margin-bottom:6px;">
        已归档 <b>${graded.length}</b> 例，其中完全应验 <b>${byOutcome.happened || 0}</b> 例（${hitRate}%）。
        <span class="muted">这只是这批案例的结果分布，不等于准确率——占类混杂、难度不一。
        按规则拆开的符合率（含样本门槛）在「校准统计」页。</span>
      </div>`;
    const controls = `<div style="margin-bottom:6px;display:flex;flex-wrap:wrap;gap:4px;align-items:center;">
        ${allChip} ${chips}
        <input id="archSearch" placeholder="搜问题 / 占类 / 实况 / 四柱" value="${esc(_archQuery)}"
               style="flex:1;min-width:140px;padding:4px 6px;font-size:13px;">
      </div>`;
    const body = list.length
      ? pagedHtml(list, _archShown, 'data-more="archive"')
      : '<span class="muted">这个筛选下没有案例。</span>';
    host.innerHTML = summary + controls
      + (list.length !== graded.length ? `<div class="muted" style="font-size:12px;margin-bottom:4px;">筛出 ${list.length} 例</div>` : '')
      + body;
    // 重绘会丢焦点，键入时逐字重绘等于打不了字，故只在有查询词时把光标接回去
    if (q) { const s = $('archSearch'); if (s) { s.focus(); s.selectionStart = s.selectionEnd = s.value.length; } }
  }

  /** 回填/删除/导入之后，两页的内容都可能变，一并重绘。 */
  async function renderCaseViews() { await renderCases(); await renderArchive(); }

  /* ---------- 复盘表单：实况文本 + 实际日期 + 逐条标注 + AI 复盘 ---------- */
  let _reviewRec = null;

  const VERDICT_OPTS = [['', '未标注'], ['happened', '相符'], ['partial', '部分'], ['not_happened', '不符'], ['opposite', '相反']];

  /* 复盘表单（Phase 35 改为「快速复盘」）：
   *   首屏只留三样——① 实况、② 实际日期、③ 整体判断——加主按钮「AI 代标并保存」。
   *   规则判读、逐维度收进折叠的「细标」，AI 代标会替你填好，想改再展开。
   *   「复盘反推」（Phase 36）在首屏：只要 ① 就能推，推成即存，与保存互不牵连。
   *   盘面象义的逐条标注撤掉：它只进一张按「元素@宫」分的表，样本永远攒不够，不进任何修订。
   *   （AI 提示里象义清单仍在——只作断错分析的依据锚点，见 casebook.reviewPrompt。）
   * 依据：用户案例本两次整本评估（152 例 / 72 例）——改了纲领的发现全出自实况与断错分析；
   * 逐条勾选做了 93%，而 177 个规则分支里够 8 例门槛的只有 1 个。 */
  async function openReview(id) {
    if (!store || !CB) return;
    const rec = await store.get(id);
    if (!rec) return;
    _reviewRec = rec;
    const fb = rec.feedback || {};
    const vs = fb.ruleVerdicts || {};
    const sel = (attr, key, cur) => `<select data-${attr}="${esc(key)}" style="font-size:12px;margin-top:2px;">
      ${VERDICT_OPTS.map(([v, label]) => `<option value="${v}"${cur === v || (!cur && !v) ? ' selected' : ''}>${label}</option>`).join('')}
    </select>`;
    // 规则判读：domain-rules.json 命中项，有出处、可回查、可驱动校准——收进细标，AI 代填
    const recRules = (rec.fired && rec.fired.rules) || [];
    const rulesHtml = recRules.length ? recRules.map(r => `
      <div style="border-bottom:1px solid #f2f2f2;padding:4px 0;font-size:12px;">
        <div>${esc(r.label || r.id)} <span class="muted">→ ${esc(r.concept || '')}</span>
          <span class="muted">[${r.polarity === '+' ? '助' : r.polarity === '-' ? '阻' : '中'}]</span></div>
        ${sel('verdict', r.id, vs[r.id])}
      </div>`).join('')
      : '<div class="muted" style="font-size:12px;padding:4px 0;">本占类的规则库尚未覆盖（如综合占类、或飞盘），故无规则判读条目。</div>';
    const cvDims = ((rec.converge && rec.converge.dims) || []).length;
    const mis = (fb.misreads || []);
    // 「占问当天」：占问时刻取自存档的盘（chartRef.date 形如「2025-04-04 19:41:00 …」）
    const askDay = String((rec.chartRef && rec.chartRef.date) || '').slice(0, 10);
    const hasAskDay = /^\d{4}-\d{2}-\d{2}$/.test(askDay);
    $('reviewBody').innerHTML = `
      <div style="font-size:13px;">
        <div><b>${esc(rec.question || '')}</b> <span class="muted">${esc((rec.chartRef && rec.chartRef.siZhu) || '')}</span></div>
        ${rec.answer ? `<details style="margin-top:6px;"><summary>📄 当时的解读全文（打分前先对照一下）</summary>
          <div class="${(MD && MD.looksMarkdown(rec.answer)) ? 'md-on' : ''}" style="white-space:pre-wrap;background:#f7f7f7;border-radius:6px;padding:8px;margin-top:4px;max-height:240px;overflow:auto;font-size:12px;">${
            // 存档的解读全文同样渲染：这一栏是复盘时拿来跟实况逐条对照的，
            // 表格散成竖线最难对。MdLite 先转义再生成，故此处放 HTML 与 esc() 同样安全。
            (MD && MD.render && MD.looksMarkdown(rec.answer)) ? MD.render(rec.answer) : esc(rec.answer)
          }</div>
        </details>` : '<div class="muted" style="margin-top:6px;">（本条案例未记录解读全文——存档前的旧案例会这样）</div>'}
        <div style="margin-top:6px;">
          <div class="muted">① 实际发生了什么？（用你自己的话写，越具体越有用——AI 代标全靠这段）</div>
          <textarea id="reviewActual" rows="3" style="width:100%;">${esc(fb.actual || '')}</textarea>
        </div>
        <div style="margin-top:6px;">
          <span class="muted">② 实际发生日期</span>
          <input type="date" id="reviewDate" value="${esc(fb.happenedAt || '')}">
          ${hasAskDay ? `<button class="btn" type="button" id="reviewDayAsk" style="background:#666;padding:2px 6px;font-size:12px;">占问当天</button>
          <button class="btn" type="button" id="reviewDayNext" style="background:#666;padding:2px 6px;font-size:12px;">次日</button>` : ''}
          <span class="muted">时刻(可选)</span>
          <input type="time" id="reviewTime" value="${esc(fb.happenedTime || '')}" style="width:96px;">
          <span class="muted" id="reviewHitTag"></span>
          <div class="muted" style="font-size:11px;margin-top:2px;">
            填了日期，应期才核对得了。时刻填了才核对「时辰」一级——不填就不核对，拿中午顶替等于白送一次蒙中的机会。
          </div>
        </div>
        ${partsFormHtml(rec)}
        <div style="margin-top:6px;">
          <span class="muted">③ 整体判断${rec.parts && rec.parts.confirmed ? '（已按逐问自动推出，可手改）' : ''}</span>
          ${OUTCOME_BTNS.map(([k, label]) =>
            `<label style="margin-right:8px;font-size:12px;"><input type="radio" name="reviewOutcome" value="${k}"${fb.outcome === k ? ' checked' : ''}>${label}</label>`).join('')}
        </div>
        <div style="margin-top:10px;">
          <button class="btn" id="reviewAiSaveBtn">🤖 AI 代标并保存</button>
          <button class="btn" id="reviewSaveBtn" style="background:#666;">仅保存</button>
          <button class="btn" id="reviewCancelBtn" style="background:#999;">关闭</button>
          <span class="muted" id="reviewSaveTag"></span>
          <div class="muted" style="font-size:11px;margin-top:2px;">
            填好 ①③ 按「AI 代标并保存」即可：AI 依实况替你标好规则判读、逐维度，并挑出断错之处——一次调用。
          </div>
        </div>
        <div style="margin-top:10px;">
          <button class="btn" id="reviewFixBtn" style="background:#8a6d3b;">🔍 复盘反推：当时应该如何判断</button>
          <span class="muted" id="reviewFixTag"></span>
          <div class="muted" style="font-size:11px;margin-top:2px;">
            只需填 ①：AI 依实况回看当时那一盘——按纲要本该怎么断、当时偏在哪一条、下次同类盘留意什么。
            只许用盘上已有的条目；按纲要断不出就如实说断不出。结果当场存入本案例。
          </div>
          <div id="reviewFix" style="margin-top:6px;">${rec.correction ? renderCorrection(rec.correction, fb.actual || '') : ''}</div>
        </div>
        <details id="reviewFine" style="margin-top:10px;border:1px solid #ddd;border-radius:6px;padding:6px;">
          <summary class="muted">细标（可选）：规则判读 ${recRules.length} 条${cvDims ? '、逐维度 ' + cvDims + ' 项' : ''}——AI 代标会替你填好，想改再展开</summary>
          <div style="margin-top:6px;">
            <button class="btn" id="reviewAiBtn" style="background:#666;padding:3px 8px;font-size:12px;">🤖 先代标、看过再存</button>
            <span class="muted" id="reviewAiTag"></span>
          </div>
          <div style="max-height:420px;overflow:auto;margin-top:4px;">
            <div style="margin:4px 0;font-weight:bold;">规则判读（按纲要命中的条目，有出处）</div>
            ${rulesHtml}
          </div>
          ${dimsFormHtml(rec)}
        </details>
        <div id="reviewMisreads" style="margin-top:8px;">${mis.length ? renderMisreads(mis) : ''}</div>
        <div id="reviewObs" class="muted" style="margin-top:6px;"></div>
      </div>`;
    $('reviewPanel').style.display = 'block';
    $('reviewDate').addEventListener('change', previewTimingHits);
    $('reviewTime').addEventListener('change', previewTimingHits);
    if (hasAskDay) {
      const setDay = (offset) => {
        const d = new Date(askDay + 'T12:00:00'); d.setDate(d.getDate() + offset);
        const pad = (n) => String(n).padStart(2, '0');
        $('reviewDate').value = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
        previewTimingHits();
      };
      $('reviewDayAsk').addEventListener('click', () => setDay(0));
      $('reviewDayNext').addEventListener('click', () => setDay(1));
    }
    $('reviewAiSaveBtn').addEventListener('click', aiAndSave);
    $('reviewAiBtn').addEventListener('click', () => aiReview());
    $('reviewFixBtn').addEventListener('click', askCorrection);
    // 细标里的改动由人手做了才算「人工标注」；AI 预填是程序赋值，不触发 change
    $('reviewFine').addEventListener('change', () => { if (_reviewRec) _reviewRec._touched = true; });
    // 一卦多问：勾选后展开逐问，且逐问一改就把「整体判断」按规则推出来
    const partsOn = $('partsOn');
    if (partsOn) {
      const sync = () => {
        const on = partsOn.checked;
        if ($('partsRows')) $('partsRows').style.display = on ? 'block' : 'none';
        if (!on || !CB.deriveOutcome) return;
        const items = ((_reviewRec.parts || {}).items || []).map(it => {
          const sel = document.querySelector(`input[name="part${it.i}"]:checked`);
          return { outcome: sel ? sel.value : '' };
        });
        const d = CB.deriveOutcome(items);
        if (!d) return;
        const r = document.querySelector(`input[name="reviewOutcome"][value="${d}"]`);
        if (r) r.checked = true;
      };
      partsOn.addEventListener('change', sync);
      document.querySelectorAll('input[name^="part"]').forEach(x => x.addEventListener('change', sync));
      sync();
    }
    $('reviewSaveBtn').addEventListener('click', () => saveReview());
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

  /** 复盘反推（正解）：当时按纲要正确地断该是什么样。含「断不出来」这一诚实出口。
   *  curActual：面板上现在的实况——与反推当时依据的实况不同，就提示可以重推。 */
  const VERDICT_LABEL = { derivable: '按纲要可以断出', partly_derivable: '部分可断出', not_derivable: '按纲要断不出此结果' };
  const HOW_LABEL = { overrated: '当时高估了', underrated: '当时低估了', missed: '当时漏看了' };
  function renderCorrection(c, curActual) {
    if (!c) return '';
    const bad = c.verdict === 'not_derivable';
    const stale = c.basedOnActual && curActual && c.basedOnActual.trim() !== String(curActual).trim();
    return `<div style="border:1px solid ${bad ? '#c9c9c9' : '#c9dcc9'};border-radius:6px;padding:6px;background:${bad ? '#fafafa' : '#f7fbf7'};">
      <b style="font-size:12px;">复盘反推</b> <span class="muted">（${esc(VERDICT_LABEL[c.verdict] || c.verdict)}）</span>
      ${stale ? '<div style="font-size:11px;color:#a15c00;margin-top:2px;">⚠ 这份反推依据的是改动前的实况，可再按一次「复盘反推」。</div>' : ''}
      ${bad
        ? `<div class="muted" style="font-size:12px;margin-top:4px;">${esc(c.whyNotDerivable || '')}
           <br>—— 这是允许且重要的答案：强行圆出一套说法，比承认断不出更有害。</div>`
        : `<div style="font-size:12px;white-space:pre-wrap;margin-top:4px;">${esc(c.correction || '')}</div>`}
      ${(c.misweighted || []).length ? `<div style="font-size:12px;margin-top:6px;">偏差所在：${
        c.misweighted.map(m => `<div>· <code>${esc(m.itemId)}</code> ${esc(HOW_LABEL[m.how] || m.how)}——${esc(m.why)}</div>`).join('')
      }</div>` : ''}
      ${c.lesson ? `<div style="font-size:12px;margin-top:6px;">💡 下次留意：${esc(c.lesson)}
        <span class="muted">（单案心得，未经多案验证）</span></div>` : ''}
      ${(c.at || c.model) ? `<div class="muted" style="font-size:11px;margin-top:4px;">${esc(String(c.at || '').slice(0, 16).replace('T', ' '))}${c.model ? ' · ' + esc(c.model) : ''}</div>` : ''}
    </div>`;
  }

  /** 复盘反推：依 ① 实况回推「当时该怎么断」。
   *  只要 ① 就能推（不必先定整体判断）；推成即**当场存入案例**——此前要再按保存，
   *  关掉面板就白推一次。存的是 correction 一栏，与实况反馈分开，不动任何判读统计。 */
  async function askCorrection() {
    if (!_reviewRec || !RV) return;
    const tag = (m) => { $('reviewFixTag').textContent = m; };
    const actual = $('reviewActual').value.trim();
    if (!actual) { tag('请先填写 ① 实际发生了什么——反推全靠这段'); return; }
    const picked = document.querySelector('input[name="reviewOutcome"]:checked');
    const rec0 = _reviewRec;
    const btn = $('reviewFixBtn'); btn.disabled = true; tag('反推中…');
    try {
      const sys = '你在为奇门占例写复盘反推（正解）。只能基于给定条目，不得新造断法；断不出就如实说。只输出 JSON。';
      const out = await LLM.chat(sys, RV.correctionPrompt(_reviewRec, actual, _reviewRec.safetyNote || '', { outcome: picked ? picked.value : '', happenedAt: $('reviewDate').value, happenedTime: $('reviewTime') ? $('reviewTime').value : '' }), null, tag);
      const p = RV.parseCorrection(out, rec0);
      if (!p.ok) { tag('解析失败：' + p.error + '，可再试一次'); return; }
      const u = (LLM.lastUsed && LLM.lastUsed()) || null;
      const c = {
        verdict: p.verdict, correction: p.correction, misweighted: p.misweighted,
        whyNotDerivable: p.whyNotDerivable, lesson: p.lesson,
        basedOnActual: actual, at: new Date().toISOString(), model: u ? u.label : ''
      };
      // 存库以库里那份为底：只并入 correction，面板上尚未保存的实况/标注不在此一并写入
      if (store && CB) {
        const cur = await store.get(rec0.id);
        if (cur) {
          await store.save(CB.applyCorrection(cur, c));
          try { await renderCaseViews(); } catch (e) { /* 列表刷新失败不影响反推结果 */ }
        }
      }
      rec0.correction = c; rec0._correction = c;   // 之后再按保存也带着它
      if (_reviewRec !== rec0) return;               // 等 AI 期间面板被关掉或换了案例
      $('reviewFix').innerHTML = renderCorrection(c, actual);
      tag((p.verdict === 'not_derivable'
        ? '按纲要断不出此结果——这条信息本身很有价值'
        : `已反推${p.misweighted.length ? `，指出 ${p.misweighted.length} 处偏差` : ''}`)
        + (p.dropped.length ? `（丢弃 ${p.dropped.length} 条无效项）` : '') + '；已存入本案例');
    } catch (e) { tag('反推失败：' + (e.message || e)); }
    finally { btn.disabled = false; }
  }

  /** 实际发生时刻 → 四柱。未填时刻则**摘掉时柱**：中午顶替出来的时柱会白送一层命中机会。 */
  function actualSiZhu(dateStr, timeStr) {
    if (!dateStr) return null;
    const at = new Date(dateStr + 'T' + (timeStr || '12:00') + ':00');
    const sz = QM.qimen.calculate(at, { type: '四柱', method: '时家', purpose: '综合' }).siZhu;
    const out = { year: sz.year, month: sz.month, day: sz.day };
    if (timeStr) out.time = sz.time;
    return out;
  }

  /** 逐维度标注：说是 A 级的，后来对了几成——不标这一栏，档位校准永远算不出来。 */
  function dimsFormHtml(rec) {
    const cv = rec.converge;
    if (!cv || !cv.dims || !cv.dims.length) return '';
    const dv = (rec.feedback || {}).dimVerdicts || {};
    const rows = cv.dims.map(d => {
      const ab = (cv.abstained || []).indexOf(d.dim) >= 0;
      return `<div style="border-bottom:1px solid #f2f2f2;padding:3px 0;font-size:12px;">
        <b>${esc(d.dim)}</b>　<span class="muted">当时断「${esc(d.top || '—')}」
        ${esc(d.tier)}级·${d.independent} 路${d.contested ? '·两说相争' : ''}${ab ? '　<b>已弃权</b>' : ''}</span>
        ${ab ? '<span class="muted">（弃权项无需标注）</span>'
             : VERDICT_OPTS.map(([v, label]) =>
                `<label style="margin-left:6px;"><input type="radio" name="dim_${esc(d.dim)}" value="${v}"${(dv[d.dim] || '') === v ? ' checked' : ''}>${label}</label>`).join('')}
      </div>`;
    }).join('');
    return `<div style="margin-top:8px;border:1px solid #ddd;border-radius:6px;padding:6px;">
      <div><span class="muted">②c 逐维度标注</span>
        <span class="muted" style="font-size:11px;">　标了这一栏，「档位准不准」才算得出来——A 级若不比 C 级准，档位就是摆设</span></div>
      ${rows}
    </div>`;
  }

  /** 一卦多问：把拆分提议摆出来，逐问各自回填。
   *  拆与不拆由用户定——「①中医②西医③祝由④开刀」是选项不是子问题，硬拆会把选项拆成问题。 */
  function partsFormHtml(rec) {
    const p = rec.parts;
    if (!p || !p.items || !p.items.length) return '';
    const fb = rec.feedback || {};
    const po = fb.partOutcomes || {};
    const pa = fb.partActuals || {};
    const rows = p.items.map(it => `
      <div style="border-bottom:1px solid #f2f2f2;padding:4px 0;font-size:12px;">
        <div><b>${it.i + 1}.</b> ${esc(it.text)}</div>
        <div style="margin-top:2px;">
          ${OUTCOME_BTNS.map(([k, label]) =>
            `<label style="margin-right:6px;"><input type="radio" name="part${it.i}" value="${k}"${po[it.i] === k ? ' checked' : ''}>${label}</label>`).join('')}
          <input data-partactual="${it.i}" placeholder="这一问的实况(可选)" value="${esc(pa[it.i] || '')}"
                 style="width:44%;font-size:12px;padding:2px 4px;">
        </div>
      </div>`).join('');
    return `
      <div style="margin-top:8px;border:1px solid ${p.confirmed ? '#3c763d' : '#ddd'};border-radius:6px;padding:6px;">
        <div><span class="muted">②b 一卦多问</span>
          <label style="font-size:12px;margin-left:6px;">
            <input type="checkbox" id="partsOn"${p.confirmed ? ' checked' : ''}> 按 ${p.items.length} 问分别回填
          </label>
          <span class="muted" style="font-size:11px;">　${esc(p.why)}</span>
        </div>
        ${p.looksLikeOptions ? `<div class="muted" style="font-size:11px;color:#8a6d3b;">
          ⚠ 这几条看着像**选项**而不是子问题，默认不拆。确属多问再勾选。</div>` : ''}
        <div id="partsRows" style="margin-top:4px;${p.confirmed ? '' : 'display:none;'}">${rows}
          <div class="muted" style="font-size:11px;margin-top:4px;">
            逐问回填后，「整体判断」会按各问自动推出；统计也改用各问平均分——
            四问中三问应验记 0.75，而不是笼统的「部分＝0.5」。
          </div>
        </div>
      </div>`;
  }

  /** 应期反推：确定性比对，实时显示命中了哪条机制。 */
  function previewTimingHits() {
    if (!_reviewRec || !CB) return;
    const d = $('reviewDate').value, tm = $('reviewTime') ? $('reviewTime').value : '';
    if (!d) { $('reviewHitTag').textContent = ''; return; }
    const sz = actualSiZhu(d, tm);
    const der = CB.deriveTimingHits(_reviewRec, sz);
    const head = esc(sz.day) + '日' + (sz.time ? '·' + esc(sz.time) + '时' : '');
    const lv = (der.levelsEvaluated || []).join('/');
    $('reviewHitTag').innerHTML = der.hits.length
      ? `　<span style="color:#3c763d">${head} — 命中：${der.hits.map(h => esc(h.mechanism + '·' + h.value + '(' + (h.at || [h.level]).join('+') + ')')).join('、')}</span>
         <span class="muted">（评了 ${esc(lv)} ${(der.levelsEvaluated || []).length} 层，随机基准 ${Math.round(der.chance * 100)}%，命中率与基准相当即不算准）</span>`
      : `　<span class="muted">${head} — 当时的锚点无一命中（评了 ${esc(lv)} ${(der.levelsEvaluated || []).length} 层，随机基准 ${Math.round(der.chance * 100)}%）</span>`;
  }

  /** AI 复盘：只让模型把实况映射到当时的判读上，输出经严格校验后填进表单，由用户过目再存。 */
  /** AI 依实况代标：填好规则判读、逐维度，并挑出断错之处。返回是否成功（「AI 代标并保存」据此决定怎么报）。 */
  async function aiReview() {
    if (!_reviewRec || !CB) return false;
    const actual = $('reviewActual').value.trim();
    if (!actual) { $('reviewAiTag').textContent = '请先填写实际情况'; return false; }
    const btns = ['reviewAiBtn', 'reviewAiSaveBtn'].map(i => $(i)).filter(Boolean);
    btns.forEach(b => { b.disabled = true; });
    $('reviewAiTag').textContent = 'AI 代标中…';
    try {
      const sys = '你是奇门占例复盘助手。只做判读与实况的比对标注，不重新断卦、不新增断法。只输出 JSON。';
      const out = await LLM.chat(sys, CB.reviewPrompt(_reviewRec, actual), null);
      const parsed = CB.parseReview(out, _reviewRec);
      if (!parsed.ok) { $('reviewAiTag').textContent = '解析失败：' + parsed.error + '（可手动标注）'; return false; }
      let n = 0;
      Object.keys(parsed.verdicts).forEach(id => {
        const el = document.querySelector(`select[data-verdict="${CSS.escape(id)}"]`);
        if (el) { el.value = parsed.verdicts[id]; n++; }
      });
      Object.keys(parsed.dimVerdicts || {}).forEach(dim => {
        const el = document.querySelector(`input[name="dim_${CSS.escape(dim)}"][value="${CSS.escape(parsed.dimVerdicts[dim])}"]`);
        if (el) { el.checked = true; n++; }
      });
      _reviewRec._aiDone = true;
      _reviewRec._aiObservations = parsed.observations;
      _reviewRec._aiMisreads = parsed.misreads || [];
      $('reviewMisreads').innerHTML = renderMisreads(_reviewRec._aiMisreads);
      $('reviewObs').innerHTML = parsed.observations.length
        ? '观察（供参考，非结论）：<br>' + parsed.observations.map(o => '· ' + esc(o)).join('<br>') : '';
      $('reviewAiTag').textContent = `已代标 ${n} 条`
        + ((parsed.misreads || []).length ? `、${parsed.misreads.length} 条断错分析` : '')
        + (parsed.dropped.length ? `，丢弃 ${parsed.dropped.length} 条无效项` : '');
      return true;
    } catch (e) {
      $('reviewAiTag').textContent = 'AI 代标失败：' + (e.message || e);
      return false;
    } finally { btns.forEach(b => { b.disabled = false; }); }
  }

  /** 主按钮：先代标，再保存。
   *  代标失败就**不自动保存**，面板留着并写明原因——保存会收起面板，失败的消息收起就看不见了；
   *  填的内容一字不丢，可按「仅保存」存下，或稍后再试。 */
  async function aiAndSave() {
    if (!_reviewRec) return;
    if (!$('reviewActual').value.trim()) { $('reviewSaveTag').textContent = '请先填写 ① 实际发生了什么——AI 代标全靠这段'; return; }
    if (!document.querySelector('input[name="reviewOutcome"]:checked')) { $('reviewSaveTag').textContent = '请先选择 ③ 整体判断'; return; }
    // 已代标过（先代标、看过再存）就不重跑——重跑会冲掉你在细标里的改动
    let ok = !!_reviewRec._aiDone;
    if (!ok) { $('reviewSaveTag').textContent = 'AI 代标中…'; ok = await aiReview(); }
    if (!_reviewRec) return;   // 等 AI 期间被关掉了
    if (!ok) {
      $('reviewSaveTag').textContent = '未保存：' + ($('reviewAiTag').textContent || 'AI 代标未成')
        + '。你填的内容还在——可按「仅保存」先存下，或稍后再试。';
      return;
    }
    await saveReview();
  }

  async function saveReview(opts) {
    opts = opts || {};
    if (!_reviewRec || !store || !CB) return;
    const picked = document.querySelector('input[name="reviewOutcome"]:checked');
    if (!picked) { $('reviewSaveTag').textContent = '请先选择整体判断'; return; }
    const verdicts = {};
    document.querySelectorAll('select[data-verdict]').forEach(sel => {
      if (sel.value) verdicts[sel.dataset.verdict] = sel.value;
    });
    // 盘面象义已不再逐条标注（Phase 35）；旧案例当初标过的原样带过，不因重新保存而丢
    const symbolVerdicts = Object.assign({}, ((_reviewRec.feedback || {}).symbolVerdicts) || {});
    const partsOnEl = $('partsOn');
    const partOutcomes = {}, partActuals = {};
    if (partsOnEl && partsOnEl.checked) {
      ((_reviewRec.parts || {}).items || []).forEach(it => {
        const sel = document.querySelector(`input[name="part${it.i}"]:checked`);
        if (sel) partOutcomes[it.i] = sel.value;
        const ta = document.querySelector(`input[data-partactual="${it.i}"]`);
        if (ta && ta.value.trim()) partActuals[it.i] = ta.value.trim();
      });
    }
    const dimVerdicts = {};
    document.querySelectorAll('input[name^="dim_"]:checked').forEach(x => {
      dimVerdicts[x.name.slice(4)] = x.value;
    });
    const happenedAt = $('reviewDate').value;
    const happenedTime = $('reviewTime') ? $('reviewTime').value : '';
    try {
      let rec = CB.applyFeedback(_reviewRec, {
        outcome: picked.value,
        actual: $('reviewActual').value.trim(),
        happenedAt, happenedTime, partOutcomes, partActuals, dimVerdicts,
        ruleVerdicts: verdicts,
        symbolVerdicts,
        // 标注来源如实记：人手在细标里改过 → manual；只由 AI 代标、没人改 → ai；
        // 都没动而沿用旧标注 → 沿用旧来源。「AI 代标并保存」一键下去，没人逐条过目，不能记成 manual。
        verdictSource: (Object.keys(verdicts).length || Object.keys(dimVerdicts).length)
          ? (_reviewRec._touched ? 'manual' : _reviewRec._aiDone ? 'ai' : (((_reviewRec.feedback || {}).verdictSource) || 'manual'))
          : '',
        observations: _reviewRec._aiObservations || [],
        misreads: _reviewRec._aiMisreads || (_reviewRec.feedback && _reviewRec.feedback.misreads) || [],
        now: new Date().toISOString()
      });
      if (happenedAt) {
        rec = CB.applyTimingDerivation(rec, CB.deriveTimingHits(rec, actualSiZhu(happenedAt, happenedTime)));
      }
      if (rec.parts) {
        rec.parts = Object.assign({}, rec.parts, { confirmed: !!(partsOnEl && partsOnEl.checked) });
      }
      if (_reviewRec._correction) rec = CB.applyCorrection(rec, _reviewRec._correction);
      delete rec._aiObservations; delete rec._aiMisreads; delete rec._correction; delete rec._aiDone; delete rec._touched;
      await store.save(rec);
      $('reviewSaveTag').textContent = '已保存' + (opts.note || '');
      $('reviewPanel').style.display = 'none'; _reviewRec = null;
      await refreshCaseCount(); await renderCaseViews(); await rebuildOverlay();
    } catch (e) { $('reviewSaveTag').textContent = '保存失败：' + e.message; }
  }

  /** 由已达门槛的统计重建经验层 overlay。只产出附注，不改任何规则。 */
  async function rebuildOverlay() {
    if (!store || !CB) return null;
    try {
      const rows = (await store.list()).filter(r => r.id !== REV_ID);
      const cal = CB.calibrate(rows);
      const overlay = CB.buildOverlay(CB.proposals(cal), cal);
      await store.setOverlay(overlay);
      return overlay;
    } catch (e) { console.warn('[casebook] 重建经验层失败：', e.message); return null; }
  }

  /** 评估报告：把整本案例本跑成一张可重复、可比对的成绩单。
   *  刻意把「算不了的指标」也印出来——免得没测过的东西被当成测过了。 */
  async function renderEvalReport() {
    const host = $('caseEvalOut');
    if (!host || !window.Evaluate || !store) return;
    host.textContent = '正在评估…';
    try {
      const rows = (await store.list()).filter(r => r.id !== REV_ID);
      host.textContent = window.Evaluate.toReport(window.Evaluate.evaluate(rows));
    } catch (e) { host.textContent = '评估失败：' + e.message; }
  }

  async function renderStats() {
    if (!store || !CB) return;
    const host = $('caseStatsBody') || $('caseStatsView');
    const rows = (await store.list()).filter(r => r.id !== REV_ID);
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
    /* 按模型：哪一路作答的应验率。统计口径不在这里另写一套，直接取评估器的 byModel——
       两处各算一套迟早对不上，而这一项最怕的就是「报告里一个数、界面上另一个数」。 */
    const mdRep = (window.Evaluate && window.Evaluate.evaluate)
      ? (window.Evaluate.evaluate(rows) || {}).byModel : null;
    const mdHtml = !mdRep ? ''
      : !mdRep.rows.length
        ? `<div style="margin-top:8px;"><b>按模型</b></div>
           <div class="muted" style="font-size:12px;">尚无带模型标记的案例——本项自本版才开始记${
             mdRep.unlabeled ? `，现有 ${mdRep.unlabeled} 例都在此之前` : ''}。此后每存一条案例都会记下实际作答的那一路。</div>`
        : `<div style="margin-top:8px;"><b>按模型</b>
             <span class="muted">（记的是<b>实际作答</b>的那一路；备用接管过的算接管者）</span></div>
           ${mdRep.rows.map(x => `<div style="font-size:12px;">
             ${esc(x.label)}(n=${x.n})：${esc(x.display)}${
               x.fellBack ? `　<span class="muted">其中 ${x.fellBack} 例由备用接管</span>` : ''}</div>`).join('')}
           ${mdRep.unlabeled ? `<div class="muted" style="font-size:12px;">另有 ${mdRep.unlabeled} 例未记录模型（本项自本版才记），不参与比较。</div>` : ''}
           <div style="font-size:12px;margin-top:2px;color:${mdRep.comparable >= 2 ? '#8a6d3b' : '#888'};">${
             mdRep.comparable >= 2
               ? `加权分差距 ${mdRep.spread}（${mdRep.comparable} 家达门槛）。${esc(mdRep._caveat).replace(/\*\*/g, '')}`
               : `<b>目前还比不出来</b>：达到 ${mdRep.minSamples} 例门槛的只有 ${mdRep.comparable} 家，两家都够格才谈得上比较。`}</div>`;
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
          <span class="muted">（键为「元素@宫」，如 生门@2＝生门临坤二。这是象的配置统计，不是纲要规则。
          自 Phase 35 起不再逐条标注：新案例只按整案归因计入，旧案例当初的逐条标注照常计）</span></div>
        <div style="max-height:200px;overflow:auto;margin-top:4px;">${symStatHtml}</div>
        ${mdHtml}
        <div style="margin-top:8px;"><b>按规则</b>（符合率低者在前，便于复核；不足 ${cal.minSamples} 例不给百分比）</div>
        <div style="max-height:200px;overflow:auto;margin-top:4px;">${ruleHtml}</div>
        ${tcHtml}
        <div style="margin-top:10px;"><b>校订建议</b>
          <span class="muted">——建议而已，不会自动改规则。规则库是按纲要写的，要改请改 knowledge/domain-rules.json 并补出处。</span>
        </div>${psHtml}
      </div>`;
  }

  /* ---------- 规则修订：反推 → 冲突检查 → 人工采纳 ---------- */
  let _revCandidates = [];

  const OP_LABEL = { narrow: '收窄适用范围', reweight: '调整权重', mute: '停用此条' };

  async function renderRevisions() {
    if (!store || !RV || !CB) return;
    const rows = (await store.list()).filter(r => r.id !== REV_ID);
    const adopted = await getRevisionList();
    const fails = rows.filter(r => RV.isFail(r)).length;
    const digest = RV.failureDigest(rows);

    const adoptedHtml = adopted.length ? adopted.map((r, i) => `
      <div style="border-bottom:1px solid #f0f0f0;padding:4px 0;font-size:12px;">
        <label><input type="checkbox" data-revtoggle="${i}"${r.enabled ? ' checked' : ''}> 启用</label>
        <code>${esc(r.ruleId)}</code>　<b>${esc(OP_LABEL[r.op] || r.op)}</b>
        ${r.op === 'reweight' ? `（${r.payload.delta > 0 ? '+' : ''}${r.payload.delta}）` : ''}
        <div class="muted">易理依据：${esc(r.reasoning)}</div>
        <div class="muted">支撑 ${r.supportCases.length} 例｜冲突 ${r.conflictCases.length} 例｜${esc(r.provenance)}</div>
        <button class="btn" style="background:#a94442;padding:2px 6px;font-size:11px;" data-revdel="${i}">删除</button>
      </div>`).join('') : '<span class="muted">尚未采纳任何修订。</span>';

    const candHtml = _revCandidates.length ? _revCandidates.map((rv, i) => {
      const c = rv.check, ok = rv.recommend === 'accept';
      return `<div style="border:1px solid ${ok ? '#c9dcc9' : '#e0d0c0'};border-radius:6px;padding:6px;margin:6px 0;font-size:12px;">
        <code>${esc(rv.revision.ruleId)}</code>　<b>${esc(OP_LABEL[rv.revision.op] || rv.revision.op)}</b>
        ${rv.revision.op === 'reweight' ? `（${rv.revision.payload.delta > 0 ? '+' : ''}${rv.revision.payload.delta}）` : ''}
        ${rv.revision.op === 'narrow' ? `<span class="muted">追加条件 ${esc(JSON.stringify(rv.revision.payload.when))}</span>` : ''}
        <div style="margin-top:2px;">易理依据：${esc(rv.revision.reasoning)}</div>
        <div class="muted" style="margin-top:2px;">支撑 ${c.supportN} 例不应验｜冲突 ${c.conflictN} 例已应验｜置信 ${esc(rv.revision.confidence)}</div>
        <div style="margin-top:2px;color:${ok ? '#3c763d' : '#a94442'};">${esc(rv.recommendWhy)}</div>
        ${ok ? `<button class="btn" style="padding:2px 8px;font-size:11px;margin-top:4px;" data-revadopt="${i}">采纳</button>`
             : `<span class="muted">（不建议采纳）</span>`}
      </div>`;
    }).join('') : '';

    $('caseRevView').innerHTML = `
      <div style="font-size:13px;">
        <p class="muted" style="margin:0 0 6px;line-height:1.7;">
          <b>修订独立于《解断方法纲要》</b>：纲要文件一字不动，修订自成一集、可导出、可随时停用。
          且只允许<b>收窄／降权／停用</b>——不允许从错例反推出新规则，
          因为象数系统里任何结果都能被事后圆回来。
        </p>
        <!-- 下面三条是用户问出来的：他看到「纲要一字不动」，以为反推等于白做。
             那两件事其实是分开的——教义文件不改，修订却是真参与判读的。
             这种「看了说明仍不知道到底改没改」的地方，就该把话写在界面上，
             而不是留给人去翻代码。 -->
        <div class="muted" style="margin:0 0 8px;padding:6px 8px;background:#f7f7f7;border-radius:6px;line-height:1.75;">
          <div style="margin-bottom:3px;">① <b>反推本身不改变任何判读。</b>
            点「让 AI 反推易理偏差」只是生成<b>候选</b>并做冲突检查，
            <b>必须再点候选下面的「采纳」</b>才会落盘生效。
            候选须有 ≥${RV.MIN_FAIL_CASES} 例不应验支撑、且与已应验案例冲突不超过 1 例，
            才会出现「采纳」按钮；不够格的只显示「（不建议采纳）」。</div>
          <div style="margin-bottom:3px;">② <b>采纳之后，下一次解读是真的会变。</b>
            被停用的那条判读会整段从送给 AI 的证据包里消失，倾向计数随之改变，
            并附一行「本次应用了 N 条本机经验修订」。取消下面的「启用」勾选即刻恢复原样。</div>
          <div>③ <b>只作用于「占类象义判读」这一层。</b>
            排盘与格局、用神取用、旺衰四害与力量校验、应期锚点、类象取用、证据合流、
            伏吟反吟、八十一格、时格、取数——<b>这些都不受修订影响</b>，
            它们照旧按纲要与引擎走。</div>
        </div>
        <div><b>当前修订集</b>　<span class="muted">${adopted.length} 条，哈希 ${esc((_revIndex && _revIndex.hash) || '—')}</span></div>
        <div style="max-height:220px;overflow:auto;margin:4px 0;">${adoptedHtml}</div>
        <hr style="border:none;border-top:1px solid #eee;margin:8px 0;">
        <div><b>反推候选</b>　<span class="muted">已回填 ${rows.filter(r => CB.graded(r)).length} 例，其中不应验 ${fails} 例；
          有 ${digest.length} 条规则反复不应验（需 ≥${RV.MIN_FAIL_CASES} 次才纳入反推）</span></div>
        ${digest.length
          ? `<button class="btn" id="revDeriveBtn" style="margin-top:6px;">🧭 让 AI 反推易理偏差</button>
             <span class="muted" id="revDeriveTag"></span>`
          : '<div class="muted" style="margin-top:6px;">暂无够格的反推对象——需要同一条规则累计 ≥4 次不应验。</div>'}
        ${candHtml}
      </div>`;

    if ($('revDeriveBtn')) $('revDeriveBtn').addEventListener('click', () => deriveBias(rows, digest));
    $('caseRevView').querySelectorAll('[data-revadopt]').forEach(b =>
      b.addEventListener('click', () => adoptRevision(Number(b.dataset.revadopt))));
    $('caseRevView').querySelectorAll('[data-revdel]').forEach(b =>
      b.addEventListener('click', () => deleteRevision(Number(b.dataset.revdel))));
    $('caseRevView').querySelectorAll('[data-revtoggle]').forEach(b =>
      b.addEventListener('change', () => toggleRevision(Number(b.dataset.revtoggle), b.checked)));
  }

  async function deriveBias(rows, digest) {
    const btn = $('revDeriveBtn'); btn.disabled = true; $('revDeriveTag').textContent = '反推中…';
    try {
      const known = [];
      rows.forEach(r => ((r.fired && r.fired.rules) || []).forEach(x => { if (known.indexOf(x.id) < 0) known.push(x.id); }));
      const sys = '你在为奇门规则做偏差反推。只许收窄/降权/停用，不得新造规则。每条须给易理依据。只输出 JSON。';
      const out = await LLM.chat(sys, RV.biasPrompt(digest, ''), null, m => { $('revDeriveTag').textContent = m; });
      const p = RV.parseBias(out, known);
      if (!p.ok) { $('revDeriveTag').textContent = '解析失败：' + p.error; return; }
      // 每条候选都要过「已应验案例」的反证
      _revCandidates = RV.review(p.revisions, rows);
      $('revDeriveTag').textContent = `得候选 ${p.revisions.length} 条`
        + (p.notes.length ? `，另有 ${p.notes.length} 条判为「规则没错、是解读用错了」` : '')
        + (p.dropped.length ? `，丢弃 ${p.dropped.length} 条无效项` : '');
      await renderRevisions();
    } catch (e) { $('revDeriveTag').textContent = '反推失败：' + (e.message || e); }
    finally { if ($('revDeriveBtn')) $('revDeriveBtn').disabled = false; }
  }

  async function adoptRevision(i) {
    const rv = _revCandidates[i]; if (!rv || !RV) return;
    const list = await getRevisionList();
    const rec = RV.adopt(rv, new Date().toISOString());
    const at = list.findIndex(x => x.id === rec.id);
    if (at >= 0) list[at] = rec; else list.push(rec);
    await saveRevisions(list);
    _revCandidates.splice(i, 1);
    await renderRevisions();
  }
  async function deleteRevision(i) {
    const list = await getRevisionList();
    if (!list[i]) return;
    if (!confirm('删除这条修订？之后解读将恢复按纲要原样。')) return;
    list.splice(i, 1); await saveRevisions(list); await renderRevisions();
  }
  async function toggleRevision(i, on) {
    const list = await getRevisionList();
    if (!list[i]) return;
    list[i].enabled = !!on; await saveRevisions(list); await renderRevisions();
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
      await renderCaseViews(); await rebuildOverlay();
      if (_caseTab === 'stats') await renderStats();
    } catch (e) { $('caseCountTag').textContent = '导入失败：' + e.message; }
  }

  /** 占类实时预览：在提问处就把「本次会按哪个占类断」摆出来，并说明是谁定的。
   *  实测里最贵的一类错就是占类判错——错了则用神、规则、判读整套都错，事后无从补救。 */
  /**
   * 占类的**唯一**解析口径——预览与真跑必须共用它。
   *
   * 实测过的 bug：此前两处各写各的。预览调 `classifyQuestion(q, fb)`（它认 fb，
   * 会听用户的），真跑调 `buildPrompt(pan, q, {fallbackCategory})`——而引擎的
   * buildPrompt **只认 opts.category，不认 opts.fallbackCategory**（后者仅
   * classifyQuestion 认）。于是用户选了「学业」，界面明明写着「按 功名 断（你指定的）」，
   * 整篇却仍按 求财 断，连用神都取的求财那套。选错占类是最贵的一类错，
   * 而这个 bug 让「选对」这件事根本做不到。
   *
   * 口径：占类下拉选了 → 显式；留「自动判定」→ 才交给关键词。
   * Phase 22 之前还有第二个入口（排盘栏的「目的」下拉），它与占类下拉两处并存、
   * 语义又不完全一样，是实测里误导过人的地方；那个下拉已撤，此处只认一个来源。
   */
  function resolveCategory() {
    const uiPick = ($('aiDomain') && $('aiDomain').value) || '';
    // 按盘别解析：界面「失物」在飞盘上即引擎的「寻物」
    const cat = uiPick && YS && YS.toEngineCategory ? YS.toEngineCategory(uiPick, school) : '';
    return {
      explicit: !!cat,
      uiPick: uiPick,                                  // 界面选项原值（如「股市」）
      category: cat,                                   // 显式时用它**硬指定**引擎占类（如「求财」）
      source: uiPick ? 'ai' : 'auto'
    };
  }

  /**
   * 本盘别不支持的占类，在下拉里就标出来——**选之前**就看得见，
   * 比选完再告诉他「其实没生效」要好。飞盘不认「事业」、转盘不认飞盘专有的追捕/讨债等即属此列。
   */
  function markUnsupportedDomains() {
    if (!YS || !YS.categoryMap || !YS.isLoaded || !YS.isLoaded()) return;   // 数据没到位就先不标
    const sch = school === 'feipan' ? 'feipan' : 'zhuanpan';
    const schName = sch === 'feipan' ? '飞盘' : '转盘';
    [...($('aiDomain') ? $('aiDomain').options : [])]
      .forEach(o => {
        if (!o.value) return;
        const base = o.dataset.base || (o.dataset.base = o.textContent.replace(/（.*不支持）$/, ''));
        const m = YS.categoryMap(o.value, sch);
        o.textContent = m.engineSupported ? base : base + '（' + schName + '不支持）';
      });
  }

  function previewDomain() {
    const sel = $('aiDomain'), tag = $('aiDomainTag');
    if (!sel || !tag) return;
    const q = ($('aiQuestion') && $('aiQuestion').value || '').trim();
    const builder = school === 'feipan' ? QM.feipanPredict : QM.zhuanpanPredict;
    if (!builder || !builder.classifyQuestion) { tag.textContent = ''; return; }
    const rc = resolveCategory();
    let cat = rc.category;
    // 只有真「自动」时才让关键词说话；显式选择直接就是结论，不再过一遍分类器——
    // 过了反而给了它推翻用户的机会，那正是此前那个 bug 的来路
    if (!rc.explicit) {
      try { cat = (builder.classifyQuestion(q, '综合') || {}).category || ''; } catch (e) { cat = ''; }
    }
    if (!q) { tag.innerHTML = '<span class="muted">（填了问句才能判占类）</span>'; return; }
    // 三层一次说清：引擎认不认（分盘别）、规则有没有专条。任一层降级都必须看得见——
    // 静默降级是此前最伤的一类问题：界面写「你指定的」，实际那个选择根本没生效。
    // 同上：预览也须按界面选项解析，否则显示的规则占类与真跑不一致
    const m = (YS && YS.categoryMap)
      ? YS.categoryMap(rc.uiPick || cat, school === 'feipan' ? 'feipan' : 'zhuanpan') : null;
    let notes = '';
    // 知识库还没到位就不下结论——宁可少说一句，也不说错
    if (m && m.loaded === false) notes = '';
    else if (m && !m.engineSupported) {
      notes += '<br><b style="color:#a94442">⚠ ' + (school === 'feipan' ? '飞盘' : '转盘')
        + '不支持「' + esc(m.unsupportedName || m.engineCategory) + '」占类，本次会落回「' + esc(m.degradedTo)
        + '」且取不到专用用神。</b><span class="muted">' + esc(m.degradeWhy) + '</span>';
    }
    else if (m && m.engineSupported && !m.hasDedicatedRules && !m.isZongHe) {
      notes += '<br><span class="muted">用神按「' + esc(m.engineCategory) + '」取；象义规则库暂无此占类专条，'
        + '判读退用通用占类 <b>' + esc(m.ruleLabel) + '</b>——是规则未建，不是判错。</span>';
    }
    // 终身局按出生年月日时起盘（Phase 42，用户所定）：选了就提醒改排盘时间——用占时起的盘断不了一生
    if (m && m.engineSupported && m.ruleDomain === 'lifetime') {
      notes += '<br><b style="color:#8a6d3b">⚠ 终身局须按出生年月日时起盘：请把上方排盘的日期、时间改成命主的出生时间再排一次。</b>'
        + '<span class="muted">年命不选时自动取本盘年柱。</span>';
    }
    tag.innerHTML = '→ 本次按 <b>' + esc(cat || '综合') + '</b> 断'
      + (rc.source === 'ai' ? '<span class="muted">（你指定的）</span>'
        : rc.source === 'purpose' ? '<span class="muted">（据排盘「目的」）</span>'
          : '　<b style="color:#8a6d3b">⚠ 据问句关键词自动判定，请核对</b>')
      + notes;
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
        markUnsupportedDomains(); previewDomain();
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
      // 引擎对占类的支持分盘别，换派之后下拉里的「不支持」标记与预览都要重算
      markUnsupportedDomains(); previewDomain();
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
      if ($('caseEvalBtn')) $('caseEvalBtn').addEventListener('click', renderEvalReport);
      $('caseTabSeg').addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-tab]'); if (!b) return;
        _caseTab = b.dataset.tab;
        [...$('caseTabSeg').children].forEach(x => x.classList.toggle('on', x === b));
        $('caseListView').style.display = _caseTab === 'list' ? 'block' : 'none';
        $('caseArchiveView').style.display = _caseTab === 'archive' ? 'block' : 'none';
        $('caseStatsView').style.display = _caseTab === 'stats' ? 'block' : 'none';
        $('caseRevView').style.display = _caseTab === 'revisions' ? 'block' : 'none';
        if (_caseTab === 'archive') { _archShown = PAGE_SIZE; await renderArchive(); }
        if (_caseTab === 'stats') await renderStats();
        if (_caseTab === 'revisions') await renderRevisions();
      });
      // 反馈与删除用事件委托：列表是动态重绘的，逐个绑定会在重绘后失效
      const onCaseClick = async (e) => {
        const more = e.target.closest('button[data-more]');
        if (more) {
          if (more.dataset.more === 'pending') { _pendShown += PAGE_SIZE; await renderCases(); }
          else { _archShown += PAGE_SIZE; await renderArchive(); }
          return;
        }
        const f = e.target.closest('button[data-archfilter]');
        if (f) { _archFilter = f.dataset.archfilter; _archShown = PAGE_SIZE; await renderArchive(); return; }
        const open = e.target.closest('button[data-open]');
        if (open) { await openReview(open.dataset.open); return; }
        const del = e.target.closest('button[data-del]');
        if (del && confirm('删除这条案例？删除后它不再计入统计。')) {
          await store.remove(del.dataset.del);
          await refreshCaseCount(); await renderCaseViews(); await rebuildOverlay();
        }
      };
      $('caseListView').addEventListener('click', onCaseClick);
      $('caseArchiveView').addEventListener('click', onCaseClick);
      $('caseArchiveView').addEventListener('input', async (e) => {
        if (e.target.id !== 'archSearch') return;
        _archQuery = e.target.value; _archShown = PAGE_SIZE;
        await renderArchive();
      });
      refreshCaseCount(); renderCaseViews(); loadRevisions();
    }
    if ($('aiRawToggle')) {
      $('aiRawToggle').addEventListener('click', () => { _answerShowRaw = !_answerShowRaw; paintAnswer(); });
    }
    // 占类下拉：选项直接写在 index.html 里（从前是启动时从排盘栏「目的」下拉搬过来的，
    // 那个下拉已撤，再搬就搬空了）。改占类要连带重画「分析与建议」——用神是按目的取的，
    // 从前得回头再按一次「排盘」才更新，等于把这件事推给了用户。
    if ($('aiDomain')) {
      $('aiDomain').addEventListener('change', previewDomain);
      $('aiDomain').addEventListener('change', refreshAnalysisForPurpose);
      if ($('aiQuestion')) $('aiQuestion').addEventListener('input', previewDomain);
      markUnsupportedDomains();
      previewDomain();
      // 占类三层解析要读知识库，而知识库原先只在点 AI 时才懒加载——
      // 于是首屏的下拉标记与预览全是在数据缺席下算出来的（且当时还给出了确定结论）。
      // 这里提前把它拉起来，加载完再重算一次。失败也无妨：上面两处会自行判断数据是否到位。
      loadKnowledge().then(() => { markUnsupportedDomains(); previewDomain(); })
        .catch(() => {});
    }
    if ($('cfgProbeBtn')) $('cfgProbeBtn').addEventListener('click', async () => {
      const btn = $('cfgProbeBtn'), out = $('cfgProbeOut');
      btn.disabled = true; out.textContent = '自检中…';
      try {
        const rows = await LLM.probe(t => { out.textContent = t; });
        // 三态而非两态：HTTP 通了却没吐出正文，既不是 ✅ 也不是 ❌，
        // 它恰恰是「答案空白／写一半就断」的现场，必须单独看得见。
        out.textContent = rows.map(r =>
          `${r.ok ? (r.warn ? '⚠' : '✅') : '❌'} ${r.step}（${r.mode}）　HTTP ${r.status || '—'}　${r.ms}ms\n    ${r.detail}`
        ).join('\n') + '\n\n✅ 通且有正文　⚠ 通但没正文　❌ 没通。把这一段原样发给开发者，比「暂时失败」有用得多。';
      } catch (e) { out.textContent = '自检本身出错：' + e.message; }
      finally { btn.disabled = false; }
    });
    document.querySelectorAll('[data-listmodels]').forEach(b =>
      b.addEventListener('click', () => listModelsFor(b.dataset.listmodels, b)));
    loadCfgForm();
    cast();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
