import type { SVGProps } from 'react';

export function ChiefUserSolid({ width = 24, height = 24, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      {...props}
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M4 19c0-3.5 3.6-5.5 8-5.5s8 2 8 5.5v1.5H4Z" />
    </svg>
  );
}
