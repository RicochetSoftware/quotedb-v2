import { mkdir, readFile, writeFile } from 'node:fs/promises'

const packages = ['apps/api', 'apps/discord-bot', 'packages/shared', 'packages/ui']
let covered = 0
let total = 0
for (const directory of packages) {
  const report = JSON.parse(await readFile(`${directory}/coverage/coverage-summary.json`, 'utf8'))
  const lines = report.total.lines
  if (!Number.isInteger(lines.covered) || !Number.isInteger(lines.total) || lines.total <= 0) {
    throw new Error(`Invalid line coverage in ${directory}`)
  }
  covered += lines.covered
  total += lines.total
}

const percentage = (100 * covered) / total
const value = `${percentage.toFixed(1)}%`
const color = percentage >= 90 ? '#4c1' : percentage >= 75 ? '#97ca00' : '#dfb317'
const date = new Date().toISOString().slice(0, 10)
const description = `Unit-test line coverage: ${covered}/${total} lines (${value}), measured ${date}`
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="118" height="20" role="img" aria-label="${description}">
  <title>${description}</title>
  <linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>
  <clipPath id="r"><rect width="118" height="20" rx="3"/></clipPath>
  <g clip-path="url(#r)"><path fill="#555" d="M0 0h70v20H0z"/><path fill="${color}" d="M70 0h48v20H70z"/><path fill="url(#s)" d="M0 0h118v20H0z"/></g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="35" y="15" fill="#010101" fill-opacity=".3">unit lines</text><text x="35" y="14">unit lines</text>
    <text x="94" y="15" fill="#010101" fill-opacity=".3">${value}</text><text x="94" y="14">${value}</text>
  </g>
</svg>
`
await mkdir('.github/badges', { recursive: true })
await writeFile('.github/badges/coverage.svg', svg)
console.log(description)
