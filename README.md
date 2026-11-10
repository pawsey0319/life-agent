# Life Agent · 生活个性化平台

**一只一直陪着你的 PA，一支由你决定的 Agent 团队。**

依据《产品方案 v0.3》与《研发方案 v0.2》重新实现，不合并旧原型代码。本仓库当前交付单元为 **M0 自用内测**；穿搭师、外部适配器与熟人社交属于后续路线。

## 重要边界
- **演示不等于接通真实 AI。** demo 模式明确标识，不能部署公网或输入私人数据。
- **工程规则不等于模型质量。** 单元测试不能替代300条人工标注、真实模型保持率和本人连续一周体验。
- **云端未执行的验收不算通过。** Supabase RLS/事务、真实模型/生图、Android 设备和系统推送需要配置后单独验证。
- 原始方案、用户数据、模型密钥不随仓库上传。

## 仓库结构

```text
apps/mobile        Expo Router / React Native，Web + Android
packages/core      记忆、manifest、授权等确定性领域规则
packages/runtime   Hono HTTP/SSE、模型适配、持久化和 Worker
supabase           Postgres 迁移与受控数据层
 tests             HTTP 冒烟、浏览器验收、评测种子与仓库卫生检查
 docs              设计、实施合同、需求追踪和部署/安全说明
```

## 开发环境
Node.js 22+、pnpm 10.11.0。项目使用 pnpm workspace，所有依赖从仓库根安装。云数据库集成另需 Supabase CLI 与 Docker，或独立测试 Supabase 项目；不要对生产用户运行破坏性测试。

```bash
pnpm install
# 终端一：本地内存演示，关闭即清空数据
RUNTIME_MODE=demo pnpm dev:runtime
# 终端二：浏览器客户端（使用启动命令实际输出的 URL）
EXPO_PUBLIC_MODE=demo EXPO_PUBLIC_API_URL=http://127.0.0.1:8787 pnpm dev:web
```

客户端只通过 Runtime 执行业务请求；配置模式登录使用 Supabase Auth，服务角色和主密钥永远只留服务端。缺配置必须报错，不自动切换演示。

## 验证

```bash
pnpm typecheck
pnpm test
EXPO_PUBLIC_MODE=demo EXPO_PUBLIC_API_URL=http://127.0.0.1:8787 pnpm build:web
# fresh demo Runtime 运行时：
pnpm test:http
# 已导出 Web、启动本地静态验证服务后：
pnpm serve:export
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" pnpm test:e2e
# 或先 pnpm exec playwright install chromium 再执行
```

实际执行结果与未完成边界见[验证记录](docs/validation.md)，不以文档中的验收目标冒充结果。配置模式变量见[服务端环境示例](packages/runtime/.env.example)和[客户端环境示例](apps/mobile/.env.example)。这些示例不会自动加载；显式导出变量或使用部署平台的秘密配置。

> 当前配置模式采用 per-user DEK 加密聚合与 CAS，并未接入迁移中的完整规范化逐对象写入。这是工程内测骨架，不是完整 M0 生产验收。pgvector 语义检索与 pgmq 消费仍须集成；不能仅因为 SQL 已提供就宣称运行时已接通。

## 核心产品规则
- 每账号一只 PA，确认后不能删除重孵；注销账号才一起删除。
- PA 负责陪伴、通用助理和专业调度，不替代专业判断。
- 记忆写入时定核心/普通/琐碎；核心不自动淡忘，核心冲突先确认。
- “记住”不绕过敏感存储同意；保存、分享、读原文是三个独立授权。
- 积木间没有直接数据通道；未知/禁止字段拒绝，外部敏感逐次确认。
- 原文仅 PA 单次、指定来源时段用途，用完即失效；不自动写记忆或后续上下文。
- 拆卸清理命名空间与授权，删除记忆清理检索派生物；队列不能复活已删数据。

## 文档
- [已确认 M0 设计](docs/superpowers/specs/2026-11-10-life-agent-m0-design.md)
- [实施计划与 HTTP 合同](docs/implementation-plan.md)
- [需求追踪](docs/requirements.md)
- [部署与运维](docs/deployment.md)
- [安全边界](docs/security.md)
- [模型验收协议](docs/model-evaluation.md)

## 路线
M0：PA、记忆手账、平台日程、自定义积木与授权底座。
M1：穿搭师、两路衣橱录入、Look 图集、阶段 A 渲染和早报。
M2：外部 OpenAI/MCP 优先，逐步接入其他适配、网页/导入、模板分享与熟人社交。
M3–M5：第二个官方积木、虚拟形象、商业化和市场。

完整后续验收见需求追踪；当前没有收费、公开上架或生产就绪承诺。
