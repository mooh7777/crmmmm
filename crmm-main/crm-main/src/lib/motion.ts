export const motionTokens = {
  duration: {
    press: 100,
    hover: 160,
    panel: 240,
    page: 360,
    highlight: 1200,
  },
  easing: {
    standard: "cubic-bezier(0.2, 0, 0, 1)",
    enter: "cubic-bezier(0, 0, 0, 1)",
    exit: "cubic-bezier(0.4, 0, 1, 1)",
  },
} as const;

export type MotionIntent = "content" | "arrival" | "complete" | "attention";

export function directionMultiplier(direction: "ltr" | "rtl") {
  return direction === "rtl" ? -1 : 1;
}

export function motionIsReduced() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
