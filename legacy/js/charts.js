/* ═══════════════════════════════════════════════
   نمودارها — Canvas خالص (بدون کتابخانه)
   حلقه‌ای، ستونی، خطی — با پشتیبانی Retina
   ═══════════════════════════════════════════════ */

const Charts = (() => {
  const PALETTE = [
    "--c1",
    "--c2",
    "--c3",
    "--c4",
    "--c5",
    "--c6",
    "--c7",
    "--c8",
  ];

  function cssVar(name) {
    return getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
  }

  function themeColors() {
    return {
      text: cssVar("--text-2"),
      text3: cssVar("--text-3"),
      grid: cssVar("--border"),
      income: cssVar("--income"),
      expense: cssVar("--expense"),
      palette: PALETTE.map(cssVar),
    };
  }

  /* آماده‌سازی canvas برای Retina */
  function setup(canvas, w, h) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  /* ── نمودار حلقه‌ای ── */
  /* data = [{ label, value, color }] */
  function donut(canvas, data, opts = {}) {
    const W = 260,
      H = 260;
    const ctx = setup(canvas, W, H);
    const cx = W / 2,
      cy = H / 2;
    const R = 100,
      r = 68;
    const total = data.reduce((s, d) => s + d.value, 0);

    ctx.clearRect(0, 0, W, H);

    if (total === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, (R + r) / 2, 0, Math.PI * 2);
      ctx.lineWidth = R - r;
      ctx.strokeStyle = cssVar("--card-2");
      ctx.stroke();
      return;
    }

    let angle = -Math.PI / 2;
    const gap = data.length > 1 ? 0.035 : 0;

    for (const d of data) {
      const slice = (d.value / total) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(cx, cy, (R + r) / 2, angle + gap / 2, angle + slice - gap / 2);
      ctx.lineWidth = R - r;
      ctx.lineCap = "round";
      ctx.strokeStyle = d.color;
      ctx.stroke();
      angle += slice;
    }
  }

  /* ── نمودار ستونی روزانه ── */
  /* data = [{ label, value }] — فقط روزهای دارای تراکنش */
  function bars(canvas, data, opts = {}) {
    const W = 340,
      H = 220;
    const ctx = setup(canvas, W, H);
    const C = themeColors();
    const padT = 16,
      padB = 26,
      padL = 8,
      padR = 8;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    ctx.clearRect(0, 0, W, H);

    const max = Math.max(...data.map((d) => d.value), 1);
    const n = data.length;
    const slot = plotW / Math.max(n, 1);
    const barW = Math.min(slot * 0.55, 26);

    /* خطوط راهنما */
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = padT + (plotH / 3) * i;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
    }

    /* ستون‌ها */
    data.forEach((d, i) => {
      const x = padL + slot * i + (slot - barW) / 2;
      const h = (d.value / max) * plotH;
      const y = padT + plotH - h;

      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, C.income);
      grad.addColorStop(1, C.income + "55");

      ctx.beginPath();
      const rad = Math.min(barW / 2, 5);
      ctx.roundRect(x, y, barW, Math.max(h, 2), [rad, rad, 0, 0]);
      ctx.fillStyle = grad;
      ctx.fill();
    });

    /* برچسب روزها */
    ctx.fillStyle = C.text3;
    ctx.font = "10px Vazirmatn, sans-serif";
    ctx.textAlign = "center";
    const step = Math.ceil(n / 8);
    data.forEach((d, i) => {
      if (i % step === 0) {
        ctx.fillText(d.label, padL + slot * i + slot / 2, H - 8);
      }
    });
  }

  /* ── نمودار خطی (درآمد/هزینه) ── */
  /* series = [{ values: number[], color }] — labels روی محور x */
  function line(canvas, labels, series, opts = {}) {
    const W = 340,
      H = 220;
    const ctx = setup(canvas, W, H);
    const C = themeColors();
    const padT = 16,
      padB = 26,
      padL = 10,
      padR = 10;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    ctx.clearRect(0, 0, W, H);

    const all = series.flatMap((s) => s.values);
    const max = Math.max(...all, 1);

    /* خطوط راهنما */
    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = padT + (plotH / 3) * i;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
    }

    const n = labels.length;
    const xAt = (i) => padL + (plotW / Math.max(n - 1, 1)) * i;
    const yAt = (v) => padT + plotH - (v / max) * plotH;

    /* ناحیه زیر خط هزینه */
    const exp = series.find((s) => s.kind === "expense");
    if (exp && exp.values.some((v) => v > 0)) {
      ctx.beginPath();
      exp.values.forEach((v, i) => {
        const x = xAt(i),
          y = yAt(v);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.lineTo(xAt(n - 1), padT + plotH);
      ctx.lineTo(xAt(0), padT + plotH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
      grad.addColorStop(0, C.expense + "30");
      grad.addColorStop(1, C.expense + "00");
      ctx.fillStyle = grad;
      ctx.fill();
    }

    /* خطوط */
    for (const s of series) {
      ctx.beginPath();
      s.values.forEach((v, i) => {
        const x = xAt(i),
          y = yAt(v);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.stroke();

      /* نقاط */
      s.values.forEach((v, i) => {
        if (v <= 0) return;
        ctx.beginPath();
        ctx.arc(xAt(i), yAt(v), 3.5, 0, Math.PI * 2);
        ctx.fillStyle = cssVar("--card");
        ctx.fill();
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2;
        ctx.stroke();
      });
    }

    /* برچسب ماه‌ها */
    ctx.fillStyle = C.text3;
    ctx.font = "10px Vazirmatn, sans-serif";
    ctx.textAlign = "center";
    labels.forEach((lb, i) => {
      ctx.fillText(lb, xAt(i), H - 8);
    });
  }

  return { donut, bars, line, themeColors };
})();
