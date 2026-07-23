/**
 * Mermaid code → SVG, lazily loaded (the library is heavy; it costs nothing
 * until a note actually contains a diagram) and cached by source text so
 * live-preview rebuilds on every keystroke never re-render unchanged diagrams.
 */
const svgCache = new Map<string, string>();
let counter = 0;
let initialized = false;

export async function renderMermaid(code: string): Promise<string | null> {
  const cached = svgCache.get(code);
  if (cached) return cached;
  try {
    const { default: mermaid } = await import('mermaid');
    if (!initialized) {
      mermaid.initialize({
        startOnLoad: false,
        theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default',
      });
      initialized = true;
    }
    const { svg } = await mermaid.render(`wf-mermaid-${counter++}`, code);
    svgCache.set(code, svg);
    return svg;
  } catch {
    return null; // invalid diagram — caller keeps the source visible
  }
}
