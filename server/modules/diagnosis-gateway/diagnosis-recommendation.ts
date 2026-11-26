import type { Diagnosis } from '@shared/api.interface';
import { eligibleCapabilities, capabilityBoundary, capabilityCategory, PRODUCT_CAPABILITIES, PRODUCT_SOURCE, type ProductCapability } from './diagnosis-product-library';

function publicCapabilityText(text: string): string {
  return text.replace(/[（(]\s*CAP-[A-Za-z0-9-]+\s*[）)]/gu, '')
    .replace(/\bCAP-[A-Za-z0-9-]+\b/gu, '').trim();
}

export function recommend(diagnosis: Diagnosis, selectedIds: unknown,
  library: ProductCapability[] = PRODUCT_CAPABILITIES): boolean {
  const available = eligibleCapabilities(diagnosis.grade, diagnosis.subjects, library);
  const ids = Array.isArray(selectedIds)
    ? [...new Set(selectedIds.filter((id: unknown): id is string => typeof id === 'string'))] : [];
  const selected = ids.map((id: string) => available.find((capability) => capability.id === id))
    .filter((capability) => capability !== undefined).slice(0, 4);
  // The source describes capabilities, and supplies no entitlement mapping for an individual student.
  diagnosis.membership = '待定';
  if (diagnosis.photoQuality.assessment === '无法辨认' || selected.length < 1 ||
    !selected.some(c => capabilityCategory(c) === '产品') ||
    selected.length !== ids.length || !Array.isArray(selectedIds) ||
    selectedIds.some((id: unknown) => typeof id !== 'string')) {
    diagnosis.onionRecommendation = '本次尚未形成可核实的产品能力组合。请先确认学习问题、年级和学科，再按产品库选择使用路径。';
    diagnosis.parentMessage = '这次先结合清晰作答确认孩子的具体困难，再通过同类题复测。产品建议暂待核实，确认学习问题、教材版本和账号权益后，再安排适合的学习路径。';
    diagnosis.salesTips = '先核对清晰作答、教材版本和主问题；再按产品能力库选用少量适配能力，并确认账号权益与复测安排。';
    diagnosis.solutions = [];
    delete diagnosis.diagnosisBoard;
    return false;
  }
  diagnosis.onionRecommendation = [...selected.filter(c => capabilityCategory(c) === '产品'),
    ...selected.filter(c => capabilityCategory(c) === '卖点')].map((capability, index: number) =>
    `${index + 1}. ${capabilityCategory(capability) === '产品' ? '推荐课程' : '辅助卖点'}：${capability.name}。${capability.sequence}。\n验收：${capability.acceptance}。\n使用边界：${capabilityBoundary(capability)}。`)
    .join('\n\n') + `\n\n产品依据：洋葱产品映射表中的已启用能力。\n${[...new Set(selected.map(c => c.sourceUrl || PRODUCT_SOURCE))].join('\n')}`;
  if (!diagnosis.salesTips) {
    diagnosis.salesTips = '先核对本次主问题、教材版本和学校进度；使用前确认所选能力的设备入口与账号权益；按推荐路径约定复测并记录结果。';
  }
  diagnosis.parentMessage = publicCapabilityText(diagnosis.parentMessage);
  diagnosis.salesTips = publicCapabilityText(diagnosis.salesTips);
  diagnosis.plan = diagnosis.plan.map(publicCapabilityText);
  diagnosis.solutions = selected.filter(c => capabilityCategory(c) === '产品').slice(0, 2).map(c => {
    const problems = diagnosis.problems.filter(p => !c.subjects || c.subjects.includes(p.subject));
    const problem = problems[0];
    return { capabilityId: c.id, name: c.name,
      knowledgePoint: [...new Set(problems.map(p => p.knowledgePoint).filter(Boolean))].join('、') ||
        diagnosis.weakPoints[0] || '复核当前掌握情况',
      reason: problem ? `结合${problem.item}的表现：${problem.rootCause}` : diagnosis.overall,
      method: c.sequence, acceptance: c.acceptance, boundary: capabilityBoundary(c),
      sellingPoints: selected.filter(p => capabilityCategory(p) === '卖点').slice(0, 2)
        .map(p => ({ capabilityId: p.id, name: p.name, boundary: capabilityBoundary(p) })) };
  });
  return true;
}
