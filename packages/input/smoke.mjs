// Smoke test: spawn glance-input, do pos/move/pos round trips, exit nonzero on a miss > 2 points.
// Usage: node smoke.mjs   (run `cargo build --release` first)
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const bin = join(dirname(fileURLToPath(import.meta.url)), "target", "release", "glance-input");
const child = spawn(bin, [], { stdio: ["pipe", "pipe", "inherit"] });
const rl = createInterface({ input: child.stdout });
const waiting = [];
rl.on("line", (l) => waiting.shift()?.(JSON.parse(l)));
child.on("error", (e) => { console.error("spawn failed:", e.message); process.exit(2); });
const call = (req) => new Promise((res, rej) => {
  waiting.push(res);
  setTimeout(() => rej(new Error("timeout: " + JSON.stringify(req))), 3000).unref();
  child.stdin.write(JSON.stringify(req) + "\n");
});

let failed = false;
try {
  const t = await call({ op: "trusted" });
  console.log("trusted:", t.trusted);
  const start = await call({ op: "pos" });
  console.log("start pos:", start.x, start.y);
  for (const [x, y] of [[300, 400], [10, 10], [812, 55], [1200, 700], [640, 360]]) {
    const m = await call({ op: "move", x, y });
    const p = await call({ op: "pos" });
    const err = Math.max(Math.abs(p.x - x), Math.abs(p.y - y));
    const ok = m.ok && p.ok && err <= 2;
    console.log(`move(${x},${y}) -> pos(${p.x},${p.y}) err=${err} ${ok ? "OK" : "MISS"}`);
    if (!ok) failed = true;
  }
  await call({ op: "move", x: start.x, y: start.y }); // restore cursor
} catch (e) {
  console.error(e.message);
  failed = true;
}
child.stdin.end();
child.on("exit", () => process.exit(failed ? 1 : 0));
