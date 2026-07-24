import type { CSSProperties } from 'react';
import type { InteractionMark } from './types';

/**
 * Personal marks are overlays, not topping properties. Renderers receive them
 * pre-resolved so presentation code never learns entity identity or queries a
 * private interaction table.
 */
export function InteractionBadges({ marks }: { marks: InteractionMark[] | undefined }) {
  const visible = marks?.filter((mark) => mark.statusLabel || mark.rating !== null) ?? [];
  if (visible.length === 0) return null;

  const accessibilityLabel = visible.flatMap((mark) => {
    const parts: string[] = [];
    if (mark.statusLabel) parts.push(`${mark.setName}: ${mark.statusLabel}`);
    if (mark.rating !== null) parts.push(`${mark.setName} rating: ${formatRating(mark.rating)} out of 10`);
    return parts;
  }).join('; ');

  return (
    <span
      aria-label={accessibilityLabel}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        maxWidth: '100%',
        overflow: 'hidden',
        pointerEvents: 'none',
      }}
    >
      {visible.flatMap((mark) => {
        const badges = [];
        if (mark.statusLabel) {
          badges.push(
            <span key={`${mark.setId}:status`} title={`${mark.setName}: ${mark.statusLabel}`} style={{ ...badgeStyle, background: 'var(--accent)', color: 'var(--accent-ink)' }}>
              {mark.statusLabel}
            </span>,
          );
        }
        if (mark.rating !== null) {
          badges.push(
            <span key={`${mark.setId}:rating`} title={`${mark.setName} rating: ${formatRating(mark.rating)}/10`} style={{ ...badgeStyle, background: 'var(--ramp-peach)', color: 'var(--ink-peach)' }}>
              ★ {formatRating(mark.rating)}
            </span>,
          );
        }
        return badges;
      })}
    </span>
  );
}

const badgeStyle: CSSProperties = {
  flexShrink: 0,
  maxWidth: 128,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  border: '1px solid var(--border)',
  borderRadius: 999,
  padding: '0.12rem 0.4rem',
  fontSize: '0.66rem',
  fontWeight: 700,
  lineHeight: '0.95rem',
};

function formatRating(rating: number): string {
  return rating.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
