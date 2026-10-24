import { HistoryIcon, LayoutDashboardIcon, TargetIcon } from "lucide-react";
import type { ReactNode } from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import type { View } from "@/hooks/useDashboardState";

const NAV: { view: View; label: string; icon: typeof LayoutDashboardIcon }[] = [
  { view: "overview", label: "Overview", icon: LayoutDashboardIcon },
  { view: "accuracy", label: "Accuracy", icon: TargetIcon },
  { view: "versions", label: "Forecast versions", icon: HistoryIcon },
];

function Brand() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="pointer-events-none">
          <img src="/logo.svg" alt="" className="size-8 shrink-0" />
          <span className="truncate leading-tight font-semibold">
            GB wind forecasts
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function NavLinks({
  view,
  onNavigate,
}: {
  view: View;
  onNavigate: (view: View) => void;
}) {
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <SidebarGroup>
      <SidebarGroupContent>
        <SidebarMenu aria-label="Dashboard sections">
          {NAV.map(({ view: target, label, icon: Icon }) => (
            <SidebarMenuItem key={target}>
              <SidebarMenuButton
                tooltip={label}
                isActive={view === target}
                aria-current={view === target ? "page" : undefined}
                onClick={() => {
                  onNavigate(target);
                  if (isMobile) setOpenMobile(false);
                }}
              >
                <Icon aria-hidden />
                <span>{label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function AppShell({
  view,
  onNavigate,
  children,
}: {
  view: View;
  onNavigate: (view: View) => void;
  children: ReactNode;
}) {
  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <Brand />
        </SidebarHeader>
        <SidebarContent>
          <NavLinks view={view} onNavigate={onNavigate} />
        </SidebarContent>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0">
        <header className="bg-background sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex w-full flex-col gap-6">{children}</div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
