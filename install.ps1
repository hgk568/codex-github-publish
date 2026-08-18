# install.ps1 — 把 github-publish 技能安装到 Codex CLI
# 用法:  powershell -ExecutionPolicy Bypass -File .\install.ps1
$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$dst = Join-Path $env:USERPROFILE '.codex\skills\github-publish'
New-Item -ItemType Directory -Force -Path $dst | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $dst -Recurse -Force
Write-Host "installed -> $dst"
Write-Host "restart Codex, then ask: 把某个目录发布到 owner/repo"
