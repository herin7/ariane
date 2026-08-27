import { animate } from "motion";

/**
 * The thread, thrown.
 *
 * Ariane is Ariadne's thread: the wordmark is one, the journey pages are drawn
 * as one, and `--thread` is a token. So "Find my path" does not fade something
 * in - it throws the thread from the button you pressed to the box that answers
 * you, and the box springs when it arrives. The motion is the product's own
 * metaphor rather than decoration bolted onto it.
 *
 * Loaded on demand from `motion.tsx`, never in the shared bundle: an animation
 * nobody has asked for yet should not cost every visitor a download. The scroll
 * starts before this module lands, so a cold click is a plain jump and a warm
 * one is the whole performance. Both are correct; one is nicer.
 *
 * Springs, not `cubic-bezier`. A curve is a shape, a spring is a mass on a
 * string, and only one of them looks like a physical object came to rest.
 */

const NS = "http://www.w3.org/2000/svg";

/** Above the header (20), below any full screen overlay. */
const LAYER = 80;

const el = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string>) => {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
};

/** Where the thread leaves from, captured at click time in viewport coordinates. */
export interface Origin {
  x: number;
  y: number;
}

/**
 * A quadratic arc between two points, bowed out perpendicular to the line so
 * the thread hangs rather than pointing. The bow scales with distance and stops
 * growing, because a thread thrown across a tall page should not loop the page.
 */
export function arc(from: Origin, to: Origin): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const span = Math.hypot(dx, dy) || 1;
  const bow = Math.min(Math.max(span * 0.16, 18), 90);
  const cx = (from.x + to.x) / 2 + (-dy / span) * bow;
  const cy = (from.y + to.y) / 2 + (dx / span) * bow;
  return `M ${from.x} ${from.y} Q ${cx} ${cy} ${to.x} ${to.y}`;
}

/**
 * Throw the thread at `landing` and resolve when it has been caught.
 *
 * The path is recomputed every frame against the target's live rectangle,
 * because the page is smooth-scrolling underneath while the thread is in the
 * air. A path computed once would detach from the box within 100ms and read as
 * a stray line drawn over the page.
 */
export async function throwThread(from: Origin, landing: HTMLElement): Promise<void> {
  const svg = el("svg", {
    "aria-hidden": "true",
    fill: "none",
    style: `position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:${LAYER};overflow:visible`,
  });

  const line = el("path", {
    stroke: "var(--thread)",
    "stroke-width": "2",
    "stroke-linecap": "round",
    style: "filter:drop-shadow(0 0 7px color-mix(in srgb, var(--thread) 55%, transparent))",
  });

  const head = el("circle", {
    r: "4.5",
    fill: "var(--thread)",
    style: "filter:drop-shadow(0 0 10px color-mix(in srgb, var(--thread) 80%, transparent))",
  });

  // The ring is a rounded rectangle rather than a circle: it is the shape of
  // the thing that was hit, so it reads as the box ringing rather than as a
  // bubble that happened to appear nearby.
  const ring = el("rect", {
    rx: "16",
    fill: "none",
    stroke: "var(--thread)",
    "stroke-width": "2",
    opacity: "0",
    style: "transform-box:fill-box;transform-origin:center",
  });

  svg.append(line, head, ring);
  document.body.append(svg);

  const target = (): Origin => {
    const box = landing.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  };

  try {
    // Draw. `strokeDasharray` is set from the measured length each frame, so
    // the dash stays exactly one path long as the geometry moves.
    await animate(0, 1, {
      duration: 0.52,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (t) => {
        const to = target();
        line.setAttribute("d", arc(from, to));
        const length = line.getTotalLength();
        line.setAttribute("stroke-dasharray", `${length}`);
        line.setAttribute("stroke-dashoffset", `${length * (1 - t)}`);
        const tip = line.getPointAtLength(length * t);
        head.setAttribute("cx", `${tip.x}`);
        head.setAttribute("cy", `${tip.y}`);
      },
    });

    const box = landing.getBoundingClientRect();
    ring.setAttribute("x", `${box.left}`);
    ring.setAttribute("y", `${box.top}`);
    ring.setAttribute("width", `${box.width}`);
    ring.setAttribute("height", `${box.height}`);

    // Caught. Everything from here runs together: the box takes the hit, the
    // ring rings, and the thread pays itself back out of the frame.
    const control = landing.querySelector<HTMLElement>(".search-control") ?? landing;
    const icon = landing.querySelector<HTMLElement>(".search-icon");

    void animate(
      control,
      { transform: ["translateY(9px) scale(0.985)", "none"] },
      { type: "spring", stiffness: 460, damping: 17, mass: 0.9 },
    ).then(() => {
      // Handed back to the stylesheet, or `:focus-within` would have nothing
      // left to move.
      control.style.removeProperty("transform");
    });

    if (icon) {
      void animate(
        icon,
        { transform: ["rotate(-38deg) scale(0.6)", "none"], opacity: [0.35, 1] },
        { type: "spring", stiffness: 380, damping: 14 },
      ).then(() => {
        icon.style.removeProperty("transform");
        icon.style.removeProperty("opacity");
      });
    }

    void animate(ring, { opacity: [0.75, 0], scale: [0.96, 1.07] }, { duration: 0.72, ease: [0.16, 1, 0.3, 1] });

    // The tail catches up to the head: same dash, offset driven the other way,
    // so the thread leaves the way it arrived instead of blinking out.
    await animate(1, 0, {
      duration: 0.46,
      delay: 0.12,
      ease: [0.65, 0, 0.35, 1],
      onUpdate: (t) => {
        const to = target();
        line.setAttribute("d", arc(from, to));
        const length = line.getTotalLength();
        line.setAttribute("stroke-dasharray", `${length}`);
        line.setAttribute("stroke-dashoffset", `${-length * (1 - t)}`);
        head.setAttribute("opacity", `${t}`);
      },
    });
  } finally {
    svg.remove();
  }
}

/**
 * The sender. The arrow on the pill leaves before the thread does, so the click
 * has a departure as well as an arrival.
 */
export function launch(button: Element): void {
  const arrow = button.querySelector<HTMLElement>(".nav-cta-icon");
  if (!arrow) return;
  void animate(
    arrow,
    { transform: ["none", "translate(7px,-7px) scale(0.82)", "none"], opacity: [1, 0.5, 1] },
    { duration: 0.62, ease: [0.16, 1, 0.3, 1] },
  ).then(() => {
    arrow.style.removeProperty("transform");
    arrow.style.removeProperty("opacity");
  });
}
