import type { Diagnosis } from '@shared/api.interface';
export function escapeHtml(value: string): string {
  return value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;');
}
export function renderReport(d: Diagnosis, studentName: string, salesName: string): string {
  const e = escapeHtml;
  const section = (title: string, values: string[]) => values.length
    ? `<section><h2>${e(title)}</h2>${values.map((value) => `<p>${e(value)}</p>`).join('')}</section>` : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${e(studentName)}的学情报告</title><style>
    *{box-sizing:border-box;letter-spacing:0}body{margin:0;background:#fff;color:#232629;font-family:Arial,"PingFang SC","Microsoft Yahei",sans-serif}
    main{max-width:900px;margin:auto;padding:40px}header{border-bottom:3px solid #754ac4;padding-bottom:24px}
    .brand{color:#754ac4;font-size:16px}h1{font-size:28px;margin:16px 0}h2{font-size:18px;margin:0 0 12px}
    p{font-size:15px;line-height:1.9;white-space:pre-wrap;overflow-wrap:anywhere;margin:8px 0}section{padding:24px 0;border-bottom:1px solid #e4e5e7}
    .meta,footer{color:#656a70;font-size:13px}footer{padding-top:24px}article{margin:18px 0;padding-left:14px;border-left:3px solid #d9c9f0}
    @media(max-width:600px){main{padding:24px}h1{font-size:24px}}@media print{section,article{break-inside:avoid}}
    </style></head><body><main><header><div class="brand">洋葱学园</div><h1>${e(studentName)}的学情报告</h1>
    <p class="meta">${e(d.grade || '年级待确认')} · ${e(d.subjects.join('、') || '学科待确认')} · ${new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' })}</p></header>
    ${section('家长沟通', [d.parentMessage])}${section('总体学情', [d.overall])}${section('优势表现', d.strengths)}${section('掌握情况', [...d.rightItems, d.rightAnalysis].filter(Boolean))}
    ${section('待提升知识点', d.weakPoints)}${d.problems.length ? `<section><h2>学习问题与建议</h2>${d.problems.map((p) =>
      `<article><p><strong>${e(p.item)}</strong></p><p>知识点：${e(p.knowledgePoint)}\n错误类型：${e(p.errorType)}\n原因：${e(p.rootCause)}\n建议：${e(p.suggestion)}</p></article>`).join('')}</section>` : ''}
    ${section('近期学习安排', d.plan.map((p, i) => `${i + 1}. ${p}`))}${section('学习资源建议', [d.onionRecommendation])}
    ${d.courseMatches?.length ? `<section><h2>洋葱课程目录匹配</h2>${d.courseMatches.map((course) =>
      `<article><p><strong>${e(course.title)}</strong></p><p>${e(course.grade)} · ${e(course.edition)} · ${e(course.courseType)}</p><p>对应知识点：${e(course.knowledgePoint)}</p>${course.reviewNote ? `<p>${e(course.reviewNote)}</p>` : ''}<p>目录来源：${e(course.sourceUrl)}</p></article>`).join('')}</section>` : ''}
    <footer>跟进顾问：${e(salesName)}<p>${e(d.scopeNote)}</p><p>本报告基于本次照片与已确认题目，供沟通参考。</p></footer>
    </main></body></html>`;
}
