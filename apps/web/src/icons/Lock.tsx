import type { SVGProps } from 'react';

export function Lock({ width = 11, height = 11, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M7 17V13C3.5 13 3 10 5 8 5 5 8 3 12 3s7 2 7 5c2 2 1.5 5-2 5v4" />
      <rect x="7" y="17" width="10" height="3" rx=".75" />
    </svg>
  );
}
