import { Mark } from "@glance/ui/components/mark";
import { Play } from "lucide-react";
import Link from "next/link";
import { Glass, Section } from "../components/bits";
import { pair, pct, signed, summary, sys } from "../lib/results";
import { REPO, REPO_URL } from "../lib/site";

const inbox = [
  ["Re: Demo tomorrow at 3", "ANA"],
  ["Re: Invoice #4821", "BILLING"],
  ["Weekly update", "TEAM"],
  ["Lunch on Friday?", "MARCO"],
  ["Your receipt", "STORE"],
];

function HeroMock() {
  return (
    <Glass className="relative mx-auto w-full max-w-[34rem] p-5 sm:p-8">
      <div className="mb-5 flex gap-2.5" aria-hidden>
        <i className="size-3.5 rounded-full bg-w20" />
        <i className="size-3.5 rounded-full bg-w20" />
        <i className="size-3.5 rounded-full bg-w20" />
      </div>
      <div className="relative">
        {inbox.map(([t, who]) => (
          <div
            key={t}
            className="mb-2.5 flex h-14 items-center justify-between rounded-3xl border border-white/10 bg-white/[0.07] px-5 sm:h-[4.25rem]"
          >
            <span className="truncate text-[0.95rem] font-medium tracking-[-0.015em] sm:text-lg">
              {t}
            </span>
            <small className="mono ml-3 text-[0.65rem] tracking-wider text-w40 sm:text-xs">
              {who}
            </small>
          </div>
        ))}
        <div
          className="gaze-ring absolute left-[18%] top-[22%] size-36 rounded-full sm:size-48"
          aria-hidden
        />
        <div className="mono absolute right-[2%] top-[52%] whitespace-nowrap rounded-full border border-white/35 bg-black/70 px-3 py-1.5 text-[0.62rem] tracking-wide sm:text-xs">
          webcam gaze: ±100–200 px
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3 rounded-full border border-white/20 bg-black/40 px-4 py-2.5">
        <span className="mono text-[0.65rem] tracking-[0.14em] text-w60 sm:text-xs">
          YOU SAY
        </span>
        <span className="text-base font-light tracking-[-0.02em] sm:text-xl">
          “Open that.”
        </span>
        <span className="mono ml-auto text-[0.65rem] text-w40 sm:text-xs">
          which one?
        </span>
      </div>
    </Glass>
  );
}

const cards = [
  {
    k: "Eyes",
    h: "Look",
    p: "Webcam, iris and head pose, calibrated to you in about a minute. Moves the cursor; a wink clicks.",
    w: "LOCAL · ~30 FPS · PRIVATE",
  },
  {
    k: "Brain",
    h: "Decide",
    p: "A model gets your gaze point, your command and the clickable elements on screen, as text. It returns the one you mean.",
    w: "TEXT ONLY · NO IMAGES LEAVE THE LAPTOP",
  },
  {
    k: "Hands",
    h: "Act",
    p: "The Mac does it: click, scroll, type. The cursor never waits on the cloud.",
    w: "macOS · NATIVE MOUSE HELPER",
  },
];

const controls = [
  ["Move", "Look. Smoothed gaze moves the real cursor."],
  ["Left / right click", "Wink left / wink right"],
  ["Double click", "Double wink"],
  ["Drag", "Open mouth to press, move your gaze, close mouth to drop"],
  ["Scroll", "Raise brows, then nod up or down"],
  ["Radial menu", "Hold your gaze for about 1 second"],
  ["Voice command", "Option+Space, speak, Option+Space"],
  ["Pause tracking", "Alt+Shift+P"],
];

export default function Home() {
  const gain = pair("open_base_vs_open_cmd_only");
  const lora = pair("lora_vs_open_base");
  return (
    <>
      <div className="relative overflow-hidden">
        <div
          className="blob left-[45%] top-[-8rem] size-[40rem] max-w-[120vw] opacity-60"
          aria-hidden
        />
        <section className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-4 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:pt-24">
          <div>
            <div className="mb-8 flex items-center gap-4">
              <Mark size={76} />
              <div className="eyebrow">
                Fireworks · Deploy Buildathon · 2026-11-02
              </div>
            </div>
            <h1 className="headline text-[clamp(2.4rem,6.2vw,4.9rem)] leading-[1.02]">
              Your assistant can hear you. <em>Now it can see what you see.</em>
            </h1>
            <p className="mt-6 max-w-xl text-lg font-light leading-relaxed text-w80 sm:text-xl">
              Say “open that” and the assistant knows which “that.” Your eyes
              point, your voice commands, and a model picks the exact element,
              even when the eye tracker is 100 to 200 px off.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/results/"
                className="glass glass-pill px-6 py-3 text-sm font-medium"
              >
                <span className="relative z-10">See the benchmark</span>
              </Link>
              <a href={REPO_URL} className="pill px-6 py-3">
                {REPO}
              </a>
            </div>
          </div>
          <HeroMock />
        </section>
      </div>

      <Section
        eyebrow="How it works"
        title={
          <>
            Eyes say <em>where.</em> Voice says <em>what.</em> A model decides{" "}
            <em>which.</em>
          </>
        }
      >
        <div className="grid gap-5 md:grid-cols-3">
          {cards.map((c) => (
            <Glass key={c.k} className="flex min-h-72 flex-col p-8">
              <div className="eyebrow">{c.k}</div>
              <h3 className="headline mt-4 text-5xl">{c.h}</h3>
              <p className="mt-4 text-lg leading-snug text-w80">{c.p}</p>
              <div className="mono mt-auto pt-6 text-[0.7rem] tracking-[0.08em] text-w60">
                {c.w}
              </div>
            </Glass>
          ))}
        </div>
        <p className="mt-8 text-lg text-w60 sm:text-xl">
          <b className="font-semibold text-white">
            Eyes are local and private.
          </b>{" "}
          The model gets text only: a gaze point, a command and element names.{" "}
          <b className="font-semibold text-white">Gaze never clicks alone.</b> A
          wink, a key or a spoken command does.
        </p>
      </Section>

      <Section
        eyebrow="Controls"
        title={
          <>
            Hands off, <em>on purpose.</em>
          </>
        }
      >
        <Glass md className="overflow-hidden p-2 sm:p-4">
          <table className="relative z-10 w-full border-collapse text-left">
            <thead>
              <tr className="eyebrow">
                <th className="px-4 py-3 font-normal">Action</th>
                <th className="px-4 py-3 font-normal">Gesture</th>
              </tr>
            </thead>
            <tbody>
              {controls.map(([a, g]) => (
                <tr key={a} className="rowline align-top">
                  <td className="w-[38%] px-4 py-3.5 font-medium sm:w-1/3">
                    {a}
                  </td>
                  <td className="px-4 py-3.5 text-w80">{g}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Glass>
        <p className="mt-4 text-sm text-w40">
          Onboarding runs a 9-point calibration and tests which gestures work
          for your face. Gesture and eye tracking are verified with synthetic
          camera frames only; real-face testing is still to do.
        </p>
      </Section>

      <Section
        eyebrow="Demo"
        title={
          <>
            See it <em>work.</em>
          </>
        }
      >
        <div className="dashed-frame relative grid aspect-video w-full place-items-center overflow-hidden">
          <div className="text-center">
            <div className="glass glass-pill mx-auto grid size-16 place-items-center">
              <Play className="relative z-10 size-6" />
            </div>
            <div className="mono mt-5 text-sm tracking-[0.16em] text-w60">
              VIDEO COMING
            </div>
            <div className="mt-1 text-sm text-w40">
              The demo video is not recorded yet. Nothing here is a fake
              recording.
            </div>
          </div>
        </div>
      </Section>

      <Section
        eyebrow="Measured, not claimed"
        title={
          <>
            Gaze + command beats either alone.{" "}
            <em>Our LoRA did not beat its base.</em>
          </>
        }
      >
        <div className="grid gap-5 sm:grid-cols-3">
          <Glass md className="p-6">
            <div className="eyebrow">Gaze adds</div>
            <div className="mt-3 text-4xl font-semibold tracking-[-0.04em]">
              {signed(gain.boot_diff_pts)} pts
            </div>
            <p className="mt-2 text-sm text-w60">
              open model with vs without the gaze point, {summary.n_test}{" "}
              held-out cases, {summary.n_sites} unseen sites
            </p>
          </Glass>
          <Glass md className="p-6">
            <div className="eyebrow">LoRA vs its base</div>
            <div className="mt-3 text-4xl font-semibold tracking-[-0.04em]">
              {signed(lora.boot_diff_pts)} pts
            </div>
            <p className="mt-2 text-sm text-w60">
              {pct(lora.acc_a)} vs {pct(lora.acc_b)}. Not a win, and the tests
              disagree on whether it is a loss.
            </p>
          </Glass>
          <Glass md className="p-6">
            <div className="eyebrow">Highest accuracy</div>
            <div className="mt-3 text-4xl font-semibold tracking-[-0.04em]">
              {pct(sys("open_base_flash").acc)}
            </div>
            <p className="mt-2 text-sm text-w60">
              untrained open flash model; no reliable difference from the
              frontier model at a fraction of the cost
            </p>
          </Glass>
        </div>
        <Link
          href="/results/"
          className="mono mt-6 inline-block text-sm tracking-wider text-w80 underline decoration-white/30 underline-offset-4"
        >
          FULL RESULTS, METHOD AND LIMITS →
        </Link>
      </Section>

      <Section
        eyebrow="Who it is for"
        title={
          <>
            Anyone whose hands are busy <em>or can’t help.</em>
          </>
        }
      >
        <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
          <Glass className="p-8 sm:p-10">
            <div className="eyebrow">Hands that can’t</div>
            <h3 className="headline mt-4 text-3xl leading-[1.08] sm:text-4xl">
              Today: a $10,500 device. Glance: a webcam.
            </h3>
            <ul className="mt-6">
              <li className="rowline py-4 text-lg leading-snug text-w80">
                <b className="font-semibold text-white">~33,000</b> people with
                ALS in the US (CDC registry projection for 2022)
              </li>
              <li className="rowline py-4 text-lg leading-snug text-w80">
                <b className="font-semibold text-white">&gt;250,000</b> with
                spinal cord injury, about 47% quadriplegic (2009 paper)
              </li>
              <li className="rowline py-4 text-lg leading-snug text-w80">
                Dedicated eye-gaze hardware:{" "}
                <b className="font-semibold text-white">~$10,500</b> (Tobii
                Dynavox TD Pilot, state AT program listing)
              </li>
            </ul>
          </Glass>
          <Glass className="p-8 sm:p-10">
            <div className="eyebrow">Hands that are busy</div>
            <h3 className="headline mt-4 text-3xl leading-[1.08] sm:text-4xl">
              Everyone else
            </h3>
            <ul className="mt-6">
              <li className="rowline py-4 text-lg leading-snug text-w80">
                Cooking with a recipe on screen, presenting standing up, working
                reclined
              </li>
              <li className="rowline py-4 text-lg leading-snug text-w80">
                Say less: it already knows what “that” is
              </li>
              <li className="rowline py-4 text-lg leading-snug text-w80">
                <b className="font-semibold text-white">
                  No market number yet.
                </b>{" "}
                We have not measured this one.
              </li>
            </ul>
          </Glass>
        </div>
        <p className="mono mt-5 max-w-4xl text-xs leading-relaxed text-w40">
          Sources: CDC National ALS Registry (modelled projection, not a count)
          · Harada et al. 2009 · Montana Assistive Technology Program listing ·
          Engadget 2021. The device price is a listed estimate; insurance
          coverage varies. No interview with a user yet.
        </p>
      </Section>

      <Section
        eyebrow="Team"
        title={
          <>
            Look at it. Say it. <em>Done.</em>
          </>
        }
      >
        <Glass className="flex flex-col gap-8 p-8 sm:flex-row sm:items-end sm:justify-between sm:p-10">
          <div>
            <div className="eyebrow">Built today by</div>
            <div className="headline mt-3 text-4xl leading-[1.15] sm:text-5xl">
              Joel Timana
              <br />
              Diana Munoz
            </div>
          </div>
          <div className="relative z-10 flex flex-col gap-3 sm:items-end">
            <Mark size={56} />
            <a
              href={REPO_URL}
              className="mono text-base tracking-wide text-w80 underline decoration-white/30 underline-offset-4"
            >
              {REPO}
            </a>
          </div>
        </Glass>
      </Section>
    </>
  );
}
