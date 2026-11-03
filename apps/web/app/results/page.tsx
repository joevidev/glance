import type { Metadata } from "next"
import Link from "next/link"
import { Glass, Section, Stat } from "../../components/bits"
import { REPO, REPO_URL, NOTE_SUSPENDED } from "../../lib/site"
import {
  summary, ranked, LABEL, SHORT, SYSTEM_KEYS, PAIR_LABEL, pair, sys, pct, signed, usd, secs, fmtP, isModel,
} from "../../lib/results"

export const metadata: Metadata = {
  title: "Results",
  description: "Glance benchmark: 360 held-out commands on 8 unseen sites, nine systems, McNemar and site-cluster bootstrap. Our LoRA did not beat its base model.",
}

type BarRow = { k: string; value: number; label: string; ci?: [number, number]; note?: string }

function Bars({ rows, hot, stack = false }: { rows: BarRow[]; hot?: string; stack?: boolean }) {
  const max = Math.max(...rows.map((r) => r.ci?.[1] ?? r.value), 1)
  return (
    <div className="relative z-10 space-y-3.5">
      {rows.map((r) => (
        <div key={r.k} className={`grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 ${stack ? "" : "sm:grid-cols-[17rem_1fr_5.5rem] sm:gap-x-5"}`}>
          <div className={`text-sm leading-tight sm:text-base ${r.k === hot ? "font-semibold text-white" : "text-w80"}`}>
            {LABEL[r.k]}
            {r.note && <span className="mono ml-2 text-[0.65rem] tracking-wider text-w40">{r.note}</span>}
          </div>
          <div className={`mono text-right text-sm sm:text-base ${stack ? "" : "sm:order-3"}`}>{r.label}</div>
          <div className={`track col-span-2 ${stack ? "" : "sm:col-span-1"}`}>
            <div className={`fillbar ${r.k === hot ? "hot" : ""}`} style={{ width: `${(r.value / max) * 100}%` }} />
            {r.ci && (
              <div
                className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-black/80"
                style={{ left: `${(r.ci[0] / max) * 100}%`, width: `${((r.ci[1] - r.ci[0]) / max) * 100}%` }}
                title={`95% site-bootstrap CI ${r.ci[0].toFixed(1)} to ${r.ci[1].toFixed(1)}`}
              >
                <i className="absolute -left-px top-1/2 h-3.5 w-0.5 -translate-y-1/2 bg-black/80" />
                <i className="absolute -right-px top-1/2 h-3.5 w-0.5 -translate-y-1/2 bg-black/80" />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <Glass md className="p-2 sm:p-4">
      <div className="relative z-10 overflow-x-auto">
        <table className="w-full min-w-[62rem] border-collapse text-left text-sm">
          <thead>
            <tr className="eyebrow">{head.map((h, i) => <th key={i} className="px-3 py-3 font-normal">{h}</th>)}</tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </Glass>
  )
}

const notRun = [
  { k: "harness_vote", what: "Open model, vote of 5 samples", detail: "Started; 46 of 360 rows were lost to the suspension, so it is excluded." },
  { k: "open_base_geo", what: "Open model with the distance-to-gaze prompt", detail: "Not scored: the account was suspended before it could run." },
  { k: "lora_geo", what: "A second LoRA trained with the distance prompt", detail: "Not launched." },
  { k: "lora_muse", what: "A LoRA on Muse Glimmer 30B", detail: "Prepared and dry-run, not launched." },
]

export default function Results() {
  const lora = pair("lora_vs_open_base")
  const gain = pair("open_base_vs_open_cmd_only")
  const flash = pair("open_base_flash_vs_frontier")
  const loraSys = sys("lora")
  const base = sys("open_base")
  const flashSys = sys("open_base_flash")
  const frontier = sys("frontier")
  const dTypes = Object.keys(summary.by_command_type)
  const first = summary.by_command_type[dTypes[0]!]!
  const cols = SYSTEM_KEYS.filter((k) => first[k])
  const llm = ranked.filter((k) => isModel(k))
  const pairOrder = Object.keys(summary.pairs).sort((a, b) => (a === "lora_vs_open_base" ? -1 : b === "lora_vs_open_base" ? 1 : 0))
  const sigmas = Object.keys(summary.by_sigma)

  return (
    <>
      <div className="relative overflow-hidden">
        <div className="blob left-[50%] top-[-10rem] size-[38rem] max-w-[120vw] opacity-50" aria-hidden />
        <section className="relative mx-auto max-w-6xl px-4 pt-14 sm:px-6 sm:pt-20">
          <div className="eyebrow">Results · {summary.n_test} held-out commands · {summary.n_sites} unseen sites</div>
          <h1 className="headline mt-3 max-w-5xl text-[clamp(2.2rem,5.6vw,4.4rem)] leading-[1.03]">
            Our LoRA did not beat its base model. <em>Gaze + command beats either alone.</em>
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-w80">
            The LoRA scored <b className="text-white">{pct(lora.acc_a)}</b> against <b className="text-white">{pct(lora.acc_b)}</b> for the model it was trained from
            ({signed(lora.boot_diff_pts)} points; {lora.n_only_a} cases only the LoRA got right, {lora.n_only_b} only the base; McNemar p = {fmtP(lora.mcnemar_p)}; site-bootstrap 95% CI {signed(lora.boot_ci95[0])} to {signed(lora.boot_ci95[1])}).
            The two tests disagree, so we do not call it a real loss either, but there is no win. It did remove the format errors: {loraSys.n_pred_none} unparseable replies against {base.n_pred_none} for the base.
          </p>
        </section>
      </div>

      <section className="mx-auto mt-10 grid max-w-6xl gap-4 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <Stat k="Gaze adds" v={`${signed(gain.boot_diff_pts)} pts`} d={<>open model with vs without the gaze point. McNemar p = {fmtP(gain.mcnemar_p)}, CI {signed(gain.boot_ci95[0])} to {signed(gain.boot_ci95[1])}. Real: both tests agree.</>} />
        <Stat k="LoRA vs its base" v={`${signed(lora.boot_diff_pts)} pts`} d={<>{pct(lora.acc_a)} vs {pct(lora.acc_b)}. p = {fmtP(lora.mcnemar_p)}, CI {signed(lora.boot_ci95[0])} to {signed(lora.boot_ci95[1])}. Tests disagree; no gain.</>} />
        <Stat k="Cost / 1,000 commands" v={`${usd(flashSys.cost_per_1k!)} vs ${usd(sys("frontier_sol").cost_per_1k!)}`} d={<>untrained flash ({pct(flashSys.acc)}) vs gpt-6.1-sol ({pct(sys("frontier_sol").acc)}), the cheapest OpenAI model that matched {summary.frontier_name} at {usd(frontier.cost_per_1k!)}; p = {fmtP(pair("open_base_flash_vs_frontier_sol").mcnemar_p)}, no reliable difference.</>} />
        <Stat k="Latency p50" v={`${secs(base.latency_p50_ms!)} vs ${secs(frontier.latency_p50_ms!)}`} d="open reasoning model vs frontier. No latency win for the open models." />
      </section>

      <Section eyebrow="Leaderboard" title={<>Top-1 accuracy, <em>same cases for every system.</em></>}>
        <Glass className="p-6 sm:p-10">
          <Bars hot="lora" rows={ranked.map((k) => ({ k, value: sys(k).acc, label: pct(sys(k).acc), ci: summary.acc_ci95_site_bootstrap[k], note: k === "lora" ? "OURS" : undefined }))} />
          <p className="relative z-10 mt-6 text-xs leading-relaxed text-w40">
            Dark whiskers are 95% intervals from resampling whole sites ({summary.n_sites} sites, so they are wide). Source: results/summary.json, one row per case per system.
          </p>
        </Glass>
        <div className="mt-6 grid items-start gap-5 md:grid-cols-3">
          {[["leaderboard.png", "Leaderboard"], ["bootstrap_ci.png", "Paired differences with site-bootstrap intervals"], ["disagreements.png", "Where two systems disagree"]].map(([f, t]) => (
            <Glass key={f} md className="overflow-hidden p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/charts/${f}`} alt={`Chart: ${t}`} className="relative z-10 w-full rounded-2xl bg-white" loading="lazy" />
              <div className="mono relative z-10 px-2 pb-1 pt-3 text-[0.7rem] tracking-wider text-w60">{t!.toUpperCase()}</div>
            </Glass>
          ))}
        </div>
      </Section>

      <Section eyebrow="Cost and latency" title={<>Cheaper is real. <em>Faster is not.</em></>}>
        <div className="grid gap-5 lg:grid-cols-2">
          <Glass className="p-6 sm:p-8">
            <div className="eyebrow relative z-10 mb-5">Cost per 1,000 commands</div>
            <Bars stack hot="lora" rows={[...llm].sort((a, b) => sys(a).cost_per_1k! - sys(b).cost_per_1k!).map((k) => ({ k, value: sys(k).cost_per_1k!, label: usd(sys(k).cost_per_1k!), note: k === "lora" ? "ESTIMATE" : undefined }))} />
            <p className="relative z-10 mt-5 text-xs leading-relaxed text-w40">Measured tokens from each provider times list price (looked up 2026-11-02, no cached-input discount, so upper bounds). The two geometry baselines run locally at no cost. The LoRA figure is a training-session estimate, not serving.</p>
          </Glass>
          <Glass className="p-6 sm:p-8">
            <div className="eyebrow relative z-10 mb-5">Latency, median per command</div>
            <Bars stack hot="lora" rows={[...llm].sort((a, b) => sys(a).latency_p50_ms! - sys(b).latency_p50_ms!).map((k) => ({ k, value: sys(k).latency_p50_ms!, label: secs(sys(k).latency_p50_ms!), note: k === "lora" ? "NOT SERVING" : undefined }))} />
            <p className="relative z-10 mt-5 text-xs leading-relaxed text-w40">{summary.latency_note}</p>
          </Glass>
        </div>
      </Section>

      <Section eyebrow="Paired tests" title={<>Is a difference <em>real?</em></>}>
        <Table head={["Comparison (A vs B)", "A", "B", "Diff (pts)", "95% site CI", "A only / B only", "McNemar p", "Verdict"]}>
          {pairOrder.map((k) => {
            const p = pair(k)
            return (
              <tr key={k} className={`rowline align-top ${k === "lora_vs_open_base" ? "bg-white/[0.08] font-semibold" : ""}`}>
                <td className="px-3 py-3">{PAIR_LABEL[k] ?? k}</td>
                <td className="mono whitespace-nowrap px-3 py-3">{pct(p.acc_a)}</td>
                <td className="mono whitespace-nowrap px-3 py-3">{pct(p.acc_b)}</td>
                <td className="mono whitespace-nowrap px-3 py-3">{signed(p.boot_diff_pts)}</td>
                <td className="mono whitespace-nowrap px-3 py-3">{signed(p.boot_ci95[0])} to {signed(p.boot_ci95[1])}</td>
                <td className="mono whitespace-nowrap px-3 py-3">{p.n_only_a} / {p.n_only_b}</td>
                <td className="mono whitespace-nowrap px-3 py-3">{fmtP(p.mcnemar_p)}</td>
                <td className="px-3 py-3 text-w80">{p.verdict.replace("open_base_flash", "untrained flash").replace("open_base", "open base").replace("lora", "LoRA")}</td>
              </tr>
            )
          })}
        </Table>
        <p className="mt-4 max-w-4xl text-sm leading-relaxed text-w60">
          Method: McNemar {summary.method.mcnemar}; bootstrap {summary.method.bootstrap}. Rule: {summary.method.real_gain_rule}. “A only / B only” counts the discordant cases.
        </p>
      </Section>

      <Section eyebrow="By command type" title={<>Where gaze matters, <em>and where it does not.</em></>}>
        <Table head={["Command type", "n", ...cols.map((k) => SHORT[k] ?? k)]}>
          {dTypes.map((t) => {
            const row = summary.by_command_type[t]!
            return (
              <tr key={t} className="rowline">
                <td className="px-3 py-3 font-medium">{t.replace("_", " ")}</td>
                <td className="mono px-3 py-3 text-w60">{row[cols[0]!]?.n}</td>
                {cols.map((k) => {
                  const v = row[k]?.acc ?? 0
                  return (
                    <td key={k} className="mono whitespace-nowrap px-3 py-3" style={{ background: `rgba(255,255,255,${(v / 100) * 0.28})` }}>{v.toFixed(0)}%</td>
                  )
                })}
              </tr>
            )
          })}
        </Table>
        <p className="mt-4 max-w-4xl text-sm leading-relaxed text-w60">
          Cell brightness follows accuracy. With the command alone, deictic commands (“open that”) score {pct(summary.by_command_type.deictic?.open_cmd_only?.acc ?? 0)} and ordinal ones score {pct(summary.by_command_type.ordinal?.open_cmd_only?.acc ?? 0)}: the command can name “the third one” but not “that.” Results are also split by gaze noise level (σ = {sigmas.join(", ")} px) in results/summary.json.
        </p>
      </Section>

      <Section eyebrow="Not run" title={<>What did not finish, <em>and why.</em></>}>
        <Glass className="p-6 sm:p-10">
          <p className="relative z-10 max-w-3xl text-lg leading-relaxed text-w80">{NOTE_SUSPENDED}. Everything in the tables above was produced and saved before that. Anything below is absent from every number on this page.</p>
          <ul className="relative z-10 mt-6">
            {notRun.map((n) => (
              <li key={n.k} className="rowline grid gap-1 py-4 sm:grid-cols-[22rem_1fr] sm:gap-6">
                <span className="font-medium">{n.what}</span>
                <span className="text-w60">{n.detail}</span>
              </li>
            ))}
          </ul>
          <p className="mono relative z-10 mt-4 text-xs leading-relaxed tracking-wider text-w40">summary.json lists as not run: {summary.not_run.join(", ")}. The demo app uses OpenAI gpt-6-astra for its model call, not Fireworks and not our LoRA.</p>
        </Glass>
      </Section>

      <Section eyebrow="Limits" title={<>What we <em>don’t</em> claim.</>}>
        <Glass className="p-6 sm:p-10">
          <ul className="relative z-10">
            {[
              <><b className="font-semibold text-white">Gaze is simulated.</b> Noise at published webcam error levels, on public sites. Not tested on real users at scale.</>,
              <><b className="font-semibold text-white">Commands are templated</b>, not spoken by people.</>,
              <><b className="font-semibold text-white">The LoRA did not beat its base</b> ({pct(lora.acc_a)} vs {pct(lora.acc_b)}). One training run, one seed.</>,
              <><b className="font-semibold text-white">LoRA cost and latency are estimates</b> sampled inside a training session. They are not serving numbers.</>,
              <><b className="font-semibold text-white">The frontier model could not run at temperature 0.</b> Its API accepts only the default, so its numbers come from a stochastic setting.</>,
              <><b className="font-semibold text-white">{base.n_truncated_length} of {base.n} open-model replies were cut off</b> at the 8,192-token limit and scored wrong. The open reasoning model spends its budget thinking.</>,
              <><b className="font-semibold text-white">Only {summary.n_sites} test sites.</b> The intervals are wide, and a few sites can move a result.</>,
              <><b className="font-semibold text-white">Prices are list prices</b> times measured tokens, upper bounds without caching.</>,
            ].map((li, i) => (
              <li key={i} className={`py-4 text-lg leading-snug text-w80 ${i ? "rowline" : ""}`}>{li}</li>
            ))}
          </ul>
        </Glass>
        <details className="mt-6 text-sm text-w60">
          <summary className="mono cursor-pointer text-xs tracking-wider text-w80">PIPELINE SUMMARY, VERBATIM FROM summary.json</summary>
          <p className="mt-3 max-w-4xl leading-relaxed">{summary.headline}</p>
        </details>
        <p className="mt-8 text-sm text-w60">
          Code, rows and the locked test manifest: <a href={REPO_URL} className="underline decoration-white/30 underline-offset-4">{REPO}</a> · <Link href="/disclosure/" className="underline decoration-white/30 underline-offset-4">Disclosure</Link>
        </p>
      </Section>
    </>
  )
}
