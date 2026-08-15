import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import rehypeParse from 'rehype-parse'
import * as ts from '@typescript/typescript6'
import { LineCounter, isMap, isScalar, isSeq, parseDocument } from 'yaml'

const markdownParser = unified().use(remarkParse)
const htmlParser = unified().use(rehypeParse, { fragment: true })
const HTML_NON_PROSE = new Set(['code', 'pre', 'script', 'style', 'template'])

function walk(root, relativeDir, extensions) {
  const start = path.join(root, relativeDir)
  if (!existsSync(start)) return []
  const files = []

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) visit(full)
      else if (extensions.has(path.extname(entry.name))) files.push(path.relative(root, full))
    }
  }

  visit(start)
  return files
}

function appendValue(lines, startLine, value) {
  const parts = String(value).split(/\r?\n/)
  for (let offset = 0; offset < parts.length; offset += 1) {
    const line = startLine + offset
    lines.set(line, (lines.get(line) ?? '') + parts[offset])
  }
}

function rowsFromLineMap(lines, scope) {
  const entries = [...lines.entries()].sort((a, b) => a[0] - b[0])
  return entries.map(([line, text], index) => ({
    line,
    text,
    breakBefore: index === 0,
    breakAfter: index === entries.length - 1,
    scope,
  }))
}

function collectHtmlText(node, lines, baseLine, hidden = false) {
  const nextHidden = hidden || (node.type === 'element' && HTML_NON_PROSE.has(node.tagName))
  if (nextHidden) return
  if (node.type === 'text') {
    const relativeLine = node.position?.start?.line ?? 1
    appendValue(lines, baseLine + relativeLine - 1, node.value)
    return
  }
  if (node.type === 'element' && node.tagName === 'img' && typeof node.properties?.alt === 'string') {
    const relativeLine = node.position?.start?.line ?? 1
    appendValue(lines, baseLine + relativeLine - 1, node.properties.alt)
  }
  if (node.type === 'element' && node.tagName === 'br') {
    const relativeLine = node.position?.start?.line ?? 1
    appendValue(lines, baseLine + relativeLine - 1, '\n')
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectHtmlText(child, lines, baseLine, nextHidden)
  }
}

function htmlBlockRows(value, startLine, scope) {
  const tree = htmlParser.parse(value)
  const lines = new Map()
  collectHtmlText(tree, lines, startLine)
  return rowsFromLineMap(lines, scope)
}

function collectMarkdownInline(node, lines) {
  const line = node.position?.start?.line ?? 1
  if (node.type === 'text') {
    appendValue(lines, line, node.value)
    return
  }
  if (node.type === 'inlineCode' || node.type === 'html') {
    appendValue(lines, line, ' ')
    return
  }
  if (node.type === 'image' || node.type === 'imageReference') {
    appendValue(lines, line, node.alt ?? '')
    return
  }
  if (node.type === 'break') {
    appendValue(lines, line, '\n')
    return
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) collectMarkdownInline(child, lines)
  }
}

export function markdownProseLines(text) {
  const tree = markdownParser.parse(text)
  const rows = []
  let scope = 0

  const visit = (node) => {
    if (node.type === 'paragraph' || node.type === 'heading') {
      const lines = new Map()
      collectMarkdownInline(node, lines)
      if (lines.size) rows.push(...rowsFromLineMap(lines, ++scope))
      return
    }
    if (node.type === 'html') {
      const startLine = node.position?.start?.line ?? 1
      const htmlRows = htmlBlockRows(node.value, startLine, ++scope)
      if (htmlRows.length) rows.push(...htmlRows)
      return
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child)
    }
  }

  visit(tree)
  return rows.sort((a, b) => a.line - b.line || a.scope - b.scope)
}

function sourceLine(sourceFile, position) {
  return sourceFile.getLineAndCharacterOfPosition(position).line + 1
}

function plainScopeRows(value, startLine, scope) {
  const lines = new Map()
  appendValue(lines, startLine, value)
  return rowsFromLineMap(lines, scope)
}

function decodeRawStringLine(value) {
  return value
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\[nrtvfb]/g, ' ')
    .replace(/\\(["'`\\])/g, '$1')
}

function rawScopeRows(value, startLine, scope) {
  const lines = new Map()
  const parts = String(value).split(/\r?\n/)
  for (let offset = 0; offset < parts.length; offset += 1) {
    lines.set(startLine + offset, decodeRawStringLine(parts[offset]))
  }
  return rowsFromLineMap(lines, scope)
}

function literalSourceRows(node, sourceFile, text, scope) {
  const start = node.getStart(sourceFile)
  const raw = text.slice(start, node.getEnd())
  return rawScopeRows(raw.length >= 2 ? raw.slice(1, -1) : '', sourceLine(sourceFile, start), scope)
}

function templatePartRows(node, sourceFile, text, scope, head = false) {
  const start = node.getStart(sourceFile)
  const raw = text.slice(start, node.getEnd())
  let body = raw
  if (head) body = raw.length >= 3 ? raw.slice(1, -2) : ''
  else if (raw.endsWith('`')) body = raw.length >= 2 ? raw.slice(1, -1) : ''
  else body = raw.length >= 3 ? raw.slice(1, -2) : ''
  return rawScopeRows(body, sourceLine(sourceFile, start), scope)
}

function collectCommentRanges(sourceFile, text) {
  const ranges = new Map()
  const add = (range) => {
    if (!range) return
    ranges.set(`${range.pos}:${range.end}`, range)
  }

  const visit = (node) => {
    for (const range of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []) add(range)
    for (const range of ts.getTrailingCommentRanges(text, node.getEnd()) ?? []) add(range)
    for (const child of node.getChildren(sourceFile)) visit(child)
  }

  visit(sourceFile)
  for (const range of ts.getLeadingCommentRanges(text, 0) ?? []) add(range)
  for (const range of ts.getTrailingCommentRanges(text, text.length) ?? []) add(range)
  return [...ranges.values()].sort((a, b) => a.pos - b.pos)
}

function commentMarkdownGroups(sourceFile, text) {
  const ranges = collectCommentRanges(sourceFile, text)
  const groups = []

  for (const range of ranges) {
    const previous = groups.at(-1)
    if (
      previous
      && previous.kind === ts.SyntaxKind.SingleLineCommentTrivia
      && range.kind === ts.SyntaxKind.SingleLineCommentTrivia
      && /^\r?\n[\t ]*$/.test(text.slice(previous.end, range.pos))
    ) {
      previous.ranges.push(range)
      previous.end = range.end
      continue
    }
    groups.push({ kind: range.kind, ranges: [range], end: range.end })
  }

  return groups.map((group) => {
    const first = group.ranges[0]
    const startLine = sourceLine(sourceFile, first.pos)
    if (group.kind === ts.SyntaxKind.SingleLineCommentTrivia) {
      const body = group.ranges
        .map((range) => text.slice(range.pos + 2, range.end).replace(/^[\t ]?/, ''))
        .join('\n')
      return { body, startLine }
    }

    const raw = text.slice(first.pos + 2, first.end - 2)
    const body = raw
      .split(/\r?\n/)
      .map((line) => line.replace(/^[\t ]*\*[\t ]?/, ''))
      .join('\n')
    return { body, startLine }
  })
}

export function typescriptProseLines(text, fileName = 'source.ts') {
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const rows = []
  let scope = 0

  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      rows.push(...literalSourceRows(node, sourceFile, text, ++scope))
      return
    }
    if (ts.isTemplateExpression(node)) {
      rows.push(...templatePartRows(node.head, sourceFile, text, ++scope, true))
      for (const span of node.templateSpans) {
        ts.forEachChild(span.expression, visit)
        rows.push(...templatePartRows(span.literal, sourceFile, text, ++scope))
      }
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)

  for (const comment of commentMarkdownGroups(sourceFile, text)) {
    const commentRows = markdownProseLines(comment.body)
    const offset = comment.startLine - 1
    const commentScope = ++scope
    for (const row of commentRows) {
      rows.push({ ...row, line: row.line + offset, scope: commentScope })
    }
  }

  return rows.sort((a, b) => a.line - b.line || a.scope - b.scope)
}

function yamlScalarRows(value, lineCounter, scope, fallbackPosition = 0) {
  const token = value?.srcToken
  if (token?.type === 'block-scalar') {
    const headerLength = token.props.reduce((sum, part) => sum + (typeof part.source === 'string' ? part.source.length : 0), 0)
    const contentOffset = token.offset + headerLength
    const startLine = lineCounter.linePos(contentOffset).line
    const lines = new Map()
    const parts = String(token.source ?? '').split(/\r?\n/)
    for (let offset = 0; offset < parts.length; offset += 1) {
      lines.set(startLine + offset, parts[offset].replace(/^[\t ]+/, ''))
    }
    return rowsFromLineMap(lines, scope)
  }
  const position = value?.range?.[0] ?? fallbackPosition
  const startLine = lineCounter.linePos(position).line
  return plainScopeRows(value?.value ?? '', startLine, scope)
}

export function yamlProseLines(text) {
  const lineCounter = new LineCounter()
  const document = parseDocument(text, {
    keepSourceTokens: true,
    lineCounter,
    uniqueKeys: true,
    prettyErrors: true,
  })
  if (document.errors.length) throw document.errors[0]

  const rows = []
  let scope = 0
  const seenComments = new Set()
  const addMarkdownComment = (comment, startLine) => {
    if (typeof comment !== 'string' || comment.trim() === '') return
    const key = `${startLine}\0${comment}`
    if (seenComments.has(key)) return
    seenComments.add(key)
    const commentRows = markdownProseLines(comment)
    const offset = Math.max(0, startLine - 1)
    const commentScope = ++scope
    for (const row of commentRows) rows.push({ ...row, line: row.line + offset, scope: commentScope })
  }

  const visit = (node, fallbackLine = 1) => {
    if (!node || typeof node !== 'object') return
    const position = Array.isArray(node.range) ? node.range[0] : null
    const startLine = position === null ? fallbackLine : lineCounter.linePos(position).line
    const beforeLines = typeof node.commentBefore === 'string' ? node.commentBefore.split(/\r?\n/).length : 0
    addMarkdownComment(node.commentBefore, Math.max(1, startLine - beforeLines))
    addMarkdownComment(node.comment, startLine)

    if (isMap(node)) {
      for (const pair of node.items) {
        visit(pair, startLine)
        const key = isScalar(pair.key) ? pair.key.value : undefined
        if ((key === 'name' || key === 'run-name') && isScalar(pair.value) && typeof pair.value.value === 'string') {
          rows.push(...yamlScalarRows(pair.value, lineCounter, ++scope, position ?? 0))
        }
        if (pair.key) visit(pair.key, startLine)
        if (pair.value) visit(pair.value, startLine)
      }
      return
    }
    if (isSeq(node)) {
      for (const item of node.items) if (item) visit(item, startLine)
    }
  }

  addMarkdownComment(document.commentBefore, 1)
  addMarkdownComment(document.comment, text.split(/\r?\n/).length)
  if (document.contents) visit(document.contents)
  return rows.sort((a, b) => a.line - b.line || a.scope - b.scope)
}

export function jsonMetadataProseLines(text) {
  const value = JSON.parse(text)
  const description = value && typeof value === 'object' ? value.description : undefined
  if (typeof description !== 'string' || description === '') return []
  const match = /"description"\s*:/.exec(text)
  const startLine = match ? text.slice(0, match.index).split(/\r?\n/).length : 1
  return plainScopeRows(description, startLine, 1)
}

export function collectWritingFiles(root) {
  const files = new Set()
  for (const file of ['README.md', 'README.zh.md', 'package.json', 'cordis.patch.yml']) {
    if (existsSync(path.join(root, file))) files.add(file)
  }
  if (existsSync(root)) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      if (/^(?:CHANGELOG|RELEASE_NOTES)(?:\.[^.]+)?\.md$/i.test(entry.name)) files.add(entry.name)
    }
  }
  for (const file of walk(root, 'docs', new Set(['.md']))) files.add(file)
  for (const file of walk(root, 'src', new Set(['.ts']))) files.add(file)
  for (const file of walk(root, 'test', new Set(['.ts']))) files.add(file)
  for (const file of walk(root, '.github', new Set(['.md', '.yml', '.yaml']))) files.add(file)
  return [...files].sort()
}

export function proseLinesForFile(root, file) {
  const text = readFileSync(path.join(root, file), 'utf8')
  if (file.endsWith('.md')) return markdownProseLines(text)
  if (file.endsWith('.ts')) return typescriptProseLines(text, file)
  if (file.endsWith('.yml') || file.endsWith('.yaml')) return yamlProseLines(text)
  if (file === 'package.json') return jsonMetadataProseLines(text)
  return []
}

function normalizePart(text) {
  return text.trim().replace(/\s+/g, ' ')
}

export function findPhraseMatches(rows, phrase, options = {}) {
  const needle = normalizePart(phrase).toLowerCase()
  if (!needle) return []
  const requireHan = options.requireHan === true
  const matches = []
  let block = []

  const flush = () => {
    if (block.length === 0) return
    let text = ''
    const starts = []

    for (const row of block) {
      const part = normalizePart(row.text)
      if (!part) continue
      if (text) {
        const preserveHanAdjacency = /\p{Script=Han}$/u.test(text) && /^\p{Script=Han}/u.test(part)
        if (!preserveHanAdjacency) text += ' '
      }
      starts.push({ offset: text.length, line: row.line })
      text += part
    }

    if (requireHan && !/\p{Script=Han}/u.test(text)) {
      block = []
      return
    }

    const folded = text.toLowerCase()
    let offset = folded.indexOf(needle)
    while (offset >= 0) {
      let start = starts[0]
      for (const candidate of starts) {
        if (candidate.offset > offset) break
        start = candidate
      }
      matches.push(start?.line ?? block[0].line)
      offset = folded.indexOf(needle, offset + Math.max(1, needle.length))
    }
    block = []
  }

  for (const row of rows) {
    if (row.breakBefore) flush()
    if (normalizePart(row.text) === '') flush()
    else {
      block.push(row)
      if (row.breakAfter) flush()
    }
  }
  flush()
  return matches
}

export function addedLineNumbers(root, ref, files) {
  const result = spawnSync(
    'git',
    ['-c', 'core.quotePath=false', 'diff', '--unified=0', `${ref}...HEAD`, '--', ...files],
    { cwd: root, encoding: 'utf8' },
  )
  if (result.status !== 0) throw new Error(result.stderr || `git diff failed for base ${ref}`)

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
