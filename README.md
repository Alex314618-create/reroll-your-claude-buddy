# Reroll Your Claude Buddy

## 中文

面向普通用户的 Claude Buddy 本地工具。

这一版只保留一条产品线：`Portable`。

- 一键启动
- 自动搜索
- 直接应用
- 单文件 `exe`

使用方式：

1. 从 Release 下载 `ClaudeBuddyLocalPortable.exe` 或 `ClaudeBuddyLocalPortable.zip`
2. 如果下载的是 zip，先解压
3. 双击 `ClaudeBuddyLocalPortable.exe`
4. 选择你想要的 Buddy 外观
5. 点击开始，等它自动搜索
6. 选中结果后直接应用

它会在本机启动一个很小的本地宿主，只服务当前页面，不依赖远端后端。

### 当前发布物

- `ClaudeBuddyLocalPortable.exe`
- `ClaudeBuddyLocalPortable.zip`

### 前提

如果你希望写入后的 `userID` 真正对 Claude Code 生效，请先完成 Claude Code 自己的认证流程：

1. 设置 `CLAUDE_CODE_OAUTH_TOKEN`
2. 运行 `claude setup-token`
3. 确认 `~/.claude.json` 已生成

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

A local Claude Buddy tool built for normal users.

This repo now keeps only one product line: `Portable`.

- one-click launch
- automatic search
- direct apply
- single-file `exe`

How to use it:

1. Download `ClaudeBuddyLocalPortable.exe` or `ClaudeBuddyLocalPortable.zip` from Releases
2. Extract the zip if needed
3. Double-click `ClaudeBuddyLocalPortable.exe`
4. Choose the Buddy look you want
5. Start the roll and let it search automatically
6. Select a result and apply it directly

The app starts a tiny local host on your machine and serves only the local UI.

### Release Assets

- `ClaudeBuddyLocalPortable.exe`
- `ClaudeBuddyLocalPortable.zip`

### Prerequisite

If you want the written `userID` to actually take effect in Claude Code, finish Claude Code's own auth setup first:

1. Set `CLAUDE_CODE_OAUTH_TOKEN`
2. Run `claude setup-token`
3. Make sure `~/.claude.json` exists

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
