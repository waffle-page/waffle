/**
 * Styled source mode — the first layer of live preview: markdown renders with
 * its meaning while you type (headings big in Nunito, bold bold, code mono),
 * markers still visible. Layer two (cursor-aware marker hiding + inline
 * widgets for embeds/mermaid) completes the Obsidian feel.
 *
 * Dependency note (docs/08): @codemirror/language and @lezer/highlight were
 * already in the tree via the codemirror meta-package; declaring them makes
 * these imports legal under pnpm's strict resolution — no new code shipped.
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

const style = HighlightStyle.define([
  { tag: tags.heading1, fontFamily: 'var(--font-head)', fontSize: '1.55em', fontWeight: '700' },
  { tag: tags.heading2, fontFamily: 'var(--font-head)', fontSize: '1.3em', fontWeight: '700' },
  { tag: tags.heading3, fontFamily: 'var(--font-head)', fontSize: '1.15em', fontWeight: '600' },
  { tag: tags.heading4, fontFamily: 'var(--font-head)', fontWeight: '600' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, fontFamily: 'ui-monospace, monospace', fontSize: '0.9em', background: 'var(--surface-2)', borderRadius: '3px' },
  { tag: tags.link, color: 'var(--accent-ink)' },
  { tag: tags.url, color: 'var(--text-dim)' },
  { tag: tags.quote, color: 'var(--text-dim)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--text-dim)' },                 // frontmatter fences, markers
  { tag: tags.processingInstruction, color: 'var(--text-dim)' }, // #, *, ``` markers
]);

export const liveStyle = syntaxHighlighting(style);
