import type { SVGProps } from 'react';

export function CheckWhite({ width = 9, height = 9, ...props }: SVGProps<SVGSVGElement>) {
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
      <path d="M6.5 12.5 10.5 16.5 17.5 8" />
    </svg>
  );
}
