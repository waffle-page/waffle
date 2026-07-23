/**
 * Reading view: frontmatter chips + rendered markdown. Post-render passes:
 *  - mermaid fences → SVG (mermaid loads lazily, only when a diagram exists)
 *  - #embed: anchors → <audio>/<img> with bytes from the vault
 *  - #wikilink: anchors → onNavigate (open the target note)
 */
import { useEffect, useRef } from 'react';
import { parseNote } from '@waffle/core';
import { vaultUrl, mimeFor } from './assetUrl';
import { renderMermaid } from './mermaidRender';
import { AUDIO_EXT, IMAGE_EXT, renderMarkdown } from './renderMarkdown';
import { resolveEmbed } from './resolve';

export function Preview({ notePath, text, onNavigate }: { notePath: string; text: string; onNavigate: (name: string) => void }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let live = true;
    const { properties, tags, body } = parseNote(text);

    const chips = [
      ...Object.entries(properties).map(([k, v]) => `${k}: ${propLabel(v)}`),
      ...tags.map((t) => `#${t}`),
    ];
    host.innerHTML =
      (chips.length
        ? `<div class="wf-chips">${chips.map((c) => `<span>${escapeHtml(c)}</span>`).join('')}</div>`
        : '') + renderMarkdown(body);

    void (async () => {
      // Embeds: audio/image bytes from the vault replace their placeholder anchors.
      for (const anchor of [...host.querySelectorAll<HTMLAnchorElement>('a[href^="#embed:"]')]) {
        const target = decodeURIComponent(anchor.getAttribute('href')!.slice('#embed:'.length));
        const path = await resolveEmbed(notePath, target);
        if (!live) return;
        if (!path) continue;
        if (AUDIO_EXT.test(target)) {
          const audio = document.createElement('audio');
          audio.controls = true;
          audio.src = await vaultUrl(path, mimeFor(target));
          audio.style.width = '100%';
          anchor.replaceWith(audio);
        } else if (IMAGE_EXT.test(target)) {
          const img = document.createElement('img');
          img.src = await vaultUrl(path, mimeFor(target));
          img.style.maxWidth = '100%';
          img.style.borderRadius = 'var(--radius-sm)';
          anchor.replaceWith(img);
        }
      }

      for (const code of [...host.querySelectorAll<HTMLElement>('pre code.language-mermaid')]) {
        const svg = await renderMermaid(code.textContent ?? '');
        if (!live) return;
        if (!svg) continue; // invalid diagram: leave the fenced source visible
        const wrap = document.createElement('div');
        wrap.innerHTML = svg;
        code.closest('pre')?.replaceWith(wrap);
      }
    })();

    return () => {
      live = false;
    };
  }, [notePath, text]);

  const onClick = (e: React.MouseEvent): void => {
    const anchor = (e.target as HTMLElement).closest('a');
    if (!anchor) return;
    const href = anchor.getAttribute('href') ?? '';
    if (href.startsWith('#wikilink:')) {
      e.preventDefault();
      onNavigate(decodeURIComponent(href.slice('#wikilink:'.length)));
    } else if (href.startsWith('#embed:')) {
      e.preventDefault(); // unresolved embed — nothing to open yet
    }
  };

  return (
    <div onClick={onClick} style={{ maxWidth: 720, margin: '0 auto', padding: '1rem' }}>
      <style>{`
        .wf-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 1rem; }
        .wf-chips span { background: var(--surface-2); border: 1px solid var(--border); border-radius: 999px; padding: 2px 10px; font-size: 0.72rem; color: var(--text-dim); }
        .wf-preview h1, .wf-preview h2, .wf-preview h3 { font-family: var(--font-head); }
        .wf-preview a[href^="#wikilink:"] { color: var(--accent-ink); background: var(--accent); border-radius: 4px; padding: 0 3px; text-decoration: none; }
        .wf-preview pre { background: var(--surface-2); border-radius: var(--radius-sm); padding: 0.75rem; overflow-x: auto; }
        .wf-preview code { font-size: 0.85em; }
        .wf-preview blockquote { border-left: 3px solid var(--border); margin-left: 0; padding-left: 1rem; color: var(--text-dim); }
      `}</style>
      <div ref={hostRef} className="wf-preview" style={{ lineHeight: 1.65 }} />
    </div>
  );
}

function propLabel(v: { kind: string } & Record<string, unknown>): string {
  switch (v.kind) {
    case 'text': case 'url': return String(v.value);
    case 'number': return String(v.value);
    case 'checkbox': return v.value ? 'yes' : 'no';
    case 'date': return String(v.iso).slice(0, 10);
    case 'money': return `${v.amount} ${v.currency}`;
    default: return JSON.stringify(v);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
