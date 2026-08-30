/* نمودارهای Canvas — حلقه‌ای، ستونی، خطی (React، پشتیبانی Retina) */

import { useEffect, useRef } from "react";

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

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

export interface ThemeColors {
  text: string;
  text3: string;
  grid: string;
  income: string;
  expense: string;
  palette: string[];
}

export function themeColors(): ThemeColors {
  return {
    text: cssVar("--text-2"),
    text3: cssVar("--text-3"),
    grid: cssVar("--border"),
    income: cssVar("--income"),
    expense: cssVar("--expense"),
    palette: PALETTE.map(cssVar),
  };
}

function setup(canvas: HTMLCanvasElement, w: number, h: number) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export function DonutChart({
  data,
  size = 260,
}: {
  data: DonutSlice[];
  size?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = setup(canvas, size, size);
    if (!ctx) return;

    const cx = size / 2,
      cy = size / 2;
    const R = size * 0.385,
      r = size * 0.26;
    const total = data.reduce((s, d) => s + d.value, 0);

    ctx.clearRect(0, 0, size, size);

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
  }, [data, size]);

  return <canvas ref={ref} />;
}

export interface BarDatum {
  label: string;
  value: number;
}

export function BarChart({
  data,
  width = 340,
  height = 220,
}: {
  data: BarDatum[];
  width?: number;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = setup(canvas, width, height);
    if (!ctx) return;
    const C = themeColors();
    const padT = 16,
      padB = 26,
      padL = 8,
      padR = 8;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    ctx.clearRect(0, 0, width, height);

    const max = Math.max(...data.map((d) => d.value), 1);
    const n = data.length;
    const slot = plotW / Math.max(n, 1);
    const barW = Math.min(slot * 0.55, 26);

    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = padT + (plotH / 3) * i;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();
    }

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

    ctx.fillStyle = C.text3;
    ctx.font = "10px Vazirmatn, sans-serif";
    ctx.textAlign = "center";
    const step = Math.ceil(n / 8);
    data.forEach((d, i) => {
      if (i % step === 0) {
        ctx.fillText(d.label, padL + slot * i + slot / 2, height - 8);
      }
    });
  }, [data, width, height]);

  return <canvas ref={ref} />;
}

export interface LineSeries {
  values: number[];
  color: string;
  kind: "income" | "expense";
}

export function LineChart({
  labels,
  series,
  width = 340,
  height = 220,
}: {
  labels: string[];
  series: LineSeries[];
  width?: number;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = setup(canvas, width, height);
    if (!ctx) return;
    const C = themeColors();
    const padT = 16,
      padB = 26,
      padL = 10,
      padR = 10;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    ctx.clearRect(0, 0, width, height);

    const all = series.flatMap((s) => s.values);
    const max = Math.max(...all, 1);

    ctx.strokeStyle = C.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = padT + (plotH / 3) * i;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(width - padR, y);
      ctx.stroke();
    }

    const n = labels.length;
    const xAt = (i: number) => padL + (plotW / Math.max(n - 1, 1)) * i;
    const yAt = (v: number) => padT + plotH - (v / max) * plotH;

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

    ctx.fillStyle = C.text3;
    ctx.font = "10px Vazirmatn, sans-serif";
    ctx.textAlign = "center";
    labels.forEach((lb, i) => ctx.fillText(lb, xAt(i), height - 8));
  }, [labels, series, width, height]);

  return <canvas ref={ref} />;
}
