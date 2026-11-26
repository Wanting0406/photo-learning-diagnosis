# 中高考宣传长图匹配：实现与验收

状态：本地功能已实现并验证，未提交、推送或发布。正式环境未配置新表 ID。

## 交付结果

| 项目 | 结果 |
| --- | --- |
| 候选素材 | 67 张，限定 2025/2026 中高考指定栏目及高考长图子文档 |
| 选定原图 | 51 张，37 组内容；四个年度考试组合均覆盖 |
| 排除项 | 10 张封面、单题截图或拼接重复；另排除 6 张重复/较低清晰度版本 |
| 试点 | 8 张，每个年度考试组合 2 张，通过原图、映射及匹配验证 |
| 已审核映射 | 191 条，来自 146 条逐项目视核对证据，再关联同内容横竖版 |
| 待复核映射 | 757 条，保留在表内，不参与检索；不能把模型自报“高置信度”视为已审核 |
| 原图验证 | 51/51 从飞书附件下载后 SHA-256 与源文件一致 |
| 缓存纯匹配 | 实际全量索引 1000 次测量，P95 约 0.17ms；目标不超过 200ms |
| 首次索引读取 | 本机实测约 2.45 秒，包含飞书分页网络读取，不属于纯匹配耗时 |
| 模型调用 | 在线匹配增加 0 次；离线资料提取使用现有 qwen3.5-omni-plus |

飞书表沿用现有业务多维表格，不新增存储平台，也不增加 FC 依赖：

- [长图素材表](https://guanghe.feishu.cn/base/DMIKbwdZmasDJPs34BqccPijnjb?table=tblB9YPSR3VZvwu2)
- [知识点映射表](https://guanghe.feishu.cn/base/DMIKbwdZmasDJPs34BqccPijnjb?table=tblbAEDvXRgBQZ4s)

原图保存在附件字段，缩略图单独保存。没有把临时下载地址作为永久链接。完全相同的文件按 SHA-256 复用附件，横竖版按内容组归并。

## 匹配流程

1. 复用当前登录用户已完成的识别任务中的知识点；课程标题只作为附加证据。
2. 限定中考/高考学段和学科，依次匹配标准词、已审核别名、保守包含关系。忽略“函数”“方程”“计算”等泛词。
3. 按匹配强度、知识点覆盖、明确地区、年度、竖版排序；同内容组及相同文件去重，最多三张。
4. 前端独立异步请求长图；课程结果和报告生成无需等待。无可靠结果、索引不可用和图片失败均单独展示。
5. 显示整图名称、年度、考试、学科、地区和命中知识点；支持整图预览、100%-300% 缩放、原图下载、查看来源。

宣传图仅代表历史相关资料，不据此宣称本次学生题目已被押中，不传入或替换产品能力库。

## 接口与权限

接口基路径由平台添加 `/app/app_17dsmxamvns`：

- `GET /api/diagnosis/jobs/:jobId/materials`：登录且具备 sales/admin；只读取当前用户自己的已完成识别任务。
- `GET /api/diagnosis/materials/:materialId/image?thumbnail=0|1&download=0|1`：同样受角色保护；只能使用素材 ID，无法提交任意附件 token。每次读取附件前重新检查素材审核状态。
- 结果使用共享 `MaterialMatch` 类型，不暴露附件 token。图片响应禁用缓存嗅探，使用私有不缓存策略和 UTF-8 下载文件名。
- 索引缓存十分钟，合并并发读取；分页失败不缓存半份结果，后续请求可重试。原图按需读取，最多 32MB；普通客户照片原有上限未改变。

本地配置：

```text
BITABLE_MATERIAL_TABLE_ID=tblB9YPSR3VZvwu2
BITABLE_MATERIAL_MAPPING_TABLE_ID=tblbAEDvXRgBQZ4s
```

这两个表 ID 没有推送到平台环境。测试时通过本地启动进程注入；本地网关身份模拟仅用于验证 sales/admin，未修改正式角色或关闭权限校验。

## 素材与复核

主文档：`Ls24w0CnoiUVYnk9OtGchGbmnhc`；仅额外读取已批准的长图子文档 `Ia9jwKznRiAamQksFMAcDyrNnRg`。没有遍历无关链接，也没有导入 2025 中考散点对照表。

先按栏目与版式筛选，再下载选定范围原图。每组选择一个清晰代表图分块提取题旁标签；保留标签原文、题号、置信度、证据分块和位置。未解整卷，也未根据题干猜测未标注知识点。

审核由 Codex 对照原图标签逐项完成，并在审核说明中明确“非人工业务签审”。其余候选标签保持待复核，仍需要业务/教研扩大覆盖，不能称为全部标签已审核。

发现并修正的源数据问题：候选编号 30 的栏目名写“数学江苏苏州卷”，原图明确写“2026年中考化学苏州卷”，题旁标签也为化学；按原图核定为化学并记录修正说明。

## 离线脚本

在项目目录使用 Node.js 24、现有服务端环境变量以及已安装的 ts-node。`WORK` 指向独立的资料工作目录，脚本不会发布应用。

```sh
TS_NODE_PROJECT=tsconfig.node.json node --env-file=.env.local --require ts-node/register scripts/materials-import.cjs inventory "$WORK"
TS_NODE_PROJECT=tsconfig.node.json node --env-file=.env.local --require ts-node/register scripts/materials-import.cjs download "$WORK"
python scripts/material-images.py "$WORK"
TS_NODE_PROJECT=tsconfig.node.json node --require ts-node/register scripts/materials-screen.cjs "$WORK"
TS_NODE_PROJECT=tsconfig.node.json node --env-file=.env.local --require ts-node/register scripts/materials-extract.cjs "$WORK" pilot
python scripts/materials-review.py "$WORK"
```

`materials-approve.cjs WORK 证据编号列表` 必须在查看对应复核图片之后使用。`manual-labels.json` 保存逐项纠正记录，不能自动把全部模型标签设为已审核。

`materials-publish-data.cjs WORK pilot|all` 名称中的 publish-data 仅指把素材与映射写入飞书，**不发布应用**。脚本会校验表结构、复用已上传附件、跳过已有记录、将通过复核的待审核记录更新为已审核；保留已有已审核记录的修改。

试点验证通过后，运行 `materials-extract.cjs WORK all` 处理其余内容。已有成功分块可复用；模型限流、失败或格式错误需再次运行以补齐，保留原始输出供排查。不要重复运行 inventory 覆盖已积累的筛选/校验状态，新增资料使用新的工作目录。

`materials-verify.cjs WORK pilot|all` 验证原图及匹配；`materials-http-verify.cjs` 验证本地实际接口和角色；`materials-ui-fixture.cjs --apply/--cleanup` 仅创建/清理已标记的测试任务；`materials-deliver.cjs WORK` 导出脱敏的清单和验收结果。

## 验收与限制

- 原有 38 项回归与新增匹配测试通过；类型、ESLint、样式检查及生产构建通过。
- 实际本地 HTTP：匿名/无角色拒绝，sales/admin 可匹配，跨用户任务拒绝，任意附件参数拒绝，销售无法读取管理员配置。
- 桌面 1440×1000、手机 390×844 验证真实飞书附件；手机页面宽度没有溢出，原始 800×16600 竖图可查看和缩放。
- 下载 `2025中考-数学-湖北卷-竖版-44.png`，文件名正确，文件 SHA-256 与原图一致。
- 自动化覆盖精确词、别名、保守匹配、泛词、跨学科学段、横竖版/同文件去重、无结果、缓存合并及审核撤销。
- 本地模拟网关身份的验证不替代发布后的真实平台登录验收。当前按指令不发布，线上验收尚未进行。
- 主要剩余风险是映射覆盖率：757 条待复核记录不参与检索，可能出现原图相关但暂未推荐的情况。不得为了提高召回率取消审核门槛。

## 周会口径

本次完成了宣传长图从文档筛选、附件归档、知识点映射到页面推荐的本地闭环；51 张整图、37 组内容均有可用映射。新功能处于开发验证阶段，暂未进入正式试用。

本周完成度应分别汇报：素材归档与整图校验 51/51，内容组可匹配 37/37，计划试点 8/8；标签全量业务复核尚未完成，不能把功能完成等同于内容准确率已全部验收。

最大的风险是自动提取混入课程截图标题、标签被分块截断或原文档学科命名错误。已通过原图核对、保守检索和审核门槛控制；需要学科教研支持扩大已审核映射。

建议下周唯一主目标：完成待复核映射的业务评审，交付可评审的标签复核报告。验收：757 条待复核记录逐条给出通过/修正/排除结论，抽查不少于 50 条已通过映射且标注依据正确率不低于 95%。建议项目 Owner 为孟婉婷，教研复核人待指定，目标日期为 2026-09-18；这是建议安排，未替任何成员作承诺。

可复用沉淀包括：限定栏目素材清单、SHA-256 附件去重、可续跑提取脚本、题旁标签证据链、审核索引、独立异步媒体组件和权限验收脚本。若重做，会更早用八张原图确定标签提取规则与命名规则，再进行批量识别，减少误取课程标题和错误学科元数据的返工。
