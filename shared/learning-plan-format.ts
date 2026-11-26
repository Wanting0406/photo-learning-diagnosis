import type { LearningMetric, LearningPlanReport, ProductMaterialPreview } from './api.interface';
import { parentCourseNote, parentSolutionCopy, plainSalesText, reportProductText, salesTextParts, solutionCourses, solutionMaterial } from './diagnosis-presentation';

export function learningReportMetrics(r: LearningPlanReport): LearningMetric[] {
  const priority = (m: LearningMetric): number => /累计.*主动.*时长/u.test(m.label) ? 0
    : /刷题.*正确率/u.test(m.label) ? 1 : /正确率/u.test(m.label) ? 2 : /时长/u.test(m.label) ? 3 : 4;
  return (r.evidence.metrics || []).filter(m => m.source === 'report' && m.confidence === 'clear')
    .sort((a, b) => priority(a) - priority(b)).slice(0, 6);
}
export function metricSource(m: LearningMetric): string {
  return m.sourceIndex ? `学情报告截图${m.sourceIndex}` : '学情报告正文';
}
export function parentMetricPeriod(m: LearningMetric): string {
  return /^(?:累计|总计)$/u.test(m.period.trim()) || /未标注|待核实/u.test(m.period) ? '' : m.period;
}
export function learningMetricAnalysis(r: LearningPlanReport, m: LearningMetric): string {
  return r.metricAnalyses?.find(entry => entry.label === m.label)?.analysis || '';
}
export function diagnosisSelection(r: LearningPlanReport): string[] {
  return ['parent', 'summary', 'metrics', ...r.solutions.slice(0, 2).map(s => `product:${s.capabilityId}`)];
}
export function diagnosisBoardHtml(r: LearningPlanReport): string {
  return learningBoardHtml(r, [], ['metrics', r.diagnosisBoard ? 'diagnosis' : 'summary',
    ...r.solutions.slice(0, 2).map(s => `product:${s.capabilityId}`)]);
}
export function learningPlanText(r: LearningPlanReport, selected?: string[]): string {
  const include = (key: string): boolean => !selected || selected.includes(key);
  return [`${r.studentName}的学情诊断`, `${r.grade} · ${r.subjects.join('、')}`,
    ...(include('parent') ? [r.parentMessage] : []),
    ...(include('summary') ? ['目前需要关注', r.summary] : []),
    ...(include('metrics') ? learningReportMetrics(r).map(m => `${m.label}：${m.value}${m.unit}${parentMetricPeriod(m) ? `（${parentMetricPeriod(m)}）` : ''}${learningMetricAnalysis(r, m) ? `\n${learningMetricAnalysis(r, m)}` : ''}`) : []),
    ...r.solutions.slice(0, 2).flatMap((s, i) => include(`product:${s.capabilityId}`) ? [
      `适合孩子的课程：${s.name}`, `重点关注：${s.knowledgePoint}`, ...parentSolutionCopy(s),
      ...solutionCourses(r, i).map(c => `${c.reviewNote ? '可以和老师一起确认这节课' : '可以从这节课开始'}：${c.title}（${[c.grade, c.book, c.edition, c.courseType].filter(Boolean).join(' · ')}），对应知识点：${c.knowledgePoint}。${parentCourseNote(c)}`),
    ] : []),
    ...r.phoneSteps.filter((_, i) => !selected || selected.includes(`phone:${i}`)).map(s => `${s.title}：${s.text}`),
  ].filter(Boolean).map(text => plainSalesText(reportProductText(r, text))).join('\n\n');
}
export function learningBoardHtml(r: LearningPlanReport, materials: ProductMaterialPreview[] = [], selected?: string[]): string {
  const include = (key: string): boolean => !selected || selected.includes(key);
  const esc = (v: string): string => v.replace(/[&<>"']/gu, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
  const p = (v: string): string => `<p>${salesTextParts(reportProductText(r, v)).map(part => part.strong
    ? `<strong>${esc(part.text)}</strong>` : esc(part.text)).join('')}</p>`;
  const metrics = learningReportMetrics(r);
  const shown = new Set<string>();
  const poster = (index: number): string => {
    const m = solutionMaterial(materials, r, index);
    if (!m || !include(`image:${m.materialId}`) || shown.has(m.materialId) ||
      !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/u.test(m.imageDataUrl)) return '';
    shown.add(m.materialId);
    return `<div class="poster"><p class="poster-label">课程介绍</p><img src="${m.imageDataUrl}" alt="${esc(m.name)}"></div>`;
  };
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>学情诊断</title>
<style>*{box-sizing:border-box}body{margin:0;background:#fff;color:#293c35;font:20px/1.7 system-ui,-apple-system,sans-serif;letter-spacing:0}
main{max-width:900px;margin:auto}header{padding:36px 42px 32px;background:#edf5ef;border-top:8px solid #26735a}h1{font-size:50px;line-height:1.25;margin:12px 0 8px;overflow-wrap:anywhere;font-weight:700}
.header-title{font-size:23px;color:#277259;margin:0}.brand{font-size:18px;color:#277259;font-weight:600}.meta{font-size:17px;color:#63776c;margin:10px 0 0}
h2{font-size:24px;line-height:1.4;margin:0 0 18px}h3{font-size:30px;line-height:1.4;margin:10px 0 16px;color:#246f57}p{margin:10px 0;white-space:pre-wrap;overflow-wrap:anywhere}
section{padding:28px 42px}.metrics-section{padding-bottom:10px}.metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.metric{padding:20px 22px;background:#edf5f8;border-radius:6px}.metric:nth-child(2n){background:#eff5ed}
.metric strong{display:block;font-size:58px;line-height:1.25;overflow-wrap:anywhere;color:#265875;font-variant-numeric:tabular-nums}.metric:nth-child(2n) strong{color:#32714e}.metric strong span{font-size:23px;font-weight:500;margin-left:4px}.metric small{display:block;font-size:14px;color:#687970;margin-top:6px}.metric p{margin:0 0 12px;font-size:17px}
.metric:nth-child(n+3){grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:20px;background:#f6f8f7;padding:10px 22px}.metric:nth-child(n+3) p{margin:0}.metric:nth-child(n+3) strong{font-size:30px}.metric:nth-child(n+3) small{margin:0}
.metric p.metric-analysis{font-size:17px;color:#425c50;line-height:1.7;margin:16px 0 0}.metric:nth-child(n+3){flex-wrap:wrap}.metric:nth-child(n+3) p.metric-analysis{flex-basis:100%;margin:0}
.parent{padding-top:26px;padding-bottom:16px}.parent p{margin:0}.observation{padding-top:16px}.observation>div{border-left:4px solid #4e8972;padding-left:20px}.observation h2{font-size:20px;margin-bottom:8px}.observation p{margin:0}
.solution{border-top:1px solid #dfe8e2;padding-top:28px}.solution-label{font-size:17px;color:#697c71}.problem{display:inline-block;font-size:17px;color:#49785f;margin:0 0 8px}.course{padding:16px 20px;background:#f3f7f4;margin:18px 0}.course strong{display:block;font-size:22px}.course small{display:block;font-size:15px;color:#65796c;margin-top:4px}
.poster{margin-top:26px}.poster-label{font-size:17px;color:#64786b;margin:0 0 12px}.poster img{display:block;width:100%;height:auto;margin:auto}.standalone-poster{padding:16px 42px}
footer{padding:18px 42px 28px;font-size:14px;color:#738176;border-top:1px solid #e4eae6;display:flex;justify-content:space-between;gap:16px}</style></head><body><main>
<header><span class="brand">洋葱学园</span><h1>${esc(r.studentName)}</h1><p class="header-title">学情诊断</p><p class="meta">${esc(r.grade)} · ${esc(r.subjects.join('、'))}</p></header>
${include('metrics') && metrics.length ? `<section class="metrics-section"><h2>学习概况</h2><div class="metrics">${metrics.map(m => `<div class="metric"><p>${esc(m.label)}</p><strong>${esc(m.value)}<span>${esc(m.unit)}</span></strong>${parentMetricPeriod(m) ? `<small>${esc(parentMetricPeriod(m))}</small>` : ''}${learningMetricAnalysis(r, m) ? `<p class="metric-analysis">${esc(learningMetricAnalysis(r, m))}</p>` : ''}</div>`).join('')}</div></section>` : ''}
${include('parent') ? `<section class="parent">${p(r.parentMessage)}</section>` : ''}
${include('summary') ? `<section class="observation"><div><h2>目前需要关注</h2>${p(r.summary)}</div></section>` : ''}
${selected?.includes('diagnosis') && r.diagnosisBoard ? `<section class="observation"><div><h2>当前重点关注</h2>${p(r.diagnosisBoard.focus)}</div></section><section class="observation"><div><h2>为什么要重视</h2>${p(r.diagnosisBoard.importance)}</div></section>${r.diagnosisBoard.courseApproach ? `<section class="observation"><div><h2>同步打底，培优进阶</h2>${p(r.diagnosisBoard.courseApproach)}</div></section>` : ''}` : ''}
${r.solutions.slice(0, 2).map((s, i) => include(`product:${s.capabilityId}`) ? `<section class="solution"><span class="solution-label">洋葱课程 · 从这里开始学</span><h3>${esc(reportProductText(r, s.name))}</h3><p class="problem">重点关注 · ${esc(s.knowledgePoint)}</p>${parentSolutionCopy(s).map(p).join('')}${solutionCourses(r, i).map(c => `<div class="course"><span>${c.reviewNote ? '可以和老师一起确认这节课' : '可以从这节课开始'}</span><strong>${esc(c.title)}</strong><small>${esc([c.grade, c.book, c.edition, c.courseType].filter(Boolean).join(' · '))}</small><small>对应知识点：${esc(c.knowledgePoint)}</small>${parentCourseNote(c) ? `<small>${esc(parentCourseNote(c))}</small>` : ''}</div>`).join('')}${poster(i)}</section>` : (() => { const html = poster(i); return html ? `<div class="standalone-poster">${html}</div>` : ''; })()).join('')}
${r.phoneSteps.filter((_, i) => selected?.includes(`phone:${i}`)).map(s => `<section><h2>${esc(s.title)}</h2>${p(s.text)}</section>`).join('')}
<footer><span>洋葱学园</span><span>${esc(r.createdAt.slice(0, 10))}</span></footer></main></body></html>`;
}
