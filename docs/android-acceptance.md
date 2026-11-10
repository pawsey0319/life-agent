# Apple Silicon Mac：Android 模拟器准备与验收

历史记录（2026-11-10）：本机 arm64、约98GiB可用空间、Java25，当时未发现 Android Studio/SDK/adb，用户选择先模拟器、本机 Runtime。

进展更新（2026-11-11）：当前已确认本机 arm64，Android Studio、SDK、adb 与 API 36 ARM64 模拟器在线；原生 APK 尚未构建通过（许可证/构建元数据仍在处理），因此不能宣称 Android 原生验收通过。

## 1. 安装与检查

从 Android 官方网站下载 Apple 芯片版 Android Studio，首次选择 Standard，完成 SDK、Platform Tools 和 Emulator 安装。不要从不明镜像下载。Android Studio 内附 JDK；原生构建前按当前 Expo/RN/Gradle 插件要求核对版本，不能直接假设系统 Java25 兼容。

SDK Manager 中安装构建所需的 SDK Platform/Build Tools。不要仅依据本文猜测 API 版本：生成原生工程后以其 Gradle 配置为准。Device Manager 新建普通 Pixel 手机，使用可用稳定版 ARM64 系统镜像。先启动到桌面，再执行：

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
adb version
adb devices
emulator -list-avds
```

`adb devices` 必须显示在线 emulator；只有命令存在不算设备就绪。若有多个设备，后续明确指定序列号。

## 2. 安全连接本机 Runtime

模拟器的 `127.0.0.1` 默认是模拟器自身，不是 Mac。推荐使用 adb 端口反向，避免让服务监听局域网：

```bash
adb reverse tcp:8787 tcp:8787
adb reverse tcp:8081 tcp:8081
```

然后客户端使用 `EXPO_PUBLIC_API_URL=http://127.0.0.1:8787`。断开/重启模拟器后可能需重设。只转发本项目端口；撤销用 `adb reverse --remove tcp:8787`，另同理移除8081。

真实配置时，客户端只放 Supabase URL 和 anon/publishable 公钥；服务密钥、DeepSeek Key、数据主密钥不得出现于 `EXPO_PUBLIC_`。Runtime 和 Worker 都在服务端环境运行。`TEXT_*` 与 `EXTRACT_*` 是 configured 核心要求；`EMBED_*`、`IMAGE_*` 可暂不配置。缺少嵌入时相关聊天检索返回503并 fail-closed，不静默切 demo 或伪造向量；缺少生图时图片候选返回503且不入队，Worker 不领取生图任务。任一用途只配置部分字段都会拒绝启动。

## 3. 两层验收，不混淆

### 快速交互检查

仓库根执行 `pnpm --filter @life-agent/mobile android` 可使用 Expo 的 Android 启动流程。Expo Go 是否支持本仓库当前 SDK 必须实测；不兼容则改用 development build，不能靠 Web/Hermes 导出来宣称原生通过。

### 原生构建

需要完整 SDK/JDK/Gradle 条件，执行 Expo 原生构建流程前先核对工作区，生成目录不要盲目提交。记录 SDK、JDK、Gradle、Expo/RN 版本、模拟器镜像、构建命令和错误原文。首次下载依赖可能较大。

```bash
pnpm --filter @life-agent/mobile exec expo run:android
```

若构建或运行报告明文 HTTP 不允许，先仅在开发构建处理本机访问，正式部署使用 HTTPS；不要为省事全局关闭网络安全校验。

## 4. 验收表

逐项记录通过/失败与截图（不得包含密钥、真实敏感正文）：

1. 启动、中文布局、键盘/滚动、返回键与前后台切换。
2. Supabase 注册/登录/退出，错误凭据不进入工作台。
3. 当前未配置图片用途时，确认候选请求明确报能力未配置且无排队任务；待配置生图后，再验 PA 异步候选等待/失败/重试/确认锁与图片显示。
4. 私聊、切换会话不显示旧回复；首次发送不丢消息。
5. 敏感记忆先确认、冲突拒绝/接受、删除后消失。
6. 自定义 Agent 组件记录、暂停只读、清单扩权确认、拆卸清理。
7. 字段授权与单次原文读取、临时内容离页清除。
8. 日程时区、站内提醒和成绩早报；系统推送未实现明确标识。
9. Android 导出分享、重新认证注销、弱网失败提示。

模拟器通过后仍建议至少一部真实 Android 设备验证网络、照片/分享及后台行为。实际系统推送需要独立实现和设备投递证据。
