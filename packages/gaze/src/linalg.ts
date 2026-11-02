/** Tiny dense linear algebra: just enough for ridge regression. */

export function invertMatrix(a: number[][]): number[][] | null {
  const n = a.length;
  const m = a.map((row, i) => {
    const r = row.slice();
    for (let j = 0; j < n; j++) r.push(i === j ? 1 : 0);
    return r;
  });
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r]![c]!) > Math.abs(m[piv]![c]!)) piv = r;
    if (Math.abs(m[piv]![c]!) < 1e-14) return null;
    if (piv !== c) {
      const tmp = m[piv]!;
      m[piv] = m[c]!;
      m[c] = tmp;
    }
    const row = m[c]!;
    const d = row[c]!;
    for (let j = 0; j < 2 * n; j++) row[j] = row[j]! / d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const rr = m[r]!;
      const f = rr[c]!;
      if (f === 0) continue;
      for (let j = 0; j < 2 * n; j++) rr[j] = rr[j]! - f * row[j]!;
    }
  }
  return m.map((row) => row.slice(n));
}

export function matMul(a: number[][], b: number[][]): number[][] {
  const n = a.length;
  const k = b.length;
  const p = b[0]?.length ?? 0;
  const out: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(p).fill(0);
    const ai = a[i]!;
    for (let t = 0; t < k; t++) {
      const v = ai[t]!;
      if (v === 0) continue;
      const bt = b[t]!;
      for (let j = 0; j < p; j++) row[j] = row[j]! + v * bt[j]!;
    }
    out.push(row);
  }
  return out;
}

export function transpose(a: number[][]): number[][] {
  const n = a.length;
  const m = a[0]?.length ?? 0;
  const out: number[][] = [];
  for (let j = 0; j < m; j++) {
    const row = new Array<number>(n);
    for (let i = 0; i < n; i++) row[i] = a[i]![j]!;
    out.push(row);
  }
  return out;
}
