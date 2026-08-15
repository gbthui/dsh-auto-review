import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkTerminology } from './check-terminology.mjs'
import { readTerminology } from './terminology.mjs'
import { collectWritingFiles, findPhraseMatches, markdownProseLines } from './writing-scope.mjs'

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-writing-'))
  mkdirSync(path.join(root, 'docs'), { recursive: true })
  mkdirSync(path.join(root, 'src'), { recursive: true })
  mkdirSync(path.join(root, 'test'), { recursive: true })
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true })
  writeFileSync(path.join(root, 'docs', 'terminology.yaml'), `version: 2\n\nterms:\n  lookup-path:\n    en: lookup path\n    zh: 查找路径\n    avoid_zh:\n      - 解析链\n  fallback-path:\n    en: fallback path\n    zh: 回退路径\n    avoid_zh:\n      - fallback\n  last-valid-configuration:\n    en: last valid configuration\n    zh: 上一次有效配置\n    avoid_en:\n      - last known-good config\n\nforbidden_zh:\n  - 记账\nforbidden_en:\n  - behavior contract\n`)
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
  } finally {
    cleanup(root)
  }
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
    for (const expected of [
      'README.md',
      'package.json',
      'cordis.patch.yml',
      'docs/writing-guide.md',
      'src/x.ts',
      'test/x.ts',
      '.github/pull_request_template.md',
      '.github/workflows/ci.yml',
    ]) assert.ok(files.includes(expected), expected)
  } finally {
    cleanup(root)
  }
})

test('Markdown stripping preserves source line numbers and ignores fenced code', () => {
  const rows = markdownProseLines('top\n```text\nbehavior contract\n```\ntext\nbehavior\ncontract\n')
  assert.deepEqual(findPhraseMatches(rows, 'behavior contract'), [6])
})

test('terminology check catches wrapped phrases and alternatives outside localized docs', () => {
  const root = fixture()
  try {
    writeFileSync(path.join(root, '.github', 'pull_request_template.md'), 'behavior\ncontract\n')
    writeFileSync(path.join(root, 'README.md'), 'The fallback behavior is documented here.\n')
    writeFileSync(path.join(root, 'src', 'x.ts'), '// 这里不要写解析链，也不要写 fallback。\n')
    writeFileSync(path.join(root, 'test', 'x.ts'), "check('keeps last known-good config', true, true)\n")
    const result = checkTerminology(root)
    assert.ok(result.failures.some((line) => line.includes('.github/pull_request_template.md:1') && line.includes('behavior contract')))
    assert.ok(result.failures.some((line) => line.includes('src/x.ts:1') && line.includes('查找路径')))
    assert.ok(result.failures.some((line) => line.includes('src/x.ts:1') && line.includes('回退路径')))
    assert.ok(result.failures.some((line) => line.includes('test/x.ts:1') && line.includes('last valid configuration')))
    assert.equal(result.failures.some((line) => line.includes('README.md:1') && line.includes('回退路径')), false)
  } finally {
    cleanup(root)
  }
})
