// Random-but-deterministic star field rendered as layered radial gradients.
// Used by the Galaxy theme as a fixed background behind the app.

function makeStarLayer(seed: number, count: number, maxR: number, maxAlpha: number): string {
  let s = seed;
  const rand = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const dots: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = (rand() * 100).toFixed(2);
    const y = (rand() * 100).toFixed(2);
    const r = (rand() * maxR + 0.4).toFixed(1);
    const alpha = ((0.25 + rand() * 0.75) * maxAlpha).toFixed(2);
    dots.push(
      `radial-gradient(circle at ${x}% ${y}%, rgba(235,238,255,${alpha}) ${r}px, transparent ${r}px)`,
    );
  }
  return dots.join(', ');
}

const STAR_LAYER_1 = makeStarLayer(11, 90, 0.9, 0.9);
const STAR_LAYER_2 = makeStarLayer(47, 60, 1.4, 0.7);
const STAR_LAYER_3 = makeStarLayer(83, 34, 2.4, 0.5);

export function Starfield() {
  return (
    <div className="starfield" aria-hidden="true">
      <div className="starfield-nebula" />
      <div className="starfield-layer starfield-layer-1" style={{ backgroundImage: STAR_LAYER_1 }} />
      <div className="starfield-layer starfield-layer-2" style={{ backgroundImage: STAR_LAYER_2 }} />
      <div className="starfield-layer starfield-layer-3" style={{ backgroundImage: STAR_LAYER_3 }} />
    </div>
  );
}