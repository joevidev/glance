// Copies the benchmark output into this app at build time, so no number is typed by hand.
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const web = resolve(here, "..")
const results = resolve(web, "../../results")

const summary = join(results, "summary.json")
if (!existsSync(summary)) throw new Error(`missing ${summary}: run the lab stats first`)
mkdirSync(join(web, "data"), { recursive: true })
cpSync(summary, join(web, "data/summary.json"))

const charts = join(results, "charts")
mkdirSync(join(web, "public/charts"), { recursive: true })
let n = 0
for (const f of readdirSync(charts)) {
  if (f.endsWith(".png")) {
    cpSync(join(charts, f), join(web, "public/charts", f))
    n++
  }
}
console.log(`sync-results: summary.json + ${n} charts`)
