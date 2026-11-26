// ---- plugin:student_homework_image_recognition_1 ----
// ============================================================
// 插件 student_homework_image_recognition_1 (学情图片识别) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export type StudentHomeworkImageRecognitionOneInput = {
  /** 待识别的学生作业/试卷图片，支持1-6张（http(s) 地址） */
  images: string[];
  /** 完整的识别提示词（含系统规则、上下文与输出 JSON 结构要求） */
  prompt: string;
};

/**
 * const input: StudentHomeworkImageRecognitionOneInput = { images, prompt };
 * capabilityClient.load('student_homework_image_recognition_1').callStream<StudentHomeworkImageRecognitionOneOutput>('imageUnderstanding', input)
 * 每个 chunk 就是下面这个扁平对象，字段名与 StudentHomeworkImageRecognitionOneOutput 一致，外面没有 data / choices / message 包装：
 *   {"content":"示例文本","reasoningContent":"","response":"示例文本"}
 * 返回值可能是 AsyncIterable<chunk>，也可能是 { output: AsyncIterable<chunk> }，取流前先归一化。
 * 逐段累加：
 *   for await (const chunk of stream) { result += chunk.content ?? ''; }
 */
export type StudentHomeworkImageRecognitionOneOutput = {
  content: string;
  reasoningContent?: string;
  response?: string;
};
// ---- end:student_homework_image_recognition_1 ----

// ---- plugin:learning_diagnosis_text_generation_1 ----
// ============================================================
// 插件 learning_diagnosis_text_generation_1 (学情诊断文本生成) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export type LearningDiagnosisTextGenerationOneInput = {
  /** 完整提示词（包含系统提示与用户内容），用于学情诊断报告与家长话术生成 */
  prompt: string;
};

/**
 * const input: LearningDiagnosisTextGenerationOneInput = { prompt };
 * capabilityClient.load('learning_diagnosis_text_generation_1').callStream<LearningDiagnosisTextGenerationOneOutput>('textGenerate', input)
 * 每个 chunk 就是下面这个扁平对象，字段名与 LearningDiagnosisTextGenerationOneOutput 一致，外面没有 data / choices / message 包装：
 *   {"content":"示例文本","response":"示例文本"}
 * 返回值可能是 AsyncIterable<chunk>，也可能是 { output: AsyncIterable<chunk> }，取流前先归一化。
 * 逐段累加：
 *   for await (const chunk of stream) { result += chunk.content ?? ''; }
 */
export type LearningDiagnosisTextGenerationOneOutput = {
  content: string;
  response?: string;
};
// ---- end:learning_diagnosis_text_generation_1 ----

// ---- plugin:tmp_model_probe ----
// ============================================================
// 插件 tmp_model_probe (模型探针(临时)) 的类型定义
// 由 get_plugin_ai_json 自动生成
// ============================================================

export type TmpModelProbeInput = {
  /** 提示词 */
  prompt: string;
};

/**
 * const input: TmpModelProbeInput = { prompt };
 * capabilityClient.load('tmp_model_probe').callStream<TmpModelProbeOutput>('textGenerate', input)
 * 每个 chunk 就是下面这个扁平对象，字段名与 TmpModelProbeOutput 一致，外面没有 data / choices / message 包装：
 *   {"content":"示例文本","response":"示例文本"}
 * 返回值可能是 AsyncIterable<chunk>，也可能是 { output: AsyncIterable<chunk> }，取流前先归一化。
 * 逐段累加：
 *   for await (const chunk of stream) { result += chunk.content ?? ''; }
 */
export type TmpModelProbeOutput = {
  content: string;
  response?: string;
};
// ---- end:tmp_model_probe ----