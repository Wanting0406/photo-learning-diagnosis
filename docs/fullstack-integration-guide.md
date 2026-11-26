# 妙搭全栈迁移与部署

## 架构

浏览器/飞书 → 妙搭 React → 平台登录及角色校验 → NestJS → 平台 AI 能力（图片理解 / 文本生成） / 飞书多维表格。

新运行链路已移除阿里云 FC、FC SDK、独立域名和 FastAPI 代理。原 Python 项目保留作为业务规则参考。模型调用已改为妙搭平台官方 AI 能力插件，平台当前绑定豆包，不再使用阿里云百炼接口。

## 功能

- 1–6 张 JPG/PNG/WebP，单张最多 10 MiB、合计最多 12 MiB；服务端检查 MIME、文件头、规范 base64 和请求体。
- 已批改、未批改、混合照片识别；主观或低置信度题保留存疑状态。
- 销售确认的错题范围控制诊断；无错题时不凭空添加学习问题。
- 年级/学科课程映射、会员兼容、家长沟通话术、学习计划。
- 任务先落飞书，前端短轮询；结果在照片与诊断写入前先保存。写库未确认时明确显示警告。
- HTML 报告由服务端转义生成，PNG 在浏览器通过 html2canvas 渲染，不需服务器 Chromium；两种格式均提供预览与下载链接。刷新时可恢复本账号最近一份报告。
- 管理员查看诊断记录、分页照片、服务配置状态和连接检查。配置页只读，密钥只能通过妙搭服务端配置管理。

## 服务端配置

| 变量 | 用途 |
|---|---|
| FEISHU_APP_ID / FEISHU_APP_SECRET | 飞书自建应用身份 |
| BITABLE_APP_TOKEN | 多维表格应用 |
| BITABLE_DIAGNOSIS_TABLE_ID | 诊断记录表 |
| BITABLE_MAPPING_TABLE_ID | 产品映射表 |
| BITABLE_TASK_TABLE_ID | 诊断任务表 |
| BODY_SIZE_LIMIT | 18mb，容纳图片的 base64 开销 |
| LOG_REQUEST_BODY / LOG_RESPONSE_BODY | 均为 false |

### 平台 AI 能力

模型调用统一走平台官方 AI 能力插件，不再配置外部模型地址、密钥或备用模型：

- 图片识别：`student_homework_image_recognition_1`（`@official-plugins/ai-image-understanding`，action `imageUnderstanding`）；
- 文本生成：`learning_diagnosis_text_generation_1`（`@official-plugins/ai-text-generate`，action `textGenerate`）。

照片随请求以 base64 传入，服务端先上传到应用存储、签发 1 小时临时 URL 再交给图片理解实例，调用结束即删除临时文件；文本提示词由服务端组装后经 `prompt` 传入，输出仍按原有 JSON 结构解析。模型由平台绑定，当前实测为豆包，应用侧无法按实例切换模型。

调用失败、超时（180 秒）或输出不可解析时，任务标记失败并提示核对照片或联系管理员，不自动改用其他模型。诊断记录的“识别模型”写平台能力标识；运行日志记录阶段、动作、图片张数与耗时，不记录密钥、图片或上游错误正文。

本地运行 scripts/diagnosis-bootstrap.cjs 默认只预览；--apply 创建或复用任务表并把父项目配置写入忽略的 .env.local（权限 600）。脚本不输出密钥。线上不复制本地模拟身份或数据库跳过选项。

任务表文字列：请求编号、提交用户、学生姓名、模式、状态、进度、输入摘要、结果、错误。数字列：开始时间（毫秒）。已配置表为 tbl2aymLDqP0qOWZ。

## 身份与接口

接口前缀：/app/app_17dsmxamvns/api/diagnosis（由平台 base path 生成）。

| 方法/路径 | 权限 |
|---|---|
| GET session | 登录 |
| GET backend-health | sales/admin |
| POST recognize/:mode | sales/admin |
| POST analyze | sales/admin |
| GET jobs/by-request/:requestId | sales/admin，并检查任务所有者 |
| GET jobs/:jobId | sales/admin，并检查任务所有者 |
| POST report/html | sales/admin |
| GET admin/records、admin/photos、admin/photo、admin/config | admin |
| POST admin/test-feishu | admin |

前端统一使用 axiosForBackend。平台 CSRF cookie suda-csrf-token 与 header x-suda-csrf-token 必须一致。生产请求经平台网关传入权威身份，不能把本地 x-larkgw-suda-webuser 模拟方式当成正式鉴权。

## 任务可靠性边界

请求 UUID 与服务端用户 ID 生成稳定的 UUID v4 格式幂等编号；相同编号但内容不同返回 409。飞书创建接口 client_token 已真实验证可复用原记录，搜索返回的富文本字段统一归一化。单实例同时提交相同请求共享创建过程；单实例最多运行 4 个任务。

这不保证跨实例模型调用恰好一次。两个实例同时读到任务不存在时，虽记录创建有幂等保护，模型仍可能重复执行。应用重启后不会自动重跑任务；超过 15 分钟仍运行的任务在读取时提示中断。飞书是状态和结果存储，不是持久工作队列。正式上线前需确认平台在响应返回后继续运行任务的生命周期，验证缩容、重启和并发行为，必要时接入平台支持的持久执行机制。

## 验证与部署

1. 用 Node.js 24 安装依赖；运行 npm run lint、MIAODA_APP_TYPE=3 npm run build:prod 和 test/diagnosis.test.cjs。
2. 本地 .env.local 仅用于开发。用户已同意专家模式升级，平台环境变量接口现已可用；scripts/diagnosis-platform-config.cjs --environment dev|online 默认仅列出待配置键，添加 --apply 后通过 stdin 设置凭证，不回显变量值。
3. 在专家模式中分别配置预览/线上服务端变量，核对平台自带运行环境；不要为了绕过本地数据库初始化而擅自拆分平台数据库。
4. 平台已定义 sales/admin 角色，创建者已分配 admin；试用人员需加入 sales。保持应用可见范围不变，访问申请由创建者审批。
5. 推送后在妙搭预览中验证匿名、无角色、sales、admin 四类身份；本地模拟身份与装饰器测试不能证明线上权限正确。
6. 用户已授权上线供内部试用。提交推送后发起 release，必须读取 finished 才能交付线上链接，并验证正式入口、任务执行与报告下载。最终发布结果以 release 记录为准。

真实集成检查（会调用模型并创建、清理少量验证记录）：

```sh
DOTENV_CONFIG_PATH=.env.local TS_NODE_PROJECT=tsconfig.node.json node -r dotenv/config -r ts-node/register test/diagnosis-live.cjs --apply --model ../tests/test_photo/named/01.jpg
```

已验证：13 项自动化测试、ESLint、Stylelint、前后端类型检查、全栈生产构建；真实模型识别与诊断、飞书任务轮询、诊断写入、照片上传下载字节比对、幂等参数与搜索文本格式。浏览器和平台生产验收结果见后续验证记录。

## 浏览器验证（2026-09-10）

- 本地浏览器完成照片上传、识别、错题确认、诊断生成和飞书保存；报告可从任务编号恢复，服务端仍校验所有者。
- 桌面 1280px、手机 390px 布局检查无横向溢出；图片实际加载。
- PNG 预览成功生成 900 × 3198 图片，HTML 沙箱预览显示完整内容。
- 管理区记录、照片列表、配置脱敏显示与飞书连接检查已接入；管理员照片预览实际加载 1440 × 1920 卷面。
- 本地 HTTP 请求缺少权威用户身份时返回 401；生产角色隔离仍需平台预览验收。
- 内嵌浏览器未返回下载事件，因此文件实际落盘及飞书移动端下载仍需平台预览验收，不能将预览成功视为下载已验收。
- 本地 Vite 和生产构建共用 dist/client/index.html；生产构建后需重启 Vite，让其重新生成开发 HTML，避免开发页面引用生产脚本而空白。
