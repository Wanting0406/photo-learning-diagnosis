import { Body, Controller, Get, Post, Param, Query, Req, Res, UnauthorizedException, BadRequestException, Header } from '@nestjs/common';
import type { Request, Response } from 'express';
import { NeedLogin, CanRole } from '@lark-apaas/fullstack-nestjs-core';
import type { SessionInfo, BackendHealth, RecognitionMode } from '@shared/api.interface';
import { DiagnosisGatewayService, type SalesIdentity } from './diagnosis-gateway.service';

@Controller('api/diagnosis')
export class DiagnosisGatewayController {
  constructor(private readonly service: DiagnosisGatewayService) {}
  private identity(req: Request): SalesIdentity {
    if (!req.userContext?.userId) throw new UnauthorizedException('请先登录');
    return { userId: req.userContext.userId, userName: req.userContext.userName || '' };
  }
  @Get('session')
  @NeedLogin()
  @Header('Cache-Control', 'no-store')
  session(@Req() req: Request): SessionInfo {
    return { ...this.identity(req), roles: req.userContext.roles || [] };
  }
  @Get('backend-health')
  @NeedLogin()
  health(@Req() req: Request): Promise<BackendHealth> {
    this.identity(req); return this.service.checkBackendHealth();
  }
  @Post('recognize/:mode')
  @NeedLogin()
  recognize(@Param('mode') mode: string, @Body() body: unknown, @Req() req: Request) {
    if (!['extract-wrong', 'grade', 'auto'].includes(mode)) throw new BadRequestException('诊断模式无效');
    return this.service.start(mode as RecognitionMode, body, this.identity(req));
  }
  @Post('analyze')
  @NeedLogin()
  analyze(@Body() body: unknown, @Req() req: Request) {
    return this.service.start('analyze', body, this.identity(req));
  }
  @Get('jobs/by-request/:requestId')
  @NeedLogin()
  @Header('Cache-Control', 'no-store')
  findJob(@Param('requestId') id: string, @Req() req: Request) {
    return this.service.findJob(id, this.identity(req).userId);
  }
  @Post('timings')
  @NeedLogin()
  clientTiming(@Body() body: unknown, @Req() req: Request) {
    return this.service.clientTiming(body, this.identity(req).userId);
  }
  @Get('jobs/:jobId')
  @NeedLogin()
  @Header('Cache-Control', 'no-store')
  job(@Param('jobId') id: string, @Req() req: Request) {
    return this.service.job(id, this.identity(req).userId);
  }
  @Post('report/html')
  @NeedLogin()
  report(@Body() body: unknown, @Req() req: Request, @Res() res: Response): void {
    const user = this.identity(req);
    const html = this.service.report(body, user.userName || user.userId);
    res.status(200).set({ 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
      'Content-Disposition': 'attachment; filename="diagnosis.html"' }).send(html);
  }
  @Get('jobs/:jobId/materials')
  @NeedLogin()
  @CanRole(['sales', 'admin'])
  @Header('Cache-Control', 'no-store')
  materialMatches(@Param('jobId') id: string, @Req() req: Request) {
    return this.service.materialMatches(id, this.identity(req).userId);
  }
  @Get('jobs/:jobId/product-materials')
  @NeedLogin()
  @CanRole(['sales', 'admin'])
  @Header('Cache-Control', 'no-store')
  productMaterials(@Param('jobId') id: string, @Req() req: Request) {
    return this.service.productMatches(id, this.identity(req).userId);
  }
  @Get('jobs/:jobId/product-materials/:materialId/image')
  @NeedLogin()
  @CanRole(['sales', 'admin'])
  async productImage(@Param('jobId') id: string, @Param('materialId') materialId: string,
    @Req() req: Request, @Res() res: Response) {
    const image = await this.service.productImage(id, materialId, this.identity(req).userId);
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Content-Type': image.contentType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(image.name)}` }).send(image.body);
  }
  @Get('materials/:materialId/image')
  @NeedLogin()
  @CanRole(['sales', 'admin'])
  async materialImage(@Param('materialId') id: string, @Query('thumbnail') thumbnail = '0',
    @Query('download') download = '0', @Req() req: Request, @Res() res: Response): Promise<void> {
    this.identity(req);
    if (!['0', '1'].includes(thumbnail) || !['0', '1'].includes(download)) throw new BadRequestException('图片参数无效');
    const result = await this.service.materialImage(id, thumbnail === '1');
    res.status(200).set({ 'Content-Type': result.contentType, 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `${download === '1' ? 'attachment' : 'inline'}; filename="material.${result.contentType.split('/')[1]}"; filename*=UTF-8''${encodeURIComponent(result.name)}`,
    }).send(result.body);
  }
  @Get('admin/records')
  @NeedLogin()
  @CanRole(['admin'])
  @Header('Cache-Control', 'no-store')
  records(@Req() req: Request, @Query('pageToken') token = '') {
    this.identity(req);
    if (typeof token !== 'string' || token.length > 2000) throw new BadRequestException('分页参数无效');
    return this.service.records(token);
  }
  @Get('admin/config')
  @NeedLogin()
  @CanRole(['admin'])
  config(@Req() req: Request) { this.identity(req); return this.service.config(); }
  @Get('admin/photos')
  @NeedLogin()
  @CanRole(['admin'])
  @Header('Cache-Control', 'no-store')
  photos(@Req() req: Request, @Query('pageToken') token = '') {
    this.identity(req);
    if (typeof token !== 'string' || token.length > 2000) throw new BadRequestException('分页参数无效');
    return this.service.photos(token);
  }
  @Get('admin/photo')
  @NeedLogin()
  @CanRole(['admin'])
  async photo(@Query('token') token = '', @Req() req: Request, @Res() res: Response): Promise<void> {
    this.identity(req);
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/u.test(token)) throw new BadRequestException('图片参数无效');
    const result = await this.service.photo(token);
    res.status(200).set({ 'Content-Type': result.contentType, 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff' }).send(result.body);
  }
  @Post('admin/test-feishu')
  @NeedLogin()
  @CanRole(['admin'])
  testFeishu(@Req() req: Request) { this.identity(req); return this.service.testFeishu(); }
}
