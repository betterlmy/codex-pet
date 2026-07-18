# Codex Pet 能力移植基线

## 上游基线

- 仓库：`https://github.com/openai/codex`
- 提交：`56395bddaf26eb2829387ca6a417bf9128e5b239`
- 上游目录：`codex-rs/tui/src/pets/`
- 集成目录：`codex-rs/tui/src/app/pets.rs`、`codex-rs/tui/src/chatwidget/pets.rs`

本项目以该提交为一次性等价移植基线。完成验收后独立演进，不承诺持续同步上游。
桌面端翻译、代理、全局快捷键和选区读取属于本项目扩展，不计入上游等价范围。

## 能力矩阵

| 能力 | 上游模块 | 本项目目标 | 验收方式 |
| --- | --- | --- | --- |
| 内置宠物 catalog | `catalog.rs` | 8 个内置宠物及元数据一致 | catalog 对照测试 |
| 自定义宠物 | `model.rs` | 支持 `pet.json`、旧版 `avatar.json`、显式路径和路径逃逸防护 | model 对照测试 |
| 动画模型 | `model.rs` | 帧时长、循环起点、单次动画 fallback 和默认动画一致 | 动画逐帧对照测试 |
| 资源下载 | `asset_pack.rs` | CDN 路径、大小限制、缓存校验和原子安装一致 | 资源边界测试 |
| 帧切割 | `frames.rs` | 帧命名、过期缓存清理和无外部命令切割一致 | 像素切割测试 |
| 语义状态 | `ambient.rs` | `Running`、`Waiting`、`Review`、`Failed` 及生命周期一致 | 通知状态测试 |
| 帧调度 | `ambient.rs` | 精确下一帧延迟、关闭动画时固定首帧、fallback 一致 | 时钟测试 |
| Ambient 布局 | `ambient.rs` | 锚点、尺寸、空间不足隐藏和通知预留区域一致 | 布局测试 |
| Kitty 协议 | `image_protocol.rs` | inline、local-file、删除、分块和 tmux 转义一致 | 字节级对照测试 |
| Sixel | `sixel.rs` | 调色板、透明像素、波段和 RLE 一致 | 字节级对照测试 |
| 协议检测 | `image_protocol.rs` | Kitty、iTerm2、WezTerm、Sixel、tmux/Zellij 和不支持原因一致 | 环境矩阵测试 |
| 图像清理 | `mod.rs` | 协议切换、光标恢复、Kitty 删除和 Sixel 区域清理一致 | 输出序列测试 |
| 宠物选择器 | `picker.rs` | 内置、自定义、禁用、当前项和旧版 avatar 导入一致 | picker 数据测试 |
| 宠物预览 | `preview.rs` | 异步加载、固定 idle 首帧、错误和禁用状态一致 | preview 状态测试 |
| 桌面选择窗口 | 桌面适配 | 承载 picker、preview、异步下载和持久化 | Electron 集成测试 |
| 桌面 AI 状态 | 桌面扩展 | 请求中映射 `Running`，等待映射 `Waiting`，成功映射 `Review`，失败映射 `Failed` | 控制器测试 |

## 适配原则

1. 上游纯 pet 逻辑进入共享 Rust crate，不与 Electron 或 Codex TUI 类型耦合。
2. 终端端保留上游语义和输出契约，桌面端只替换布局与绘制适配器。
3. 本项目扩展不得修改上游状态含义；扩展状态通过适配层映射。
4. 任何有意偏离都必须在本文件记录原因和对应测试。
