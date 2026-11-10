/**
 * 奇门·AI 解读的共用编排（Reading）。【Phase 45】
 *
 * 这里的内容原在 app.js 的 runAI 里：知识库加载、各层分析的先后编排、证据包、
 * 两段纪律、转盘日干/时干/年命落宫段、收尾锚。原样搬出，一字未改，
 * 为的是让「奇门穿壬」也能调同一份，而不是在那边另抄一份再各自走样。
 * 搬出前后，本 app 发给模型的 system 与 user 逐字相同（48 组盘与问句比对）。
 *
 * 用法（浏览器）：各 core 模块与 engine.bundle.js 先载入，再载入本文件。
 *   QimenReading.loadKnowledge({ base })      载入 knowledge/*.json；base 为路径前缀（穿壬用 vendor/qimen-pwa/）
 *   QimenReading.evidenceFor({...})           排各层分析并组证据包 → { evBlock, sysExtra, runOut }
 *   QimenReading.riShiGanBlock(pan, 年命)      转盘：日干/时干/年命落宫段
 *   QimenReading.tailAnchor(问句, rc, catMap)  收尾锚
 *   QimenReading.AI_DISCIPLINE / EVIDENCE_DISCIPLINE
 * 各模块在调用时才从全局取，缺哪一层就少哪一段，其余照旧。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else root.QimenReading = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  const mods = () => ({
    QM: root.QM, YS: root.YongShen, XY: root.XiangYi, TM: root.Timing, LX: root.LeiXiang, SV: root.Severity,
    CV: root.Converge, YJ: root.YinJu, GJ: root.GeJu, SG: root.ShiGe, QS: root.QuShu, FR: root.Framing,
    WX: root.WuXing, CB: root.Casebook, EV: root.Evidence
  });
  // riShiGanBlock 只用到引擎的九宫表；调用时才取，函数体照原样不动
  const QM = { get JIU_GONG() { return (root.QM || {}).JIU_GONG || {}; } };
  /* ---------- 结构化知识库（象义 + 占类用神） ---------- */
  // 两份 JSON 随 SW 预缓存，离线可用。加载失败不是致命错误：
  // 证据层只是"增益"，缺失时 runAI 自动退回原有的纯文本纲要流程，功能不减。
  let _kbReady = false;
  let _rulesReady = false;      // 象义规则库单独计：它缺席只减 READING，不该拖垮整个证据层
  let _timingReady = false;     // 应期规则库同理：缺席只减 TIMING
  let _leixiangReady = false;   // 类象库同理：缺席只减类象用神，占类用神照常
  let _severityReady = false;   // 力量校验库同理：缺席只减禁令段
  let _convergeReady = false;   // 维度表同理：缺席只减合流段
  let _yinjuReady = false;      // 吟局规则库同理：缺席只是不判伏吟反吟，不影响其余各层
  let _gejuReady = false;       // 81 格表同理：缺席只是不带格之断语
  let _shigeReady = false;      // 时格规则库同理：缺席只是不判五不遇时与天显时格
  let _qushuReady = false;      // 取数规则库同理：缺席只是退回原状（用神宫河图数仍由 TIMING 承载）
  async function loadKnowledge(opts) {
    const { YS, EV, XY, TM, LX, SV, CV, YJ, GJ, SG, QS } = mods();
    const base = (opts && opts.base) || '';
    if (!YS || !EV) return false;
    const get = (p) => fetch(base + p).then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)));
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
    // 类象库同样单独计：它缺席只减类象用神，占类用神与引擎用神照常
    if (_kbReady && LX && !_leixiangReady) {
      try { _leixiangReady = LX.load(await get('knowledge/leixiang.json')); }
      catch (e) { console.warn('[leixiang] 类象库加载失败，本次不取类象用神：', e.message); _leixiangReady = false; }
    }
    // 力量校验库同样单独计：缺席只减禁令段，力量数据仍由 wangshuai 块承载
    if (_kbReady && SV && !_severityReady) {
      try { _severityReady = SV.load(await get('knowledge/severity-rules.json')); }
      catch (e) { console.warn('[severity] 力量校验库加载失败，本次不作力量校验：', e.message); _severityReady = false; }
    }
    if (_kbReady && CV && !_convergeReady) {
      try { _convergeReady = CV.load(await get('knowledge/dimensions.json')); }
      catch (e) { console.warn('[converge] 维度表加载失败，本次不作证据合流：', e.message); _convergeReady = false; }
    }
    if (_kbReady && YJ && !_yinjuReady) {
      try { _yinjuReady = YJ.load(await get('knowledge/yinju-rules.json')); }
      catch (e) { console.warn('[yinju] 吟局规则库加载失败，本次不判伏吟反吟：', e.message); _yinjuReady = false; }
    }
    if (_kbReady && GJ && !_gejuReady) {
      try { _gejuReady = GJ.load(await get('knowledge/geju-81.json')); }
      catch (e) { console.warn('[geju] 81 格表加载失败，本次不带格之断语：', e.message); _gejuReady = false; }
    }
    if (_kbReady && SG && !_shigeReady) {
      try { _shigeReady = SG.load(await get('knowledge/shige-rules.json')); }
      catch (e) { console.warn('[shige] 时格规则库加载失败，本次不判时格：', e.message); _shigeReady = false; }
    }
    // 取数库同样单独计：缺席只是没有宫数一路，用神宫河图数仍由 TIMING 段承载，取数不至于断炊
    if (_kbReady && QS && !_qushuReady) {
      try { _qushuReady = QS.load(await get('knowledge/qushu-rules.json')); }
      catch (e) { console.warn('[qushu] 取数规则库加载失败，本次取数只有河图数一路：', e.message); _qushuReady = false; }
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
    '4.1 年命宫=该人出生年之**天干**在天盘所落之宫。**年命、日干为甲者，甲不上天盘，须按其本年、本日之甲所遁之仪取宫：甲子→戊、甲戌→己、甲申→庚、甲午→辛、甲辰→壬、甲寅→癸**（如甲子年生人看天盘戊落宫，甲午日之日干看天盘辛落宫）。**不得以本盘旬首或值符代之**——本盘旬首随占时而变，年与日不随之变；惟**时干**为甲者以值符落宫论（甲X时之旬首即甲X本身）。见纲要一节「甲干不上天盘」条。问句中涉及多人（候选人、对手、家人）并给出生年者，各人年命一律照此取宫；只知「甲年」不知年支者，写明无法定宫，不得硬取。',
    '5. 推理要一步步写清"为什么"，把纲要规则套到本盘的具体元素上，避免只下结论不给过程；衍象须落到具体的人/物/事/方位/时机，不停在抽象吉凶。',
    '6. 趋避建议须由盘面推出、具体可行（往何方位、何时机、借何门何神之象、忌何宫），并注明所据宫位；不写与本盘无关的泛泛套话与免责声明。',
    '7. 纲要与盘面确未直接载明处，可据纲要衍象作合理延伸并标注「（据×宫×象推）」；仅在毫无盘面依据时才写「纲要未载，不予推断」，不得以此搪塞本可分析之处。',
    '【结构——每节都要展开充分，理由部分尤须详尽】',
    '8. 按骨架输出：① 结论（一句断吉凶成败）② 用神与关键宫位逐宫详析 ③ 生克成败推理 ④ 方位 ⑤ 应期/数字 ⑥ 趋避建议。',
    '8.1 第②节的「用神」不止值符/值使/日干宫/时干宫：**所问的具体人事物本身也要取一个用神**——'
      + '测钱财取戊(财货)、测钥匙首饰取辛(金刃/首饰)、测车取伤门(车)、测丧葬坟墓取死门(死丧/坟)、'
      + '测文书证件取丁(文书)或景门、测病取天芮(病符)、测妻取乙、测夫取庚……依二节表尾'
      + '「衍象类象：人/物/事各取对应符号(见第四节)，落宫定方位、临神临门定性质」。'
      + '取定之后与占类用神一同逐宫展开，并写明取的是哪个象、据四节哪一条。（此为转盘法；飞盘按《鸣法·用神章》固定取用。）',
    '9. 应期一节须落到**与所问远近相称的那一级**：近事给到日并尽量给到时辰（几点到几点），中事给到月（并注明节气区间），远事给到年（并注明生肖与约略公历年）。只给一个笼统的「某日」而不说是哪一天、或问的是几个月后的事却只答某日，都算没答。'
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
    'E19. 证据包若给出【证据合流】，其档位是**硬约束**：A级可写进结论；B级只能作次要可能且须并列写出；'
      + 'C级只能标「参考」；**D级与「须弃权的维度」不得出现在结论里**。'
      + '凡被判为弃权的维度（方位/场所/高低/显隐等），请照实写「此项证据不足，不锁定」——'
      + '**不要凭一条孤证编出一个确指**。实测里最伤的一次：凭「离九＝明亮处」一条孤证断成'
      + '「正南明亮处、炉灶电器旁」，而实物在床下、被衣物压住；同盘的九地(藏纳)、杜门(隐藏)'
      + '三路指向「藏」，反倒没被采信。',
    // Phase 14/15：吟局与八十一格。此前两层的内容都进了证据包，却没有任何一条 E 规则
    // 叫模型必须用它——力量校验有 E9a、证据合流有 E19/E20，这两层是空的。
    'E21. 证据包若给出【伏吟／反吟】，先据它定「事动不动」，再谈成败：'
      + '**伏吟局**（星、门俱归本位）主静——事在原处不动、久拖难成、进展迟滞，'
      + '不得写成「近日可成/进展顺利」；宜守成、宜就近、宜循旧例的话要说出来。'
      + '**反吟局**（星、门俱落对宫）主动荡反复——纵然应验亦「速而不久」，'
      + '不得断为定局，须写明其反复之性。'
      + '未成局者（只星或只门、或只若干宫）**不得以局论**，只在所命中之宫上说。'
      + '各条已标出处等级：〔纲要原文〕与〔用户所定〕不可等同看待，'
      + '引用时请说明该条依据来自哪一级。',
    'E22. 证据包若给出【八十一格】，用神宫与关注宫之格名与断语须落到解读里，'
      + '不得只报格名而不说其义（此前正是如此：提示词里只有「日奇伏吟」四个字，模型无从用起）。'
      + '两条硬约束：① **格之名不等于宫之吉凶**——某宫格名凶而引擎判该宫吉，或反之，'
      + '都要照实并陈，不得拿格名去覆盖宫位吉凶，也不得反过来；'
      + '② 标「引擎作『×』，两说并存」者，是本表与引擎命名不同的 20 格之一，'
      + '**不要只挑一个说成定论**，如该格对结论要紧，请说明两说并存。',
    'E23. 证据包若给出【时格】，那是**几率上的倾向，不是禁令、不是定论**，与【力量校验】的硬约束'
      + '性质不同，不可当成同一类东西用。**五不遇时**只提高事难成之几率，不等于此事必不成——'
      + '全盘明显有力时，不得因这一条就翻成凶断。**天显时格分量最轻**，用户给这一条时明言'
      + '「吉的几率不显着」，故**不得据它加重吉断**，更不足以支撑「可成／顺利」一类结论。'
      + '另有两条：① 本仓**从未测过**时格与实际应验率的关系，故不得说「此类盘更准／更不准」，'
      + '也不得据时格调整你对自己判断的把握度；② 时格**可解与否本仓未收录**，不要自行搬用'
      + '「得三奇可解」之类说法——没收录就是没有，宁可不说。',
    // Phase 20：股市占类。以下四条**出自用户所供原文自带的戒律**，不是外加的免责声明。
    'E24. 占类为**股市**时，原文自带的四条戒律与判读同等要紧，逐条照办：'
      + '① **一卦一事**——一局只测大盘，或只测单一支股票；'
      + '**不得在同一局里同时研判多只个股**（原文：气机混杂，信息互相干扰，论断便会失真）。'
      + '问句若含多个标的，先说明本局只能答其中一个，请对方另起一局。'
      + '② **不锁定点位**——原文：「奇门可以研判一时气机的强弱，却不能精准锁定某一只个股、'
      + '某一日的涨跌点位。一局只能看清大势的倾向，并不是一张稳赚不赔的藏宝图。」'
      + '故取数只给**大概区间与方向**（旺相取大数、休囚取小数），**不得报出具体点位或精确涨跌幅**。'
      + '③ **不作投资建议、不承诺获利**——原文：「勿以一局，而赌千金之利」「术数，是观天时、'
      + '察进退的参考，绝非投机赌博的利器」。不得出现「建议买入/卖出/加仓/满仓」一类操作指令，'
      + '不得承诺收益，须提示风险自负。'
      + '④ 见**伏吟局**则言震荡磨底、久盘不动，频繁交易徒增损耗；见**反吟局**则言暴涨暴跌，'
      + '极易追高被套——这两条与【伏吟／反吟】段的判定联读。',
    // Phase 21：取数纪律。起因是一例高考分数断错（断 560～580、实际 620）——问题不在算错，
    // 而在数源只有河图数一路，且没人被要求先声明取数法。这两条把「先声明」和「报可达数」写死。
    'E25. 证据包若给出【取数】，凡答数字（分数/价格/点位/数量/号码/层数），**必须先声明四件事再给数**：'
      + '①取哪个（哪些）用神；②用它的哪个数源（天盘干河图数／地盘干河图数／后天宫数／先天卦数）；'
      + '③用哪种组合法（单取／两干相加／乘宫数·层数／连读）；④落在哪个量级，量级的依据是问题里的哪句话。'
      + '四件事写在数**之前**——先给数再回头挑一条算法圆回去，是本条要禁的唯一那件事。'
      + '出处不得混称：河图数、单取、相加、旺相足数/休囚减半、乘宫数出自纲要原文；'
      + '**后天宫数作独立候选、先天卦数、连读、定量级四条出自〔用户所定·2026-09-03〕，纲要无此文**，'
      + '用了就要写明是按用户所定之法。',
    'E26. 【取数】段会报出「本盘可达 N 个相异数值」。给出答案后须一并说明：在这 N 个候选里凭什么选中它。'
      + '理由若只是「它最接近某个已知值／最像正确答案」，那不是断，是拟合——此时应当直说**此盘取数无据**。'
      + '**数字题允许弃权**：用神休囚入墓、或候选过多而无从取舍时，答「取数无据，只能给方向不能给数」'
      + '是正当且更可取的答法，不得硬凑一个数交差。另：宫数入候选能不能让数字题更准，'
      + '本仓一个数据都没有，**不得声称这一路更准**。',
    'E27. 宫际生克若标了「⚠ 施方…力量仅 x，此路作**虚**／**力薄**读」，照它减轻：'
      + '**不得**把一条虚克写成「直接压制」「封死上限」「彻底不成」。但减的只是**这一路**的分量——'
      + '施方无力不等于此事转吉，成败仍须以用神自身旺衰与其余各路合断，不许反过来据此翻成吉断。'
      + '此条出自〔用户所定·2026-09-03·据纲要§旺衰推〕，纲要原文只说了「该宫自身」的吉凶随旺衰增减，'
      + '推到「它对他宫的生克亦随之折减」是补的一步，不得说成纲要明文。',
    // Phase 23：两条都出自案例本导出 2026-09-07（159 例／152 回填／353 条断错分析）的复盘统计。
    // 不是我觉得该这么断，是这么断的那些例子被实况逐条驳回了。
    'E28. **旺衰与四害只论「分量」，不论「有无」。** 力量弱、空亡、入墓、击刑、门迫，说的是'
      + '「力气小、来得慢、办得费劲、吉不显凶更烈」，**不是**「这件事不会发生」「此人无恙」「该选项可排除」。'
      + '故三条硬禁：①不得以某宫力弱断「此事不具备成事之力／概率偏低／必不成」；'
      + '②**不得拿力弱或空亡去排除射覆、选择题的某个选项**；'
      + '③不得以某人年命宫力弱断其「伤情较轻／病情可控」。'
      + '这不是新立的规矩——纲要解读流程 3.5 本就写着「**吉凶定方向，旺衰定成败大小与迟速**」，'
      + '四害表通篇也是「减半／仅余两成」的分量语；把分量读成有无是用法之误。'
      + '实测：本仓 353 条断错分析里，以力量／四害为由推出「不成／排除／伤轻」者 **15 条，实况逐条相反**，'
      + '其中两条是拿力弱去排除射覆选项（实际正是被排除的那一项）、一条断车祸伤者「伤情相对可控」（实际去世）。'
      + '（「不得排除选项／不得断伤轻」这一推论为〔用户所定·2026-09-07·据案例本 15 例〕，纲要未明言。）',
    'E29. **应期实测系统性偏晚，先答「当下这一档」再谈填实冲实。** TIMING 里 `offset 0` 的锚点'
      + '（写作「即今日」「即当下这个时辰」「即本月建」）是**正当候选**，不是占位符。'
      + '空亡「须待填实／冲实方应」是纲要对**应期**之说，不是「此刻不能应」的禁令；'
      + '入墓「待冲墓」、伏吟「主静」同理。'
      + '实测：本仓可判方向的应期错例中，**断得比实际晚者 12 例、早者 1 例**——猫当天下午就找回而断「5–10 日」、'
      + '摇号当天就成而断「戌月」、绩效数日内到账而断「子月」、餐饮店 3 月就关门而断「10 月」。'
      + '故：问「今天／现在／这两天」的近事，**先看有没有 offset 0 或最近一两位的锚点能答**，'
      + '答得了就先答它；确要断到填实／冲实那一档，须说明为何不是更早。'
      + '（偏晚这一实测结论为〔用户所定·2026-09-07·据案例本 12:1〕，纲要只写了填实冲实之法，未言早晚。）',
    // Phase 38：出自案例本导出 2026-10-05（396 例／379 回填）逐例判读实况。问「怕发生之事」的
    // 那一类，解读分远低于其余，且错的方向一边倒——不是规则错，是没分清 [助] 助的是谁。
    'E30. **先定问句方向，再读 [助]/[阻]。** 证据包若有「⚠ 问句方向」一行，所问之事是求测人'
      + '（或所问之人）**不愿其发生**之事（被抓、被罚、被举报、裁员、出事、复发、会漏、倒闭……）。此时：'
      + '① READING 的 [助]/[阻] 与倾向计数说的是**此事得成／不成**，对求测人的吉凶**恰好相反**，'
      + '不得把 [助] 写成「对你有利」、把 [阻] 写成「对你不利」；'
      + '② 时干宫即这件怕发生之事。纲要「时干宫空亡主事虚悬待填实」「用神空亡：所问之事多虚」在此读作'
      + '**所怕之事虚悬、未成形**；「日干宫克时干宫→我能制事」读作我制得住此事；「时干宫克日干宫→事制我」'
      + '读作此事伤我；「时干宫生日干宫→事来就我」读作此事**找上门来**——于所怕之事是凶，不是「易成」之吉；'
      + '③ **凶门、凶星、凶神落时干宫，只说明所问之事本身是件凶事——那是题面已知的，不是它会发生的证据。**'
      + '会不会发生，要看时干宫的虚实（空亡、入墓、旺衰）与日时生克，并把所据写出来；'
      + '④ 断「会发生」之前，须先说明为何不读作虚悬——只凭凶象叠加断「必发」，正是这类题的主错。'
      + '实测：本仓是非题里此类 18 例，所怕之事**实际发生的只有 7 例**；解读加权分 0.36（盼发生之事 181 例为 0.52）；'
      + '断错者 **6 例断「会发生」而实际没发生**（举报、被抓、投诉、出问题、处分、裁员），3 例相反。'
      + '（②的换算为〔本层归纳·据纲要一节生克原句〕，纲要未就「怕发生之事」另立条文，**本仓未测过它准不准**；'
      + '实测数为〔据案例本导出 2026-10-05·18 例〕，样本小，只作纠偏之据，不作概率用。）',
    // Phase 42：终身局、异梦两个占类，取用为〔用户所定·2026-10-25〕（转盘纲要无原文）。
    'E31. 占类为**终身局**或**异梦**时（取用皆为〔用户所定·2026-10-25〕，转盘纲要无此二占类原文，引用时须说明）：'
      + '【终身局】① 本盘按**出生年月日时**起，年命宫＝命主一生之象，为主用神；分项借纲要二节各占类之用神：'
      + '事业看开门、财看生门、婚姻男看乙女看庚（据问句定男女，定不了就两条都说并写明）、健康看天芮、学业看景门、贵人看值符，'
      + '各以其宫与年命宫的生克盗泄论得失。② **应期一律按「年」断**：TIMING 的「第 N 年后」是从**出生那年**起算，'
      + '须换算成公历年份并注明虚岁；问过去之事答过去，问将来只取今年以后的那一个，不得把「第 N 日后」当成从今天算。'
      + '③ **不断寿元、死期**，不作「注定」「一辈子都不会」一类宿命论断语。'
      + '【异梦】① 以腾蛇为主用神（纲要原文仅「腾蛇(凶)：虚惊怪异」），先分两路：腾蛇宫实（不空）且克日干、或逢死门白虎者，'
      + '方说「确有其扰」；腾蛇空亡、日干空亡（纲要：日干宫空亡主自身心神不定）、天芮临日干者，先往睡眠、情绪、身体上断。'
      + '② **不得断定「必是鬼神作祟」**，不劝人花钱做法事、买符化解；趋避只给作息、环境、就医一类具体可行之议。'
      + '③ 两占类的判读条目标〔用户所定〕者是用户采纳的草案，不得说成纲要原文。',
    'E20. 数证据数的是**互不相干的路数**，不是象义条数。同一个元素的多个别名（如玄武的'
      + '「盗/失物/暗昧/欺诈」）只算**一路**；五条同源的话不等于五路旁证，不得据此说「多重印证」。',
    // Phase 9：力量校验与断语范围。以下四条全部出自实测案例本的失败复盘，逐条对应一类真实误判。
    'E9a. 证据包若给出【力量校验】，其中每一条**禁令都是硬约束**，逐条照办。'
      + '尤其：引擎判某宫为「吉」而该宫力量不足时，**不得**据以写「有转机/可成/可控/无碍」；'
      + '「衰死又入墓」者**不可强断为吉**。纲要原话：吉凶定方向，旺衰定成败大小；**不可只看吉凶不看旺衰**。'
      + '实测吃过亏：某宫引擎判「小吉」而力量仅 0.08（门迫+入墓），解读照断「病有转机」，次日即噩耗。',
    'E9b. **生克关系只断成败向背，不断迟速、不断幅度、不断程度。**'
      + '「日干宫克时干宫→我能制事、谋为可成(但费些气力)」说的是**能不能成**，不是「会延误」「要久等」'
      + '「幅度不大」「只是小胜」。迟速另有其法（应期一节：得令旺相则应速，休囚墓绝则应迟），'
      + '大小与程度看旺衰力量。实测中这条被反复误用：断「延误概率极高」实际准点、断「需耐心等待」'
      + '实际一小时即好、断「微降」实际大降、断「小胜」实际平局。',
    'E9c. 时干宫代表的是**本次所占的那一件事**。问句若含多件事（如既问通话能否接通、又问某人病情），'
      + '须先点明时干宫所主是哪一件，**其结论不得跨到另一件上**。'
      + '实测吃过亏：时干宫断「事在掌握之中」本指通话可成，却被写成「病情在掌控之中」。',
    'E9d. 凡问病情、安危、生死一类，**不得作宽慰之辞**：不得断「医疗手段有效」「病有转机」「可控」，'
      + '除非盘上确有明证且须同时写出凶象；见凶象叠加或力量极弱时必须照实写重。'
      + '同时仍不得作医学诊断（不说患何病、不劝停药、不劝不就医）——两个方向都要守住。'
      + '亦不得以「可待某日再占」代替本次该给的判断：那是回避，不是回答。',
    // Phase 8：类象用神。用户实测反馈——「用神与关键宫位逐宫详析」永远只写值符值使日干时干，
    // 所问的那件东西（钥匙、钱、尸体…）在解读里根本没有代表。纲要二节表尾本就写了要取象。
    'E10b. 证据包若给出【类象用神】，「② 用神与关键宫位逐宫详析」一节**必须把每一个类象用神的落宫也逐一展开**——'
      + '读其星/门/神/天地盘干、旺衰四害、与年命(或日干)的生克盗泄，并据其落宫定方位与场所。'
      + '只写值符、值使、日干宫、时干宫而略过所问之物本身，算没答。'
      + '类象用神与占类用神**并列合参**，不相取代；标〔本层归类〕者可用，但须写明是按该类归的，不要说成纲要原文如此。'
      + '标「盘上未见」者按未见论，不得代为安置落宫。',
    'E10c. 证据包若说【类象用神】未匹配到类象词，**不等于盘上没有此物**：请你自行按转盘纲要四节'
      + '（九星/八门/八神/十干）为所问之人/物/事取象为用神，并写明「取×为用神，据四节×象」。'
      + '不得因索引未匹配就略过这一步，也不得凭空指派纲要未载之象。',
    'E11. 【关注点与权重】的 ★ 决定着墨详略：★★★★★ 者须逐条展开，★★ 者点到为止，不要平均用力。标为「盘上未见」者按未见论。',
    'E12. 若证据包声明本占类「规则未建」，那是应用尚未收录该占类规则，**不等于盘上没有阻碍**；此时按《解断方法纲要》正常推断，不得以"未见判读"为由声称一切顺遂。',
    // Phase 4/7：应期锚点。要点是"只在候选里选"与"先定远近再定单位"——这两处一旦被误读，应期就会重新开始瞎猜。
    'E13. 断应期只许在 TIMING 所列锚点中选取，不得自造日辰；其干支与上方 yingqi 同源，二者不是两套推算，不要并列陈述或相互印证。填实/冲实/冲墓/马星取的是**地支**，宫干定日取的是**天干**，两者不可互换。',
    'E14. TIMING 已把每个候选折成具体时点（第 N 日后 = 某年某月某日、第 N 个时辰后并附钟点、第 N 个月后并附节气区间、第 N 年后并附生肖与约略公历年），**照用即可，不必也不要另行换算**。但要分清：「这个候选下次何时到来」是历法事实，「事情是否应在那时」才是你的判断——后者须结合旺衰、格局与问事性质，不得把前者直接说成后者。',
    'E15. **先看用户问的是多远的事，再决定按哪一级作答**：问「这两天/这几天能不能成」就断日，并进一步给时辰（TIMING 的「若断时辰」一段）；问「这两三个月」就断月（「若断月」一段）；问「今年还是明年」「哪一年」就断年（「若断年」一段）。同一批锚点按哪一级读，答案就落在哪一级——不要一律断成某日，也不要因为用户问的是远事就说「本盘只能断日」。证据包里的「本次缺省按…读」只是缺省推定，用户问题与它冲突时以用户问题为准。',
    'E16. TIMING 中带〔推及〕标记的单位，是由纲要「近事看日时、中事看月、远事看年」一条推及的，该法原文只写了日；不带标记的是纲要写这条法时就写明了这一级。两者都可用，但断语中若用了带〔推及〕者，须说明是按远近推的，不得说成该法本身如此。',
    'E17. 同一个支在时/日/月/年四级是**同一个候选的四种读法，不是四个候选**，不可分别陈述以显得处处应验。另：时辰与月建以地支命名（午时、辰月），天干在时/月/年三柱上只能说「时干戊」「月干戊」「年干戊」，**不得写成「戊时」「戊月」**；惟「戊日」是纲要原有用语，照旧。',
    'E18. TIMING 的 [★强]/[★中]/[★参考] 表示该机制与本占用神的关系强弱，不是应验概率；不得写成"某日必应"，应表述为"应期多在…"或"须待…方应"。'
  ].join('\n');
  // 转盘断局补充：日干(求测人)/时干(所占之事)/年命(求测人本命)天盘落宫。
  // 引擎序列化只给四柱与九宫干，不点明三者落宫；此处算好喂给 AI，
  // 配合纲要新增的「日干为人、时干为事」总纲落地。甲不上天盘：时干为甲以值符落宫论；
  // 日干、年命为甲按其本日、本年之甲所遁之仪取宫（纲要一节，〔用户所定·2026-09-24〕）。
  //
  // **年命宫此前是缺的**：提示词给了【求测人年命天干】，骨架与纪律又反复要求「以…对
  // 年命宫的生克盗泄定论」，却从不说年命落在哪一宫——模型只能自己去九宫表里翻那个干。
  // 肯翻的模型就论了，不肯翻的整段跳过，同一份提示词遂在不同模型上表现不一。飞盘早有
  // 【三乙四宫 + 年命宫】把它定死，转盘这一路漏了。既然日干/时干已经在这里算好，
  // 年命用同一个 fmt 一并算出即可。
  //
  // **fmt 里「以值符落宫论」那条只给时干用**：甲X时之旬首就是甲X本身，两条路恰好重合。
  // 日干、年命不行——本盘旬首随占时而变，日与年不随之变。甲日十二时辰全在甲子旬或甲戌旬，
  // 按值符取，任何甲日的日干都只会取到戊或己，甲午、甲寅之日也不例外。故日干、年命之甲
  // 按六甲遁仪取宫（甲子戊、甲戌己…）；界面上甲年须连年支一起选，只有一个「甲」则如实说定不了。
  function riShiGanBlock(pan, nianMingGan) {
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
    // 六甲遁六仪。与 core/yongshen.js、engine.bundle.js 各一份，由 core/nianming.test.js 钉在一起。
    const LIU_JIA_DUN = { 甲子: '戊', 甲戌: '己', 甲申: '庚', 甲午: '辛', 甲辰: '壬', 甲寅: '癸' };
    const nm = String(nianMingGan || '').trim();
    const nmIsJia = nm.charAt(0) === '甲', nmYi = nmIsJia ? LIU_JIA_DUN[nm] : '';
    const nmOk = !!nm && (!nmIsJia || !!nmYi);   // 年命确能定宫
    const riYi = riGan === '甲' ? LIU_JIA_DUN[sz.day] : '';
    const lines = ['', nm ? '【日干/时干/年命落宫（转盘断局补充）】' : '【日干/时干落宫（转盘断局补充）】',
      riYi ? fmt(`日干(求测人)${sz.day}遁于`, riYi) : fmt('日干(求测人)', riGan),
      fmt('时干(所占之事/对方)', shiGan)];
    if (nm && !nmIsJia) lines.push(fmt('年命(求测人本命)', nm));
    else if (nmYi) lines.push(fmt(`年命(求测人本命)${nm}遁于`, nmYi));
    else if (nmIsJia) lines.push('  - 年命(求测人本命)甲：甲不上天盘，须按本年之甲所遁之仪取宫（甲子戊、甲戌己、甲申庚、甲午辛、甲辰壬、甲寅癸）；'
      + '本次未给年支，无法定位。**不得以本盘旬首或值符代之**——那条只管日干、时干。');
    // 末行点名年命宫，故只在年命确有落宫时才提它——否则又成了「点名却不给」。
    lines.push(nmOk
      ? '请按纲要「日干为人、时干为事」：先审时干宫对年命宫(求测人本命，优先于日干宫)的生克盗泄定成败，再合值符值使、用神宫参断。'
      : '请按纲要「日干为人、时干为事」：先审时干宫对日干宫的生克盗泄定成败，再合值符值使、用神宫参断。'
        + (nm ? '（年命未能定宫，以日干宫代年命宫）' : '（本次未提供年命，以日干宫代年命宫）'));
    return lines.join('\n');
  }

  /**
   * 收尾锚：把「你要回答的是哪个问题」再说一遍，钉在整条消息的**最末尾**。
   *
   * 起因是用户报「Gemini 与自定义端点的解读，前者更贴题」。实测把两路请求体逐字比对，
   * system 13538 字、user 14214 字**完全相同**，temperature/maxTokens 也相同——
   * 也就是说**不是提示词的差别**，是模型本身的差别。
   *
   * 但比对时看见了一个谁都该修的毛病：占问只在 user 消息的**第 4 个字**出现一次，
   * 其后是一万四千字的盘面、判读、应期表，全文以一串「组合关键词池」收尾。
   * 强模型扛得住，弱一点的模型会被末尾那堆词带偏——这正是「答得不贴题」的样子。
   * 故在末尾把问题、占类与三条最硬的约束重述一遍：**近因效应对哪个模型都成立**，
   * 强模型不受损，弱模型受益。
   *
   * 另有一层保险：Gemini 走 system_instruction，OpenAI 兼容端点走 role:"system"，
   * 后者被各家后端的权重待遇不一，个别代理甚至整个丢掉。硬约束在这里再落一次，
   * 万一 system 被轻视或丢弃，最要紧的几条仍然到得了模型跟前。
   */
  function tailAnchor(question, rc, catMap) {
    const q = String(question || '').trim();
    if (!q) return '';
    const cat = (catMap && catMap.ruleLabel) || (rc && (rc.uiPick || rc.category)) || '';
    const how = rc && rc.explicit ? '（你指定的）' : '（按问句自动判定）';
    // 前导空行不能靠数组里的 '' —— 末尾那句 filter(Boolean) 会把它们一并滤掉，
    // 结果分隔线直接黏在上一行的关键词池后面（实测输出：「…争斗、追索─────」）。
    // 故换行由 join 之后统一前置。
    return '\n\n' + ['─────────────────────────────',
      '【回到你要回答的问题】以上全部盘面与判读，都是为了回答下面这一句——不是为了复述它们：',
      '　　「' + q + '」',
      cat ? '　　占类：' + cat + how + '　取用与判读规则以本占类为准。' : '',
      '作答前自查三条：',
      '　① **直接答这句问句问到的每一件事**；问句里有几问就答几问，一件都不许略过，' +
        '也不要答它没问的（问「能不能找到」就先答能不能，问「在哪」就给方位，问「何时」就给应期）。',
      '　② 用神以上方【用神落宫】所列为准，不得另取；应期只在【应期】所列锚点中选，不得自造日辰。',
      '　③ 结论写在最前面，先给答案再给理由；理由须落到具体宫位与依据，不得只堆象义。'
    ].filter(Boolean).join('\n');
  }

  /**
   * 排各层分析并组证据包。原 runAI 中段，逻辑与先后一字未动。
   * @param a { pan, q, school, prompt, rc, catMap, nianMing, fallbackCategory, ysGongs, wsBlock, yqBlock,
   *            revisions, getOverlay, base }
   *   prompt＝引擎 buildPrompt 的结果（取其 context）；revisions＝本机修订集（可无）；
   *   getOverlay＝取经验层的异步函数（可无，无则不附经验）；base＝knowledge 路径前缀。
   * @returns { evBlock, sysExtra, runOut }  evBlock 为空即证据包不可用，调用方退回 wsBlock + yqBlock。
   */
  async function evidenceFor(a) {
    const { YS, EV, XY, TM, LX, SV, CV, YJ, GJ, SG, QS, FR, WX, CB } = mods();
    const { pan, q, school, prompt, rc, catMap, nianMing, fallbackCategory, ysGongs, wsBlock, yqBlock } = a;
    let evBlock = '', sysExtra = '';
    // 按次作用域收集本轮的结构化产物，不靠全局量（见 app.js runAI 的说明）
    const runOut = { yongshen: null, xiangyi: null, timing: null, leixiang: null, severity: null, qushu: null, wuxing: null, evidence: null, domain: '' };
    if (await loadKnowledge({ base: a.base })) {
    try {
      // 规则占类：用户显式选了就以**他选的那个**为准（catMap 已按界面选项解析），
      // 只有在「自动判定」时才从引擎按问句识别出的占类反推。
      // 若一律从引擎占类反推，「财运」与「股市」这类同走一个引擎占类的选项就分不开了。
      const domain = (rc.explicit && catMap && catMap.ruleDomain)
        ? catMap.ruleDomain
        : YS.normalizeDomain((prompt.context && prompt.context.category) || fallbackCategory);
      const yongshen = YS.resolve({
        domain, chart: pan,
        options: {
          engineYong: prompt.context && prompt.context.yong,
          nianMingGan: nianMing,
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
            revisions: a.revisions || null,   // 本机经验修订：只收窄/降权/停用，绝不新造断法
            // 传 wangshuai 的**分析结果**（非文本块）：旺衰与四害由它单一供给，
            // 象义层只读不重算，避免与 wangshuai 出现两套说法。
            wangshuai: (root.WangShuai && root.WangShuai.analyze) ? root.WangShuai.analyze(pan) : null,
            options: { school: school === 'feipan' ? 'feipan' : 'zhuanpan', nianMing: nianMing }
          });
        } catch (xe) { console.warn('[xiangyi] 判读失败，本次不含 READING：', xe.message); xiangyi = null; }
      }
      // 类象取用（Phase 8）：所问的具体人事物本身也要有一个用神，否则解读永远只在
      // 值符/值使/日干宫/时干宫几个宫里打转。转盘专有——飞盘《鸣法·用神章》按占问类型
      // 固定取用，不含类象取用，故 leixiang 自行停用。
      let leixiang = null;
      if (_leixiangReady && LX && school !== 'feipan') {
        try {
          leixiang = LX.resolve({
            question: q, chart: pan,
            options: {
              school: 'zhuanpan',
              locate: YS.locate,                       // 定宫复用 yongshen，不另写一套
              actors: yongshen.actors,
              domain, domainLabel: yongshen.label || domain,
              domainNames: (yongshen.examine || []).map(m => m.name),
              // 取到的象若正是某占类的主用神，而本次占类却落在「其他」，提示之
              domainsForHint: YS.domainIds().map(id => {
                const dd = YS.getDomain(id) || {};
                return { name: id, label: dd.label, yongshen: dd.yongshen };
              })
            }
          });
        } catch (le) { console.warn('[leixiang] 类象取用失败，本次不含类象用神：', le.message); leixiang = null; }
      }
      // 伏吟／反吟（Phase 14）：必须排在应期之前算——纲要「伏吟主静，静中以马星为动机」
      // 要由本层判出伏吟，应期层才谈得上把马星锚点升格。次序颠倒则该条又成一句空文。
      let yinju = null;
      if (_yinjuReady && YJ) {
        try {
          yinju = YJ.analyze({ chart: pan, school: school === 'feipan' ? 'feipan' : 'zhuanpan' });
        } catch (ye) { console.warn('[yinju] 伏吟反吟判定失败，本次不含吟局：', ye.message); yinju = null; }
      }
      // 应期时间线（Phase 4）：把 yingqi 已算好的干支按「与本占用神的关系」筛选、定强弱、排先后。
      // 干支一律取自上面同一份 yingqi 计算，绝不重算——两处若各推一套，模型必然选错日子。
      let timing = null;
      if (_timingReady && TM) {
        try {
          const baseGongs = (xiangyi && xiangyi.applicable)
            ? xiangyi.focus.map(f => String(f.gong))
            : ysGongs;   // 飞盘/象义层停用时退回引擎自算的用神宫
          // 类象用神的落宫也要并进来：yingqi 只为所给之宫算宫干，漏了它，
          // 「所问那件东西何时到手」就永远算不出宫干定日。
          const lxGongs = (leixiang && leixiang.applicable)
            ? leixiang.candidates.filter(c => c.located).map(c => String(c.gong)) : [];
          const ysGongsForTiming = [...new Set([...baseGongs.map(String), ...lxGongs])];
          timing = TM.analyze({
            chart: pan,
            yingqi: root.YingQi.analyze(pan, { yongShenGongs: ysGongsForTiming, domain }),   // domain：应期融合法定用神所需
            xiangyi, leixiang, yinju,
            wangshuai: (root.WangShuai && root.WangShuai.analyze) ? root.WangShuai.analyze(pan) : null,
            options: { domain, school: school === 'feipan' ? 'feipan' : 'zhuanpan', yongShenGongs: ysGongsForTiming }
          });
        } catch (te) { console.warn('[timing] 排应期失败，本次不含 TIMING：', te.message); timing = null; }
      }
      // 不传 shanxiang：山向背景与阳宅断法要求仍由 sxBlock 原样承载（那段含解读指引而不止事实），
      // 若再进证据包会造成同一内容重复入提示词。
      // 经验层（Phase 5）：把本机历史反馈里已达样本门槛的规则附一条说明。
      // 只是附注——不参与规则求值，故规则层的确定性与跨设备可复现不受影响。
      let calibration = [];
      if (a.getOverlay && CB && xiangyi) {
        try {
          const overlay = await a.getOverlay();
          calibration = CB.calibrationFor(overlay, xiangyi);
        } catch (ce) { console.warn('[casebook] 读取经验层失败，本次不附经验：', ce.message); }
      }
      // 力量校验（Phase 9）：把纲要「不可只看吉凶不看旺衰」「衰死又入墓不可强断为吉」
      // 等本就写死、却从未被执行的禁令，做成确定性检查。实测吃过亏：某宫引擎判「小吉」、
      // 力量却只有 0.08（门迫+入墓），解读照断「有转机」。
      let severity = null;
      if (_severityReady && SV) {
        try {
          const wsAll = (root.WangShuai && root.WangShuai.analyze) ? root.WangShuai.analyze(pan) : null;
          severity = SV.analyze({
            chart: pan, wangshuai: wsAll, xiangyi, leixiang, yongshen,
            yongShenGongs: ysGongs,
            options: { school: school === 'feipan' ? 'feipan' : 'zhuanpan' }
          });
        } catch (se) { console.warn('[severity] 力量校验失败，本次不含禁令段：', se.message); severity = null; }
      }
      // 证据合流（Phase 13）：数「有几路互不相干的证据指向同一结论」，据此定档与弃权。
      // 关注宫＝占类用神宫（primary，方位以它为准）+ 类象用神宫（旁证）。
      let converge = null;
      if (_convergeReady && CV) {
        try {
          const focus = [];
          if (xiangyi && xiangyi.applicable) {
            xiangyi.focus.forEach(f => focus.push({
              gong: String(f.gong), roles: [f.name + (f.aspect ? '(' + f.aspect + ')' : '')], primary: true
            }));
          } else {
            ysGongs.forEach(g => focus.push({ gong: String(g), roles: ['用神'], primary: true }));
          }
          if (leixiang && leixiang.applicable) {
            leixiang.candidates.filter(c => c.located).forEach(c => focus.push({
              gong: String(c.gong), roles: [c.symbol + '〔类象·所问「' + (c.terms || []).join('/') + '」〕'], primary: false
            }));
          }
          converge = CV.analyze({
            chart: pan, focus,
            wangshuai: (root.WangShuai && root.WangShuai.analyze) ? root.WangShuai.analyze(pan) : null,
            options: { school: school === 'feipan' ? 'feipan' : 'zhuanpan' }
          });
        } catch (ce2) { console.warn('[converge] 证据合流失败，本次不含合流段：', ce2.message); converge = null; }
      }
      // 八十一格（Phase 15）：查出各宫干加干之格名与断语。关注宫沿用象义／类象
      // 已定的那几宫——与力量校验同一套口径，免得两处各说各的「哪宫要紧」。
      let geju = null;
      if (_gejuReady && GJ) {
        try {
          const gjRoles = {};
          const addRole = (g, r) => { g = String(g); (gjRoles[g] = gjRoles[g] || []).push(r); };
          if (xiangyi && xiangyi.applicable) {
            xiangyi.focus.forEach(f => addRole(f.gong, f.name + (f.aspect ? '(' + f.aspect + ')' : '')));
          } else {
            ysGongs.forEach(g => addRole(g, '用神'));
          }
          if (leixiang && leixiang.applicable) {
            leixiang.candidates.filter(c => c.located)
              .forEach(c => addRole(c.gong, c.symbol + '〔类象〕'));
          }
          geju = GJ.analyze({ chart: pan, focusGongs: Object.keys(gjRoles), focusRoles: gjRoles });
        } catch (ge) { console.warn('[geju] 查 81 格失败，本次不含格之断语：', ge.message); geju = null; }
      }
      // 时格（Phase 16）：五不遇时／天显时格。判据只是四柱日干时干，与盘上排布无关，
      // 故不依赖前面任何一层，放在最后算即可。
      let shige = null;
      if (_shigeReady && SG) {
        try { shige = SG.analyze({ chart: pan }); }
        catch (se) { console.warn('[shige] 判时格失败，本次不含时格：', se.message); shige = null; }
      }
      // 取数（Phase 21）：把用神宫可取之数摊开列全。此前只有河图数一路（由 TIMING 段承载），
      // 用神所落之宫**本身的宫数**从来不是候选——纲要「范围大则乘宫数」里宫数只当倍率使。
      // 本层另补后天洛书数与先天卦数两路，并**报出可达的相异数值个数**：
      // 数源一多，事后总凑得出实际值，那是拟合不是断准，故把可达度量与候选一同送进去。
      let qushu = null;
      if (_qushuReady && QS && yongshen) {
        try {
          qushu = QS.analyze({
            // 与其余各层同一路数：传 wangshuai 的**分析结果**，旺衰只此一处供给。
            // 取数只用它裁「旺相足数／休囚减半」一条，且这一条纲要只对河图数说过——
            // 宫数该不该随旺衰增减，纲要与用户皆未言，本层不代为增减。
            yongshen, wangshuai: (root.WangShuai && root.WangShuai.analyze) ? root.WangShuai.analyze(pan) : null,
            options: { school: school === 'feipan' ? 'feipan' : 'zhuanpan' }
          });
        }
        catch (qe) { console.warn('[qushu] 排取数失败，本次取数只有河图数一路：', qe.message); qushu = null; }
      }
      // 问句方向（Phase 38）：只看问句字面，与盘无关，故不依赖前面任何一层。
      let framing = null;
      if (FR) {
        try { framing = FR.detect(q); }
        catch (fe) { console.warn('[framing] 检问句方向失败，本次不提示：', fe.message); framing = null; }
      }
      // 五行推理（Phase 40/41）：两派都用，取用分派——转盘我＝日干宫；飞盘我＝年命宫、事＝引擎《鸣法》用神宫。
      // 旺衰取自 wangshuai 同一份分析。
      let wuxing = null;
      if (WX) {
        const ctx = prompt.context || {};
        // 取第一个定得了宫的引擎用神：飞盘阳遁九神无白虎、玄武，出行、盗贼的首用神在阳遁定不了宫，
        // 原先照取 [0] 得空宫，五行推理便落回时干；出行应顺延到开门（Phase 44）
        const fpLoc = ((ctx.yong && ctx.yong.located) || []).find(x => x && x.gong) || null;
        const feipanCtx = school === 'feipan' ? {
          nianMingGong: ctx.sanyi && ctx.sanyi.nianMingGong, shiGanGong: ctx.sanyi && ctx.sanyi.shiGanGong,
          yongGong: fpLoc && fpLoc.gong, yongName: fpLoc && fpLoc.name
        } : null;
        try { wuxing = WX.analyze({ chart: pan, wangshuai: (root.WangShuai && root.WangShuai.analyze) ? root.WangShuai.analyze(pan) : null, domain, feipan: feipanCtx }); }
        catch (we) { console.warn('[wuxing] 五行推理失败，本次不含：', we.message); wuxing = null; }
      }
      const evidence = EV.build({
        question: q, domain, chart: pan, yongshen, xiangyi, timing, leixiang, severity, converge, yinju, geju, shige, qushu, calibration, categoryMap: catMap, framing, wuxing,
        wangshuai: wsBlock, yingqi: yqBlock
      });
      runOut.yongshen = yongshen; runOut.xiangyi = xiangyi;
      runOut.timing = timing; runOut.leixiang = leixiang; runOut.severity = severity;
      runOut.yinju = yinju; runOut.geju = geju; runOut.shige = shige; runOut.qushu = qushu;
      runOut.wuxing = wuxing;   // 核对五行推理断了什么
      // converge 此前一直漏在这里没赋值：_lastReading 取的是 runOut.converge，
      // 于是自 Phase 13 起**每一条存下的案例其 converge 都是 null**——
      // 「说是 A 级的后来对了几成」这条校准曲线因此从未有过数据。
      runOut.converge = converge;
      runOut.evidence = evidence; runOut.domain = domain;
      evBlock = EV.toPromptBlock(evidence);
      if (evBlock) sysExtra = '\n' + EVIDENCE_DISCIPLINE;
    } catch (ee) {
      console.warn('[evidence] 构建失败，本次按原有流程解读：', ee.message);
      evBlock = '';
    }
    }
    return { evBlock, sysExtra, runOut };
  }

  return { loadKnowledge, evidenceFor, riShiGanBlock, tailAnchor, AI_DISCIPLINE, EVIDENCE_DISCIPLINE,
    ready: () => ({ kb: _kbReady, rules: _rulesReady, timing: _timingReady, leixiang: _leixiangReady, severity: _severityReady,
      converge: _convergeReady, yinju: _yinjuReady, geju: _gejuReady, shige: _shigeReady, qushu: _qushuReady }) };
});
