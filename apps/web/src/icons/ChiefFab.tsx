import type { SVGProps } from 'react';

export function ChiefFab({ width = 30.8, height = 30.8, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#52525b"
      strokeWidth="2.5"
      strokeLinecap="round"
      {...props}
    >
      <circle cx="7" cy="9" r="3" fill="#52525b" stroke="none" />
      <circle cx="17" cy="9" r="3" fill="#52525b" stroke="none" />
      <line x1="7.5" y1="17" x2="16.5" y2="17" />
    </svg>
  );
}
