import type { Diagnosis } from '@shared/api.interface';

// Bounded checks for observed failure categories, not a general semantic verifier.
const unsupportedClaim = /机械记忆|死记硬背|逻辑漏洞|概念地基不牢|掌握存在波动|基础.{0,12}(?:运算|计算).{0,8}(?:没(?:有)?问题|扎实|薄弱)|(?:公式(?:运用|应用)|计算能力)(?:很|非常|十分)?(?:熟练|扎实)|(?:展现|具备).{0,16}(?:能力)|(?:表明|说明|反映出).{0,90}(?:严谨|逻辑|能力|掌握|习惯|概念理解)|(?:虽然|已经|完全)掌握了|(?:若|如果).{0,50}(?:习惯|失分)|(?:将|会).{0,30}连锁失分/u;
const limitation = '本次先围绕题中具体步骤，结合课程讲解与练习巩固。';

export function groundNarrative(text: string): string {
  if (typeof text !== 'string') return '';
  const unsupported = (clause: string): boolean => {
    const match = unsupportedClaim.exec(clause);
    if (!match) return false;
    const prefix = clause.slice(0, match.index);
    return !/(?:不能|不代表|不足以|无法|不应)(?:说明|认定|推断|判断)?[^，。]{0,16}$/u.test(prefix);
  };
  if (!text.split(/[，,。！？；;\n]/u).some(unsupported)) return text;
  // Remove only unsupported clauses; preserve adjacent facts and product guidance.
  const result = (text.match(/[^。！？\n]+[。！？\n]?/gu) || []).map((sentence: string): string => {
    const ending = sentence.match(/[。！？\n]$/u)?.[0] || '';
    const body = ending ? sentence.slice(0, -1) : sentence;
    const clauses = body.match(/[^，,；;]+[，,；;]?/gu) || [];
    let previousRemoved = false;
    const kept = clauses.flatMap((clause: string): string[] => {
      if (unsupported(clause)) { previousRemoved = true; return []; }
      const value = previousRemoved ? clause.replace(/^(?:但是|不过|然而|但|比如|因此|所以)/u, '') : clause;
      previousRemoved = false;
      return [value];
    });
    if (!kept.length) return '';
    return kept.join('').replace(/[，,；;]$/u, '') + ending;
  }).join('').trim();
  return result || limitation;
}

export function groundDiagnosis(diagnosis: Diagnosis): Diagnosis {
  return { ...diagnosis,
    overall: groundNarrative(diagnosis.overall), parentMessage: groundNarrative(diagnosis.parentMessage),
    rightAnalysis: groundNarrative(diagnosis.rightAnalysis), salesTips: groundNarrative(diagnosis.salesTips),
    strengths: (diagnosis.strengths || []).map(groundNarrative), weakPoints: (diagnosis.weakPoints || []).map(groundNarrative),
    rightItems: (diagnosis.rightItems || []).map(groundNarrative), plan: (diagnosis.plan || []).map(groundNarrative),
    onionRecommendation: groundNarrative(diagnosis.onionRecommendation),
    diagnosisBoard: diagnosis.diagnosisBoard ? {
      focus: groundNarrative(diagnosis.diagnosisBoard.focus),
      importance: groundNarrative(diagnosis.diagnosisBoard.importance),
      courseApproach: groundNarrative(diagnosis.diagnosisBoard.courseApproach),
    } : undefined,
    problems: (diagnosis.problems || []).map(problem => ({ ...problem,
      errorType: groundNarrative(problem.errorType), rootCause: groundNarrative(problem.rootCause),
      suggestion: groundNarrative(problem.suggestion) })),
    solutions: diagnosis.solutions?.map(solution => ({ ...solution,
      reason: groundNarrative(solution.reason), method: groundNarrative(solution.method) })),
  };
}
