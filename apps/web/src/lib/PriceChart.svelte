<script lang="ts">
  type Point = { on: string; price: string };

  let { points, from, to, symbol }: { points: Point[]; from: string; to: string; symbol: string } = $props();

  const w = 800;
  const h = 280;
  const pad = { l: 78, r: 18, t: 16, b: 40 };

  function dayMs(s: string): number {
    const p = String(s || '').slice(0, 10).split('-');
    return Date.UTC(Number(p[0]), (Number(p[1]) || 1) - 1, Number(p[2]) || 1);
  }

  function niceNum(span: number, round: boolean): number {
    const exp = Math.floor(Math.log(span) / Math.LN10);
    const frac = span / 10 ** exp;
    let nice: number;
    if (round) {
      if (frac < 1.5) nice = 1;
      else if (frac < 3) nice = 2;
      else if (frac < 7) nice = 5;
      else nice = 10;
    } else if (frac <= 1) nice = 1;
    else if (frac <= 2) nice = 2;
    else if (frac <= 5) nice = 5;
    else nice = 10;
    return nice * 10 ** exp;
  }

  const model = $derived.by(() => {
    const nums = points.map((p) => Number(p.price)).filter((n) => Number.isFinite(n));
    if (!nums.length) return null;
    const numsMin = Math.min(...nums);
    const numsMax = Math.max(...nums);
    let t0 = dayMs(from);
    let t1 = dayMs(to);
    if (!t0 || !t1 || t1 <= t0) {
      t0 = dayMs(points[0]!.on);
      t1 = dayMs(points[points.length - 1]!.on);
      if (t1 <= t0) t1 = t0 + 86400000;
    }
    let min = numsMin;
    let max = numsMax;
    let padY = (max - min) * 0.08;
    if (!Number.isFinite(padY) || padY <= 0) padY = Math.max(0.5, Math.abs(max) * 0.1 || 1);
    min -= padY;
    max += padY;
    if (min < 0 && numsMin >= 0) min = 0;
    const range = niceNum(max - min || 1, false);
    const step = niceNum(range / 4, true);
    let niceMin = Math.floor(min / step) * step;
    let niceMax = Math.ceil(max / step) * step;
    if (niceMin < 0 && numsMin >= 0) niceMin = 0;
    if (niceMin === niceMax) niceMax = niceMin + step;
    const ticks: number[] = [];
    for (let v = niceMin; v <= niceMax + step / 2; v = Number((v + step).toFixed(10))) ticks.push(v);
    const innerW = w - pad.l - pad.r;
    const innerH = h - pad.t - pad.b;
    const xOfMs = (ms: number) => pad.l + ((ms - t0) / (t1 - t0)) * innerW;
    const yOf = (price: number) => pad.t + (1 - (price - niceMin) / (niceMax - niceMin)) * innerH;
    const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
    const sym = symbol.trim();
    const fmtPrice = (n: number) => n.toFixed(digits).replace('.', ',') + (sym ? ` ${sym}` : '');
    const names = ['sty', 'lut', 'mar', 'kwi', 'maj', 'cze', 'lip', 'sie', 'wrz', 'paź', 'lis', 'gru'];
    const fmtMonth = (ms: number) => {
      const d = new Date(ms);
      const label = names[d.getUTCMonth()] ?? '';
      if (d.getUTCMonth() === 0) {
        const y = d.getUTCFullYear() % 100;
        return `${label} ’${y < 10 ? '0' : ''}${y}`;
      }
      return label;
    };
    const first = new Date(t0);
    let t = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1);
    if (t < t0) t = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1);
    const months: number[] = [];
    while (t <= t1) {
      months.push(t);
      const d = new Date(t);
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    }
    let minor = 0;
    if (step >= 10) minor = step / 2;
    else if (step === 5 || step === 2) minor = 1;
    const minorLines: number[] = [];
    if (minor > 0) {
      for (let yv = niceMin + minor; yv < niceMax - minor / 2; yv = Number((yv + minor).toFixed(10))) {
        if (Math.abs(yv / step - Math.round(yv / step)) < 1e-6) continue;
        minorLines.push(yOf(yv));
      }
    }
    const coords = points.map((p) => ({ x: xOfMs(dayMs(p.on)), y: yOf(Number(p.price)) }));
    const labels: { x: number; text: string }[] = [];
    let lastLabelX = -Infinity;
    months.forEach((ms, i) => {
      const x = xOfMs(ms);
      if (x - lastLabelX < 44 && i !== months.length - 1) return;
      if (x > pad.l + innerW - 8) return;
      lastLabelX = x;
      labels.push({ x, text: fmtMonth(ms) });
    });
    return {
      innerW,
      innerH,
      minorLines,
      months: months.map((ms) => ({ x: xOfMs(ms), year: new Date(ms).getUTCMonth() === 0 })),
      ticks: ticks.map((tick) => ({ y: yOf(tick), text: fmtPrice(tick) })),
      polyline: coords.length > 1 ? coords.map((c) => `${c.x},${c.y}`).join(' ') : '',
      coords,
      labels,
    };
  });
</script>

{#if model}
  <svg viewBox="0 0 {w} {h}" class="text-foreground w-full" role="img">
    {#each model.minorLines as y}
      <line class="stroke-border" x1={pad.l} x2={pad.l + model.innerW} y1={y} y2={y} />
    {/each}
    {#each model.months as month}
      <line class={month.year ? 'stroke-border' : 'stroke-border/60'} x1={month.x} x2={month.x} y1={pad.t} y2={pad.t + model.innerH} />
    {/each}
    {#each model.ticks as tick}
      <line class="stroke-border" x1={pad.l} x2={pad.l + model.innerW} y1={tick.y} y2={tick.y} />
    {/each}
    <rect class="stroke-border fill-none" x={pad.l} y={pad.t} width={model.innerW} height={model.innerH} />
    {#if model.polyline}
      <polyline class="fill-none stroke-current" stroke-width="2" points={model.polyline} />
    {/if}
    {#each model.coords as c}
      <circle class="fill-current" cx={c.x} cy={c.y} r="2.5" />
    {/each}
    {#each model.ticks as tick}
      <text class="fill-muted-foreground" x={pad.l - 8} y={tick.y} text-anchor="end" dominant-baseline="middle" font-size="12">{tick.text}</text>
    {/each}
    {#each model.labels as label}
      <text class="fill-muted-foreground" x={label.x} y={h - 12} text-anchor="middle" font-size="12">{label.text}</text>
    {/each}
  </svg>
{/if}
