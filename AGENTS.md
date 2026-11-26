# 拍照学情诊断

销售团队内部工具。浏览器/飞书访问妙搭 React 页面，NestJS 服务端通过平台 AI 能力（图片理解、文本生成）与飞书多维表格完成识别与诊断。业务数据保存在飞书，不使用妙搭业务数据库，也不依赖 FC、容器或独立 FastAPI 服务。

## 约束

- 保留应用 app_17dsmxamvns 和现有可见范围；当前开发不等同于发布。
- 业务接口使用平台登录即可访问（未分配角色的成员默认拥有销售权限）；管理接口仅 admin。管理员成员只能由管理员在管理区「管理员」页签添加/移除（AuthorizationSDK，server/modules/role-manager）。
- 身份只取服务端 req.userContext，不接受前端传入销售身份。开放接口（/openapi）无登录用户，统一以固定身份 openapi-integration（销售字段记为「开放接口」）落库，同样不接受调用方传入身份。
- 凭证仅在服务端环境变量；不得写入前端、版本库、请求日志或报告。
- 使用飞书多维表格保存诊断、附件、产品映射、任务状态和结果。
- 模型调用走平台官方 AI 能力插件：图片识别 `student_homework_image_recognition_1`、文本生成 `learning_diagnosis_text_generation_1`；照片先上传应用存储并签发临时 URL 再传入，调用后删除。平台当前模型为豆包，不再使用百炼外部接口、备用模型或 VISION_* 变量。
- 不修改 server/main.ts、client/src/index.tsx；遵循 .agents/skills/coding-guide 等现有平台指南。
- 不使用生产认证绕过。DEPRECATED_SKIP_INIT_DB_CONNECTION 与 SUDA_WEBUSER 仅限本地验证。

## 实现

- client/src/pages/HomePage：学生与照片、三种识别模式、错题确认、任务轮询、诊断与 HTML/PNG 报告。
- client/src/pages/AdminHome：诊断记录、分页照片预览与下载、只读服务配置、飞书连接检查、管理员成员管理。
- server/modules/diagnosis-gateway：任务协调、平台 AI 能力调用、飞书读写、报告与数据校验。
- server/modules/role-manager：AuthorizationSDK 封装的管理员成员查询/搜索/添加/移除，仅 admin 可调用。
- server/modules/diagnosis-gateway/diagnosis.openapi.controller.ts：开放接口 POST /openapi/diagnosis/jobs 提交诊断、GET /openapi/diagnosis/jobs/:jobId 轮询结果，复用 DiagnosisGatewayService；对外 spec 见 docs/openapi.json（改接口须同步）。
- shared/api.interface.ts：前后端契约。
- 路由 / 与 /onion-learning 登录即可访问（默认销售权限）；/admin 需要 admin；/access-denied 为权限提示。
- 接口前缀为平台 base path 加 /api/diagnosis；接口列表及部署条件见 docs/fullstack-integration-guide.md。

## 验证

使用 Node.js 24（最低 22）。

```sh
npm run lint
MIAODA_APP_TYPE=3 npm run build:prod
TS_NODE_PROJECT=tsconfig.node.json node --require ts-node/register --test test/diagnosis.test.cjs
```

真实集成验证需要显式 --apply，会创建并清理标记为集成验证的记录；加 --model PHOTO 才调用模型。不得用客户照片替代测试照片。

## 当前上线条件

用户已授权发布供内部试用。平台环境变量管理已可用；通过 scripts/diagnosis-platform-config.cjs 分别配置 dev/online，密钥只走标准输入。当前创建者已分配 admin 角色；其余试用人员默认即有销售权限（无需单独加入 sales），保持登录和访问申请审批。

任务执行在应用进程内，飞书保存状态但不提供持久工作队列。发布后须验证 HTTP 返回后的任务执行和真实权限。重启可能中断任务，跨实例模型调用不保证恰好一次；试用期间需关注这些限制。
