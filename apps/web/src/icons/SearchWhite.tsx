import type { SVGProps } from 'react';

export function SearchWhite({ width = 9, height = 9, ...props }: SVGProps<SVGSVGElement>) {
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
      <circle cx="10.5" cy="10.5" r="4.5" />
      <path d="M14 14 18.5 18.5" />
    </svg>
  );
}
