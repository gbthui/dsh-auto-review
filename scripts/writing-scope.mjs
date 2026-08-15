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
    const candidate = withoutBlockquotePrefix(line)

    if (fence !== null) {
      const closingFence = candidate.match(/^\s{0,3}(`{3,}|~{3,})[\t ]*$/)
      if (
        closingFence
        && closingFence[1][0] === fence.marker
        && closingFence[1].length >= fence.length
      ) fence = null
      return ''
    }

    const openingFence = candidate.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/)
    if (openingFence) {
      const marker = openingFence[1][0]
      const info = openingFence[2]
      if (marker === '~' || !info.includes('`')) {
        fence = { marker, length: openingFence[1].length }
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
    const prose = content
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^\s{0,3}(?:#{1,6}\s*|[-*+]\s+|\d+[.)]\s+)/, '')
      .replace(/[\*_~]/g, '')

    return {
      line: index + 1,
      text: prose,
      breakBefore: heading || listItem,
      breakAfter: heading,
    }
  })
}

export function typescriptProseLines(text) {
  const lines = text.split(/\r?\n/)
  let mode = 'code'
  let escaped = false

  return lines.map((line, index) => {
    let visible = ''
    const prose = []
    let i = 0

    const appendComment = (segment) => {
      const stripped = stripCodeSpans(segment)
      visible += stripped
      prose.push(stripped)
    }

    while (i < line.length) {
      if (mode === 'block-comment') {
        const end = line.indexOf('*/', i)
        if (end < 0) {
          appendComment(line.slice(i))
          i = line.length
          continue
        }
        appendComment(line.slice(i, end + 2))
        i = end + 2
        mode = 'code'
        continue
      }

      if (mode === 'code') {
        if (line.startsWith('//', i)) {
          appendComment(line.slice(i))
          i = line.length
          continue
        }
        if (line.startsWith('/*', i)) {
          mode = 'block-comment'
          continue
        }
        const char = line[i]
        if (char === "'") mode = 'single'
        else if (char === '"') mode = 'double'
        else if (char === '`') mode = 'template'
        visible += char
        i += 1
        continue
      }

      const delimiter = mode === 'single' ? "'" : mode === 'double' ? '"' : '`'
      const char = line[i]
      visible += char

      if (escaped) {
        prose.push(char)
        escaped = false
        i += 1
        continue
      }
      if (char === '\\') {
        prose.push(char)
        escaped = true
        i += 1
        continue
      }
      if (char === delimiter) {
        mode = 'code'
        i += 1
        continue
      }

      prose.push(char)
      i += 1
    }

    if (mode === 'single' || mode === 'double') {
      mode = 'code'
      escaped = false
    } else if (mode !== 'template') {
      escaped = false
    }

    return { line: index + 1, text: visible, proseText: prose.join('') }
  })
}

export function proseLinesForFile(root, file) {
  const text = readFileSync(path.join(root, file), 'utf8')
  if (file.endsWith('.md')) return markdownProseLines(text)
  if (file.endsWith('.ts')) return typescriptProseLines(text)
  return text.split(/\r?\n/).map((line, index) => ({ line: index + 1, text: line }))
}

export function findPhraseMatches(rows, phrase, options = {}) {
  const needle = phrase.toLowerCase()
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
      starts.push({ offset: text.length, line: row.line, row })
      text += part
    }

    const folded = text.toLowerCase()
    let offset = folded.indexOf(needle)
    while (offset >= 0) {
      let start = starts[0]
      for (const candidate of starts) {
        if (candidate.offset > offset) break
        start = candidate
      }

      let accepted = true
      if (requireHan) {
        if (start?.row.proseText !== undefined) {
          const scoped = start.row.proseText
          accepted = /\p{Script=Han}/u.test(scoped) && scoped.toLowerCase().includes(needle)
        } else {
          accepted = /\p{Script=Han}/u.test(text)
        }
      }

      if (accepted) matches.push(start?.line ?? block[0].line)
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
