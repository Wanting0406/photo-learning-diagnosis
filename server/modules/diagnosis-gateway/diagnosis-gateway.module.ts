import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { FeishuService } from './feishu.service';
import { VisionService } from './vision.service';
import { DiagnosisGatewayController } from './diagnosis-gateway.controller';
import { DiagnosisOpenApiController } from './diagnosis.openapi.controller';
import { DiagnosisGatewayService } from './diagnosis-gateway.service';
import { LearningPlanController } from './learning-plan.controller';
import { LearningPlanService } from './learning-plan.service';
import { LearningReportSource } from './learning-report-source';
import { LearningSourceCrypto } from './learning-source-crypto';

@Module({
  imports: [HttpModule],
  controllers: [DiagnosisGatewayController, DiagnosisOpenApiController, LearningPlanController],
  providers: [DiagnosisGatewayService, FeishuService, VisionService, LearningPlanService, LearningReportSource, LearningSourceCrypto],
  exports: [DiagnosisGatewayService],
})
export class DiagnosisGatewayModule {}
