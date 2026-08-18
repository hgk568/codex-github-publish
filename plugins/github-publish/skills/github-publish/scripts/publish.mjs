#!/usr/bin/env node
/**
 * publish.mjs — publish local files to a GitHub repository with automatic
 * API-key / secret protection.
 *
 *   node scripts/publish.mjs <owner/repo> <file-or-dir...> [options]
 *
 * Options:
 *   --message "msg"      commit message (default: chore: publish via github-publish)
 *   --branch NAME        branch (default: main)
 *   --create             create the repository when it does not exist (private by default)
 *   --public             make the created repository public (default private)
 *   --description "txt"  repository description when creating
 *   --mode block|ignore  secret handling (default: block = abort on secrets;
 *                        ignore = auto-exclude secret files via .gitignore)
 *   --force              skip the secret check entirely
 *   --target-dir "sub/"  place files under this subdirectory in the repo
 *   --author-name / --author-email   commit author (default: the GitHub account)
 *
 * Secrets: tokens are read only from GITHUB_TOKEN env, ~/.dsh/repo-tools
 * .credentials.json, or git credential manager — never from the repository,
 * never printed, never committed. Secret files block the upload by default.
 */
import { existsSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, lstatSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, basename, dirname, relative, sep } from 'node:path'
import {
  scanPaths, fmtHits, git, gitTry, resolveToken, gcmCredentials, maskToken,
  apiCreateRepo, repoExists, walk, homedir, tmpdir,
} from './lib.mjs'

function printHelp() {
  console.log(`usage: node scripts/publish.mjs <owner/repo> <file-or-dir...> [options]

publish local files to a GitHub repository. Secret files (API keys, .env,
private keys, credentials JSON, inline credential assignments) BLOCK the
upload by default.

options:
  --message "msg"      commit message
  --branch NAME        branch (default main)
  --create             create the repository if missing (private by default)
  --public             make a created repository public
  --description "txt"  description when creating
  --mode block|ignore  block (default) or auto-exclude secrets via .gitignore
  --force              skip the secret check
  --target-dir "sub/"  place files under this subdirectory
  --author-name NAME   commit author name (default: the GitHub account)
  --author-email MAIL  commit author email (default: <user>@users.noreply.github.com)
  --help               show this help`)
}

function parseArgs(argv) {
  const opts = {
    message: null, branch: 'main', create: false, private: true, description: '',
    mode: 'block', force: false, targetDir: '', authorName: null, authorEmail: null,
  }
  const positional = []
  for (const a of argv) {
    if (a === '--create') opts.create = true
    else if (a === '--public') opts.private = false
    else if (a === '--force') opts.force = true
    else if (a === '--ignore') opts.mode = 'ignore'
    else if (a === '--help') { printHelp(); process.exit(0) }
    else if (a.startsWith('--message=')) opts.message = a.slice('--message='.length)
    else if (a.startsWith('--branch=')) opts.branch = a.slice('--branch='.length) || 'main'
    else if (a.startsWith('--description=')) opts.description = a.slice('--description='.length)
    else if (a.startsWith('--target-dir=')) opts.targetDir = a.slice('--target-dir='.length)
    else if (a.startsWith('--author-name=')) opts.authorName = a.slice('--author-name='.length)
    else if (a.startsWith('--author-email=')) opts.authorEmail = a.slice('--author-email='.length)
    else if (a.startsWith('--')) { console.error(`unknown option: ${a}`); printHelp(); process.exit(1) }
    else positional.push(a)
  }
  return { opts, positional }
}

function normalizeFiles(files, cwd) {
  return files
    .map((f) => {
      let src = String(f)
      if (src === '~') src = homedir()
      else if (src.startsWith('~/')) src = join(homedir(), src.slice(2))
      return { abs: resolve(cwd, src) }
    })
    .filter((it) => existsSync(it.abs))
}

function copyInto(work, item, targetDir, excluded, ignoredDest) {
  const base = targetDir ? join(work, targetDir) : work
  mkdirSync(base, { recursive: true })
  if (lstatSync(item.abs).isDirectory()) {
    const dest = join(base, basename(item.abs))
    for (const f of walk(item.abs)) {
      const rel = relative(item.abs, f)
      const repoRel = join(targetDir, basename(item.abs), rel)
      if (excluded.has(f)) { ignoredDest.push(repoRel); continue }
      const to = join(dest, rel)
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(f, to)
    }
  } else {
    const repoRel = join(targetDir, basename(item.abs))
    if (excluded.has(item.abs)) { ignoredDest.push(repoRel); return }
    const dest = join(base, basename(item.abs))
    mkdirSync(dirname(dest), { recursive: true })
    copyFileSync(item.abs, dest)
  }
}

function appendGitignore(work, ignoredDest, targetDir) {
  const gi = join(work, targetDir || '', '.gitignore')
  const existing = existsSync(gi) ? readFileSync(gi, 'utf8') : ''
  const entries = [...new Set(ignoredDest.map((d) => d.split(sep).join('/')))]
  const block = '\n# github-publish auto-ignored (potential secrets)\n' + entries.map((e) => '/' + e).join('\n') + '\n'
  if (entries.every((e) => existing.includes(e))) return
  appendFileSync(gi, block)
}

function ensureBranch(work, branch) {
  if (gitTry(work, ['checkout', branch]).ok) return
  if (gitTry(work, ['checkout', '-b', branch]).ok) return
  git(work, ['symbolic-ref', 'HEAD', `refs/heads/${branch}`])
}

async function main() {
  const { opts, positional } = parseArgs(process.argv.slice(2))
  const cwd = process.cwd()
  if (positional.length < 2) {
    console.error('usage: node scripts/publish.mjs <owner/repo> <file-or-dir...> [options]  (see --help)')
    process.exit(2)
  }
  const repo = String(positional[0]).trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
    console.error(`invalid repo "${repo}" — expected owner/name`)
    process.exit(2)
  }
  const items = normalizeFiles(positional.slice(1), cwd)
  if (!items.length) {
    console.error('no files given, or none of them exist')
    process.exit(2)
  }

  const token = resolveToken()
  const gcm = token ? null : gcmCredentials()

  // 1) secret scan — block or exclude
  const hits = scanPaths(items.map((i) => i.abs), cwd)
  if (hits.length && !opts.force && opts.mode === 'block') {
    console.error(`⛔ blocked — ${hits.length} potential secret file(s):\n${fmtHits(hits)}\n\nfix them, or re-run with --mode=ignore (auto-exclude via .gitignore) or --force (skip check)`)
    process.exit(1)
  }
  const excluded = new Set(hits.map((h) => h.file))

  // 2) ensure the repository exists
  if (!repoExists(repo, token)) {
    if (!opts.create) {
      console.error(`repo ${repo} not found — pass --create to create it (private by default)`)
      process.exit(1)
    }
    if (!token) {
      console.error('no GitHub token available to create the repository (set GITHUB_TOKEN or configure ~/.dsh/repo-tools.credentials.json)')
      process.exit(1)
    }
    try {
      await apiCreateRepo({ name: repo.split('/')[1], description: opts.description, isPrivate: opts.private }, token)
    } catch (error) {
      console.error('create failed: ' + maskToken(error.message, token))
      process.exit(1)
    }
  }

  // 3) temp clone → copy → commit → push
  const tmp = mkdtempSync(join(tmpdir(), 'github-publish-'))
  try {
    const remote = token
      ? `https://x-access-token:${encodeURIComponent(token)}@github.com/${repo}.git`
      : `https://github.com/${repo}.git`
    const cloned = gitTry(tmp, ['-c', 'http.sslBackend=openssl', 'clone', remote, 'work'])
    if (!cloned.ok) { console.error(`clone failed: ${maskToken(cloned.out, token)}`); process.exit(1) }
    const work = join(tmp, 'work')
    ensureBranch(work, opts.branch)

    const ignoredDest = []
    for (const it of items) copyInto(work, it, opts.targetDir.replace(/^[/\\]+|[/\\]+$/g, ''), excluded, ignoredDest)
    if (opts.mode === 'ignore' && ignoredDest.length) appendGitignore(work, ignoredDest, opts.targetDir.replace(/^[/\\]+|[/\\]+$/g, ''))

    const status = gitTry(work, ['status', '--porcelain'])
    if (!status.ok) { console.error(`git status failed: ${status.out}`); process.exit(1) }
    if (!status.out.trim()) { console.log(`nothing to commit — files unchanged in ${repo}`); process.exit(0) }

    const staged = gitTry(work, ['add', '--all'])
    if (!staged.ok) { console.error(`git add failed: ${staged.out}`); process.exit(1) }

    const user = opts.authorName || gcm?.username || 'github-publish'
    const email = opts.authorEmail || `${user}@users.noreply.github.com`
    const message = opts.message || 'chore: publish via github-publish'
    const committed = gitTry(work, ['-c', `user.name=${user}`, '-c', `user.email=${email}`, 'commit', '-m', message])
    if (!committed.ok) { console.error(`commit failed: ${committed.out}`); process.exit(1) }

    const base = ['-c', 'http.sslBackend=openssl', 'push', '-u', 'origin', opts.branch]
    let pushed
    if (token) {
      const rem = git(work, ['remote', 'get-url', 'origin']).trim()
      const authed = rem.replace('https://github.com/', `https://x-access-token:${encodeURIComponent(token)}@github.com/`)
      git(work, ['remote', 'set-url', 'origin', authed])
      pushed = gitTry(work, base)
      git(work, ['remote', 'set-url', 'origin', rem])
    } else {
      pushed = gitTry(work, base)
    }
    if (!pushed.ok) {
      const hint = token ? '' : '\n\nfully automatic push needs a token: set GITHUB_TOKEN or fill ~/.dsh/repo-tools.credentials.json ({"github":{"token":"<PAT>"}})'
      console.error('push failed: ' + maskToken(pushed.out, token) + hint)
      process.exit(1)
    }

    const summary = ignoredDest.length ? ` (excluded ${ignoredDest.length} secret file(s) via .gitignore)` : ''
    console.log(`published ${items.length} item(s) → https://github.com/${repo} (branch ${opts.branch})${summary}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error('error: ' + (error?.message || String(error)))
  process.exit(1)
})
