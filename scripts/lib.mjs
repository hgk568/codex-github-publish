/**
 * lib.mjs — shared helpers for the github-publish Codex skill.
 * Zero dependencies, node >= 20. Tokens are read ONLY from local sources
 * (GITHUB_TOKEN env → ~/.dsh/repo-tools.credentials.json → git credential
 * manager) and are never printed, never written into any repository.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, lstatSync } from 'node:fs'
import { join, resolve, basename, dirname, relative, sep } from 'node:path'
import { tmpdir, homedir } from 'node:os'

// ─────────────────────────── secret rules ────────────────────────────────

export const FILENAME_RULES = [
  { re: /^\.env$/i, note: '环境文件 (.env)' },
  { re: /^\.env\..+$/i, allow: /^\.env\.(example|sample|template|dist|default)$/i, note: '环境变量文件 (.env.*)' },
  { re: /\.(key|pem|p12|pfx|p8|jks|keystore|secret|token)$/i, note: '密钥/凭据文件' },
  { re: /^id_(rsa|ed25519|ecdsa|dsa)$/i, note: 'SSH 私钥' },
  { re: /^(credentials|client_secret|client-secret|service-account|serviceaccount|secret|secrets)([._-].*)?\.json$/i, note: '凭据 JSON' },
  { re: /^\.(npmrc|pypirc|netrc|git-credentials)$/i, note: '凭据存储文件' },
  {
    re: /(^|[._-])(api[._-]?key|apikey|secret|token)([._-]|$)/i,
    allow: /\.(mjs|js|ts|jsx|tsx|py|sh|bash|rb|go|rs|c|h|cpp|java|md|markdown|ps1|jsonc)$/i,
    note: '含凭据字样的文件',
  },
]

export const CONTENT_RULES = [
  { re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, note: '私钥块' },
  { re: /\b(?:sk-[A-Za-z0-9]{20,}|sk-ws-[A-Za-z0-9]{20,})\b/, note: 'OpenAI/DashScope 密钥' },
  { re: /\bAKIA[0-9A-Z]{16}\b/, note: 'AWS Access Key' },
  { re: /\b(?:ghp|gho|ghu|github_pat)_[A-Za-z0-9_]{20,}\b/, note: 'GitHub Token' },
  { re: /\bAIza[0-9A-Za-z\-_]{35}\b/, note: 'Google API Key' },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, note: 'Slack Token' },
  {
    re: /(?:api[_-]?key|apikey|secret|passwd|password|access[_-]?key|token)\s*[:=]\s*["']?([A-Za-z0-9_\-./+]{16,})/i,
    placeholder: true,
    note: '内联凭据赋值',
  },
]

export const PLACEHOLDER_RE =
  /^(your|example|changeme|change_me|replace|placeholder|dummy|sample|todo|test|local|xxx+|your[_\-][a-z0-9_]+|example[_\-][a-z0-9_]+|[a-z0-9_]*_here|<[^>]*>|\$\{\{.+?\}\}|process\.env\.[A-Z0-9_]+|getenv\([^)]*\)|env\([^)]*\)|os\.environ(\[[^\]]*\])?|secret|token|null|undefined|\.\.\.)$/i

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.venv', 'venv', 'dist', 'build', '__pycache__', '.next', '.nuxt',
  'target', '.idea', '.vscode', '.cache', 'coverage', '.DS_Store', '.pytest_cache', '.mypy_cache',
])
const MAX_SCAN_FILES = 4000
const MAX_CONTENT_BYTES = 1024 * 1024

// ─────────────────────────── scanning ────────────────────────────────────

export function walk(abs, out = []) {
  if (out.length >= MAX_SCAN_FILES) return out
  let st
  try { st = lstatSync(abs) } catch { return out }
  if (st.isSymbolicLink()) return out
  if (st.isFile()) { out.push(abs); return out }
  if (st.isDirectory()) {
    let entries
    try { entries = readdirSync(abs) } catch { return out }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue
      walk(join(abs, entry), out)
      if (out.length >= MAX_SCAN_FILES) break
    }
  }
  return out
}

export function scanFile(abs) {
  const hits = []
  const b = basename(abs)
  for (const rule of FILENAME_RULES) {
    if (rule.re.test(b) && !(rule.allow && rule.allow.test(b))) {
      hits.push({ file: abs, rule: rule.note, line: 0 })
      break
    }
  }
  let size = 0
  try { size = statSync(abs).size } catch { return hits }
  if (size === 0 || size > MAX_CONTENT_BYTES) return hits
  let buf
  try { buf = readFileSync(abs) } catch { return hits }
  if (buf.includes(0)) return hits // binary
  const lines = buf.toString('utf8').split('\n')
  for (const rule of CONTENT_RULES) {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(rule.re)
      if (!m) continue
      if (rule.placeholder) {
        const value = (m[1] ?? m[0]).replace(/^["']|["']$/g, '').trim()
        if (PLACEHOLDER_RE.test(value)) continue
      }
      hits.push({ file: abs, rule: rule.note, line: i + 1 })
      break
    }
  }
  return hits
}

export function scanPaths(paths, cwd) {
  const targets = []
  for (const p of paths) {
    const abs = resolve(cwd, String(p))
    if (!existsSync(abs)) continue
    if (lstatSync(abs).isDirectory()) walk(abs, targets)
    else targets.push(abs)
  }
  const hits = []
  for (const t of targets) hits.push(...scanFile(t))
  const uniq = new Map()
  for (const h of hits) uniq.set(h.file + ':' + h.rule, h)
  return [...uniq.values()]
}

export function fmtHits(hits) {
  return hits.map((h) => `  - ${h.file}${h.line ? `:${h.line}` : ''}  ← ${h.rule}`).join('\n')
}

// ─────────────────────────── git helpers ─────────────────────────────────

export function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
  })
}

export function gitTry(cwd, args) {
  try {
    return { ok: true, out: git(cwd, args) }
  } catch (error) {
    const raw = error?.stderr ?? error?.message ?? String(error)
    return { ok: false, out: String(raw).trim() }
  }
}

// ─────────────────────────── credentials ─────────────────────────────────

export function resolveToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN
  try {
    const file = join(homedir(), '.dsh', 'repo-tools.credentials.json')
    if (!existsSync(file)) return null
    const data = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    if (data?.github?.token) return String(data.github.token)
  } catch { /* ignore */ }
  return null
}

export function gcmCredentials() {
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    })
    const creds = {}
    for (const line of out.split('\n')) {
      const i = line.indexOf('=')
      if (i > 0) creds[line.slice(0, i)] = line.slice(i + 1)
    }
    if (creds.password) return { username: creds.username || '', password: creds.password }
  } catch { /* no stored credential */ }
  return null
}

export function maskToken(text, token) {
  if (!token) return String(text)
  return String(text).split(token).join('***')
}

export async function apiCreateRepo({ name, description, isPrivate }, token) {
  const res = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'codex-github-publish',
    },
    body: JSON.stringify({
      name,
      description: description || '',
      private: isPrivate,
      auto_init: false,
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const extra = Array.isArray(body?.errors) ? ' — ' + body.errors.map((e) => e.message).join('; ') : ''
    throw new Error(`GitHub 返回 ${res.status}: ${body?.message || res.statusText}${extra}`)
  }
  return { url: body.html_url, fullName: body.full_name }
}

export function repoExists(repo) {
  return gitTry(process.cwd(), ['-c', 'http.sslBackend=openssl', 'ls-remote', `https://github.com/${repo}.git`, 'HEAD']).ok
}

export { tmpdir, homedir }
