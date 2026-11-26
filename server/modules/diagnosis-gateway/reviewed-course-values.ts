import type { ProductCapability } from './diagnosis-product-library';

const sourceUrl = 'https://guanghe.feishu.cn/wiki/L3LfwQClgiYfmDkgLT3c08NLnub';
const juniorSubjects = ['数学', '语文', '英语', '物理', '化学', '生物', '地理'];

// Visually checked against the original approved posters, not their generated summaries.
export function reviewedCourseValues(product: ProductCapability, stage: string): ProductCapability {
  if (stage !== '初中' || product.category === '卖点') return product;
  const official = product.id.startsWith('CAP-SKU-');
  const sync = ['CAP-COURSE-01', 'CAP-COURSE-02'].includes(product.id) ||
    (official && [...juniorSubjects, '历史', '道德与法治'].some(s => product.name === `初中${s}同步课`));
  const advanced = product.id === 'CAP-COURSE-03' ||
    (official && juniorSubjects.some(s => product.name === `初中${s}培优课`));
  if (!sync && !advanced) return product;
  return { ...product, valueEvidence: {
    points: sync ? [
      '教材同步动画微课，把概念讲得更直观，可用于课前预习和课后复习；实际教材版本与章节须核实。',
      '对标教材目录拆解学习内容，便于按当前章节回看与查漏补缺。',
    ] : [
      '初中培优体系由原中考命题人带领教研团队设计，讲解重难点题型与方法；不等同于每节课由命题人亲授。',
      '重难点培优承接校内应用，新中考培优面向中考题型与备考；须按所选产品实际包含内容和学生基础选择。',
    ],
    sourceUrl,
    materialIds: sync ? ['prod_lib_76d179fc212f8ae22e830829', 'prod_lib_665cf9d485de7b1d10cf66f3']
      : ['prod_lib_665cf9d485de7b1d10cf66f3'],
    verifiedAt: '2026-09-21',
  } };
}
