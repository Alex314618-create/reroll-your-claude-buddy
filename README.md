# Claude Buddy Local

面向小白的最快速 Claude Buddy 本地工具。

这版只保留最轻的交付形态：

- `ClaudeBuddyLocal.html`
- `apply-userid.ps1`
- `apply-userid.mjs`

没有桌面壳，没有安装器，没有本地 HTTP 服务。

## 这是什么

这是一个本地优先的 Claude Buddy 筛选和 roll 工具。你可以：

1. 按物种、稀有度、眼睛、帽子、闪光来筛选 buddy
2. 从结果列表里选中自己想要的 buddy
3. 复制一条命令，把对应 `userID` 写入本机 `~/.claude.json`

默认界面只保留最常用的操作。线程数、前缀、随机字节数、顺序搜索这些技术参数都收进了“高级设置”。

## 为什么这版更轻

现在发布物只有：

- 一个单文件网页
- 一个 PowerShell 应用脚本
- 一个 Node 应用脚本

已经移除：

- `.NET` 桌面壳
- 安装器链路
- 本地 HTTP 服务
- `SEA exe` 发布路线

## 最适合谁

- 想快速 roll 到自己喜欢的 buddy
- 不想折腾复杂环境
- 更希望看到清楚直观的界面
- 希望工具本身尽可能轻、容易发布到 GitHub

## 小白使用方式

1. 直接打开 `ClaudeBuddyLocal.html`
2. 在页面里筛选并搜索 buddy
3. 在结果列表里选中一个
4. 点击“复制 PowerShell 命令”
5. 在同目录打开 Windows PowerShell，粘贴执行

如果你更习惯 Node，也可以复制 Node 命令。

## 前置条件

如果你希望写入的 `userID` 真正作用到 Claude Code Buddy，请先完成 Claude Code 自己的 token 配置流程：

1. 设置 `CLAUDE_CODE_OAUTH_TOKEN`
2. 运行 `claude setup-token`
3. 确认系统已经生成 `~/.claude.json`

## 发布物

构建 release 不需要先 `npm install`。

直接运行：

```powershell
node scripts/build-release.mjs
```

或者：

```powershell
npm.cmd run build:release
```

输出：

```text
dist\ClaudeBuddyLocal.html
dist\apply-userid.ps1
dist\apply-userid.mjs
```

打包 zip：

```powershell
node scripts/build-zip.mjs
```

或者：

```powershell
npm.cmd run build:zip
```

输出：

```text
dist\ClaudeBuddyLocal-release.zip
```

## 应用脚本

PowerShell 版本：

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\apply-userid.ps1 -UserId "YOUR_USER_ID"
```

Node 版本：

```powershell
node .\apply-userid.mjs "YOUR_USER_ID"
```

可选参数：

- `-NoBackup` / `--no-backup`
- `-KeepCompanion` / `--keep-companion`
- `-KeepAccountUuid` / `--keep-account-uuid`

也支持用环境变量 `CLAUDE_CONFIG_PATH` 覆盖默认配置路径。
如果这个路径的父目录不存在，Node 和 PowerShell helper 都会自动创建。

## 测试

```powershell
npm.cmd test
```

当前测试覆盖：

- hash 自检
- roll 的 deterministic 行为
- filters 逻辑
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

- 如果当前环境禁止测试进程拉起 `powershell.exe`，PowerShell 集成项会显示为 `SKIP`，不会再伪装成 `PASS`。
