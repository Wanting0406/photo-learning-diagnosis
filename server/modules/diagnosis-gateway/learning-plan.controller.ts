import { Body, Controller, Get, Post, Param, Req, Res, Header, UnauthorizedException } from '@nestjs/common';
import { NeedLogin, CanRole } from '@lark-apaas/fullstack-nestjs-core';
import type { Request, Response } from 'express';
import { LearningPlanService } from './learning-plan.service';
import { LearningReportSource } from './learning-report-source';
import { LearningSourceCrypto } from './learning-source-crypto';

@Controller('api/diagnosis/learning')
export class LearningPlanController {
  constructor(private readonly service: LearningPlanService, private readonly source: LearningReportSource,
    private readonly sourceCrypto: LearningSourceCrypto) {}
  private identity(req: Request) {
    if (!req.userContext?.userId) throw new UnauthorizedException('请先登录');
    return { userId: req.userContext.userId, userName: req.userContext.userName || '' };
  }
  @Post('report-source')
  @NeedLogin()
  @CanRole(['sales', 'admin'])
  @Header('Cache-Control', 'no-store')
  readSource(@Body() body: unknown, @Req() req: Request) {
    return this.source.read(this.sourceCrypto.open(body, this.identity(req).userId));
  }
  @Get('source-key')
  @NeedLogin()
  @CanRole(['sales', 'admin'])
  @Header('Cache-Control', 'no-store')
  sourceKey(@Req() req: Request) { return this.sourceCrypto.publicKey(this.identity(req).userId); }
  @Post('plans')
  @NeedLogin()
  @CanRole(['sales', 'admin'])
  start(@Body() body: unknown, @Req() req: Request) { return this.service.start(body, this.identity(req)); }
  @Get('plans/by-request/:requestId')
  @NeedLogin()
  @CanRole(['sales', 'admin'])
  @Header('Cache-Control', 'no-store')
  find(@Param('requestId') id: string, @Req() req: Request) { return this.service.find(id, this.identity(req).userId); }
  @Get('plans/:jobId')
  @NeedLogin()
  @CanRole(['sales', 'admin'])
  @Header('Cache-Control', 'no-store')
  job(@Param('jobId') id: string, @Req() req: Request) { return this.service.job(id, this.identity(req).userId); }
  @Get('plans/:jobId/materials')
  @NeedLogin()
  @CanRole(['sales', 'admin'])
  @Header('Cache-Control', 'no-store')
  materials(@Param('jobId') id: string, @Req() req: Request) {
    return this.service.materialMatches(id, this.identity(req).userId);
  }
  @Get('plans/:jobId/product-materials')
  @NeedLogin()
  @CanRole(['sales', 'admin'])
  @Header('Cache-Control', 'no-store')
  productMaterials(@Param('jobId') id: string, @Req() req: Request) {
    return this.service.productMatches(id, this.identity(req).userId);
  }
  @Get('plans/:jobId/product-materials/:materialId/image')
  @NeedLogin()
  @CanRole(['sales', 'admin'])
  async productImage(@Param('jobId') id: string, @Param('materialId') materialId: string,
    @Req() req: Request, @Res() res: Response) {
    const image = await this.service.productImage(id, materialId, this.identity(req).userId);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', image.contentType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(image.name)}`);
    res.send(image.body);
  }
}
