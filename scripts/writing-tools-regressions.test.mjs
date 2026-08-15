import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  collectWritingFiles,
  findPhraseMatches,
  jsonMetadataProseLines,
  markdownProseLines,
  typescriptProseLines,
  yamlProseLines,
} from './writing-scope.mjs'

function rootFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'dsh-writing-regressions-'))
  mkdirSync(path.join(root, 'docs'), { recursive: true })
  mkdirSync(path.join(root, 'src'), { recursive: true })
  mkdirSync(path.join(root, 'test'), { recursive: true })
  mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true })
  writeFileSync(path.join(root, 'README.md'), '# x\n')
  writeFileSync(path.join(root, 'package.json'), '{"description":"x"}\n')
  writeFileSync(path.join(root, 'cordis.patch.yml'), 'x: y\n')
  return root
}

test('indented Markdown code blocks are excluded', () => {
  const rows = markdownProseLines('before\n\n    last valid config\n\nafter\n')
  assert.deepEqual(findPhraseMatches(rows, 'last valid config'), [])
})

test('consecutive line comments share one prose scope', () => {
  const rows = typescriptProseLines('// behavior\n// contract\n')
  assert.deepEqual(findPhraseMatches(rows, 'behavior contract'), [1])
})

test('JSDoc decoration is removed before matching', () => {
  const rows = typescriptProseLines('/**\n * behavior\n * contract\n */\n')
  assert.deepEqual(findPhraseMatches(rows, 'behavior contract'), [2])
})

test('Markdown code spans do not cross paragraph boundaries', () => {
  const rows = markdownProseLines('`\n\nbehavior contract\n\n`\n')
  assert.deepEqual(findPhraseMatches(rows, 'behavior contract'), [3])
})

test('TypeScript regex literals do not create false comments', () => {
  const rows = typescriptProseLines('const re = /[/*]/\nconst message = `behavior contract`\n')
  assert.deepEqual(findPhraseMatches(rows, 'behavior contract'), [2])
})

test('phrase matching normalizes prose whitespace', () => {
  assert.deepEqual(findPhraseMatches(markdownProseLines('behavior\t  contract\n'), 'behavior contract'), [1])
})

test('release-note files are included in writing scope', () => {
  const root = rootFixture()
  try {
    writeFileSync(path.join(root, 'CHANGELOG.md'), 'x\n')
    writeFileSync(path.join(root, 'RELEASE_NOTES.zh.md'), 'x\n')
    const files = collectWritingFiles(root)
    assert.ok(files.includes('CHANGELOG.md'))
    assert.ok(files.includes('RELEASE_NOTES.zh.md'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('YAML and JSON expose prose without treating code as Chinese prose', () => {
  const yaml = yamlProseLines('run: fallback # 这里使用回退路径。\nname: behavior contract\n')
  assert.deepEqual(findPhraseMatches(yaml, 'fallback', { requireHan: true }), [])
  assert.deepEqual(findPhraseMatches(yaml, 'behavior contract'), [2])

  const json = jsonMetadataProseLines('{\n  "description": "behavior contract",\n  "main": "fallback"\n}\n')
  assert.deepEqual(findPhraseMatches(json, 'behavior contract'), [2])
  assert.deepEqual(findPhraseMatches(json, 'fallback', { requireHan: true }), [])
})

test('earlier Markdown and TypeScript regressions remain covered', () => {
  assert.deepEqual(findPhraseMatches(markdownProseLines('> ```text\n> behavior contract\n> ```\n'), 'behavior contract'), [])
  assert.deepEqual(findPhraseMatches(markdownProseLines('- ```text\n  behavior contract\n  ```\n'), 'behavior contract'), [])
  assert.deepEqual(findPhraseMatches(markdownProseLines('before `behavior\ncontract` after\n'), 'behavior contract'), [])
  assert.deepEqual(findPhraseMatches(markdownProseLines('[behavior][term] contract\n\n[term]: /x\n'), 'behavior contract'), [1])
  assert.deepEqual(findPhraseMatches(typescriptProseLines('const message = `这里使用 ${fallback}。`\n'), 'fallback', { requireHan: true }), [])
  assert.deepEqual(findPhraseMatches(typescriptProseLines('const message = `这里使用解析\n链。`\n'), '解析链', { requireHan: true }), [1])
})
