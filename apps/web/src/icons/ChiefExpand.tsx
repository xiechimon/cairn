import type { SVGProps } from 'react';

export function ChiefExpand({ width = 16, height = 16, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <polyline points="8 4 4 4 4 8" />
      <line x1="4" x2="11" y1="4" y2="11" />
      <polyline points="16 20 20 20 20 16" />
      <line x1="20" x2="13" y1="20" y2="13" />
    </svg>
  );
}
