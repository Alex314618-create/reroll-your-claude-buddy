# Claude Buddy Local

面向小白的 Claude Buddy Portable 一键版。

现在的主发布形态是 Windows Portable：

- 双击 `ClaudeBuddyLocalPortable.exe`
- 自动打开本地页面
- 直接筛选、搜索、选中、应用
- 不需要再复制命令或手动打开 PowerShell

## 这是什么

这是一个本地优先的 Claude Buddy 筛选和 reroll 工具。

你可以：

1. 按物种、稀有度、眼睛、帽子、闪光来筛选 buddy
2. 从结果列表里选中自己想要的 buddy
3. 在页面内直接把对应 `userID` 写入本机 `~/.claude.json`

## 当前推荐版本

推荐直接使用 Portable 版。

Portable 压缩包解压后会包含：

- `ClaudeBuddyLocalPortable.exe`
- `app/` 目录

注意：

- `exe` 和 `app/` 目录必须放在一起
- 用户应解压整个 zip，再双击 `ClaudeBuddyLocalPortable.exe`

## 小白使用方式

1. 解压 Portable 压缩包
2. 双击 `ClaudeBuddyLocalPortable.exe`
3. 等它自动打开页面
4. 搜索并选中一个 buddy
5. 点击“一键应用当前 Buddy”

## 前置条件

如果你希望写入的 `userID` 真正作用到 Claude Code Buddy，请先完成 Claude Code 自己的 token 配置流程：

1. 设置 `CLAUDE_CODE_OAUTH_TOKEN`
2. 运行 `claude setup-token`
3. 确认系统已经生成 `~/.claude.json`

## 构建 Portable

主构建命令：

```powershell
npm.cmd run build:portable
```

会输出：

```text
dist\portable\ClaudeBuddyLocalPortable.exe
dist\portable\app\...
```

打包 Portable zip：

```powershell
npm.cmd run build:portable:zip
```

或者：

```powershell
npm.cmd run build:release
```

会输出：

```text
dist\ClaudeBuddyLocalPortable.zip
```

## 平台说明

- 当前 Portable 主线是 Windows-only
- `build:portable:zip` 目前依赖 `powershell.exe`
- 如果以后要接跨平台 CI，再把 zip 打包改成纯 Node 即可

## 旧的 Lite 构建

仓库里仍然保留了旧的轻量 HTML 方案，主要用于开发和回退，不再是主发布方式。

可选命令：

```powershell
npm.cmd run build:lite
npm.cmd run build:lite:zip
```

## 测试

```powershell
npm.cmd test
```

当前测试覆盖：

- hash 自检
- roll 的 deterministic 行为
- filters 逻辑
- 全局 attempt limit 分配逻辑
- 配置缺失
- 配置损坏 JSON
- 合法但非对象根节点的 JSON 配置
- Node 配置写入、备份和字段清理
- BOM 前缀 JSON 配置
- `CLAUDE_CONFIG_PATH` 指向不存在父目录时的写入行为
- `dist/apply-userid.mjs` 在隔离目录独立运行
- `dist/apply-userid.ps1` 在允许调用 Windows PowerShell 的环境下验证写配置
- `dist/apply-userid.ps1` 遇到损坏 JSON 时不会覆盖原文件
- `dist/apply-userid.ps1` 遇到合法但非对象根节点时不会覆盖原文件

说明：

- 如果当前环境禁止测试进程拉起 `powershell.exe`，PowerShell 集成项会显示为 `SKIP`
