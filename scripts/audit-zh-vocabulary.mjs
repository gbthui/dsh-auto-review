import { createRequire } from 'node:module'
import path from 'node:path'
import { readTerminology } from './terminology.mjs'
import { addedLineNumbers, collectWritingFiles, proseLinesForFile } from './writing-scope.mjs'

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
const { terms } = readTerminology(terminologyPath)
const files = collectWritingFiles(root)
const canonicalTerms = [...new Set(terms.map((term) => term.zh).filter((term) => /\p{Script=Han}/u.test(term)))]
for (const term of canonicalTerms) addWord(term)

let selected = null
try {
  selected = base ? addedLineNumbers(root, base, files) : null
} catch (error) {
  console.error(String(error?.message ?? error))
  process.exit(1)
}

const samples = []
for (const file of files) {
  if (selected && !selected.has(file)) continue
  const wanted = selected?.get(file)
  for (const row of proseLinesForFile(root, file)) {
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

for (const term of canonicalTerms) {
  const segmented = cut(term, true).map((token) => String(token).trim()).filter(Boolean)
  if (!segmented.includes(term)) {
    console.error(`canonical term was split by the segmenter: ${term} -> ${segmented.join(' / ')}`)
    process.exit(1)
  }
}

if (checkOnly) {
  console.log(`Chinese vocabulary audit check passed (${tokenMap.size} unique tokens; ${canonicalTerms.length} canonical terms preserved; ${files.length} writing-scope files)`)
  process.exit(0)
}

if (tokenMap.size === 0) {
  console.log('No Chinese prose tokens found.')
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
