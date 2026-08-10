// True when built as the demo channel (Docker build arg DEMO_BUILD=true,
// surfaced to Vite as VITE_DEMO_BUILD). Shows a "DEMO INSTANCE" banner in the UI.
export const IS_DEMO = import.meta.env.VITE_DEMO_BUILD === 'true';
