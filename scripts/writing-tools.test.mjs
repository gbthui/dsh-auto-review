import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkTerminology } from './check-terminology.mjs'
import { readTerminology } from './terminology.mjs'
import { addedLineNumbers, collectWritingFiles, findPhraseMatches, markdownProseLines, proseLinesForFile } from './writing-scope.mjs'

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-writing-'))
  mkdirSync(path.join(root, 'docs'), { recursive: true })
  mkdirSync(path.join(root, 'src'), { recursive: true })
  mkdirSync(path.join(root, 'test'), { recursive: true })
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true })
  writeFileSync(path.join(root, 'docs', 'terminology.yaml'), `version: 2\n\nterms:\n  lookup-path:\n    en: lookup path\n    zh: 查找路径\n    avoid_zh:\n      - 解析链\n  fallback-path:\n    en: fallback path\n    zh: 回退路径\n    avoid_zh:\n      - fallback\n  last-valid-configuration:\n    en: last known-good configuration\n    zh: 上一次有效配置\n    avoid_en:\n      - last valid configuration\n      - last valid config\n\nforbidden_zh:\n  - 记账\nforbidden_en:\n  - behavior contract\n`)
  return root
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true })
}

test('terminology parser rejects malformed forbidden entries', () => {
  const root = fixture()
  try {
    const file = path.join(root, 'docs', 'terminology.yaml')
    writeFileSync(file, `version: 2\nterms:\n  x:\n    en: x\n    zh: 甲\nforbidden_zh:\n    - 记账\nforbidden_en:\n  - behavior contract\n`)
    assert.throws(() => readTerminology(file), /malformed forbidden_zh entry/)
  } finally { cleanup(root) }
})

test('terminology parser rejects duplicate scalar keys', () => {
  const root = fixture()
  try {
    const file = path.join(root, 'docs', 'terminology.yaml')
    writeFileSync(file, `version: 2\nterms:\n  x:\n    en: x\n    en: changed\n    zh: 甲\nforbidden_zh:\n  - 记账\nforbidden_en:\n  - behavior contract\n`)
    assert.throws(() => readTerminology(file), /duplicate key en/)
  } finally { cleanup(root) }
})

test('terminology parser rejects empty phrases', () => {
  const root = fixture()
  try {
    const file = path.join(root, 'docs', 'terminology.yaml')
    writeFileSync(file, `version: 2\nterms:\n  x:\n    en: x\n    zh: 甲\n    avoid_zh:\n      - ""\nforbidden_zh:\n  - 记账\nforbidden_en:\n  - behavior contract\n`)
    assert.throws(() => readTerminology(file), /must not be empty/)
  } finally { cleanup(root) }
})

test('writing scope includes mixed-language project prose surfaces', () => {
  const root = fixture()
  try {
    writeFileSync(path.join(root, 'README.md'), '# Readme\n')
    writeFileSync(path.join(root, 'package.json'), '{}\n')
    writeFileSync(path.join(root, 'cordis.patch.yml'), 'x: y\n')
    writeFileSync(path.join(root, 'docs', 'writing-guide.md'), '# Guide\n')
    writeFileSync(path.join(root, 'src', 'x.ts'), '// comment\n')
    writeFileSync(path.join(root, 'test', 'x.ts'), '// test\n')
    writeFileSync(path.join(root, '.github', 'pull_request_template.md'), '# PR\n')
    writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: CI\n')
    const files = collectWritingFiles(root)
    for (const expected of ['README.md','package.json','cordis.patch.yml','docs/writing-guide.md','src/x.ts','test/x.ts','.github/pull_request_template.md','.github/workflows/ci.yml']) assert.ok(files.includes(expected), expected)
  } finally { cleanup(root) }
})

test('Markdown stripping preserves source line numbers and ignores fenced code', () => {
  const rows = markdownProseLines('top\n```text\nbehavior contract\n```\ntext\nbehavior\ncontract\n')
  assert.deepEqual(findPhraseMatches(rows, 'behavior contract'), [6])
})

test('Markdown fences close only with a compatible marker and run length', () => {
  const rows = markdownProseLines('````md\n```\nbehavior contract\n```\n````\nafter\n')
  assert.deepEqual(findPhraseMatches(rows, 'behavior contract'), [])
})

test('Markdown fences are recognized inside blockquotes', () => {
  const rows = markdownProseLines('> ```text\n> behavior contract\n> ```\n')
  assert.deepEqual(findPhraseMatches(rows, 'behavior contract'), [])
})

test('Markdown fences are recognized inside list items', () => {
  const rows = markdownProseLines('- ```text\n  behavior contract\n  ```\n')
  assert.deepEqual(findPhraseMatches(rows, 'behavior contract'), [])
})

test('Markdown code spans use matching backtick run lengths', () => {
  const rows = markdownProseLines('before `` `behavior contract` `` after\n')
  assert.deepEqual(findPhraseMatches(rows, 'behavior contract'), [])
})

test('Markdown code spans can cross source lines', () => {
  const rows = markdownProseLines('before `behavior\ncontract` after\n')
  assert.deepEqual(findPhraseMatches(rows, 'behavior contract'), [])
})

test('Markdown reference links expose their rendered label text', () => {
  assert.deepEqual(findPhraseMatches(markdownProseLines('[behavior][term] contract\n\n[term]: /x\n'), 'behavior contract'), [1])
  assert.deepEqual(findPhraseMatches(markdownProseLines('[last valid][config] configuration\n'), 'last valid configuration'), [1])
  assert.deepEqual(findPhraseMatches(markdownProseLines('[behavior] contract\n'), 'behavior contract'), [1])
})

test('separate Markdown blocks do not form wrapped phrases', () => {
  assert.deepEqual(findPhraseMatches(markdownProseLines('- behavior\n- contract\n'), 'behavior contract'), [])
  assert.deepEqual(findPhraseMatches(markdownProseLines('# behavior\n## contract\n'), 'behavior contract'), [])
})

test('Chinese soft wraps preserve Han adjacency', () => {
  const rows = markdownProseLines('这里使用解析\n链。\n')
  assert.deepEqual(findPhraseMatches(rows, '解析链', { requireHan: true }), [1])
})

test('terminology check ignores backtick code spans in source comments', () => {
  const root = fixture()
  try {
    writeFileSync(path.join(root, 'src', 'x.ts'), '// `fallback` 是回退路径。\n')
    const result = checkTerminology(root)
    assert.equal(result.failures.some((line) => line.includes('src/x.ts:1') && line.includes('fallback')), false)
  } finally { cleanup(root) }
})

test('terminology check preserves TypeScript template literal prose', () => {
  const root = fixture()
  try {
    writeFileSync(path.join(root, 'src', 'x.ts'), 'const message = `behavior contract`\n')
    const result = checkTerminology(root)
    assert.ok(result.failures.some((line) => line.includes('src/x.ts:1') && line.includes('behavior contract')))
  } finally { cleanup(root) }
})

test('TypeScript template substitutions are excluded from prose matching', () => {
  const root = fixture()
  try {
    writeFileSync(path.join(root, 'src', 'x.ts'), 'const message = `这里使用 ${fallback}。`\n')
    const rows = proseLinesForFile(root, 'src/x.ts')
    assert.deepEqual(findPhraseMatches(rows, 'fallback', { requireHan: true }), [])
  } finally { cleanup(root) }
})

test('Han-scoped alternatives do not borrow Chinese from adjacent source lines', () => {
  const root = fixture()
  try {
    writeFileSync(path.join(root, 'src', 'x.ts'), 'const fallback = choosePath()\n// 这里使用回退路径。\n')
    assert.deepEqual(findPhraseMatches(proseLinesForFile(root, 'src/x.ts'), 'fallback', { requireHan: true }), [])
    writeFileSync(path.join(root, 'src', 'x.ts'), '// 这里不要写 fallback。\n')
    assert.deepEqual(findPhraseMatches(proseLinesForFile(root, 'src/x.ts'), 'fallback', { requireHan: true }), [1])
  } finally { cleanup(root) }
})

test('Han-scoped alternatives match across multiline source prose', () => {
  const root = fixture()
  try {
    writeFileSync(path.join(root, 'src', 'x.ts'), 'const message = `这里使用解析\n链。`\n')
    assert.deepEqual(findPhraseMatches(proseLinesForFile(root, 'src/x.ts'), '解析链', { requireHan: true }), [1])
    writeFileSync(path.join(root, 'src', 'x.ts'), '/* 这里使用解析\n链。 */\n')
    assert.deepEqual(findPhraseMatches(proseLinesForFile(root, 'src/x.ts'), '解析链', { requireHan: true }), [1])
  } finally { cleanup(root) }
})

test('added-line detection handles non-ASCII paths', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-writing-git-'))
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  try {
    git('init', '-q'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test')
    writeFileSync(path.join(root, 'README.md'), 'base\n'); git('add', 'README.md'); git('commit', '-qm', 'base')
    const base = git('rev-parse', 'HEAD')
    mkdirSync(path.join(root, 'docs')); writeFileSync(path.join(root, 'docs', '中文.md'), '第一行\n第二行\n')
    git('add', 'docs/中文.md'); git('commit', '-qm', 'add Chinese doc')
    const selected = addedLineNumbers(root, base, ['docs/中文.md'])
    assert.deepEqual([...selected.get('docs/中文.md')], [1, 2])
  } finally { cleanup(root) }
})

test('terminology check catches wrapped phrases and alternatives outside localized docs', () => {
  const root = fixture()
  try {
    writeFileSync(path.join(root, '.github', 'pull_request_template.md'), 'behavior\ncontract\n')
    writeFileSync(path.join(root, 'README.md'), 'The fallback behavior is documented here.\n')
    writeFileSync(path.join(root, 'src', 'x.ts'), '// 这里不要写解析链，也不要写 fallback。\n')
    writeFileSync(path.join(root, 'test', 'x.ts'), "check('keeps last valid config', true, true)\n")
    const result = checkTerminology(root)
    assert.ok(result.failures.some((line) => line.includes('.github/pull_request_template.md:1') && line.includes('behavior contract')))
    assert.ok(result.failures.some((line) => line.includes('src/x.ts:1') && line.includes('查找路径')))
    assert.ok(result.failures.some((line) => line.includes('src/x.ts:1') && line.includes('回退路径')))
    assert.ok(result.failures.some((line) => line.includes('test/x.ts:1') && line.includes('last known-good configuration')))
    assert.equal(result.failures.some((line) => line.includes('README.md:1') && line.includes('回退路径')), false)
  } finally { cleanup(root) }
})
