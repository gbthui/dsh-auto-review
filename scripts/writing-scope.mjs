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
    output += ' '
    cursor = close + runLength
    searchFrom = cursor
  }

  return cursor === 0 ? text : output + text.slice(cursor)
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

export function markdownProseLines(text) {
  const lines = text.split(/\r?\n/)
  let fence = null

  return lines.map((line, index) => {
    if (fence !== null) {
      const closingFence = line.match(/^\s{0,3}(`{3,}|~{3,})[\t ]*$/)
      if (
        closingFence
        && closingFence[1][0] === fence.marker
        && closingFence[1].length >= fence.length
      ) fence = null
      return { line: index + 1, text: '' }
    }

    const openingFence = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/)
    if (openingFence) {
      const marker = openingFence[1][0]
      const info = openingFence[2]
      if (marker === '~' || !info.includes('`')) {
        fence = { marker, length: openingFence[1].length }
        return { line: index + 1, text: '' }
      }
    }

    const heading = /^\s{0,3}#{1,6}(?:[\t ]+|$)/.test(line)
    const listItem = /^\s{0,3}(?:[-*+][\t ]+|\d+[.)][\t ]+)/.test(line)
    const prose = stripCodeSpans(line)
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/^\s{0,3}(?:#{1,6}\s*|>\s*|[-*+]\s+|\d+[.)]\s+)/, '')
      .replace(/[\*_~]/g, '')

    return {
      line: index + 1,
      text: prose,
      breakBefore: heading || listItem,
      breakAfter: heading,
    }
  })
}

export function proseLinesForFile(root, file) {
  const text = readFileSync(path.join(root, file), 'utf8')
  if (file.endsWith('.md')) return markdownProseLines(text)
  return text.split(/\r?\n/).map((line, index) => ({ line: index + 1, text: stripCodeSpans(line) }))
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
      let line = starts[0]?.line ?? block[0].line
      for (const start of starts) {
        if (start.offset > offset) break
        line = start.line
      }
      matches.push(line)
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
  const result = spawnSync('git', ['diff', '--unified=0', `${ref}...HEAD`, '--', ...files], {
    cwd: root,
    encoding: 'utf8',
  })
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
