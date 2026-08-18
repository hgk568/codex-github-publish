# codex-github-publish

**Codex CLI 技能：把本地文件发布到 GitHub 仓库，并自动保护你的 API 密钥。**

由 DSH 的 repo-tools 插件改造而来，专为 [OpenAI Codex CLI](https://github.com/openai/codex) 设计：把"密钥扫描 + 建仓 + 提交 + 推送"封装成一个可复用的 Codex 技能。

## 功能

| 能力 | 说明 |
|---|---|
| `secret-scan.mjs` | 独立密钥扫描：文件名规则 + 内容规则，命中即报错（退出码 1） |
| `publish.mjs` | 一键发布：自动先扫密钥 → 仓库不存在可自动创建（默认私有）→ 克隆 → 复制 → 提交 → 推送 |
| 密钥自动拦截 | `.env` / `*.key` / `*.pem` / `credentials.json` / `id_rsa` / `ghp_` / `sk-` / `AKIA` / 内联 `password=` 等；可用 `--mode=ignore` 自动排除并写入 `.gitignore` |
| 全自动推送 | 配置好 token 后走 `x-access-token` 直连推送，全程无弹窗 |

## 密钥安全（重点）

- **仓库里没有任何密钥**：token 只从本机读取——`GITHUB_TOKEN` 环境变量 → `~/.dsh/repo-tools.credentials.json` → git 凭据管理器。
- 脚本在任何输出中都会**打码** token。
- 仓库自带 `.gitignore`，排除所有常见凭据文件；发布前强制扫描，命中即拦截。
- 默认创建**私有**仓库，只有显式 `--public` 才公开。

## 安装到 Codex

```powershell
# 方式一：从 GitHub 克隆后安装
git clone https://github.com/hgk568/codex-github-publish.git
Copy-Item -Recurse .\codex-github-publish "$env:USERPROFILE\.codex\skills\github-publish"

# 方式二：直接运行仓库里的安装脚本（Windows）
.\codex-github-publish\install.ps1
```

macOS / Linux：

```sh
git clone https://github.com/hgk568/codex-github-publish.git
mkdir -p ~/.codex/skills/github-publish
cp -r codex-github-publish/* ~/.codex/skills/github-publish/
```

安装后重启 Codex，向它说"把 `src` 目录发布到 hgk568/xxx"即可自动使用该技能。

## 配置 GitHub Token（一次即可，之后全自动）

1. 到 https://github.com/settings/tokens 生成一个 **classic token**，勾选 **`repo`** 权限。
2. 二选一：
   - 设置环境变量 `GITHUB_TOKEN`；或
   - 编辑 `C:\Users\<你>\.dsh\repo-tools.credentials.json`（或 `~/.dsh/` 下）：
     ```json
     {"github": {"token": "在此粘贴你的PAT"}}
     ```
3. 已有 Git Credential Manager 凭据也可以直接用（无 token 时自动回退）。

## 使用示例

```powershell
# 发布单个文件
node scripts\publish.mjs hgk568/my-repo .\1.txt --message "add 1.txt"

# 发布整个目录到新仓库（自动建仓，默认私有）
node scripts\publish.mjs hgk568/new-project .\src --create --description "my project"

# 只扫描不推送
node scripts\secret-scan.mjs .
```

## 前置要求

- Node.js ≥ 20
- `git` 在 PATH 中（Windows 建议 Git for Windows）

## 与 DSH repo-tools 的关系

本仓库是 repo-tools 插件的**独立脚本版**：同一套密钥规则与发布逻辑，不依赖 DSH 运行环境，供 Codex CLI 及其它命令行工具复用。DSH 用户仍可直接用 `repo_publish` 工具。

## License

MIT
