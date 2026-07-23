import { useEffect, useState } from 'react';
import type { ToppingType } from '@waffle/core';
import type { LibraryItem, ThumbLoader } from './types';
import { DashIcon, FileIcon, LinkIcon, NoteIcon } from './icons';

/** Default type→ramp assignment (user-remappable later, docs/02 → Theming). */
const HUE: Record<ToppingType, string> = {
  note: 'peach',
  link: 'aqua',
  file: 'periwinkle',
  dash: 'mint',
};
const ICON: Record<ToppingType, typeof NoteIcon> = {
  note: NoteIcon,
  link: LinkIcon,
  file: FileIcon,
  dash: DashIcon,
};

/** Extreme aspect ratios would break masonry rhythm; clamp to a sane band. */
export const clampAspect = (aspect: number | null | undefined): number =>
  Math.min(2, Math.max(0.55, aspect ?? 4 / 3));

/**
 * Fixed height of the card's meta strip (px), borders included. The virtual
 * layouts add this to the thumb height when ESTIMATING item size, and the card
 * flex-fills whatever box it is given — one constant, so estimate and reality
 * cannot drift (drift = overlapping cards).
 */
export const CARD_META_H = 50;

/**
 * Card thumbnail resolution order: real thumb image → dominant color (instant
 * paint while the image decodes, or when only color is known) → generated
 * placeholder (type ramp fill + glyph).
 */
export function ToppingCard({
  item,
  loadThumb,
  onOpen,
}: {
  item: LibraryItem;
  loadThumb?: ThumbLoader;
  onOpen?: (item: LibraryItem) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const hue = HUE[item.type];
  const Icon = ICON[item.type];

  useEffect(() => {
    if (!item.thumbRef || !loadThumb) {
      setSrc(null);
      return;
    }
    let live = true;
    void loadThumb(item).then((url) => {
      if (live) setSrc(url);
    });
    return () => {
      live = false;
    };
  }, [item, loadThumb]);

  return (
    <div
      onClick={onOpen ? () => onOpen(item) : undefined}
      style={{
        height: '100%',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        cursor: onOpen ? 'pointer' : 'default',
      }}
    >
      <div
        style={{
          flex: 1,
          minHeight: 0,
          background: item.thumbColor ?? `var(--ramp-${hue})`,
          color: `var(--ink-${hue})`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.8rem',
        }}
      >
        {src ? (
          <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : item.thumbColor ? null : (
          <Icon />
        )}
      </div>
      <div style={{ height: CARD_META_H - 2, boxSizing: 'border-box', padding: '0.4rem 0.65rem', overflow: 'hidden' }}>
        <div style={{ fontFamily: 'var(--font-head)', fontWeight: 600, fontSize: '0.85rem', lineHeight: '1.15rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.title}
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.72rem', lineHeight: '1rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {item.subtitle ?? item.type}
        </div>
      </div>
    </div>
  );
}
