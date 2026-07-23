/**
 * Icon set — Iconsax-style linear glyphs (24×24, 1.5 stroke, rounded), bundled
 * as inline SVG. The `iconsax-react` npm port sits at 0.0.x, below the
 * dependency-budget bar (docs/08-code-conventions.md); these nine cover P0 and
 * can be swapped for the full set behind the same component names later.
 */
import type { ReactNode, SVGProps } from 'react';

export type IconProps = SVGProps<SVGSVGElement>;

const make = (children: ReactNode) =>
  function Icon(props: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        width="1em"
        height="1em"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...props}
      >
        {children}
      </svg>
    );
  };

export const FolderIcon = make(
  <path d="M21 10v5.6c0 2.9-1.5 4.4-4.4 4.4H7.4C4.5 20 3 18.5 3 15.6V8.4C3 5.5 4.5 4 7.4 4h1.9c1 0 1.3.3 1.9 1l1.1 1.4c.4.5.6.6 1.3.6h3C19.5 7 21 8.1 21 10Z" />,
);

export const NoteIcon = make(
  <>
    <path d="M20 8v9c0 2.2-1.3 3.5-3.5 3.5h-9C5.3 20.5 4 19.2 4 17V8c0-2.2 1.3-3.5 3.5-3.5h9C18.7 4.5 20 5.8 20 8Z" />
    <path d="M8.5 9.5h7M8.5 13h7M8.5 16.5h4" />
  </>,
);

export const LinkIcon = make(
  <>
    <path d="M13.5 6.5 15 5a4.2 4.2 0 0 1 6 6l-1.5 1.5" />
    <path d="M10.5 17.5 9 19a4.2 4.2 0 0 1-6-6l1.5-1.5" />
    <path d="M9 15l6-6" />
  </>,
);

export const FileIcon = make(
  <>
    <path d="M20 9v8.5c0 2-1.3 3.5-3.5 3.5h-9C5.3 21 4 19.5 4 17.5v-11C4 4.5 5.3 3 7.5 3H14l6 6Z" />
    <path d="M14 3v4c0 1.1.9 2 2 2h4" />
  </>,
);

export const DashIcon = make(
  <>
    <path d="M4 4v14c0 1.1.9 2 2 2h14" />
    <path d="M8.5 15.5v-4M12.5 15.5v-7M16.5 15.5v-2.5" />
  </>,
);

export const GridIcon = make(
  <>
    <path d="M3.5 6c0-1.7.8-2.5 2.5-2.5h2c1.7 0 2.5.8 2.5 2.5v2c0 1.7-.8 2.5-2.5 2.5H6c-1.7 0-2.5-.8-2.5-2.5V6Z" />
    <path d="M13.5 6c0-1.7.8-2.5 2.5-2.5h2c1.7 0 2.5.8 2.5 2.5v2c0 1.7-.8 2.5-2.5 2.5h-2c-1.7 0-2.5-.8-2.5-2.5V6Z" />
    <path d="M3.5 16c0-1.7.8-2.5 2.5-2.5h2c1.7 0 2.5.8 2.5 2.5v2c0 1.7-.8 2.5-2.5 2.5H6c-1.7 0-2.5-.8-2.5-2.5v-2Z" />
    <path d="M13.5 16c0-1.7.8-2.5 2.5-2.5h2c1.7 0 2.5.8 2.5 2.5v2c0 1.7-.8 2.5-2.5 2.5h-2c-1.7 0-2.5-.8-2.5-2.5v-2Z" />
  </>,
);

export const MasonryIcon = make(
  <>
    <path d="M3.5 6c0-1.7.8-2.5 2.5-2.5h2c1.7 0 2.5.8 2.5 2.5v7c0 1.7-.8 2.5-2.5 2.5H6c-1.7 0-2.5-.8-2.5-2.5V6Z" />
    <path d="M3.5 19.5c0-.8.8-1.5 2.5-1.5h2c1.7 0 2.5.7 2.5 1.5s-.8 1-2.5 1H6c-1.7 0-2.5-.2-2.5-1Z" />
    <path d="M13.5 6c0-1.7.8-2.5 2.5-2.5h2c1.7 0 2.5.8 2.5 2.5v1c0 1.7-.8 2.5-2.5 2.5h-2c-1.7 0-2.5-.8-2.5-2.5V6Z" />
    <path d="M13.5 14c0-1.7.8-2.5 2.5-2.5h2c1.7 0 2.5.8 2.5 2.5v4c0 1.7-.8 2.5-2.5 2.5h-2c-1.7 0-2.5-.8-2.5-2.5v-4Z" />
  </>,
);

export const ListIcon = make(
  <>
    <path d="M9 6h11.5M9 12h11.5M9 18h11.5" />
    <path d="M3.5 6h1M3.5 12h1M3.5 18h1" />
  </>,
);

export const TableIcon = make(
  <>
    <path d="M3.5 8.5v7c0 2.9 1.5 4.4 4.4 4.4h8.2c2.9 0 4.4-1.5 4.4-4.4v-7c0-2.9-1.5-4.4-4.4-4.4H7.9c-2.9 0-4.4 1.5-4.4 4.4Z" />
    <path d="M3.5 9.5h17M9.5 9.5V20M3.5 14.5h17" />
  </>,
);

export const PlusIcon = make(<path d="M12 5v14M5 12h14" />);

export const ChevronIcon = make(<path d="M9 5.5 15.5 12 9 18.5" />);

export const SearchIcon = make(
  <>
    <circle cx="11" cy="11" r="7.5" />
    <path d="M20.5 20.5 16.7 16.7" />
  </>,
);
