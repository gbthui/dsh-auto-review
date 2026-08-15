import { readFileSync } from 'node:fs'
import { parseDocument } from 'yaml'

function asObject(value, label, filePath) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${filePath}: ${label} must be a mapping`)
  }
  return value
}

function nonEmptyString(value, label, filePath) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${filePath}: ${label} must be a non-empty string`)
  }
  return value
}

function stringList(value, label, filePath) {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`${filePath}: ${label} must be a list`)
  return value.map((item, index) => nonEmptyString(item, `${label}[${index}]`, filePath))
}

export function readTerminology(filePath) {
  const source = readFileSync(filePath, 'utf8')
  const document = parseDocument(source, { uniqueKeys: true, prettyErrors: true })
  if (document.errors.length) {
    throw new Error(`${filePath}: ${document.errors.map((error) => error.message).join('; ')}`)
  }

  const root = asObject(document.toJS(), 'document', filePath)
  if (root.version !== 2) throw new Error(`${filePath}: version must be 2`)

  const rawTerms = asObject(root.terms, 'terms', filePath)
  const terms = []
  const allowedKeys = new Set(['en', 'zh', 'code', 'avoid_zh', 'avoid_en'])

  for (const [id, rawValue] of Object.entries(rawTerms)) {
    if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`${filePath}: invalid terminology id ${JSON.stringify(id)}`)
    const value = asObject(rawValue, `terms.${id}`, filePath)
    for (const key of Object.keys(value)) {
      if (!allowedKeys.has(key)) throw new Error(`${filePath}: unexpected key terms.${id}.${key}`)
    }
    terms.push({
      id,
      en: nonEmptyString(value.en, `terms.${id}.en`, filePath),
      zh: nonEmptyString(value.zh, `terms.${id}.zh`, filePath),
      code: value.code === undefined ? '' : nonEmptyString(value.code, `terms.${id}.code`, filePath),
      avoidZh: stringList(value.avoid_zh, `terms.${id}.avoid_zh`, filePath),
      avoidEn: stringList(value.avoid_en, `terms.${id}.avoid_en`, filePath),
    })
  }

  if (terms.length === 0) throw new Error(`${filePath}: no terminology entries`)
  const forbiddenZh = stringList(root.forbidden_zh, 'forbidden_zh', filePath)
  const forbiddenEn = stringList(root.forbidden_en, 'forbidden_en', filePath)
  if (forbiddenZh.length === 0 || forbiddenEn.length === 0) {
    throw new Error(`${filePath}: forbidden_zh and forbidden_en must both be non-empty`)
  }

  return { terms, forbiddenZh, forbiddenEn }
}
