import type { SVGProps } from 'react';

export function PlayBadge({ width = 9, height = 9, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#ffffff"
      strokeWidth="2.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M9 6.5 18.5 12 9 17.5 Z" />
    </svg>
  );
}
