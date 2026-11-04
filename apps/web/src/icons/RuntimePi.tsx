import type { SVGProps } from 'react';

export function RuntimePi({ width = 12, height = 12, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="currentColor"
      {...props}
    >
      <path d="M2 2h15v10h-5V7H2ZM2 7h5v5h5v5H7v5H2ZM17 12h5v10h-5Z" />
    </svg>
  );
}
