import { BadRequestException, Body, Controller, Get, Param, Post } from '@nestjs/common';
import type { DiagnosisJob, OpenApiDiagnosisRequest, RecognitionMode } from '@shared/api.interface';
import { DiagnosisGatewayService, type SalesIdentity } from './diagnosis-gateway.service';

const openApiIdentity: SalesIdentity = { userId: 'openapi-integration', userName: '开放接口' };
const modes: (RecognitionMode | 'analyze')[] = ['extract-wrong', 'grade', 'auto', 'analyze'];

@Controller('openapi/diagnosis')
export class DiagnosisOpenApiController {
  constructor(private readonly service: DiagnosisGatewayService) {}

  @Post('jobs')
  submit(@Body() body: OpenApiDiagnosisRequest): Promise<DiagnosisJob> {
    const mode = body.mode ?? 'extract-wrong';
    if (!modes.includes(mode)) throw new BadRequestException('诊断模式无效');
    if (!body.recognitionJobId && !body.photos?.length) throw new BadRequestException('请提供卷面照片，或用 recognitionJobId 复用识别结果');
    const input = {
      studentName: body.studentName,
      grade: body.grade ?? '',
      subject: body.subject ?? '',
      note: body.note ?? '',
      photos: body.recognitionJobId ? [] : (body.photos ?? []),
      wrongItems: body.wrongItems ?? [],
    };
    const payload = body.recognitionJobId
      ? { requestId: body.requestId, recognitionJobId: body.recognitionJobId, input }
      : { requestId: body.requestId, input };
    return this.service.start(mode, payload, openApiIdentity);
  }

  @Get('jobs/:jobId')
  job(@Param('jobId') jobId: string): Promise<DiagnosisJob> {
    return this.service.job(jobId, openApiIdentity.userId);
  }
}
