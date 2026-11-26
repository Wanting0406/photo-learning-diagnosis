import type { CourseMatch, InitialKnowledgePoint } from '@shared/api.interface';
import { capabilityBoundary, capabilityCategory, eligibleCapabilities, type ProductCapability } from './diagnosis-product-library';

interface ProductQuery {
  grade: string;
  subjects: string[];
  facts: string[];
  points: InitialKnowledgePoint[];
  courses: CourseMatch[];
  note?: string;
  attribute?: string;
}

const stopWords = new Set(['学生', '孩子', '学习', '课程', '情况', '知识点', '需要', '内容',
  '数学', '语文', '英语', '物理', '化学', '生物', '初中', '高中', '小学', '记录', '报告', '累计']);
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const intentRules = [
  { query: /计算|口算|竖式|进退位/u, product: /计算|口算/u },
  { query: /应用题|数量关系|列式/u, product: /应用题/u },
  { query: /词汇|单词|拼读/u, product: /词汇|拼读/u },
  { query: /古诗|诗词|默写/u, product: /古诗|诗词/u },
  { query: /实验|变量控制/u, product: /实验/u },
  { query: /考前|总复习|一轮|二轮|复习备考/u, product: /总复习|一轮|二轮|考前/u },
  { query: /衔接|升初|升高/u, product: /衔接/u },
];

// Rank only within the existing grade/subject eligibility rules. Selection never changes the full material index.
export function selectPromptProducts(library: ProductCapability[], query: ProductQuery): ProductCapability[] {
  const text = [...query.facts, ...query.points.flatMap(point => [point.name, ...point.keywords]),
    query.note || '', query.attribute || ''].join(' ');
  const terms = [...new Set([...segmenter.segment(text)].filter(part => part.isWordLike)
    .map(part => part.segment).filter(term => term.length >= 2 && !stopWords.has(term) && !/^\d+$/u.test(term)))];
  const types = query.courses.map(course => course.courseType).join(' ');
  const ranked = eligibleCapabilities(query.grade, query.subjects, library).map((capability, index) => {
    const category = capabilityCategory(capability);
    const searchable = `${capability.name} ${capability.trigger} ${capability.sequence}`;
    let score = terms.reduce((sum, term) => sum + (searchable.includes(term) ? 2 : 0), 0);
    if (category === '产品') {
      if (/同步|概念|教材/u.test(capability.name)) score += 12;
      if (/培优|重难点|思维/u.test(capability.name)) score += /培优|重难点/u.test(types + text) ? 12 : 3;
      if (/同步/u.test(types) && /同步/u.test(capability.name)) score += 8;
      for (const rule of intentRules) if (rule.query.test(text) && rule.product.test(capability.name)) score += 24;
      if (query.subjects.some(subject => capability.name.includes(subject))) score += 3;
    } else {
      if (/同步刷题/u.test(capability.name)) score += 8;
      if (/错|卡|不会|困难/u.test(text) && /拍题|错题/u.test(capability.name)) score += 12;
      if (/回看|复习|复盘/u.test(text) && /复习|错题/u.test(capability.name)) score += 8;
    }
    return { capability, category, score, index };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  return ['产品', '卖点'].flatMap(category => ranked.filter(item => item.category === category)
    .slice(0, 4).map(item => item.capability));
}

export function productPromptData(products: ProductCapability[]) {
  return products.map(product => ({ id: product.id, name: product.name, category: capabilityCategory(product),
    trigger: product.trigger, sequence: product.sequence, boundary: capabilityBoundary(product),
    ...(product.valueEvidence?.points.length ? { valueEvidence: { points: product.valueEvidence.points } } : {}) }));
}

export function coursePromptData(courses: CourseMatch[]) {
  return courses.map(({ title, subject, grade, edition, courseType, knowledgePoint, reviewNote, book, region }) =>
    ({ title, subject, grade, edition, courseType, knowledgePoint, ...(reviewNote ? { reviewNote } : {}),
      ...(book ? { book } : {}), ...(region ? { region } : {}) }));
}
