# 栖伴 M0 客户端

Expo Router + React Native / Web，奶油白、墨绿与青绿的响应式中文工作台。客户端仅通过 Runtime API 访问数据，不持有服务端密钥。

## 启动

在工作区根目录安装依赖后，将 `apps/mobile/.env.example` 复制为 `apps/mobile/.env`。启动 Runtime，再从根目录运行 `pnpm --filter @life-agent/mobile web`。`EXPO_PUBLIC_API_URL` 为 Runtime origin，不含 `/api`。构建时注入环境变量，修改配置后需重新构建。

- `pnpm --filter @life-agent/mobile typecheck`
- `pnpm --filter @life-agent/mobile build:web`：生成本包 `dist/` 静态 Web，可由静态服务器部署，SPA 路由回退到 index.html。
- `pnpm --filter @life-agent/mobile android`：开发设备需 Expo SDK 58 兼容客户端或 development build。当前依赖版本来自 Expo 58.0.23 的 bundledNativeModules 元数据。

## 运行边界

演示模式只接受 loopback Runtime，不调用真实外部服务。Android 模拟器/USB 设备使用 `adb reverse tcp:8787 tcp:8787`，仍填写 `http://127.0.0.1:8787`，不绕过服务端 loopback 保护。

配置模式需要公开的 Supabase URL / anon key，以及完整 Runtime 配置。支持邮箱密码登录，API 自动携带当前 Supabase bearer token。账号删除前使用密码重新验证，再提交 fresh token。没有配置、登录失败、模型失败、模式不一致都显式报错，不静默回演示。请先在 Supabase 创建账号；M0 未提供注册、密码找回或 OAuth。

聊天使用 Expo fetch 流消费 SSE 的 `message` / `done` 事件，普通 JSON 响应不会伪装成流。断流报错，刷新会话检查服务器已保存内容后再发送，避免重复。临时原文派生内容仅保留在当前轮 UI，不从历史恢复。

日程输入带明确 UTC/偏移的 ISO 时间，保存 UTC 和 IANA 时区。M0 只支持一次性站内提醒；系统推送未启用。导出在 Web 下载 JSON，在原生使用系统分享面板（JSON 文本）。备份删除遵循部署服务实际保留策略。

## 待真实环境验证

Supabase 登录/刷新/重新验证删除、真实模型 SSE、真实生图、Android 设备流与分享、真实推送均需独立验收；Web 构建与类型检查不代表这些已通过。UI 与 API 的完整演示流程由根工作区端到端测试覆盖。
