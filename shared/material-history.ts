import type { MaterialMatch } from './api.interface';

export function materialHistoryText(items: MaterialMatch[], availableImages: ReadonlySet<string>): string {
  const lines = items.filter((item) => availableImages.has(item.materialId)).flatMap((item) =>
    (item.examReferences || []).filter((reference) => reference.paperName.trim() &&
      item.matchedKnowledgePoints.includes(reference.knowledgePoint)).map((reference) =>
      `${reference.knowledgePoint}知识点在【${reference.paperName}】考过。`));
  return [...new Set(lines)].join('\n');
}

export function appendMaterialHistory(text: string, history: string): string {
  return history ? [text, history].filter(Boolean).join('\n\n') : text;
}
