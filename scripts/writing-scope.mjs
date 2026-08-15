import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

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

function backtickRunLength(text, start) {
  let end = start
  while (end < text.length && text[end] === '`') end += 1
  return end - start
}

export function stripCodeSpans(text) {
  let output = ''
  let cursor = 0
  let searchFrom = 0

  while (searchFrom < text.length) {
    const open = text.indexOf('`', searchFrom)
    if (open < 0) break

    const runLength = backtickRunLength(text, open)
    let candidateFrom = open + runLength
    let close = -1

    while (candidateFrom < text.length) {
      const candidate = text.indexOf('`', candidateFrom)
      if (candidate < 0) break
      const candidateLength = backtickRunLength(text, candidate)
      if (candidateLength === runLength) {
        close = candidate
        break
      }
      candidateFrom = candidate + candidateLength
    }

    if (close < 0) {
      searchFrom = open + runLength
      continue
    }

    output += text.slice(cursor, open)
    output += text.slice(open, close + runLength).replace(/[^\r\n]/g, ' ')
    cursor = close + runLength
    searchFrom = cursor
  }

  return cursor === 0 ? text : output + text.slice(cursor)
}

function withoutBlockquotePrefix(line) {
  return line.replace(/^(?: {0,3}>[\t ]?)+/, '')
}

function stripIndent(line, width) {
  let index = 0
  let remaining = width
  while (index < line.length && remaining > 0) {
    if (line[index] === ' ') {
      index += 1
      remaining -= 1
    } else if (line[index] === '\t') {
      index += 1
      remaining = Math.max(0, remaining - 4)
    } else break
  }
  return line.slice(index)
}

function openingFenceCandidate(line) {
  let candidate = withoutBlockquotePrefix(line)
  let continuationIndent = 0

  while (true) {
    const list = candidate.match(/^ {0,3}(?:[-*+]|\d+[.)])[\t ]+/)
    if (!list) break
    continuationIndent += list[0].length
    candidate = withoutBlockquotePrefix(candidate.slice(list[0].length))
  }

  return { candidate, continuationIndent }
}

export function collectWritingFiles(root) {
  const files = new Set()
  for (const file of ['README.md', 'README.zh.md', 'package.json', 'cordis.patch.yml']) {
    if (existsSync(path.join(root, file))) files.add(file)
  }
  for (const file of walk(root, 'docs', new Set(['.md']))) files.add(file)
  for (const file of walk(root, 'src', new Set(['.ts']))) files.add(file)
  for (const file of walk(root, 'test', new Set(['.ts']))) files.add(file)
  for (const file of walk(root, '.github', new Set(['.md', '.yml', '.yaml']))) files.add(file)
  return [...files].sort()
}

function markdownWithoutFences(lines) {
  let fence = null

  return lines.map((line) => {
    if (fence !== null) {
      let candidate = withoutBlockquotePrefix(line)
      candidate = stripIndent(candidate, fence.continuationIndent)
      candidate = withoutBlockquotePrefix(candidate)
      const closingFence = candidate.match(/^\s{0,3}(`{3,}|~{3,})[\t ]*$/)
      if (
        closingFence
        && closingFence[1][0] === fence.marker
        && closingFence[1].length >= fence.length
      ) fence = null
      return ''
    }

    const { candidate, continuationIndent } = openingFenceCandidate(line)
    const openingFence = candidate.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/)
    if (openingFence) {
      const marker = openingFence[1][0]
      const info = openingFence[2]
      if (marker === '~' || !info.includes('`')) {
        fence = { marker, length: openingFence[1].length, continuationIndent }
        return ''
      }
    }

    return line
  })
}

export function markdownProseLines(text) {
  const sourceLines = text.split(/\r?\n/)
  const withoutFences = markdownWithoutFences(sourceLines)
  const withoutCodeSpans = stripCodeSpans(withoutFences.join('\n')).split('\n')

  return withoutCodeSpans.map((line, index) => {
    const content = withoutBlockquotePrefix(line)
    const heading = /^\s{0,3}#{1,6}(?:[\t ]+|$)/.test(content)
    const listItem = /^\s{0,3}(?:[-*+][\t ]+|\d+[.)][\t ]+)/.test(content)
    const referenceDefinition = /^\s{0,3}\[[^\]]+\]:/.test(content)
    const prose = referenceDefinition ? '' : content
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
      .replace(/\[([^\]]+)\]/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^\s{0,3}(?:#{1,6}\s*|[-*+]\s+|\d+[.)]\s+)/, '')
      .replace(/[\*_~]/g, '')

    return {
      line: index + 1,
      text: prose,
      breakBefore: heading || listItem || referenceDefinition,
      breakAfter: heading || referenceDefinition,
    }
  })
}

export function typescriptProseLines(text) {
  let index = 0
  let line = 1
  let nextScopeId = 1
  const scopes = []

  const makeScope = (kind, stripCode = false) => {
    const scope = { id: nextScopeId++, kind, stripCode, startLine: line, endLine: line, parts: new Map() }
    scopes.push(scope)
    return scope
  }

  const append = (scope, value) => {
    if (value === '\r') return
    if (value === '\n') {
      scope.endLine = Math.max(scope.endLine, line + 1)
      return
    }
    scope.endLine = Math.max(scope.endLine, line)
    scope.parts.set(line, (scope.parts.get(line) ?? '') + value)
  }

  const take = (scope = null) => {
    const value = text[index++]
    if (scope) append(scope, value)
    if (value === '\n') line += 1
    return value
  }

  const starts = (value) => text.startsWith(value, index)

  const parseLineComment = () => {
    take()
    take()
    const scope = makeScope('line-comment', true)
    while (index < text.length && text[index] !== '\n') take(scope)
    if (index < text.length) take()
  }

  const parseBlockComment = () => {
    take()
    take()
    const scope = makeScope('block-comment', true)
    while (index < text.length) {
      if (starts('*/')) {
        take()
        take()
        return
      }
      take(scope)
    }
  }

  const parseQuoted = (quote) => {
    take()
    const scope = makeScope('string')
    let escaped = false
    while (index < text.length) {
      const char = text[index]
      if (!escaped && char === quote) {
        take()
        return
      }
      if (!escaped && char === '\n') {
        take()
        return
      }
      take(scope)
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
    }
  }

  let parseCode

  const parseTemplate = () => {
    take()
    const scope = makeScope('template')
    let escaped = false
    while (index < text.length) {
      const char = text[index]
      if (escaped) {
        take(scope)
        escaped = false
        continue
      }
      if (char === '\\') {
        take(scope)
        escaped = true
        continue
      }
      if (char === '`') {
        take()
        return
      }
      if (starts('${')) {
        append(scope, ' ')
        take()
        take()
        parseCode(1)
        continue
      }
      take(scope)
    }
  }

  parseCode = (braceDepth = 0) => {
    let depth = braceDepth
    while (index < text.length) {
      if (starts('//')) {
        parseLineComment()
        continue
      }
      if (starts('/*')) {
        parseBlockComment()
        continue
      }
      const char = text[index]
      if (char === "'") {
        parseQuoted("'")
        continue
      }
      if (char === '"') {
        parseQuoted('"')
        continue
      }
      if (char === '`') {
        parseTemplate()
        continue
      }
      if (depth > 0 && char === '{') {
        depth += 1
        take()
        continue
      }
      if (depth > 0 && char === '}') {
        depth -= 1
        take()
        if (depth === 0) return
        continue
      }
      take()
    }
  }

  parseCode()

  const rows = []
  for (const scope of scopes) {
    const source = []
    for (let lineNo = scope.startLine; lineNo <= scope.endLine; lineNo += 1) {
      source.push(scope.parts.get(lineNo) ?? '')
    }
    const normalized = (scope.stripCode ? stripCodeSpans(source.join('\n')) : source.join('\n')).split('\n')
    for (let offset = 0; offset < normalized.length; offset += 1) {
      rows.push({
        line: scope.startLine + offset,
        text: normalized[offset],
        breakBefore: offset === 0,
        breakAfter: offset === normalized.length - 1,
        scope: scope.id,
      })
    }
  }

  return rows.sort((a, b) => a.line - b.line || a.scope - b.scope)
}

export function proseLinesForFile(root, file) {
  const text = readFileSync(path.join(root, file), 'utf8')
  if (file.endsWith('.md')) return markdownProseLines(text)
  if (file.endsWith('.ts')) return typescriptProseLines(text)
  return text.split(/\r?\n/).map((line, index) => ({ line: index + 1, text: line }))
}

export function findPhraseMatches(rows, phrase, options = {}) {
  const needle = phrase.toLowerCase()
  if (!needle) return []
  const requireHan = options.requireHan === true
  const matches = []
  let block = []

  const flush = () => {
    if (block.length === 0) return
    let text = ''
    const starts = []

    for (const row of block) {
      const part = row.text.trim()
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
    if (row.text.trim() === '') flush()
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
  if (result.status !== 0) {
    throw new Error(result.stderr || `git diff failed for base ${ref}`)
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
