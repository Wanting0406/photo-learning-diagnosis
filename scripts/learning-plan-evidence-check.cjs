require('reflect-metadata');
const fs = require('node:fs/promises');
const path = require('node:path');
const { HttpService } = require('@nestjs/axios');
const { VisionService } = require('../server/modules/diagnosis-gateway/vision.service');
const { LEARNING_EVIDENCE_PROMPT } = require('../server/modules/diagnosis-gateway/learning-plan.prompts');
const { evidenceSchema } = require('../server/modules/diagnosis-gateway/learning-plan.validation');
async function main() {
  const [work, mode] = process.argv.slice(2);
  if (mode !== '--apply') throw new Error('Explicit --apply required for synthetic screenshot model verification');
  const photos = await Promise.all(['watch', 'report'].map(async name => ({ name: name + '.png', mimeType: 'image/png',
    dataBase64: (await fs.readFile(path.join(work, name + '.png'))).toString('base64') })));
  const data = await new VisionService(new HttpService()).learning(LEARNING_EVIDENCE_PROMPT,
    { studentName: '合成规划验证（非客户）', grade: '初二', subject: '数学', imageOrder: '前1张观看记录，后1张学情报告' }, photos, 'evidence');
  const parsed = evidenceSchema.safeParse(data);
  await fs.writeFile(path.join(work, 'synthetic-evidence.json'), JSON.stringify(data, null, 2));
  console.log(JSON.stringify({ valid: parsed.success, issues: parsed.success ? [] : parsed.error.issues,
    data }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
