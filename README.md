# conduct-deep-research · 深度调研 Skill

把开放问题研究透，交付带引用、能直接支持决策的报告。
不堆步骤、不凑链接数——重点是研究判断本身。

适用于 Claude Code / Hermes / Codex 等任何支持 Skill 目录的 Agent。

## 一条命令安装

**Windows（PowerShell，复制回车即可）：**

```powershell
irm https://raw.githubusercontent.com/limpidwei/conduct-deep-research/main/install.ps1 | iex
```

**macOS / Linux：**

```bash
curl -fsSL https://raw.githubusercontent.com/limpidwei/conduct-deep-research/main/install.sh | bash
```

默认装到 Claude Code 技能目录（`~/.claude/skills`）。研究主流程**零依赖**，装完即可用。

装到 Hermes（Windows）：

```powershell
irm https://raw.githubusercontent.com/limpidwei/conduct-deep-research/main/install.ps1 -OutFile "$env:TEMP\cdr-install.ps1"; & "$env:TEMP\cdr-install.ps1" -Target "$env:LOCALAPPDATA\hermes\skills\research"
```

## 装完怎么用

在对话里直接说，例如：

- 「深度调研一下 XX 行业 2026 年的竞争格局」
- 「帮我对比 A 和 B 两个产品，给一份带引用的报告」

Agent 会先澄清你要改善的判断，再迭代检索、打开原页核验、主动找反证，最后交付报告。
每次调研留审计痕迹（`research-notes.md` / `run-log.md`），结论措辞不超过证据强度。

**不适用**：简单事实问答、已有文件的普通摘要、翻译、纯排版。

## 可选：HTML/PDF 出版链

默认交付 Markdown，不需要装任何东西。只有要设计型 HTML/PDF 报告时，在 Skill 目录执行一次：

```bash
npm ci && ./node_modules/.bin/playwright install chromium
```

之后要求「PDF 报告」即可自动走检查 → 渲染 → 逐页视觉校对链。

## 手动安装

也可以 `git clone` 本仓库，把整个目录复制到你的技能目录并重命名为 `conduct-deep-research`。

## 许可

MIT License。
