import { el } from "./dom.ts";
import { motionOn } from "./motion.ts";

const TAU = Math.PI * 2;
const CARDS = ".types label, #ideas li, .chart";

type Dot = { x: number; y: number; vx: number; vy: number; r: number; hue: number };
type Rocket = { x: number; y: number; vy: number; hue: number; done?: boolean };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; hue: number };

function context(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not supported");
  return ctx;
}

/** Drifting dots joined by faint lines that lean toward the cursor; drawn behind the page. */
export function startStage(canvas: HTMLCanvasElement): void {
  const ctx = context(canvas);
  const resize = () => {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
  };
  resize();
  addEventListener("resize", resize);

  const dots: Dot[] = Array.from({ length: 70 }, () => ({
    x: Math.random() * innerWidth,
    y: Math.random() * innerHeight,
    vx: (Math.random() - 0.5) * 0.4,
    vy: (Math.random() - 0.5) * 0.4,
    r: 1 + Math.random() * 2,
    hue: Math.random() < 0.5 ? 320 : 45,
  }));
  const pointer = { x: -999, y: -999 };
  const root = document.documentElement.style;
  addEventListener("pointermove", (e) => {
    pointer.x = e.clientX;
    pointer.y = e.clientY;
    root.setProperty("--mx", `${e.clientX}px`);
    root.setProperty("--my", `${e.clientY}px`);
  });

  function move(dot: Dot): void {
    dot.x += dot.vx;
    dot.y += dot.vy;
    if (dot.x < 0 || dot.x > canvas.width) dot.vx *= -1;
    if (dot.y < 0 || dot.y > canvas.height) dot.vy *= -1;
    if (Math.hypot(dot.x - pointer.x, dot.y - pointer.y) < 160) {
      dot.x += (pointer.x - dot.x) * 0.012;
      dot.y += (pointer.y - dot.y) * 0.012;
    }
  }

  function draw(dot: Dot, index: number): void {
    ctx.fillStyle = `hsl(${dot.hue} 100% 75% / 0.9)`;
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, dot.r, 0, TAU);
    ctx.fill();
    for (const other of dots.slice(index + 1)) {
      const distance = Math.hypot(dot.x - other.x, dot.y - other.y);
      if (distance >= 120) continue;
      ctx.strokeStyle = `hsl(${dot.hue} 100% 75% / ${0.18 * (1 - distance / 120)})`;
      ctx.beginPath();
      ctx.moveTo(dot.x, dot.y);
      ctx.lineTo(other.x, other.y);
      ctx.stroke();
    }
  }

  (function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (motionOn() && !document.hidden) {
      dots.forEach(move);
      dots.forEach(draw);
    }
    requestAnimationFrame(frame);
  })();
}

/** A short burst of fireworks to celebrate a finished plan. */
export function fireworks(canvas: HTMLCanvasElement): void {
  if (!motionOn()) return;
  const ctx = context(canvas);
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  const hues = [330, 28, 48, 190, 270];
  let rockets: Rocket[] = [];
  let sparks: Spark[] = [];
  let frame = 0;

  const launch = () =>
    rockets.push({ x: innerWidth * (0.2 + Math.random() * 0.6), y: innerHeight, vy: -(9 + Math.random() * 4), hue: hues[Math.floor(Math.random() * hues.length)] });
  const explode = (rocket: Rocket) => {
    for (let i = 0; i < 80; i++) {
      const angle = Math.random() * TAU;
      const speed = 1 + Math.random() * 5;
      sparks.push({ x: rocket.x, y: rocket.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, hue: rocket.hue + Math.random() * 30 });
    }
  };
  [0, 300, 600, 900].forEach((ms) => setTimeout(launch, ms));

  (function tick() {
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "rgba(0, 0, 0, 0.2)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "lighter";
    for (const rocket of rockets) {
      rocket.y += rocket.vy;
      rocket.vy += 0.12;
      ctx.fillStyle = `hsl(${rocket.hue} 100% 70%)`;
      ctx.fillRect(rocket.x, rocket.y, 3, 8);
      if (rocket.vy > -1.5) {
        rocket.done = true;
        explode(rocket);
      }
    }
    rockets = rockets.filter((r) => !r.done);
    for (const spark of sparks) {
      spark.x += spark.vx;
      spark.y += spark.vy;
      spark.vy += 0.05;
      spark.vx *= 0.98;
      spark.life -= 0.012;
      ctx.fillStyle = `hsl(${spark.hue} 100% 65% / ${Math.max(spark.life, 0)})`;
      ctx.fillRect(spark.x, spark.y, 2.5, 2.5);
    }
    sparks = sparks.filter((s) => s.life > 0);
    if (++frame < 260 || sparks.length || rockets.length) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  })();
}

const cardUnder = (e: Event): HTMLElement | null => (e.target as Element | null)?.closest<HTMLElement>(CARDS) ?? null;

/** 3D tilt and a moving highlight on cards while the pointer is over them. */
export function enableCardTilt(): void {
  document.addEventListener("pointermove", (e) => {
    const card = cardUnder(e);
    if (!card || !motionOn()) return;
    const box = card.getBoundingClientRect();
    const x = (e.clientX - box.left) / box.width;
    const y = (e.clientY - box.top) / box.height;
    card.style.setProperty("--ry", `${(x - 0.5) * 14}deg`);
    card.style.setProperty("--rx", `${(0.5 - y) * 14}deg`);
    card.style.setProperty("--cx", `${x * 100}%`);
    card.style.setProperty("--cy", `${y * 100}%`);
  });
  document.addEventListener("pointerout", (e) => {
    const card = cardUnder(e);
    card?.style.removeProperty("--rx");
    card?.style.removeProperty("--ry");
  });
}

/** The main button leans slightly toward the cursor. */
export function enableMagnet(button: HTMLElement): void {
  button.addEventListener("pointermove", (e) => {
    if (!motionOn()) return;
    const box = button.getBoundingClientRect();
    button.style.setProperty("--tx", `${(e.clientX - box.left - box.width / 2) * 0.08}px`);
    button.style.setProperty("--ty", `${(e.clientY - box.top - box.height / 2) * 0.3}px`);
  });
  button.addEventListener("pointerleave", () => {
    button.style.removeProperty("--tx");
    button.style.removeProperty("--ty");
  });
}

/** Splits the title into letters that animate in, while screen readers still read the whole word. */
export function animateBrand(heading: HTMLElement): void {
  heading.setAttribute("aria-label", heading.textContent ?? "");
  heading.replaceChildren(
    ...[...(heading.textContent ?? "")].map((letter, i) => {
      const span = el("span", { "aria-hidden": "true", class: "ch" }, letter);
      span.style.animationDelay = `${0.25 + i * 0.07}s`;
      return span;
    }),
  );
}

/** Hides the opening splash after a moment (or on click). */
export function runSplash(splash: HTMLElement): void {
  const hide = () => splash.classList.add("done");
  splash.addEventListener("click", hide);
  setTimeout(hide, motionOn() ? 1300 : 0);
}
