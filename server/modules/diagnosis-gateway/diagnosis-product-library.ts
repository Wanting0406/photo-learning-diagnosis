import { schoolStage, stageGrades } from '@shared/diagnosis-scope';
import { reviewedCourseValues } from './reviewed-course-values';
export const PRODUCT_SOURCE = 'https://guanghe.feishu.cn/docx/KmT1diV1BozRUnxf09acxsIInvd';
export const PRODUCT_VERIFIED_AT = '2026-09-10';

export interface ProductCapability {
  id: string;
  name: string;
  trigger: string;
  sequence: string;
  acceptance: string;
  boundary: string;
  stage?: '小学' | '初中';
  subjects?: string[];
  stages?: string[];
  grades?: string[];
  recordId?: string;
  sourceUrl?: string;
  verifiedAt?: string;
  functionAccess?: string;
  category?: '产品' | '卖点';
  valueEvidence?: { points: string[]; sourceUrl: string; materialIds: string[]; verifiedAt: string };
}

export function capabilityCategory(capability: ProductCapability): '产品' | '卖点' {
  return capability.category || (/^CAP-(COURSE|PRIMARY|JUNIOR)-/u.test(capability.id) ? '产品' : '卖点');
}

export const PRODUCT_ACCESS_RULE = '按productLibrary中的category区分产品和卖点。产品是需要付费的课程，是推荐主体；卖点是课程的辅助工具、练习或服务，用于解释怎样帮助学懂、练会和复习，不作为独立付费产品推荐。先按孩子的问题选择适配课程产品，再选择辅助卖点并说明使用方法和适用原因；卖点不能代替课程，也不能据其名称推断免费、单独收费或所有账号均可用。不得编造价格、套餐、包含权益或判断孩子必须再次购买；已有购买及具体开放范围使用前核实。';

export function capabilityBoundary(capability: ProductCapability): string {
  return [capability.boundary, capability.functionAccess ? `功能使用：${capability.functionAccess}` : '']
    .filter(Boolean).join('；');
}

// Reviewed document snapshot. These are capabilities, not membership entitlements or individual videos.
export const PRODUCT_CAPABILITIES: ProductCapability[] = [
  { id: 'CAP-AI-01', name: 'AI 拍题精学', trigger: '作业卡题、看懂答案但换题不会、家长不会讲',
    sequence: '拍题识别考点与思路，学对应微课，做同类或变式题，口述第一步；遇到代表性错题时使用',
    acceptance: '脱离答案能说考点与第一步，24—48 小时后换题仍能起步', boundary: '覆盖范围使用前核实；不保证覆盖所有题目和版本，不替代独立思考' },
  { id: 'CAP-AI-02', name: 'AI 错题本', trigger: '重复错题、只改答案不归因、说不清错因',
    sequence: '当天收录，标注错因并关联知识点，再次练习；每周复盘一次，每次追 1—2 类错因',
    acceptance: '同类题重复错误率下降，能说出防错动作', boundary: '具体入口使用前核实；录入不等于掌握，须重新作答和延迟复测' },
  { id: 'CAP-AI-03', name: 'AI 定制班', trigger: '有明确目标或考试日期但不会安排每日任务、多科时间冲突',
    sequence: '录入水平与目标，按日完成任务与练习，每周看完成率和正确率再调整',
    acceptance: '任务完成率稳定、薄弱点减少、学习时间可控', boundary: '班型、年级和权益使用前核实；不得承诺自动提分' },
  { id: 'CAP-AI-04', name: '课中答疑', trigger: '看课某一步卡住、频繁暂停或反复看仍不懂',
    sequence: '就当前知识点提出具体问题，理解解释后回到原步骤，用一道题验证',
    acceptance: '能复述卡住的步骤并完成后续练习', boundary: '具体课程范围使用前核实；不能泛化为不限范围的随时答疑' },
  { id: 'CAP-AI-05', name: '极速预习', trigger: '课堂节奏跟不上、新概念理解慢、新学科或章节衔接',
    sequence: '新课前建议 10—15 分钟认识关键词，标记一个疑问，带问题听课',
    acceptance: '能说出主题和 2—3 个关键词，课后指出已解决的疑问', boundary: '学段科目使用前核实；不提前学完整章，不替代课堂' },
  { id: 'CAP-AI-06', name: '极速复习', trigger: '当天知识点说不清、笔记不完整、作业起步困难',
    sequence: '当天或次日建议 10—20 分钟回看未懂环节，做 2—3 道基础验证题，记录剩余疑问',
    acceptance: '基础题正确率约 80% 且能解释规则；这是复测目标，不是效果保证', boundary: '学段科目与入口使用前核实' },
  { id: 'CAP-AI-07', name: '只看干货', trigger: '已有基础、已学内容复盘、碎片时间快速回顾',
    sequence: '先确认基础，回看关键概念与方法，立即短测；未达标则回到完整课程',
    acceptance: '短测达标且能解释方法', boundary: '入口使用前核实；不用于首次学习或基础断层' },
  { id: 'CAP-COURSE-01', name: '同步概念课', trigger: '概念混淆、基础断点、记结论但不懂原因',
    sequence: '核对教材与章节，学对应知识点微课，做随堂练习，用自己的话复述',
    acceptance: '能解释概念、判断典型正误并完成基础应用', boundary: '典型短课约 5—8 分钟，不是具体视频时长或学会时限；版本覆盖以当前页面为准' },
  { id: 'CAP-COURSE-02', name: '同步解题课', trigger: '概念懂但不会用、例题会而变式不会、独立起步困难',
    sequence: '学题型条件与起手步骤，模仿 1 题，独立做 2—3 道变式，说明方法边界',
    acceptance: '新题能判断题型并独立完成第一步，同类变式表现稳定', boundary: '先核实前置概念；具体教材与课程覆盖需确认' },
  { id: 'CAP-COURSE-03', name: '培优课', trigger: '基础和中档题已验证较稳，且有明确拔高目标',
    sequence: '确认前置知识达标，学高阶模型，做典型题，复盘多解与迁移条件',
    acceptance: '能识别同类模型并解释适用条件', boundary: '适用范围使用前核实；基础未稳不优先推荐，一次全对不等于满足前提' },
  { id: 'CAP-COURSE-04', name: '总复习课', trigger: '知识零散、跨章节连接弱、明确学期或升学复习节点',
    sequence: '按模块回顾，做诊断题，将错题定位回知识点，补薄弱模块并练习',
    acceptance: '能说出模块结构，综合卷基础和中档题更稳定', boundary: '按年级和考试节点选择，不从第一页平均重学' },
  { id: 'CAP-COURSE-05', name: '物理实验课', trigger: '实验现象、步骤、变量控制或图像结论理解薄弱', subjects: ['物理'],
    sequence: '观察过程，理解变量与现象，复述步骤和注意点，完成实验题',
    acceptance: '解释操作原因，识别错误步骤', boundary: '仅初高中物理，覆盖需核实；不能替代学校实际实验操作' },
  { id: 'CAP-PRACTICE-01', name: '同步刷题', trigger: '已学知识点需要及时验证',
    sequence: '做少量同层练习，逐题看依据和错因', acceptance: '基础题正确率稳定且能说依据', boundary: '概念不懂时先补概念，不堆题量' },
  { id: 'CAP-PRACTICE-02', name: '高频错题', trigger: '常考坑点反复出错、复习抓不住重点',
    sequence: '按章节练高频错误类型，每题归因并复测', acceptance: '同类坑点重复错误率下降', boundary: '先确认具体错因，不以题海替代定位' },
  { id: 'CAP-PRACTICE-03', name: '作业题型速攻', trigger: '作业不会起步、同类题耗时过长',
    sequence: '围绕当天作业题型学起手步骤，再做短练', acceptance: '独立起步率提高、作业耗时下降', boundary: '先记录卡题位置和耗时，不单纯催快' },
  { id: 'CAP-PRACTICE-04', name: '专项突破', trigger: '一个题型或能力反复拖分',
    sequence: '锁定最小专项，连续练习并复测', acceptance: '专项正确率和稳定性达标', boundary: '一次集中 1—2 个高价值漏洞，不平均刷题' },
  { id: 'CAP-PRACTICE-05', name: '考前突击', trigger: '临近考试，需要回顾已学高频考点',
    sequence: '按确认的考纲或范围回顾已学内容并限时练习', acceptance: '错题集中度下降、时间分配更稳定', boundary: '只选已学范围，不提前学未教内容' },
  { id: 'CAP-PRACTICE-06', name: '试卷库', trigger: '整卷诊断、限时训练或考后复盘',
    sequence: '确认考试范围后选卷，限时完成，按模块统计失分', acceptance: '能识别失分结构，不只看总分', boundary: '先核实考试范围与适用年级' },
  { id: 'CAP-PRIMARY-01', name: '计算题专题', stage: '小学', subjects: ['数学'], trigger: '口算慢、竖式错、符号和进退位不稳',
    sequence: '定位错误类型，短时定量训练并复盘', acceptance: '正确率、速度与书写过程同时改善', boundary: '小学专项；先区分计算与概念问题' },
  { id: 'CAP-PRIMARY-02', name: '应用题专题', stage: '小学', subjects: ['数学'], trigger: '数量关系混乱、读懂题却列不出式',
    sequence: '圈条件和问题，画图或说关系，列式并检查单位', acceptance: '能说明已知、所求、先算什么和理由', boundary: '小学专项；不能只模仿列式' },
  { id: 'CAP-PRIMARY-03', name: '教材同步', stage: '小学', trigger: '课堂进度跟不上、辅导口径不一致',
    sequence: '按版本与单元学概念和例题，再做校内作业', acceptance: '当天作业起步更顺、错误可解释', boundary: '小学专项；先核实教材版本和学校进度' },
  { id: 'CAP-PRIMARY-04', name: '总复习培优', stage: '小学', trigger: '单元知识零散、升年级或小升初串联',
    sequence: '按模块诊断后分层复习', acceptance: '基础题稳定且能处理跨单元问题', boundary: '小学专项；不从头平均用力，先补基础漏洞' },
  { id: 'CAP-PRIMARY-05', name: '数学思维培优', stage: '小学', subjects: ['数学'], trigger: '学有余力但模型意识和表达不足',
    sequence: '以问题情境理解模型，再做迁移题', acceptance: '能讲思路，不只报答案', boundary: '小学数学；先确认学有余力' },
  { id: 'CAP-PRIMARY-06', name: '自然拼读', stage: '小学', subjects: ['英语'], trigger: '见词不会读、听音不会拼、依赖死记',
    sequence: '建立字母与发音规则，再用词汇和短句练习', acceptance: '常见规则词能见词读、听音拼', boundary: '小学英语；不承诺覆盖所有单词规则' },
  { id: 'CAP-PRIMARY-07', name: '古诗词学习', stage: '小学', subjects: ['语文'], trigger: '只背不懂、易错字多、表达迁移弱',
    sequence: '理解情境和关键词，再背诵、默写和表达', acceptance: '能说大意并稳定默写关键句', boundary: '小学专项；不能以背诵代替理解' },
  { id: 'CAP-JUNIOR-01', name: '初中词汇训练', stage: '初中', subjects: ['英语'], trigger: '单词背了又忘、语境识词慢',
    sequence: '按主题或教材学音形义，在句子中识别，间隔复习', acceptance: '在句子和阅读中快速识别词义', boundary: '不能替代长难句、阅读方法和写作输出' },
  { id: 'CAP-JUNIOR-02', name: '快背系列', stage: '初中', subjects: ['道德与法治', '历史', '生物', '地理'], trigger: '整页死背、抓不住结构',
    sequence: '理解结构和关键词，分块记忆，口头复述，隔天抽查', acceptance: '按逻辑复述并应对材料变式', boundary: '具体学科年级使用前核实' },
  { id: 'CAP-SERVICE-01', name: '学习数据与反馈', trigger: '需了解学了什么、哪里不会、执行是否有效',
    sequence: '查看完成情况、正确率与薄弱点，每周确定一个优先问题并调整任务',
    acceptance: '用结果而非时长沟通，孩子知道下周改什么', boundary: '须结合真实作业、学校考试和孩子状态；具体数据入口与权益需核实' },
  { id: 'CAP-SERVICE-02', name: '学习辅导服务', trigger: '家长不会排任务、看数据或执行容易中断',
    sequence: '先确认购买方案和服务权益，再约定反馈频率，根据数据调整路径',
    acceptance: '计划可执行、问题能闭环、家长知道如何检查', boundary: '范围受限；周期、辅导方式及权益需核实，不是所有会员通用权益' },
];

export function eligibleCapabilities(grade: string, subjects: string[],
  library: ProductCapability[] = PRODUCT_CAPABILITIES): ProductCapability[] {
  const stage: string = schoolStage(grade);
  return library.filter((capability: ProductCapability) =>
    (!capability.stage || capability.stage === stage) &&
    (!capability.stages || capability.stages.includes(stage)) &&
    (!capability.grades || capability.grades.includes(grade) ||
      (stageGrades[grade]?.every(g => capability.grades!.includes(g)) ?? false)) &&
    (!capability.subjects || capability.subjects.some((subject: string) => subjects.includes(subject))) &&
    (capability.id !== 'CAP-COURSE-05' || stage === '初中' || stage === '高中'))
    .map(capability => reviewedCourseValues(capability, stage));
}

export const STAGE_IMPORTANCE_RULE = `解释重要性必须按学生已确认学段衔接升学：小学联系小升初与未来初中学习，不暗示所有地区都有小升初考试；初中联系中考对应能力或题型；高中联系高考对应能力或题型。点明当前内容与哪类后续应用有关，不只贴“中考/高考”标签。低年级侧重逐步积累；学段不明不猜考试。
中高考关联应给出大致分值参考：有资料分值时按实际口径表述；未指定地区试卷时允许基于常见题型给保守区间，用“按一道基础小题粗略参考，约……”自然表达，不添加“经验估算，非固定占分”的括号说明。分值是大致参考，不伪称历年统计或当地考纲结论；只估当前知识点直接关联的小题/小问，不把整个模块或综合大题总分算给一个知识点，有重叠不重复相加。不把估值说成孩子会丢的分数、每年必考分或购买后能增加的分数，不能可靠估计时说明需结合当地卷确认。小学不编造统一小升初分值。没有已匹配且可核对的试卷物料，不写“在某具体试卷考过”。`;

export const ONION_VALUE_RULE = `推荐的重点是解释“为什么我更推荐洋葱来帮助孩子”：从所选productLibrary条目的sequence、boundary与valueEvidence.points中选2—3项有依据的特点，按“特点→怎样帮助孩子”表达。可用时优先突出动画把概念讲直观、教材同步衔接校内、教研团队设计题型方法、培优衔接对应升学应用，以及所选AI工具辅助卡题或复习；不是每种课程都有上述全部特点，不得跨学段套用师资或把教研设计写成名师亲授。AI只提已选辅助卖点，不能因课程关联字段有功能名就擅自推荐。把所选课程和工具组织成理解、练习、卡题回看、进阶应用的连贯支持，让家长理解在同一平台衔接学习的便利，不只罗列功能。围绕孩子目前有证据的需求讲价值，不声称非选不可、解决所有问题、固定套餐、全部功能均可用或保证提分。资料不支持的特点省略，来源ID及核对信息不进入家长正文。`;

export const PARENT_COMMUNICATION_RULE = `你为销售老师代拟给家长的微信消息。“给家长的话”是本次诊断的总述，下方学习概况、孩子目前需要补上的一步、与升学的联系和课程建议是分述。像老师在微信里自然总结，亲切专业、口语化，不写成学习报告，不冒充孩子任课老师。
parentMessage或parent_message严格控制在90—120字，输出一个自然段；只限制这个字段，不将整份JSON或电话五步压成一个段落。不加标题、列表、换行或Markdown加粗，产品名称使用【】。字数包含产品名称和标点。完成后自行检查长度与措辞，不输出检查过程。
不得表明或暗示说话者是AI、机器人、模型或系统。不得出现“根据数据”“系统判断”“您提供的信息”“您发来的学习情况”等表达。可以提及已选产品中的真实AI辅助功能，但不能借此描述说话者身份。
不使用“完全掌握、一定提高、效果显著”等绝对化表述。不评价成绩，不制造焦虑，不进行强销售；不贴优差标签、不暗示落后或损失、不催促购买、不承诺提分。可以评价真实练习表现与复盘方向，这不等于评判学校成绩；不能因避免评价成绩而删去数据分析。不堆砌功能，不要求产品文案占固定比例。
自然称呼家长，优先用孩子姓名。在一个自然段中按“学习概况的关键数据及其评价→本次具体内容的学习重点→与已确认学段升学的具体联系→去洋葱App看哪类对应课程、帮助理解什么”串成总述，不能只写正在学习什么和推荐什么。省去空泛寒暄与结尾泛问，把字数留给本次事实、学习价值与看课引导。
有清晰报告数字时，优先从学习时长、刷题数、正确率中选最能支撑结论的数字，保留原值和统计范围，结合metricAnalyses提炼一句评价，如已有学习积累后应重视错题复盘和独立应用，不只列数字。三项都存在且字数允许时可简洁合并，但不据此认定同一批题目、不推算效率、错题数或知识点正确率。无报告数字时改用本次已确认作答事实，不套用示例数值。
从diagnosisBoard.focus提炼“孩子目前需要补上的一步”，必须点出本次知识点或题型及具体能力，如三角形三边关系中的独立判断边长条件，不用“加强基础、看完做几道题”替代定位。从diagnosisBoard.importance提炼它与小升初衔接及未来学习/中考/高考的具体关联，不只贴考试标签，不强塞分值。再结合courseApproach与已选课程，简述课程各自怎样承接这一能力。
总述与下面分述必须对应，不能在总述新增下方没有依据的薄弱点、原因、考试结论或产品特点。仅有观看记录时写正在学习的内容与课程能帮助理解的具体能力，不能把看过当不会，把累计正确率当单知识点表现。家长总述不要写“要确认能否、待核实、先检查是否”等待办事项，也不安排家长先测评孩子；把待确认的能力转为温和的看课建议，如“到洋葱App看【已选课程产品】的对应内容，用动画理解边长条件”，前提是该课程确有相关特点。单节课名与App具体菜单路径没有依据时不编造。生成后检查：若换掉姓名仍能原封不动用于别的知识点和数据，则重写，补齐本次数字评价、具体学习价值和升学联系，不输出检查过程。
课程只用当前学段学科已选产品的准确名称，写为【初中数学同步课】这样的格式；先理解和练习，再衔接适合水平的培优，不强行凑两类产品。特点只能来自产品库，具体单节课名只取匹配目录，不编造功能、价格、服务或权益。没有适配产品时温和了解情况，不硬推。
所有家长可见内容与电话话术均遵守不暴露生成身份、不使用上述禁用表达、不绝对化、不评价成绩、不制造焦虑和不强销售的口吻要求。正文提及课程产品准确名称时一律加【】，已有括号不重复添加；结构化的name、capabilityId等检索字段保留原值。卖点作为课程辅助，不包装成独立付费产品。`;

export const DIAGNOSIS_BOARD_RULE = `生成有针对性的诊断长图内容diagnosisBoard，包含focus、importance、courseApproach。focus约90—150字，按“孩子实际学了什么/明确错在哪里→能确认的表现→现在需要补上的能力”展开，必须包含本次知识点和一条本次资料事实。有正确率或练习量可引用1个相关数字，说明原有统计范围，不把累计正确率当作单知识点结果。观看记录仅写正在学习/重点关注，只有作答或报告明确薄弱才写薄弱；原因未证实时不下结论，改写为通过适配课程与练习了解具体卡点的方法，不套用“加强基础、提高能力”。importance约70—120字，面向家长直接讲本知识点的重要程度及理由：它是哪些后续能力的基础、在对应升学题型中怎样发挥作用、学清楚对后续学习有什么帮助。重要程度须符合具体知识点，不一律称为核心、重难点或必考；小学联系小升初衔接与未来学习，初高中联系中高考具体题型。中高考分值可用“按一道基础小题粗略参考、约”简洁带过，重点放在学习价值。不要输出“并不代表每张卷都会单独考查”“不将整道综合题分数重复算进来”等统计边界、自我解释或分析过程，也不写免责声明；不冒充确定考试频次、不夸大分值、不制造失分焦虑。courseApproach约60—100字，用有依据的洋葱特点说明同步理解、练习检验、适用培优进阶的分工，不承诺效果；一类课程不可用时不硬凑。summary、overall和focus向家长说明如何用产品了解孩子的学习情况：围绕本次具体知识点，写明去洋葱App看哪个已选课程的对应内容、使用哪项已选练习或辅助功能、从作答过程或讲解对照中看什么，以及遇到卡点如何回看再练。不只提出“当前重点是确认、能否独立、需要核实”等待办问题，不让家长自行设计测评。仅用产品库支持且已选的功能，不编造自动测评结果、题目数量或菜单入口；未提供练习功能时可建议用孩子现有的相关作业配合课程。用独立尝试与回看动作表达观察方式，不把一次做对等同完全掌握。summary简述这一过程，focus展开本次知识点的操作，不整段重复。长图随后会附带所选洋葱具体课程与观看建议，这里不重复长篇产品介绍，不加物料图片。`;

export const OBSERVATION_RULE = `【本次作答与能力结论的边界】
全部字段只描述本次可观察的作答或学习记录，再承接课程帮助，不能从少量题目推断孩子的整体能力、记忆方式或长期状态。不用“机械记忆、死记硬背、逻辑漏洞、基础运算没问题、记住公式但不理解、概念地基不牢、掌握存在波动”等定性表述，也不能换同义词下相同结论。
可写“这道题把两底角的和作为一个底角，接下来可结合课程中的图形演示看清两个底角怎样分配”；不可写“孩子仅停留在机械记忆，存在逻辑漏洞”。可写“这次内角和计算正确”；不可写“说明基础运算没问题”。仅标注作答错误时只点名题目与知识点，不猜具体出错步骤。
root_cause/error_type等历史字段名不要求推断心理或认知原因：只写题中可见的步骤差异；无法看清时写“本题步骤需结合讲解对照”，把具体看课方法放入建议。总体正确率只描述该统计周期的作答记录，没有多期对比不写波动或趋势；没有充分依据不推导每日时长、学习效率或专注程度。家长开场亲切称呼，不使用“暴露出、明显漏洞、低级失误”等指责用语。升学部分正向说明知识点的用途，不预测孩子将失分或学不好。`;

export const ANALYSIS_PROMPT = `你是中小学学情诊断顾问，基于照片、销售确认错题和备注提供有证据的建议。
${OBSERVATION_RULE}
【学情分析】
先区分做对、做错与无法确认的题。错题只以销售确认清单为准，problems 逐题保留，不擅自增加错题。
清单为空时 problems、weak_points 返回空数组，分析可确认的掌握表现和待验证方向；没有批改或清晰作答不等于全对。
手写尽力辨认，涂改看最后作答；看不清或没有证据时如实说明，不猜字、不捏造题目、长期学习习惯或心理根因。
right_items 按知识点归纳本次正确作答，right_analysis 只描述这些题中可见的步骤；overall 用90—140字结合本次具体题目和确认作答，说明本次表现、需要关注的具体步骤及适配产品方向，不展开讲题。资料仅支持待确认问题时，结合适配产品说明看课、配合练习、对照讲解与回看怎样了解该环节，不只列出核实待办；没有适配产品时不硬推。不把可能原因当事实，不套用所有孩子相同的“加强基础”。
一次作业不能证明全部掌握，也不能凭一次全对直接推荐培优。先验证前置知识、变式题表现和拔高目标。
备注中的背景和卷面事实分别表述，冲突时待核实。输出学情诊断而不是学习规划；plan返回空数组，不生成周、月、学期安排。
【产品推荐唯一依据】
产品名称、能力、路径和边界仅依据 productLibrary；具体单节课程名称仅依据 matchedCourses。这两类资料不可混为会员权益。
${PRODUCT_ACCESS_RULE}
从 productLibrary 选择与已验证主问题最匹配的少量能力，最多2个课程产品和2个辅助卖点，按使用先后返回 selected_capability_ids，去重；证据不足时允许不推荐。
有效推荐必须包含至少一个category为产品的课程；category为卖点的条目仅用于辅助所选课程，不单列成购买建议。
证据不足或没有适配能力时返回空数组并说明待核实，不为凑数硬推。CAP 编号仅用于结构化返回，不写入家长话术。
推荐重点写所选课程及辅助卖点怎样帮助学懂、练习和复习，用产品库里的真实特点解释购买价值，不把正文写成知识点教学方案。
各字段只能推荐所选能力，不能另外增加产品。不要堆功能，不把能力组合说成固定套餐。
家长话术 parent_message 用纯文本，按以下沟通要求组织。专业分析按题保留必要依据，不在不同字段重复复述。
${PARENT_COMMUNICATION_RULE}
${DIAGNOSIS_BOARD_RULE} 试卷流程字段名为diagnosis_board。
把可能改善写成可验证目标，不制造焦虑、不画提分大饼、不催促购买；不得写保证提分、一定考上、肯定有效或所有孩子适合。
销售跟进 sales_tips 最多三条并合并为一个字符串：待核实问题、教材/设备/权益核对、约定复测与数据反馈；不擅自许诺免费体验、价格优惠、服务周期或会员档位。
没有 matchedCourses 时，不把知识点名称包装成具体视频名，只能表述为“针对该知识点学习同步概念课”等能力与知识点的组合。
可将5—8分钟短课作为典型特点，但不能写成某节课固定时长，更不能承诺几分钟讲透或学会。学习频率和正确率是建议与验收目标，不是效果保证。
同步推荐先核实教材版本、章节和学校实际进度。基础断层不推荐只看干货；基础未稳不优先培优；学校版功能不能默认属于个人会员。
AI 精准学主要为洋葱星球平板端小学/初中数学，AI 复习诊断主要为初中数学/物理/生物/地理，同步复习主要为初中数学；这些受限能力未列入本次可选库，不得自行扩展推荐。
高中覆盖、设备入口、套餐与辅导服务权益尚有资料缺口；涉及具体覆盖必须标明使用前核实，不以“通用可用”推断所有账号均有权益。
【输出】
只输出JSON，不要代码围栏。严格使用以下键：
{"photo_quality":{"assessment":"清晰|一般|较差|无法辨认","issue":"无或问题","advice":"无或建议"},
"grade":"年级","subjects":["学科"],"wrong_items":["回显确认清单"],"right_items":["正确表现"],
"right_analysis":"本次正确作答的可见步骤","scope_note":"分析范围与不确定性","overall":"家长能理解的本次表现与看课建议",
"strengths":["优势"],"weak_points":["薄弱知识点"],
"problems":[{"subject":"学科","item":"确认错题","error_type":"本题可见的步骤差异","root_cause":"本题具体作答与正确步骤的差异，不推测认知原因",
"knowledge_point":"知识点","severity":"高|中|低","suggestion":"具体建议"}],
"plan":[],"selected_capability_ids":["从productLibrary选择的真实ID"],
"parent_message":"家长话术","sales_tips":"销售跟进",
"diagnosis_board":{"focus":"当前需要关注的内容","importance":"为什么重要","courseApproach":"同步课与培优课的衔接"}}`;
