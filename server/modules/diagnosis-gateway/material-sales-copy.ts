import type { ProductCapability } from './diagnosis-product-library';
import { bracketProductNames } from '@shared/diagnosis-presentation';

function benefit(product: ProductCapability): string {
  const name = product.name.replace(/\s/gu, '');
  if (/拍题精学/u.test(name)) return '遇到卡住的题，可以结合相关思路和微课理解，再练同类题，帮助孩子从看答案走向自己动手。';
  if (/错题本/u.test(name)) return '把做错的题和需要回看的内容整理起来，方便后面针对性复习，避免改完答案就放到一边。';
  if (/同步刷题/u.test(name)) return '看完课配合适量练习，及时了解哪些内容理解了、哪里还需要回看，让学习的收获有机会落实到做题中。';
  if (/高频错题/u.test(name)) return '围绕容易出错的题型练习和回顾，让孩子更清楚常见问题出在哪里，复习也更有重点。';
  if (product.valueEvidence?.points.length && /培优/u.test(name)) {
    return '在基础理解清楚后，由原中考命题人带领教研团队设计的初中培优体系，帮助孩子梳理重难点题型和方法，把校内所学逐步用到中考相关应用中。';
  }
  if (product.valueEvidence?.points.length && /同步|教材/u.test(name)) {
    return '用教材同步的动画微课把概念讲得更直观，课前能预习、课后能针对性回看，让孩子围绕校内正在学的内容打好基础，也方便衔接后续练习。';
  }
  if (/培优/u.test(name)) return '在基础理解清楚后，进一步学习重点题型和解题思路，帮助孩子从会基础题逐步走向更有挑战的应用。';
  if (/同步|教材/u.test(name)) return '围绕教材内容学习，没弄懂的章节可以针对性回看，让校内学习和课后巩固衔接起来。';
  if (/试卷|试题/u.test(name)) return '结合当前学习范围选择练习，用作答情况了解需要补充的内容，让后续学习更有针对性。';
  if (/预习/u.test(name)) return '提前接触接下来要学的内容，带着问题进入课堂，让学习更有方向。';
  if (/复习/u.test(name)) return '围绕已经学过的内容做回顾，把零散的知识重新联系起来，再用练习了解掌握情况。';
  return product.category === '产品' ? '可以结合孩子当前的学习内容选择，让课程学习更有重点。'
    : '可以配合课程使用，帮助孩子把学习和练习衔接起来。';
}

export function materialSalesIntroduction(products: ProductCapability[], title: string): string {
  const compact = (value: string): string => value.replace(/\s/gu, '');
  const ranked = [...products].sort((a, b) => Number(compact(title).includes(compact(b.name))) -
    Number(compact(title).includes(compact(a.name))));
  const distinct = new Map<string, ProductCapability>();
  for (const product of ranked) {
    const description = benefit(product);
    const name = compact(product.name);
    const courseFamily = /培优/u.test(name) ? 'advanced-course' : /同步|教材/u.test(name) && !/刷题/u.test(name) ? 'sync-course' : '';
    const key = courseFamily || (description.startsWith('可以') ? `${description}:${product.id || product.name}` : description);
    const previous = distinct.get(key);
    const verified = Boolean(product.valueEvidence?.points.length);
    const previousVerified = Boolean(previous?.valueEvidence?.points.length);
    if (!previous || (verified && !previousVerified) ||
      (verified === previousVerified && product.name.length > previous.name.length)) distinct.set(key, product);
  }
  return [...distinct.values()].slice(0, 2).map((product, index) =>
    `${index ? '也可以了解一下' : '给您介绍一下'}${bracketProductNames(product.name, [product.name])}，${benefit(product)}`).join('\n\n');
}
