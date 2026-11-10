# M0 实施计划（2026-11-10，已确认）

依据：产品方案 v0.3、研发方案 v0.2 及已确认设计。首期 M0，不宣称 M1–M5 完成。

## 分包与责任
1. `packages/runtime`：Hono HTTP/SSE、认证、模型适配、Worker、持久化适配；`packages/core`：记忆、授权、manifest 与领域测试；`supabase`：迁移、RLS、受控 RPC、核心保护。先领域测试再联接 HTTP。
2. `apps/mobile`：Expo Router Web/Android，孵化、PA 聊天、手账、团队与组件、授权审计、日程、导出和设置。
3. 根工作区：pnpm、严格 TS、CI、端到端联调、中文运行/部署/需求追踪和真实测试记录。

## 客户端/Runtime v1 合同
- Runtime `http://localhost:8787`，所有 API `/api`，JSON。demo 模式固定本地身份且只允许 loopback；configured 模式 Supabase bearer token，不接受客户端 user_id。客户端配置 `EXPO_PUBLIC_API_URL`、`EXPO_PUBLIC_MODE=demo|configured`。
- `GET /api/bootstrap` 返回 `{mode,pa,blocks,memories,pendingMemories,grantRequests,grants,audit,schedules,inbox,styles,events}`，不存在的 PA 为 null，其余数组。返回对象均含 id，时间为 ISO。
- `POST /api/pa/candidates` 输入 `{name,appearance,personality,relationship,exclusions}` 返回 `{candidates:[{id,imageUrl?,description}],...}`；`POST /api/pa/confirm` 输入 `{candidateId}`；`PATCH /api/pa` 改名。
- `GET /api/sessions?blockId=pa` 返回 `{sessions}`；`POST /api/sessions` 输入 `{blockId}` 返回 `{session}`；`GET /api/sessions/:id/messages` 返回 `{messages}`；`POST /api/sessions/:id/messages` 输入 `{content}`，返回 SSE，`event: message` 的 data 为完整 assistant message JSON，`event: done` 的 data 为 `{}`。UI 用 fetch 流消费，非流兼容不假装模型工作。
- `POST /api/memories` 输入候选 `{content,subject?,category?,user_signal?,sensitive?,...}`，服务端判定；`POST /api/memory-consents/:id/decide` 输入 `{allow:boolean}`；`POST /api/memory-conflicts/:id/decide` 输入 `{allow:boolean}`；`PATCH /api/memories/:id` `{content?,tier?,pinned?,state?}`；`DELETE /api/memories/:id`。
- `POST /api/blocks` 输入 `{name,domain,persona,components:["checkin","records","plans"]}`；`PATCH /api/blocks/:id` 输入 `{status?:"active"|"paused",name?,...}`；`DELETE /api/blocks/:id`。`GET /api/blocks/:id/records` => `{records}`；`POST` 同路径 `{component,content,completed?}`；`PATCH /api/blocks/:id/records/:recordId` `{content?,completed?}`；`DELETE` 同路径。
- `POST /api/grant-requests` `{sourceBlockId,granteeBlockId,field,purpose,timeRange?:{from,to}}` 返回 `{decision,request?}`；`POST /api/grant-requests/:id/decide` `{allow:boolean}`（仅本次）；`POST /api/grants` 授权中心输入 `{sourceBlockId,granteeBlockId,field,purpose,confirmedSensitive?:boolean}`；`DELETE /api/grants/:id`。字段词表由 `GET /api/fields` => `{fields}` 提供。
- `POST /api/schedules` `{title,dueAt,timeZone}`，`DELETE /api/schedules/:id`。`POST /api/interactions` `{type:"feed"|"play"}`。`POST /api/styles` `{content,source}`、`PATCH /api/styles/:id` `{content?,status?:"accepted"|"corrected"}`、`DELETE /api/styles/:id`。
- `GET /api/export` JSON；`DELETE /api/account` 输入 `{confirmation:"DELETE",reauthToken?:string}`。`POST /api/worker/tick` 仅 demo 手动验证提醒/夜间流程，configured 禁止公开。
- 成功普通返回 `{entityName: entity}` 或 `{ok:true}`，错误统一 `{error:{code,message}}`，使用 400/401/403/404/409/422/503，不把异常静默转演示。UI mutation 后重新 bootstrap。
- 常用实体展示字段：PA `{id,name,imageUrl,description}`；Memory `{id,content,subject,category,tier,state,reason,source?,createdAt}`；Block `{id,name,domain,persona,status,components}`；Pending `{id,content,reason}`；Grant request `{id,sourceBlockId,granteeBlockId,field,purpose,status,expiresAt}`；Schedule `{id,title,dueAt,timeZone,status}`；Message `{id,role,content,createdAt,ephemeral?}`。

## 验证与完成定义
- 各域单测、跨用户/命名空间和敏感先问/原文单次/核心防夜间/物理删除测试。
- 根类型检查、Expo Web 构建、HTTP 流及端到端；能运行的数据库集成必须实际执行，不能以 SQL 文本检查替代。
- demo 与真实模型测评分开；真实 Supabase/模型/生图/推送和一周体验未执行则明示待验收。
- 审查修复后检查 git diff 与秘密，仅推送新目标仓库，不 force push，不上传原始 DOCX 或用户数据。
