// Shared motion helpers — single source of truth for prefers-reduced-motion
// gating across board.js / panel.js / app.js. CSS keyframe/transition motion
// is gated separately in css/main.css via a blanket @media rule; this module
// covers JS-driven motion (FLIP regroup transforms, computed durations).

const reduceMotionQuery = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : null;

function prefersReducedMotion() {
  return !!(reduceMotionQuery && reduceMotionQuery.matches);
}

// Returns `ms` normally, or 0 when the user prefers reduced motion (so a
// D3 `.duration(motionDuration(400))` transition resolves instantly).
function motionDuration(ms) {
  return prefersReducedMotion() ? 0 : ms;
}

export { prefersReducedMotion, motionDuration };
