import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { readTerminology } from './terminology.mjs'
import { collectWritingFiles, findPhraseMatches, proseLinesForFile } from './writing-scope.mjs'

export function checkTerminology(root = process.cwd()) {
  const terminologyPath = path.join(root, 'docs', 'terminology.yaml')
  const { terms, forbiddenZh, forbiddenEn } = readTerminology(terminologyPath)
  const files = collectWritingFiles(root)
  const failures = []

  for (const file of files) {
    const rows = proseLinesForFile(root, file)

    for (const phrase of [...forbiddenZh, ...forbiddenEn]) {
      for (const line of findPhraseMatches(rows, phrase)) {
        failures.push(`${file}:${line}: forbidden terminology ${JSON.stringify(phrase)}`)
      }
    }

    for (const term of terms) {
      for (const avoided of term.avoidZh) {
        for (const line of findPhraseMatches(rows, avoided, { requireHan: true })) {
          failures.push(`${file}:${line}: use ${JSON.stringify(term.zh)} instead of ${JSON.stringify(avoided)}`)
        }
      }
      for (const avoided of term.avoidEn) {
        for (const line of findPhraseMatches(rows, avoided)) {
          failures.push(`${file}:${line}: use ${JSON.stringify(term.en)} instead of ${JSON.stringify(avoided)}`)
        }
      }
    }
  }

  return {
    failures: [...new Set(failures)],
    files: files.length,
    alternatives: terms.reduce((count, term) => count + term.avoidZh.length + term.avoidEn.length, 0),
    forbidden: forbiddenZh.length + forbiddenEn.length,
  }
}

function main() {
  const result = checkTerminology()
  if (result.failures.length) {
    console.error(result.failures.join('\n'))
    process.exit(1)
  }
  console.log(`terminology check passed (${result.files} files, ${result.alternatives} alternatives, ${result.forbidden} forbidden phrases)`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main()
