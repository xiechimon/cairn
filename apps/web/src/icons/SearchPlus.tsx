import type { SVGProps } from 'react';

export function SearchPlus({ width = 18, height = 18, ...props }: SVGProps<SVGSVGElement>) {
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
      <circle cx="11" cy="11" r="7" />
      <path d="M11 8v6" />
      <path d="M8 11h6" />
      <path d="M21 21l-4.3-4.3" />
    </svg>
  );
}
