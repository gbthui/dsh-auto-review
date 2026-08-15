import { readFileSync } from 'node:fs'

function parseScalar(raw) {
  const value = raw.trim()
  if (value.startsWith('"')) return JSON.parse(value)
  if (value.startsWith("'")) return value.slice(1, -1).replaceAll("''", "'")
  return value.replace(/\s+#.*$/, '').trim()
}

export function readTerminology(filePath) {
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/)
  const terms = new Map()
  const forbiddenZh = []
  const forbiddenEn = []
  let section = null
  let currentTerm = null
  let currentList = null
  let currentKeys = null

  const fail = (lineNo, line, message) => {
    throw new Error(`${filePath}:${lineNo}: ${message}: ${JSON.stringify(line)}`)
  }

  const claimKey = (key, lineNo, line) => {
    if (currentKeys.has(key)) fail(lineNo, line, `duplicate key ${key} in terminology entry ${currentTerm.id}`)
    currentKeys.add(key)
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const lineNo = index + 1
    if (/^\s*(?:#.*)?$/.test(line)) continue
    if (/^version:\s+\d+\s*$/.test(line)) continue

    if (/^terms:\s*$/.test(line)) {
      section = 'terms'
      currentTerm = null
      currentList = null
      currentKeys = null
      continue
    }
    if (/^forbidden_zh:\s*$/.test(line)) {
      section = 'forbidden_zh'
      currentTerm = null
      currentList = null
      currentKeys = null
      continue
    }
    if (/^forbidden_en:\s*$/.test(line)) {
      section = 'forbidden_en'
      currentTerm = null
      currentList = null
      currentKeys = null
      continue
    }

    if (section === 'terms') {
      const termStart = line.match(/^  ([a-z0-9-]+):\s*$/)
      if (termStart) {
        if (terms.has(termStart[1])) fail(lineNo, line, `duplicate terminology entry ${termStart[1]}`)
        currentTerm = { id: termStart[1], en: '', zh: '', code: '', avoidZh: [], avoidEn: [] }
        terms.set(currentTerm.id, currentTerm)
        currentList = null
        currentKeys = new Set()
        continue
      }
      if (!currentTerm) fail(lineNo, line, 'expected a terminology entry')

      const scalar = line.match(/^    (en|zh|code):\s+(.+?)\s*$/)
      if (scalar) {
        currentList = null
        claimKey(scalar[1], lineNo, line)
        const value = parseScalar(scalar[2])
        if (scalar[1] === 'en') currentTerm.en = value
        else if (scalar[1] === 'zh') currentTerm.zh = value
        else currentTerm.code = value
        continue
      }

      const listStart = line.match(/^    (avoid_zh|avoid_en):\s*$/)
      if (listStart) {
        claimKey(listStart[1], lineNo, line)
        currentList = listStart[1]
        continue
      }

      const listItem = line.match(/^      -\s+(.+?)\s*$/)
      if (listItem && currentList) {
        const value = parseScalar(listItem[1])
        if (currentList === 'avoid_zh') currentTerm.avoidZh.push(value)
        else currentTerm.avoidEn.push(value)
        continue
      }

      fail(lineNo, line, 'malformed terminology entry')
    }

    if (section === 'forbidden_zh' || section === 'forbidden_en') {
      const item = line.match(/^  -\s+(.+?)\s*$/)
      if (!item) fail(lineNo, line, `malformed ${section} entry`)
      const value = parseScalar(item[1])
      ;(section === 'forbidden_zh' ? forbiddenZh : forbiddenEn).push(value)
      continue
    }

    fail(lineNo, line, 'unexpected top-level content')
  }

  for (const term of terms.values()) {
    if (!term.en) throw new Error(`${filePath}: terminology entry ${term.id} has no en value`)
    if (!term.zh) throw new Error(`${filePath}: terminology entry ${term.id} has no zh value`)
  }
  if (terms.size === 0) throw new Error(`${filePath}: no terminology entries`)
  if (forbiddenZh.length === 0 || forbiddenEn.length === 0) {
    throw new Error(`${filePath}: forbidden_zh and forbidden_en must both be non-empty`)
  }

  return { terms: [...terms.values()], forbiddenZh, forbiddenEn }
}
