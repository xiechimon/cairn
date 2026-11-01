import type { ReactNode } from 'react';

export interface SidebarUserProps {
  name: string;
  avatar: ReactNode;
  machinesOnline: number;
  action?: ReactNode;
}

export function SidebarUser({ name, avatar, machinesOnline, action }: SidebarUserProps) {
  return (
    <div data-slot="sidebar-user" className="flex items-center gap-2.5 px-1.5 pt-2.5 pb-0.5">
      <span className="grid size-7 flex-none place-items-center">{avatar}</span>
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
