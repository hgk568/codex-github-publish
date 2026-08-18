#!/usr/bin/env node
/**
 * secret-scan.mjs — standalone API-key / secret-file scanner.
 *
 *   node scripts/secret-scan.mjs [path...]     (default: current directory)
 *
 * Exit code 0 = clean, 1 = potential secrets found. Skips .git, node_modules,
 * build output and other noise directories; binary files are skipped.
 */
import { existsSync, lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { scanPaths, fmtHits } from './lib.mjs'

const args = process.argv.slice(2)
const cwd = process.cwd()
const paths = args.length ? args : ['.']

const hits = scanPaths(paths, cwd)
if (hits.length === 0) {
  console.log(`scan ok — no secret files found (paths: ${paths.join(', ')})`)
  process.exit(0)
}
console.log(`⚠ found ${hits.length} potential secret file(s):`)
console.log(fmtHits(hits))
console.log('\nfix them, or use publish.mjs with --mode=ignore (auto-exclude via .gitignore) or --force (skip check)')
process.exit(1)
