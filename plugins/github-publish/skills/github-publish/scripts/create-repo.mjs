#!/usr/bin/env node
/**
 * Create an empty GitHub repository for the authenticated user.
 * Tokens are resolved only from the local credential helpers in lib.mjs.
 */
import { apiCreateRepo, maskToken, resolveToken } from './lib.mjs'

function printHelp() {
  console.log(`usage: node scripts/create-repo.mjs <name> [options]

create an empty GitHub repository for the authenticated user

options:
  --public                 make the repository public (default: private)
  --description="text"    set the repository description
  --help                   show this help`)
}

function parseArgs(argv) {
  const options = { description: '', isPrivate: true }
  let name = null
  for (const arg of argv) {
    if (arg === '--help') {
      printHelp()
      process.exit(0)
    }
    if (arg === '--public') {
      options.isPrivate = false
      continue
    }
    if (arg.startsWith('--description=')) {
      options.description = arg.slice('--description='.length)
      continue
    }
    if (arg.startsWith('--')) {
      throw new Error(`unknown option: ${arg}`)
    }
    if (name !== null) throw new Error('only one repository name is allowed')
    name = arg
  }
  if (!name) throw new Error('repository name is required')
  if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
    throw new Error(`invalid repository name "${name}"`)
  }
  return { name, options }
}

async function main() {
  const { name, options } = parseArgs(process.argv.slice(2))
  const token = resolveToken()
  if (!token) {
    throw new Error('no GitHub token available (set GITHUB_TOKEN or configure ~/.dsh/repo-tools.credentials.json)')
  }

  try {
    const created = await apiCreateRepo({ name, ...options }, token)
    console.log(`created empty repository ${created.fullName} → ${created.url}`)
  } catch (error) {
    throw new Error(maskToken(error.message, token))
  }
}

main().catch((error) => {
  console.error(`create failed: ${error.message || String(error)}`)
  process.exit(1)
})
