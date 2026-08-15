import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const PROSE_KEYS = new Set(['description', 'displayname', 'label', 'message', 'name', 'summary', 'title'])

function normalizedKey(value) {
  return value.toLowerCase().replace(/[-_.]/g, '')
}

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

function isReleaseNotesFile(name) {
  return /^(?:CHANGELOG|CHANGES|HISTORY|RELEASE_NOTES)(?:[._-].*)?\.md$/i.test(name)
}

export function collectWritingFiles(root) {
  const files = new Set()
  for (const file of ['README.md', 'README.zh.md', 'package.json', 'cordis.patch.yml']) {
    if (existsSync(path.join(root, file))) files.add(file)
  }
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && isReleaseNotesFile(entry.name)) files.add(entry.name)
  }
  for (const file of walk(root, 'docs', new Set(['.md']))) files.add(file)
  for (const file of walk(root, 'src', new Set(['.ts']))) files.add(file)
  for (const file of walk(root, 'test', new Set(['.ts']))) files.add(file)
  for (const file of walk(root, '.github', new Set(['.md', '.yml', '.yaml']))) files.add(file)
  return [...files].sort()
}

function markdownWithoutCodeBlocks(lines) {
  let fence = null
  let inIndented = false
  let previousBlank = true

  return lines.map((line) => {
    if (fence !== null) {
      let candidate = withoutBlockquotePrefix(line)
      candidate = stripIndent(candidate, fence.continuationIndent)
      candidate = withoutBlockquotePrefix(candidate)
      const closingFence = candidate.match(/^\s{0,3}(`{3,}|~{3,})[\t ]*$/)
      if (closingFence && closingFence[1][0] === fence.marker && closingFence[1].length >= fence.length) fence = null
      previousBlank = line.trim() === ''
      return ''
    }

    const { candidate, continuationIndent } = openingFenceCandidate(line)
    const openingFence = candidate.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/)
    if (openingFence) {
      const marker = openingFence[1][0]
      const info = openingFence[2]
      if (marker === '~' || !info.includes('`')) {
        fence = { marker, length: openingFence[1].length, continuationIndent }
        inIndented = false
        previousBlank = false
        return ''
      }
    }

    const unquoted = withoutBlockquotePrefix(line)
    const indented = /^(?: {4}|\t)/.test(unquoted)
    if (inIndented) {
      if (indented || unquoted.trim() === '') {
        previousBlank = unquoted.trim() === ''
        return ''
      }
      inIndented = false
    }
    if (indented && previousBlank) {
      inIndented = true
      previousBlank = false
      return ''
    }

    previousBlank = unquoted.trim() === ''
    return line
  })
}

function markdownBoundary(line) {
  const content = withoutBlockquotePrefix(line)
  return {
    heading: /^\s{0,3}#{1,6}(?:[\t ]+|$)/.test(content),
    listItem: /^\s{0,3}(?:[-*+][\t ]+|\d+[.)][\t ]+)/.test(content),
    referenceDefinition: /^\s{0,3}\[[^\]]+\]:/.test(content),
  }
}

function stripMarkdownCodeSpans(lines) {
  const output = [...lines]
  let start = 0

  const flush = (end) => {
    if (end <= start) return
    const stripped = stripCodeSpans(lines.slice(start, end).join('\n')).split('\n')
    for (let index = 0; index < stripped.length; index += 1) output[start + index] = stripped[index]
  }

  for (let index = 0; index <= lines.length; index += 1) {
    if (index === lines.length) {
      flush(index)
      break
    }
    const line = lines[index]
    const boundary = markdownBoundary(line)
    const separate = line.trim() === '' || boundary.heading || boundary.listItem || boundary.referenceDefinition
    if (!separate) continue
    flush(index)
    if (line.trim() !== '') output[index] = stripCodeSpans(line)
    start = index + 1
  }

  return output
}

export function markdownProseLines(text) {
  const sourceLines = text.split(/\r?\n/)
  const withoutBlocks = markdownWithoutCodeBlocks(sourceLines)
  const withoutCodeSpans = stripMarkdownCodeSpans(withoutBlocks)

  return withoutCodeSpans.map((line, index) => {
    const content = withoutBlockquotePrefix(line)
    const { heading, listItem, referenceDefinition } = markdownBoundary(line)
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

function previousWord(text, index) {
  const prefix = text.slice(0, index).match(/([A-Za-z_$][\w$]*)\s*$/)
  return prefix?.[1] ?? ''
}

function canStartRegex(text, index, previousSignificant) {
  if (previousSignificant === null || /[([{=,:;!&|?+\-*%^~<>]/.test(previousSignificant)) return true
  return /^(?:await|case|delete|in|instanceof|new|of|return|throw|typeof|void|yield)$/.test(previousWord(text, index))
}

function normalizeScopeLines(scope, source) {
  let normalized = scope.stripCode ? stripCodeSpans(source.join('\n')).split('\n') : [...source]
  if (scope.kind === 'block-comment') normalized = normalized.map((line) => line.replace(/^\s*\*\s?/, ''))
  return normalized
}

export function typescriptProseLines(text) {
  let index = 0
  let line = 1
  let nextScopeId = 1
  let previousSignificant = null
  let continuableLineComment = null
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

  const take = (scope = null, code = false) => {
    const value = text[index++]
    if (scope) append(scope, value)
    if (code && !/\s/.test(value)) {
      previousSignificant = value
      continuableLineComment = null
    }
    if (value === '\n') line += 1
    return value
  }

  const starts = (value) => text.startsWith(value, index)

  const parseLineComment = () => {
    take()
    take()
    const scope = continuableLineComment && continuableLineComment.endLine >= line - 1
      ? continuableLineComment
      : makeScope('line-comment', true)
    scope.endLine = Math.max(scope.endLine, line)
    while (index < text.length && text[index] !== '\n') take(scope)
    if (index < text.length) take()
    continuableLineComment = scope
  }

  const parseBlockComment = () => {
    continuableLineComment = null
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
    continuableLineComment = null
    take()
    const scope = makeScope('string')
    let escaped = false
    while (index < text.length) {
      const char = text[index]
      if (!escaped && char === quote) {
        take()
        previousSignificant = quote
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

  const parseRegex = () => {
    continuableLineComment = null
    take()
    let escaped = false
    let inClass = false
    while (index < text.length) {
      const char = text[index]
      take()
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '[') {
        inClass = true
        continue
      }
      if (char === ']' && inClass) {
        inClass = false
        continue
      }
      if (char === '/' && !inClass) {
        while (index < text.length && /[A-Za-z]/.test(text[index])) take()
        previousSignificant = '/'
        return
      }
      if (char === '\n') return
    }
  }

  let parseCode

  const parseTemplate = () => {
    continuableLineComment = null
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
        previousSignificant = '`'
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
      if (char === '/' && canStartRegex(text, index, previousSignificant)) {
        parseRegex()
        continue
      }
      if (depth > 0 && char === '{') {
        depth += 1
        take(null, true)
        continue
      }
      if (depth > 0 && char === '}') {
        depth -= 1
        take(null, true)
        if (depth === 0) return
        continue
      }
      take(null, true)
    }
  }

  parseCode()

  const rows = []
  for (const scope of scopes) {
    const source = []
    for (let lineNo = scope.startLine; lineNo <= scope.endLine; lineNo += 1) source.push(scope.parts.get(lineNo) ?? '')
    const normalized = normalizeScopeLines(scope, source)
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

function splitYamlComment(line) {
  let quote = null
  let escaped = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (quote === '"' && char === '\\') {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '#') return [line.slice(0, index), line.slice(index + 1)]
  }
  return [line, '']
}

function unquoteScalar(value) {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replaceAll("''", "'")
  return trimmed
}

export function yamlProseLines(text) {
  return text.split(/\r?\n/).map((line, index) => {
    const [syntax, comment] = splitYamlComment(line)
    const field = syntax.match(/^\s*(?:-\s*)?([A-Za-z0-9_.-]+):\s*(.*?)\s*$/)
    const value = field && PROSE_KEYS.has(normalizedKey(field[1])) ? unquoteScalar(field[2]) : ''
    const prose = [value, comment.trim()].filter(Boolean).join(' ')
    return { line: index + 1, text: prose }
  })
}

export function jsonMetadataProseLines(text) {
  return text.split(/\r?\n/).map((line, index) => {
    const match = line.match(/^\s*"([^"]+)"\s*:\s*"((?:\\.|[^"\\])*)"/)
    if (!match || !PROSE_KEYS.has(normalizedKey(match[1]))) return { line: index + 1, text: '' }
    let value = match[2]
    try {
      value = JSON.parse(`"${match[2]}"`)
    } catch {}
    return { line: index + 1, text: value }
  })
}

export function proseLinesForFile(root, file) {
  const text = readFileSync(path.join(root, file), 'utf8')
  if (file.endsWith('.md')) return markdownProseLines(text)
  if (file.endsWith('.ts')) return typescriptProseLines(text)
  if (file.endsWith('.yml') || file.endsWith('.yaml')) return yamlProseLines(text)
  if (file.endsWith('.json')) return jsonMetadataProseLines(text)
  return text.split(/\r?\n/).map((line, index) => ({ line: index + 1, text: line }))
}

function normalizePhraseText(value) {
  return value.trim().replace(/\s+/g, ' ')
}

export function findPhraseMatches(rows, phrase, options = {}) {
  const needle = normalizePhraseText(phrase).toLowerCase()
  if (!needle) return []
  const requireHan = options.requireHan === true
  const matches = []
  let block = []

  const flush = () => {
    if (block.length === 0) return
    let text = ''
    const starts = []

    for (const row of block) {
      const part = normalizePhraseText(row.text)
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
    if (normalizePhraseText(row.text) === '') flush()
    else {
      block.push(row)
      if (row.breakAfter) flush()
    }
  }
  flush()
  return matches
}

export function addedLineNumbers(root, ref, files) {
  const result = spawnSync('git', ['-c', 'core.quotePath=false', 'diff', '--unified=0', `${ref}...HEAD`, '--', ...files], {
    cwd: root,
    encoding: 'utf8',
  })
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
