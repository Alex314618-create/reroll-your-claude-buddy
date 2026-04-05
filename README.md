# Reroll Your Claude Buddy

<div align="center">

Portable one-click Claude Buddy reroll tool for Windows.

Designed for normal users: open, roll, apply.

[简体中文](#简体中文) · [English](#english) · [Releases](https://github.com/Alex314618-create/reroll-your-claude-buddy/releases)

</div>

---

## 简体中文

### 项目简介

`Reroll Your Claude Buddy` 是一个面向普通用户的 Claude Buddy 本地工具。

这一版只保留一条主产品线：**Portable 一键版**。

它的目标很简单：

- 一键启动
- 自动搜索
- 直接应用
- 单文件 `exe`

你不需要手动跑脚本，也不需要理解复杂参数。

### 下载

- [下载最新 Release](https://github.com/Alex314618-create/reroll-your-claude-buddy/releases)
- `ClaudeBuddyLocalPortable.exe`
- `ClaudeBuddyLocalPortable.zip`

如果你下载的是 `zip`：

1. 解压
2. 双击 `ClaudeBuddyLocalPortable.exe`

### 为什么适合普通用户

- **一键启动**：双击就能打开，不需要额外安装运行时。
- **界面优先**：直接在页面里选择目标外观、开始搜索、应用结果。
- **全自动流程**：搜索、命中、应用都在同一条流程里完成。
- **本地优先**：程序只在你的机器上启动一个很小的本地宿主，不依赖远端后端。

### 使用流程

1. 打开 `ClaudeBuddyLocalPortable.exe`
2. 选择你想要的 Buddy 外观
3. 点击开始
4. 等程序自动搜索
5. 选中结果
6. 点击应用

### 功能概览

| 功能 | 说明 |
| --- | --- |
| 外观筛选 | 支持物种、稀有度、眼睛、帽子、闪光 |
| 本地搜索 | 搜索逻辑在本地完成 |
| 直接应用 | 结果可直接写入 Claude 配置 |
| 单文件发布 | 主发布物就是一个 `exe` |

### 安全与行为说明

- 程序会在本机启动一个很小的本地服务，只服务当前页面。
- 默认只访问 `127.0.0.1`，不会把你的配置上传到远端服务。
- 应用时会写入 `~/.claude.json`，并按设置创建备份。

### 使用前提

如果你希望写入后的 `userID` 真正对 Claude Code 生效，请先完成 Claude Code 自己的认证流程：

1. 设置 `CLAUDE_CODE_OAUTH_TOKEN`
2. 运行 `claude setup-token`
3. 确认 `~/.claude.json` 已生成

### 发布校验

当前发布物校验值：

- `ClaudeBuddyLocalPortable.exe`
  `SHA256: 4C4E8AB1C92B003E310E1726FB1BB71D8702975096CCC598ABF90D483D99DB74`
- `ClaudeBuddyLocalPortable.zip`
  `SHA256: 50E47DF5FE369FFCE80DC09206156A7DE096BAB77EAAC93391825775F78F7E11`

### 本地构建

```powershell
npm.cmd run build:portable
npm.cmd run build:portable:zip
```

### 测试

```powershell
npm.cmd test
```

当前测试覆盖：

- bun-compatible hash 自检
- reroll 结果确定性
- filter 匹配
- 全局 attempt limit 分配
- Rust Portable 构建产物
- Portable `/api/health`
- Portable `/api/config/status`
- Portable `/api/apply`
- BOM 配置、非对象根节点、备份与字段清理

---

## English

### Overview

`Reroll Your Claude Buddy` is a local Claude Buddy tool built for normal users.

This repo now keeps only one main product line: **Portable one-click release**.

The goal is simple:

- one-click launch
- automatic search
- direct apply
- single-file `exe`

You should not need to run helper scripts or understand internal parameters.

### Download

- [Download the latest Release](https://github.com/Alex314618-create/reroll-your-claude-buddy/releases)
- `ClaudeBuddyLocalPortable.exe`
- `ClaudeBuddyLocalPortable.zip`

If you download the `zip`:

1. Extract it
2. Double-click `ClaudeBuddyLocalPortable.exe`

### Why this version

- **One-click launch**: double-click and open, with no extra runtime installation required.
- **UI-first flow**: choose a target look, start the search, and apply the result from the same interface.
- **Automated experience**: search, hit, and apply all stay inside one flow.
- **Local-first behavior**: the app runs a tiny local host on your machine and does not rely on a remote backend.

### User Flow

1. Open `ClaudeBuddyLocalPortable.exe`
2. Choose the Buddy look you want
3. Click Start
4. Let the app search automatically
5. Select a result
6. Apply it directly

### Feature Summary

| Feature | Description |
| --- | --- |
| Appearance filters | Species, rarity, eyes, hat, shiny |
| Local search | Search logic runs locally |
| Direct apply | Writes the selected result into Claude config |
| Single-file release | Main release asset is one `exe` |

### Safety Notes

- The app starts a very small local service on your machine and serves only the current page.
- It stays on `127.0.0.1` by default and does not upload your config to a remote service.
- When you apply a result, it writes to `~/.claude.json` and can create a backup first.

### Prerequisite

If you want the written `userID` to actually take effect in Claude Code, finish Claude Code's own auth setup first:

1. Set `CLAUDE_CODE_OAUTH_TOKEN`
2. Run `claude setup-token`
3. Make sure `~/.claude.json` exists

### Release Checksums

Current release checksums:

- `ClaudeBuddyLocalPortable.exe`
  `SHA256: 4C4E8AB1C92B003E310E1726FB1BB71D8702975096CCC598ABF90D483D99DB74`
- `ClaudeBuddyLocalPortable.zip`
  `SHA256: 50E47DF5FE369FFCE80DC09206156A7DE096BAB77EAAC93391825775F78F7E11`

### Build

```powershell
npm.cmd run build:portable
npm.cmd run build:portable:zip
```

### Test

```powershell
npm.cmd test
```

Current coverage includes:

- bun-compatible hash self-tests
- deterministic reroll behavior
- filter matching
- global attempt-limit distribution
- Rust Portable build output
- Portable `/api/health`
- Portable `/api/config/status`
- Portable `/api/apply`
- BOM config handling, non-object root protection, backups, and field cleanup
