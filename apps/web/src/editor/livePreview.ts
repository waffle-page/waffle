/**
 * Live preview (layer 2) — QUARANTINE MODULE (docs/08-code-conventions.md).
 *
 * The Obsidian feel: markdown renders its meaning in the editor, formatting
 * markers hide themselves, embeds/diagrams render as inline widgets — and
 * anything the cursor touches turns back into plain source.
 *
 * Why this is hairy, and the invariants that keep it working:
 *  - Hidden ranges KEEP their document positions. Cursor movement can land
 *    inside them; the selection then intersects the element, the decoration
 *    set rebuilds, and the source is revealed. That single rule IS the
 *    reveal-on-cursor behavior — no atomic ranges, no special casing.
 *  - Inline decorations come from a ViewPlugin over visibleRanges (cheap).
 *    Block replacements (mermaid fences span lines) MUST come from a
 *    StateField — CM6 forbids block decorations from view plugins.
 *  - Wikilinks/embeds are Obsidian syntax, invisible to the Lezer markdown
 *    tree → found by regex, skipped inside code contexts, and excluded from
 *    overlapping tree decorations (RangeSetBuilder requires disjoint ranges).
 *  - Widgets implement eq() so unchanged content keeps its DOM (mermaid SVGs
 *    and loaded images survive keystrokes elsewhere).
 *
 * v1 scope: headings, bold/italic/strikethrough, inline code, md links,
 * wikilinks, image/audio embeds, mermaid. Tables, blockquote bars, and
 * frontmatter-as-panel are later polish.
 */
import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { AUDIO_EXT, IMAGE_EXT } from './renderMarkdown';
import { renderMermaid } from './mermaidRender';

export interface LivePreviewConfig {
  onNavigate: (name: string) => void;
  /** Embed target → displayable object URL (null if unresolvable). */
  resolveAsset: (target: string) => Promise<string | null>;
}

const hide = Decoration.replace({});
const wikiSource = Decoration.mark({ class: 'wf-wikilink-src' });
const WIKI_RE = /(!?)\[\[([^[\]\n]+)\]\]/g;

const touches = (state: EditorState, from: number, to: number): boolean =>
  state.selection.ranges.some((r) => r.from <= to && r.to >= from);

function inCode(state: EditorState, pos: number): boolean {
  for (let n: { name: string; parent: unknown } | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent as never) {
    if (/Code/.test(n.name)) return true;
  }
  return false;
}

// ── Widgets ─────────────────────────────────────────────────────────────────

class WikilinkWidget extends WidgetType {
  constructor(readonly target: string, readonly onNavigate: (n: string) => void) {
    super();
  }
  override eq(other: WikilinkWidget): boolean {
    return other.target === this.target;
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'wf-wikilink';
    span.textContent = this.target;
    span.onclick = () => this.onNavigate(this.target);
    return span;
  }
  override ignoreEvent(): boolean {
    return true; // the pill handles its own click (navigation)
  }
}

class AssetWidget extends WidgetType {
  constructor(readonly target: string, readonly kind: 'image' | 'audio', readonly resolve: (t: string) => Promise<string | null>) {
    super();
  }
  override eq(other: AssetWidget): boolean {
    return other.target === this.target && other.kind === this.kind;
  }
  override get estimatedHeight(): number {
    return this.kind === 'image' ? 180 : 44;
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'wf-embed';
    const el = document.createElement(this.kind === 'image' ? 'img' : 'audio') as HTMLImageElement | HTMLAudioElement;
    if (el instanceof HTMLAudioElement) el.controls = true;
    void this.resolve(this.target).then((url) => {
      if (url) el.src = url;
      else wrap.textContent = `![[${this.target}]]`;
    });
    wrap.appendChild(el);
    return wrap;
  }
  override ignoreEvent(): boolean {
    return this.kind === 'audio'; // audio controls are interactive; image clicks place the cursor (reveal)
  }
}

class MermaidWidget extends WidgetType {
  constructor(readonly code: string) {
    super();
  }
  override eq(other: MermaidWidget): boolean {
    return other.code === this.code;
  }
  override get estimatedHeight(): number {
    return 220;
  }
  toDOM(): HTMLElement {
    const div = document.createElement('div');
    div.className = 'wf-mermaid';
    div.textContent = '…';
    void renderMermaid(this.code).then((svg) => {
      if (svg) div.innerHTML = svg;
      else div.textContent = this.code; // invalid diagram: show source text
    });
    return div;
  }
  override ignoreEvent(): boolean {
    return false; // clicking the diagram places the cursor inside → source reveals
  }
}

// ── Block layer: mermaid fences (StateField — block decos can't come from plugins) ──

const mermaidField = StateField.define<DecorationSet>({
  create: buildMermaid,
  update(deco, tr) {
    return tr.docChanged || tr.selection ? buildMermaid(tr.state) : deco;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function buildMermaid(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'FencedCode') return;
      const firstLine = state.doc.lineAt(node.from);
      if (!/^(```|~~~)\s*mermaid\s*$/.test(firstLine.text)) return;
      if (touches(state, node.from, node.to)) return;
      const lastLine = state.doc.lineAt(node.to);
      const code = state.doc.sliceString(Math.min(firstLine.to + 1, node.to), lastLine.from);
      builder.add(node.from, node.to, Decoration.replace({ widget: new MermaidWidget(code), block: true }));
    },
  });
  return builder.finish();
}

// ── Inline layer: marker hiding + wikilinks + embeds (ViewPlugin, visible ranges) ──

interface Deco {
  from: number;
  to: number;
  deco: Decoration;
}

function buildInline(view: EditorView, config: LivePreviewConfig): DecorationSet {
  const { state } = view;
  const decos: Deco[] = [];
  const replaced: Array<{ from: number; to: number }> = [];

  for (const { from, to } of view.visibleRanges) {
    // Pass 1 — wikilinks & embeds (regex; these ranges then exclude tree decos).
    const text = state.doc.sliceString(from, to);
    WIKI_RE.lastIndex = 0;
    for (let m = WIKI_RE.exec(text); m; m = WIKI_RE.exec(text)) {
      const start = from + m.index;
      const end = start + m[0].length;
      if (inCode(state, start + 1)) continue;
      if (touches(state, start, end)) {
        decos.push({ from: start, to: end, deco: wikiSource });
        continue;
      }
      const target = m[2]!;
      const isEmbed = m[1] === '!';
      const widget =
        isEmbed && IMAGE_EXT.test(target)
          ? new AssetWidget(target, 'image', config.resolveAsset)
          : isEmbed && AUDIO_EXT.test(target)
            ? new AssetWidget(target, 'audio', config.resolveAsset)
            : new WikilinkWidget(target, config.onNavigate);
      decos.push({ from: start, to: end, deco: Decoration.replace({ widget }) });
      replaced.push({ from: start, to: end });
    }

    // Pass 2 — formatting markers from the syntax tree (skip inside replacements).
    const overlapsReplaced = (a: number, b: number): boolean => replaced.some((r) => a < r.to && b > r.from);
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        if (node.name === 'HeaderMark') {
          const line = state.doc.lineAt(node.from);
          if (touches(state, line.from, line.to) || overlapsReplaced(node.from, node.to)) return;
          decos.push({ from: node.from, to: Math.min(node.to + 1, line.to), deco: hide });
          return;
        }
        if (node.name === 'EmphasisMark' || node.name === 'CodeMark' || node.name === 'StrikethroughMark' || node.name === 'LinkMark' || node.name === 'URL') {
          const parent = node.node.parent;
          if (!parent) return;
          if (touches(state, parent.from, parent.to) || overlapsReplaced(node.from, node.to)) return;
          decos.push({ from: node.from, to: node.to, deco: hide });
        }
      },
    });
  }

  decos.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  for (const d of decos) {
    if (d.from < lastTo) continue; // drop rare overlaps rather than throw
    builder.add(d.from, d.to, d.deco);
    lastTo = d.to;
  }
  return builder.finish();
}

const baseTheme = EditorView.baseTheme({
  '.wf-wikilink': {
    background: 'var(--accent)',
    color: 'var(--accent-ink)',
    borderRadius: '4px',
    padding: '0 4px',
    cursor: 'pointer',
  },
  '.wf-wikilink-src': { color: 'var(--accent-ink)' },
  '.wf-embed img': { maxWidth: '100%', borderRadius: 'var(--radius-sm)', display: 'block', margin: '0.25rem 0' },
  '.wf-embed audio': { width: '100%', display: 'block', margin: '0.25rem 0' },
  '.wf-mermaid': { display: 'flex', justifyContent: 'center', padding: '0.5rem 0' },
});

export function livePreview(config: LivePreviewConfig): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildInline(view, config);
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildInline(update.view, config);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
  return [baseTheme, mermaidField, plugin];
}
