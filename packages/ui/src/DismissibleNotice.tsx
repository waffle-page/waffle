/**
 * Compact transient feedback with an explicit dismissal path.
 *
 * Dismissal is presentation-only: callers own the message state and must not
 * couple `onDismiss` to canonical data, mutation receipts, or retry state.
 */
import type { CSSProperties, ReactNode } from 'react';

export interface DismissibleNoticeProps {
  children: ReactNode;
  onDismiss: () => void;
  /** Accessible action name. Name the owning surface, not the × glyph. */
  dismissLabel: string;
  /** Single-line treatment for toolbars and headers. */
  compact?: boolean;
  style?: CSSProperties;
}

export function DismissibleNotice({
  children,
  onDismiss,
  dismissLabel,
  compact = false,
  style,
}: DismissibleNoticeProps) {
  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        minWidth: 0,
        padding: compact ? '0.2rem 0.35rem 0.2rem 0.5rem' : '0.5rem 0.55rem 0.5rem 0.75rem',
        color: 'var(--ink-blush)',
        background: 'var(--ramp-blush)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)',
        fontSize: compact ? '0.75rem' : '0.82rem',
        ...style,
      }}
    >
      <span
        style={{
          flex: 1,
          minWidth: 0,
          overflow: compact ? 'hidden' : undefined,
          textOverflow: compact ? 'ellipsis' : undefined,
          whiteSpace: compact ? 'nowrap' : undefined,
          overflowWrap: compact ? undefined : 'anywhere',
        }}
      >
        {children}
      </span>
      <button
        type="button"
        aria-label={dismissLabel}
        title={dismissLabel}
        onClick={onDismiss}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          width: 24,
          height: 24,
          padding: 0,
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          background: 'transparent',
          color: 'currentColor',
          cursor: 'pointer',
          font: 'inherit',
          fontSize: '1rem',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
