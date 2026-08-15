import { readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { cut, add_word: addWord } = require('jieba-wasm')
const root = process.cwd()

function argValue(name) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

const base = argValue('--base')
const checkOnly = process.argv.includes('--check')
const terminologyPath = path.join(root, 'docs', 'terminology.yaml')

function parseScalar(raw) {
  const value = raw.trim()
  if (value.startsWith('"')) return JSON.parse(value)
  if (value.startsWith("'")) return value.slice(1, -1).replaceAll("''", "'")
  return value.replace(/\s+#.*$/, '').trim()
}

function readCanonicalTerms() {
  const terms = []
  for (const line of readFileSync(terminologyPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^    zh:\s+(.+?)\s*$/)
    if (!match) continue
    const value = parseScalar(match[1])
    if (/\p{Script=Han}/u.test(value)) terms.push(value)
  }
  return [...new Set(terms)]
}

function walk(relativeDir) {
  const start = path.join(root, relativeDir)
  const files = []

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (entry.name.endsWith('.md')) files.push(path.relative(root, full))
    }
  }

  visit(start)
  return files
}

const files = ['README.md', 'README.zh.md', ...walk('docs')].sort()
const canonicalTerms = readCanonicalTerms()
for (const term of canonicalTerms) addWord(term)

function markdownProseLines(file) {
  const lines = readFileSync(path.join(root, file), 'utf8').split(/\r?\n/)
  let inFence = false
  return lines.map((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      return null
    }
    if (inFence) return null
    const prose = line
      .replace(/`[^`]*`/g, ' ')
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]\s|\d+[.)]\s)+/, ' ')
      .replace(/[\*_~]/g, '')
    return { line: index + 1, text: prose }
  })
}

function addedLineNumbers(ref) {
  const result = spawnSync(
    'git',
    ['diff', '--unified=0', `${ref}...HEAD`, '--', 'README.md', 'README.zh.md', ':(glob)docs/**/*.md'],
    { cwd: root, encoding: 'utf8' },
  )
  if (result.status !== 0) {
    process.stderr.write(result.stderr || `git diff failed for base ${ref}\n`)
    process.exit(result.status || 1)
  }

  const selected = new Map()
  let file = null
  let newLine = 0

  for (const line of result.stdout.split(/\r?\n/)) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/)
    if (fileMatch) {
      file = fileMatch[1]
      if (!selected.has(file)) selected.set(file, new Set())
      continue
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      newLine = Number(hunk[1])
      continue
    }
    if (!file) continue
    if (line.startsWith('+') && !line.startsWith('+++')) {
      selected.get(file).add(newLine)
      newLine += 1
    } else if (line.startsWith(' ')) {
      newLine += 1
    }
  }

  return selected
}

const selected = base ? addedLineNumbers(base) : null
const samples = []

for (const file of files) {
  if (selected && !selected.has(file)) continue
  const wanted = selected?.get(file)
  for (const row of markdownProseLines(file)) {
    if (!row) continue
    if (wanted && !wanted.has(row.line)) continue
    if (!/\p{Script=Han}/u.test(row.text)) continue
    samples.push({ file, ...row })
  }
}

const tokenMap = new Map()
const grammarSingles = new Set(['的', '了', '在', '和', '或', '也', '都', '不', '没', '把', '被', '到', '从', '对', '让', '会', '是', '有', '这', '那'])

for (const sample of samples) {
  for (const rawToken of cut(sample.text, true)) {
    const token = String(rawToken).trim()
    if (!token || !/\p{Script=Han}/u.test(token)) continue
    const entry = tokenMap.get(token) ?? { token, count: 0, contexts: [] }
    entry.count += 1
    if (entry.contexts.length < 3) entry.contexts.push(`${sample.file}:${sample.line}: ${sample.text.trim()}`)
    tokenMap.set(token, entry)
  }
}

if (tokenMap.size === 0) {
  if (checkOnly) {
    console.log('Chinese vocabulary audit check passed (no Chinese prose in selected input)')
    process.exit(0)
  }
  console.log('No Chinese prose tokens found.')
  process.exit(0)
}

for (const term of canonicalTerms) {
  const segmented = cut(term, true).map((token) => String(token).trim()).filter(Boolean)
  if (!segmented.includes(term)) {
    console.error(`canonical term was split by the segmenter: ${term} -> ${segmented.join(' / ')}`)
    process.exit(1)
  }
}

if (checkOnly) {
  console.log(`Chinese vocabulary audit check passed (${tokenMap.size} unique tokens; ${canonicalTerms.length} canonical terms preserved)`)
  process.exit(0)
}

const entries = [...tokenMap.values()].sort((a, b) => {
  const aSingle = [...a.token].length === 1 ? 0 : 1
  const bSingle = [...b.token].length === 1 ? 0 : 1
  return aSingle - bSingle || a.token.localeCompare(b.token, 'zh-CN')
})

console.log(`Chinese vocabulary audit: ${entries.length} unique tokens from ${samples.length} prose lines${base ? ` changed since ${base}` : ''}`)
console.log('Review every token. Web-check non-trivial vocabulary; give single-character lexical tokens a second pass.\n')

for (const entry of entries) {
  const single = [...entry.token].length === 1
  const tag = single ? (grammarSingles.has(entry.token) ? 'single-grammar' : 'single-review') : 'word'
  console.log(`[${tag}] ${entry.token}  x${entry.count}`)
  for (const context of entry.contexts) console.log(`  ${context}`)
}
