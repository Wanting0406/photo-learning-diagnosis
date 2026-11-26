export const stageGrades: Record<string, string[]> = {
  小学: ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'],
  初中: ['初一', '初二', '初三'], 高中: ['高一', '高二', '高三'],
};
export function schoolStage(grade: string): string {
  return Object.keys(stageGrades).find(stage => stage === grade || stageGrades[stage].includes(grade)) || '';
}
export function confirmedGrade(selected: string, observed?: string): string {
  if (!stageGrades[selected]) return selected;
  return observed && stageGrades[selected].includes(observed) ? observed : selected;
}
