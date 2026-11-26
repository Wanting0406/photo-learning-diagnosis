import type { LearningMetric, LearningPlanInput } from '@shared/api.interface';

export function verifiedMetrics(metrics: LearningMetric[], input: LearningPlanInput): LearningMetric[] {
  const seen = new Set<string>();
  return metrics.filter((metric) => {
    const photos = metric.source === 'report' ? input.reportPhotos : input.watchPhotos;
    const text = metric.source === 'report' ? input.reportText : input.watchText;
    const normalize = (value: string): string => value.replace(/\s/gu, '');
    const quote = normalize(metric.quote);
    const numericTokens: string[] = quote.match(/\d+(?:[,.]\d+)*/gu) || [];
    const key = [metric.source, metric.label, metric.period].join(':');
    if (metric.confidence !== 'clear' || metric.sourceIndex > photos.length || seen.has(key) ||
      !numericTokens.includes(metric.value) || !quote.includes(normalize(metric.label)) ||
      (metric.unit && !quote.includes(normalize(metric.value + metric.unit))) ||
      (metric.sourceIndex === 0 && !normalize(text).includes(quote))) return false;
    seen.add(key); return true;
  }).slice(0, 8);
}
