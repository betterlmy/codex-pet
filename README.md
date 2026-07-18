# codex-pet

从 Codex 终端宠物中提取的独立桌宠原型，同时提供 Electron 桌面悬浮窗和
Kitty/Sixel 终端前端。项目不读取 Codex 会话状态；桌面端可以按用户配置连接
OpenAI Chat Completions 兼容服务，处理当前应用中选中的文本。

## 架构

- `pet-core`：宠物清单、默认动画和自动行为状态机。
- `pet-assets`：内置资源下载、校验、缓存和精灵帧切割。
- `pet-terminal`：Kitty、iTerm2 Kitty 文件模式和 Sixel 渲染。
- `pet-runtime`：供 Electron 启动的 JSONL stdio sidecar。
- `apps/desktop`：透明置顶窗口、托盘菜单和窗口设置。
- `apps/cli`：终端入口和资源管理命令。

## Windows 本地开发

在 PowerShell 中执行：

```powershell
cargo build --workspace
npm run install:desktop
npm run build
$env:CODEX_PET_RUNTIME = (Resolve-Path ".\target\debug\codex-pet-runtime.exe")
npm run desktop
```

开发环境需要 Rust stable 和 Node.js 22 或更高版本。Electron 42 的 npm 包需要显式
下载平台运行时，因此不要用普通的 `npm install --prefix apps/desktop` 替代
`npm run install:desktop`。

## macOS 本地开发与打包

在 Apple Silicon Mac 上执行：

```bash
cargo build --workspace
npm run install:desktop
npm run build
CODEX_PET_RUNTIME="$PWD/target/debug/codex-pet-runtime" npm run desktop
```

生成 Apple Silicon ARM64 DMG：

```bash
cargo build --release --locked -p pet-runtime
npm run package:mac
```

生成的 `codex-pet-macos-arm64-<版本>.dmg` 位于 `artifacts/`。未配置 Apple Developer
证书时产物不带签名和公证，首次打开可能需要在 Finder 中右键选择“打开”。推送到
`main` 后，GitHub Actions 会生成 Apple Silicon (`arm64`) DMG；当前不提供 Intel 版本。

### 绕过 macOS“应用已损坏”提示

当前 DMG 未使用 Apple Developer 证书签名，也未经过 Apple 公证。从浏览器下载后，
macOS 会为应用添加隔离属性，Gatekeeper 可能因此提示“应用已损坏，无法打开”。这不代表
DMG 文件本身一定损坏。

请仅对来源可信、且确认由本项目构建的安装包执行以下操作：

1. 将 `codex-pet.app` 从 DMG 拖到“应用程序”目录。
2. 先在 Finder 中右键点击应用，选择“打开”。
3. 如果仍提示应用已损坏，在终端中移除该应用的隔离属性，然后重新打开：

```bash
xattr -dr com.apple.quarantine /Applications/codex-pet.app
open /Applications/codex-pet.app
```

以上命令只处理 `/Applications/codex-pet.app`，不要对整个“应用程序”目录或其他下载文件
批量移除隔离属性。后续版本完成 Developer ID 签名和 Apple 公证后，将不再需要此操作。

## GitHub Actions 便携版

推送到 `main` 分支时，`.github/workflows/windows-portable.yml` 会在 GitHub 的
`windows-latest` x64 构建机上运行测试、编译 Rust sidecar，并生成：

```text
codex-pet-portable-x64-<版本>.exe
```

构建完成后，在对应 Actions 运行页面的 Artifacts 区域直接下载生成的 EXE。产物保留
30 天。当前便携版不带代码签名，Windows 可能显示“未知发布者”或 SmartScreen 提示。

如果需要在 Windows 本机复现 GitHub Actions 的打包过程：

```powershell
cargo build --release --locked -p pet-runtime
npm ci --prefix apps/desktop
npm run electron:install --prefix apps/desktop
npm run package:win
```

生成的 EXE 位于 `artifacts/`。

## Linux/WSL2 本地开发

```bash
cargo build --workspace
npm run install:desktop
npm run build
CODEX_PET_RUNTIME="$PWD/target/debug/codex-pet-runtime" npm run desktop
```

在 WSL2 内启动上面的命令时，桌面端由 WSLg 显示。若要从 WSL2 交叉构建 Windows
可执行文件，可执行：

```bash
rustup target add x86_64-pc-windows-gnu
cargo build --release --target x86_64-pc-windows-gnu \
  -p codex-pet -p pet-runtime
```

交叉构建需要 `gcc-mingw-w64-x86-64`。若项目直接位于 Windows 文件系统中，优先使用
前面的 PowerShell 流程启动 Windows Electron；Electron 不支持直接把 WSL 的 UNC 目录
作为应用入口。

## 终端前端

```bash
cargo run -p codex-pet -- terminal --pet codex --protocol auto
```

终端宠物默认使用与 Codex ambient pet 一致的右下角锚定布局；如需旧版居中展示，添加
`--centered`。自动协议检测会对 tmux、Zellij、过旧 iTerm2 和不支持图片的终端给出明确原因。

首次使用内置宠物时会从 Codex CDN 下载 spritesheet。可通过
`CODEX_PET_HOME` 覆盖数据目录；自定义宠物放在
`$CODEX_PET_HOME/pets/<pet-id>/pet.json`。

## 快捷操作

- 桌面端：悬停显示控制条；托盘菜单可打开独立宠物选择窗口、切换自动行为、暂停和点击穿透。
  选择窗口支持内置宠物、自定义 `pet.json`、旧版 `avatar.json`、异步预览和禁用桌宠。
- AI 气泡：在托盘菜单打开“AI 设置”，配置 Base URL、模型、API Key 和 Prompt 动作。
  每个动作拥有独立全局快捷键；选中文本并按下快捷键后，结果会流式显示在宠物旁边。
  请求中、等待输入、完成和失败会映射为 Codex pet 的 `Running`、`Waiting`、`Review`、
  `Failed` 动画语义；状态动画先播放三轮，再回到 idle 循环。
- 前置代理：AI 设置支持全应用 HTTP、HTTPS、SOCKS4 和 SOCKS5 代理；`socks://` 按
  SOCKS5 处理，`localhost`、`127.0.0.1` 和 `::1` 自动直连。代理 URL 可以携带
  用户名和密码，密码会从配置地址中移除并使用操作系统安全存储加密。
- 终端端：`q`/`Esc` 退出，空格暂停，`n` 立即切换行为，`a` 切换自动行为。

API Key 使用操作系统安全存储加密，且不会发送到渲染进程。远程模型地址必须使用
HTTPS；本机 `localhost` 服务可以使用 HTTP。Windows 会优先通过 UI Automation
读取选区，失败时临时模拟复制；Linux 使用 Selection Clipboard。

## 资源声明

当前官方 CDN 资源只用于本地原型。公开分发前请阅读 `NOTICE.md` 并替换资源或取得许可。
