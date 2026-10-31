import type { ReactNode } from 'react';

export interface SidebarUserProps {
  name: string;
  machinesOnline: number;
  action?: ReactNode;
}

export function SidebarUser({ name, machinesOnline, action }: SidebarUserProps) {
  return (
    <div data-slot="sidebar-user" className="flex items-center gap-2.5 px-1.5 pt-2.5 pb-0.5">
      <span
        aria-hidden="true"
        className="grid size-7 flex-none place-items-center rounded-full bg-project-tile-2 text-ui font-semibold text-(--text-on-accent)"
      >
        {Array.from(name)[0]?.toUpperCase()}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <b className="text-ui font-semibold text-foreground">{name}</b>
        <small className="text-caption text-content-tertiary">
          {machinesOnline} {machinesOnline === 1 ? 'machine' : 'machines'} online
        </small>
      </span>
      {action != null && <span className="ml-auto flex-none">{action}</span>}
    </div>
  );
}
