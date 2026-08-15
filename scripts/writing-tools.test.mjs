import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { checkTerminology } from './check-terminology.mjs'
import { readTerminology } from './terminology.mjs'
import {
  addedLineNumbers,
  collectWritingFiles,
  findPhraseMatches,
  jsonMetadataProseLines,
  markdownProseLines,
  proseLinesForFile,
  typescriptProseLines,
  yamlProseLines,
} from './writing-scope.mjs'

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

test('terminology parser delegates YAML syntax and validates the schema', () => {
  const root = fixture()
  try {
    const file = path.join(root, 'docs', 'terminology.yaml')
    writeFileSync(file, `version: 2\nterms:\n  x:\n    en: x\n    en: changed\n    zh: 甲\nforbidden_zh:\n  - 记账\nforbidden_en:\n  - behavior contract\n`)
    assert.throws(() => readTerminology(file))

    writeFileSync(file, `version: 2\nterms:\n  x:\n    en: x\n    zh: 甲\n    avoid_zh:\n      - ""\nforbidden_zh:\n  - 记账\nforbidden_en:\n  - behavior contract\n`)
    assert.throws(() => readTerminology(file), /non-empty string/)

    writeFileSync(file, `version: 2\nterms:\n  x:\n    en: 'unterminated\n    zh: 甲\nforbidden_zh:\n  - 记账\nforbidden_en:\n  - behavior contract\n`)
    assert.throws(() => readTerminology(file))
  } finally {
    cleanup(root)
  }
})

test('writing scope covers documented repository prose surfaces', () => {
  const root = fixture()
  try {
    writeFileSync(path.join(root, 'README.md'), '# Readme\n')
    writeFileSync(path.join(root, 'package.json'), '{"description":"x"}\n')
    writeFileSync(path.join(root, 'cordis.patch.yml'), 'name: x\n')
    writeFileSync(path.join(root, 'CHANGELOG.md'), '# changes\n')
    writeFileSync(path.join(root, 'docs', 'writing-guide.md'), '# Guide\n')
    writeFileSync(path.join(root, 'src', 'x.ts'), '// comment\n')
    writeFileSync(path.join(root, 'test', 'x.ts'), '// test\n')
    writeFileSync(path.join(root, '.github', 'pull_request_template.md'), '# PR\n')
    writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: CI\n')
    const files = collectWritingFiles(root)
    for (const expected of ['README.md','package.json','cordis.patch.yml','CHANGELOG.md','docs/writing-guide.md','src/x.ts','test/x.ts','.github/pull_request_template.md','.github/workflows/ci.yml']) {
      assert.ok(files.includes(expected), expected)
    }
  } finally {
    cleanup(root)
  }
})

test('Markdown extraction follows CommonMark structure instead of ad-hoc delimiters', () => {
  assert.deepEqual(findPhraseMatches(markdownProseLines('```text\nbehavior contract\n```\n'), 'behavior contract'), [])
  assert.deepEqual(findPhraseMatches(markdownProseLines('    behavior contract\n'), 'behavior contract'), [])
  assert.deepEqual(findPhraseMatches(markdownProseLines('- item\n\n    behavior contract\n'), 'behavior contract'), [3])
  assert.deepEqual(findPhraseMatches(markdownProseLines('before `behavior\ncontract` after\n'), 'behavior contract'), [])
  assert.deepEqual(findPhraseMatches(markdownProseLines('- before `behavior\n  contract` after\n'), 'behavior contract'), [])
  assert.deepEqual(findPhraseMatches(markdownProseLines('\\`last valid config\\`\n'), 'last valid config'), [1])
  assert.deepEqual(findPhraseMatches(markdownProseLines('[behavior][term] contract\n\n[term]: /x\n'), 'behavior contract'), [1])
  assert.deepEqual(findPhraseMatches(markdownProseLines('这里使用解析\n链。\n'), '解析链', { requireHan: true }), [1])
})

test('TypeScript extraction uses the compiler AST for strings and syntax-aware comment ranges', () => {
  assert.deepEqual(findPhraseMatches(typescriptProseLines('const re = /[/*]/; const message = `behavior contract`\n'), 'behavior contract'), [1])
  assert.deepEqual(findPhraseMatches(typescriptProseLines('x++ / y; const message = "behavior contract"\n'), 'behavior contract'), [1])
  assert.deepEqual(findPhraseMatches(typescriptProseLines('// behavior\n// contract\n'), 'behavior contract'), [1])
  assert.deepEqual(findPhraseMatches(typescriptProseLines('/**\n * behavior\n * contract\n */\n'), 'behavior contract'), [2])
  assert.deepEqual(findPhraseMatches(typescriptProseLines('// `fallback` 是代码标识符。\n'), 'fallback', { requireHan: true }), [])
  assert.deepEqual(findPhraseMatches(typescriptProseLines('const message = `这里使用 ${fallback}。`\n'), 'fallback', { requireHan: true }), [])
  assert.deepEqual(findPhraseMatches(typescriptProseLines('const message = `这里使用解析\n链。`\n'), '解析链', { requireHan: true }), [1])
})

test('YAML checks workflow labels and JSON checks package description', () => {
  const yaml = yamlProseLines('run: fallback # `fallback` 是代码标识符。\nname: |\n  behavior contract\n')
  assert.deepEqual(findPhraseMatches(yaml, 'fallback', { requireHan: true }), [])
  assert.ok(findPhraseMatches(yaml, 'behavior contract').length > 0)

  const json = jsonMetadataProseLines('{\n  "description": "behavior contract",\n  "main": "fallback"\n}\n')
  assert.deepEqual(findPhraseMatches(json, 'behavior contract'), [2])
  assert.deepEqual(findPhraseMatches(json, 'fallback', { requireHan: true }), [])
})

test('added-line detection handles non-ASCII paths', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-writing-git-'))
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
  }
  try {
    git('init', '-q')
    git('config', 'user.email', 'test@example.com')
    git('config', 'user.name', 'Test')
    writeFileSync(path.join(root, 'README.md'), 'base\n')
    git('add', 'README.md')
    git('commit', '-qm', 'base')
    const base = git('rev-parse', 'HEAD')
    mkdirSync(path.join(root, 'docs'))
    writeFileSync(path.join(root, 'docs', '中文.md'), '第一行\n第二行\n')
    git('add', 'docs/中文.md')
    git('commit', '-qm', 'add Chinese doc')
    const selected = addedLineNumbers(root, base, ['docs/中文.md'])
    assert.deepEqual([...selected.get('docs/中文.md')], [1, 2])
  } finally {
    cleanup(root)
  }
})

test('terminology check catches prose across Markdown, source, tests, workflows, and package metadata', () => {
  const root = fixture()
  try {
    writeFileSync(path.join(root, 'README.md'), 'behavior\ncontract\n')
    writeFileSync(path.join(root, 'package.json'), '{"description":"last valid config"}\n')
    writeFileSync(path.join(root, 'src', 'x.ts'), '// 这里不要写解析链，也不要写 fallback。\n')
    writeFileSync(path.join(root, 'test', 'x.ts'), "check('keeps last valid config', true, true)\n")
    writeFileSync(path.join(root, '.github', 'pull_request_template.md'), '# PR\n')
    writeFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'name: behavior contract\n')
    const result = checkTerminology(root)
    assert.ok(result.failures.some((line) => line.includes('README.md:1') && line.includes('behavior contract')))
    assert.ok(result.failures.some((line) => line.includes('package.json:1') && line.includes('last known-good configuration')))
    assert.ok(result.failures.some((line) => line.includes('src/x.ts:1') && line.includes('查找路径')))
    assert.ok(result.failures.some((line) => line.includes('src/x.ts:1') && line.includes('回退路径')))
    assert.ok(result.failures.some((line) => line.includes('test/x.ts:1') && line.includes('last known-good configuration')))
    assert.ok(result.failures.some((line) => line.includes('.github/workflows/ci.yml:1') && line.includes('behavior contract')))
  } finally {
    cleanup(root)
  }
})

test('file dispatch uses parser-backed extraction', () => {
  const root = fixture()
  try {
    writeFileSync(path.join(root, 'src', 'x.ts'), 'const message = `behavior contract`\n')
    assert.deepEqual(findPhraseMatches(proseLinesForFile(root, 'src/x.ts'), 'behavior contract'), [1])
  } finally {
    cleanup(root)
  }
})
