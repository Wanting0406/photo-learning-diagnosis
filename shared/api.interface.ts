/* 前后端共享的类型写在这里 */

export interface SessionInfo {
  userId: string;
  userName: string;
  roles: string[];
}

export interface BackendHealth {
  configured: boolean;
  reachable: boolean;
  statusCode?: number;
  message: string;
}

export interface AdminPingResponse {
  message: string;
  userId: string;
}

export type RecognitionMode = 'extract-wrong' | 'grade' | 'auto';
export interface PhotoInput {
  name: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  dataBase64: string;
}
export interface DiagnosisInput {
  studentName: string;
  grade: string;
  subject: string;
  note: string;
  photos: PhotoInput[];
  wrongItems: string[];
}
export interface PhotoQuality { assessment: string; issue: string; advice: string }
export interface InitialKnowledgePoint {
  subject: string;
  name: string;
  keywords: string[];
}
export interface RecognitionResult {
  ok: boolean;
  grade: string;
  subjects: string[];
  wrongItems: string[];
  scopeNote: string;
  warnings: string[];
  needsRephoto: boolean;
  rephotoHint: string;
  photoQuality: PhotoQuality;
  knowledgePoints?: InitialKnowledgePoint[];
  courseMatches?: CourseMatch[];
  courseMatchNote?: string;
  items?: {
    item: string; questionType: string; studentAnswer: string; referenceAnswer: string;
    verdict: string; confidence: string; basis: string;
  }[];
  photos?: { index: number; state: string; note: string }[];
}
export interface CourseMatch {
  subject?: string;
  reviewNote?: string;
  book?: string;
  region?: string;
  package?: string;
  title: string;
  grade: string;
  edition: string;
  courseType: string;
  knowledgePoint: string;
  sourceUrl: string;
}
export interface MaterialMatch {
  materialId: string;
  name: string;
  year: number;
  exam: '中考' | '高考';
  subjects: string[];
  region: string;
  orientation: string;
  matchedKnowledgePoints: string[];
  examReferences?: { knowledgePoint: string; paperName: string }[];
  sourceUrl: string;
  previewUrl: string;
  imageUrl: string;
}
export interface MaterialMatchesResult {
  items: MaterialMatch[];
  status: 'ready' | 'empty' | 'unavailable';
  note: string;
}
export interface DiagnosisBoard {
  focus: string;
  importance: string;
  courseApproach: string;
}
export interface Diagnosis {
  diagnosisBoard?: DiagnosisBoard;
  solutions?: LearningPlanReport['solutions'];
  grade: string;
  subjects: string[];
  overall: string;
  strengths: string[];
  weakPoints: string[];
  wrongItems: string[];
  rightItems: string[];
  rightAnalysis: string;
  scopeNote: string;
  problems: {
    subject: string; item: string; errorType: string; rootCause: string;
    knowledgePoint: string; severity: string; suggestion: string;
  }[];
  plan: string[];
  onionRecommendation: string;
  courseMatches?: CourseMatch[];
  parentMessage: string;
  salesTips: string;
  membership: string;
  photoQuality: PhotoQuality;
}
export interface DiagnosisResult {
  ok: boolean;
  stored: boolean;
  recordId: string;
  recordUrl: string;
  warnings: string[];
  needsRephoto: boolean;
  rephotoHint: string;
  diagnosis: Diagnosis;
}
export interface ReportInput { diagnosis: Diagnosis; studentName: string }
export interface RecordsResult {
  configured: boolean;
  note: string;
  pageToken: string;
  items: { recordId: string; fields: Record<string, unknown> }[];
}
export interface AdminConfig {
  fields: { key: string; label: string; value: unknown; secret?: boolean; group?: string; type?: string }[];
}
export interface AdminPhotos {
  pageToken: string;
  items: { recordId: string; studentName: string; grade: string; summary: string;
    photos: { token: string; name: string }[] }[];
}
export interface DiagnosisJob {
  jobId: string;
  mode: RecognitionMode | 'analyze';
  status: 'running' | 'completed' | 'failed';
  stage: string;
  studentName: string;
  error: string;
  result?: RecognitionResult | DiagnosisResult;
  reusable?: boolean;
  timings?: Record<string, number>;
}
export interface DiagnosisSubmission { requestId: string; input: DiagnosisInput; recognitionJobId?: string }
export interface DiagnosisClientTiming {
  jobId: string;
  photoReadMs: number;
  submitMs: number;
  visibleMs: number;
}
export interface OpenApiDiagnosisRequest {
  requestId: string;
  mode?: RecognitionMode | 'analyze';
  studentName: string;
  grade?: string;
  subject?: string;
  note?: string;
  photos?: PhotoInput[];
  wrongItems?: string[];
  recognitionJobId?: string;
}

export interface LearningPlanInput {
  studentName: string;
  grade: string;
  subject: string;
  attribute: string;
  note: string;
  watchText: string;
  reportText: string;
  watchPhotos: PhotoInput[];
  reportPhotos: PhotoInput[];
}
export interface LearningEvidence {
  grade?: string;
  facts: string[];
  uncertainties: string[];
  knowledgePoints: InitialKnowledgePoint[];
  metrics?: LearningMetric[];
}
export interface LearningMetric {
  label: string;
  value: string;
  unit: string;
  period: string;
  quote: string;
  source: 'report' | 'watch';
  sourceIndex: number;
  confidence: 'clear' | 'uncertain';
}
export interface ProductMaterialMatch {
  productIds?: string[];
  matchedText?: string;
  introduction?: string;
  recommendation?: 'recommended' | 'optional';
  capabilityNames?: string[];
  materialId: string;
  name: string;
  capabilityIds: string[];
  sourceUrl: string;
  summary: string;
  boundary: string;
}
export interface ProductMaterialResult {
  items: ProductMaterialMatch[];
  status: 'ready' | 'empty' | 'unavailable';
  note: string;
}
export interface ProductMaterialPreview extends ProductMaterialMatch {
  imageDataUrl: string;
}
export interface LearningPlanReport {
  metricAnalyses?: { label: string; analysis: string }[];
  diagnosisBoard?: DiagnosisBoard;
  studentName: string;
  grade: string;
  subjects: string[];
  attribute: string;
  parentMessage: string;
  summary: string;
  phoneSteps: { title: string; text: string }[];
  evidence: LearningEvidence;
  professionalBasis?: string[];
  plans?: { period: string; goal: string; actions: string[]; acceptance: string }[];
  allocation?: string;
  allocationNote?: string;
  reportVersion?: 'product-recommendation-v2';
  solutions: { knowledgePoint: string; capabilityId: string; name: string; method: string;
    reason: string; acceptance: string; boundary: string; evidenceIndexes?: number[];
    sellingPoints?: { capabilityId: string; name: string; boundary: string }[] }[];
  courses: CourseMatch[];
  warnings: string[];
  createdAt: string;
}
export interface LearningPlanJob {
  timings?: Record<string, number>;
  jobId: string;
  status: 'running' | 'completed' | 'failed';
  stage: string;
  studentName: string;
  error: string;
  report?: LearningPlanReport;
}
export interface LearningReportImport { text: string; source: string }
export interface LearningSourceKey { publicKey: string; keyId: string; userId: string; expiresAt: number }
export interface LearningSourceEnvelope { keyId: string; encryptedKey: string; iv: string; ciphertext: string }

/* 角色管理：管理员成员管理 */
export interface AdminMemberUser {
  userID: string;
  name: string;
  avatar: string;
}
export interface AdminMembersResult {
  users: AdminMemberUser[];
  total: number;
  hasMore: boolean;
}
export interface AddAdminMembersRequest {
  userIDs: string[];
}
export interface RemoveAdminMembersRequest {
  userIDs: string[];
}
export interface SearchUsersRequest {
  query: string;
}
export interface SearchUsersResult {
  users: AdminMemberUser[];
}
export interface MutateOk {
  ok: boolean;
}
