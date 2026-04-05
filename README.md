# Reroll Your Claude Buddy

## 中文

一个面向普通用户的 Claude Buddy 本地工具。

它的重点不是命令行，不是复杂配置，而是：

- 一键启动
- 更好看的界面
- 全自动流程

你只需要：

1. 下载发布页里的 `ClaudeBuddyLocalPortable.exe` 或 `ClaudeBuddyLocalPortable.zip`
2. 双击启动
3. 选择你想要的 Buddy 外观
4. 等它自动搜索
5. 选中结果并直接应用

整个主流程都在界面里完成。
不需要自己手动跑脚本，也不需要理解复杂参数。

### 这是什么

这是一个本地优先的 Claude Buddy reroll 工具。

它支持：

- 按物种、稀有度、眼睛、帽子、闪光筛选
- 自动搜索匹配结果
- 在页面里直接应用选中的 Buddy
- 便携式启动，不需要安装器

### 为什么用它

- 一键启动：双击就开
- 设计更完整：不是简单工具页，而是完整流程界面
- 自动化更强：搜索、重试、应用都尽量在页面里完成
- 本地优先：不会把你的配置写入远端服务

### 当前推荐发布方式

推荐直接使用 Portable 版本。

发布物：

- `ClaudeBuddyLocalPortable.exe`
- `ClaudeBuddyLocalPortable.zip`

如果你下载的是 zip：

1. 解压 zip
2. 双击 `ClaudeBuddyLocalPortable.exe`

### 使用前提

如果你希望写入后的 `userID` 真正对 Claude Code 生效，请先完成 Claude Code 自己的认证配置流程：

1. 设置 `CLAUDE_CODE_OAUTH_TOKEN`
2. 运行 `claude setup-token`
3. 确认系统已经生成 `~/.claude.json`

### 适用平台

- 当前主发布线是 Windows Portable
- 目标用户是想直接双击使用的人

### 本地构建

构建 Portable：

```powershell
npm.cmd run build:portable
```

打包 zip：

```powershell
npm.cmd run build:portable:zip
```

### 测试

```powershell
npm.cmd test
```

当前测试覆盖：

- hash 自检
- roll 的确定性行为
- filters 逻辑
- 全局 attempt limit 分配
- 配置读取与写入
- 非法 JSON / 非对象根节点保护
- Node helper 独立运行
- PowerShell helper 在允许环境中的集成验证

说明：

- 如果当前环境禁止测试进程拉起 `powershell.exe`，PowerShell 集成项会显示为 `SKIP`

---

## English

A local-first Claude Buddy reroll tool built for normal users.

The goal is simple:

- one-click launch
- polished interface
- automated flow

You should be able to:

1. Download `ClaudeBuddyLocalPortable.exe` or `ClaudeBuddyLocalPortable.zip` from Releases
2. Double-click to open
3. Choose the Buddy look you want
4. Let the app search automatically
5. Select a result and apply it directly

The main flow stays inside the UI.
No manual scripting should be required for normal use.

### What It Does

This is a local Claude Buddy reroll tool that supports:

- filtering by species, rarity, eyes, hat, and shiny state
- automatic local search
- direct apply from the page
- portable startup without an installer

### Why This Version

- One-click launch
- Better visual design
- More automated UX
- Local-first config handling

### Recommended Release

Use the Portable release.

Release assets:

- `ClaudeBuddyLocalPortable.exe`
- `ClaudeBuddyLocalPortable.zip`

If you download the zip:

1. Extract it
2. Double-click `ClaudeBuddyLocalPortable.exe`

### Prerequisite

If you want the written `userID` to actually take effect in Claude Code, complete Claude Code's own auth setup first:

1. Set `CLAUDE_CODE_OAUTH_TOKEN`
2. Run `claude setup-token`
3. Make sure `~/.claude.json` exists

### Platform

- Windows Portable is the main release line

### Build

Build Portable:

```powershell
npm.cmd run build:portable
```

Build zip:

```powershell
npm.cmd run build:portable:zip
```

### Test

```powershell
npm.cmd test
```

Current coverage includes:

- hash self-tests
- deterministic reroll behavior
- filter matching
- global attempt-limit distribution
- config read/write safety
- invalid JSON and non-object root handling
- standalone Node helper validation
- PowerShell helper integration in allowed environments
