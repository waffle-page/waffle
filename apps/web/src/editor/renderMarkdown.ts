/**
 * Markdown → HTML for the preview pane. markdown-it with `html: false`: raw
 * HTML in notes renders as text, which is the safe default without a sanitizer
 * dependency (docs/08). Wikilinks and embeds are rewritten to ordinary links
 * BEFORE parsing — fence-aware, so code blocks keep their literal [[...]].
 *
 *   [[target]]   → <a href="#wikilink:target">      (Preview intercepts clicks)
 *   ![[target]]  → <a href="#embed:target">         (Preview swaps in <audio>/<img>)
 */
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true });

const FENCE = /^\s*(```|~~~)/;

export function renderMarkdown(body: string): string {
  const lines = body.split('\n');
  let inFence = false;
  const rewritten = lines.map((line) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    return line
      .replace(/!\[\[([^\]]+)\]\]/g, (_, target: string) => `[${target}](#embed:${encodeURIComponent(target)})`)
      .replace(/\[\[([^\]]+)\]\]/g, (_, target: string) => `[${target}](#wikilink:${encodeURIComponent(target)})`);
  });
  return md.render(rewritten.join('\n'));
}

export const AUDIO_EXT = /\.(wav|webm|m4a|mp3|ogg)$/i;
export const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif)$/i;
