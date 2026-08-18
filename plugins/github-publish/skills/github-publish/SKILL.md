---
name: github-publish
description: "Publish local files to GitHub repositories with automatic API-key and secret protection: secret-scan before upload, create the repository when missing, commit and push the specified files, auto-exclude secret files via .gitignore. Use when the user asks to push/upload/commit code or files to a GitHub repository, publish a folder, or create a new GitHub repo with content. GitHub tokens are read only from local sources (GITHUB_TOKEN env, ~/.dsh/repo-tools.credentials.json, or git credential manager) — never from the repository and never printed."
---

# GitHub Publish Skill

Publish local files or directories to a GitHub repository without ever leaking API keys or tokens.

## When to use

- The user asks to push / upload / commit files to GitHub.
- The user asks to create a new GitHub repo and fill it with content.
- The user wants a folder published under a specific path in a repo.

## How to use

Run the scripts from the project root (or with absolute paths):

```sh
# 1) (optional) scan first — exit 0 clean, exit 1 if secrets found
node scripts/secret-scan.mjs .

# 2) publish (secret-scan runs automatically inside; blocks on hits)
node scripts/publish.mjs owner/repo ./some-file.txt ./some-dir --message "add feature"
```

Useful flags (see `node scripts/publish.mjs --help`):

- `--create` — create the repository if it does not exist (**private** by default; add `--public` to make it public).
- `--mode=ignore` — instead of blocking, auto-exclude flagged secret files via `.gitignore` in the target repo.
- `--target-dir=sub/folder` — publish under a subdirectory.
- `--branch=main` — target branch (default `main`).
- `--force` — skip the secret check (only when the user explicitly insists).

## Rules (follow these strictly)

1. **Never put a token or key into any file you commit.** Tokens come from:
   `GITHUB_TOKEN` env → `~/.dsh/repo-tools.credentials.json` → git credential manager.
   The scripts handle this automatically — do not inline credentials.
2. **Secret files block the upload.** If a scan finds `.env`, `*.key`, `*.pem`,
   `credentials.json`, `id_rsa`, inline `password=`/`api_key=` assignments etc.,
   the publish aborts with the list. Do not force unless the user explicitly
   confirms; prefer `--mode=ignore` so the files are skipped and gitignored.
3. **Default to private** when creating a repository; only `--public` when the
   user explicitly asks for a public repo.
4. After publishing, report the repository URL and the branch. Mention how many
   secret files were excluded if `--mode=ignore` was used.

## Notes

- Requires Node.js >= 20 and `git` on PATH.
- `secret-scan.mjs` is also usable standalone for a quick check before any push.
