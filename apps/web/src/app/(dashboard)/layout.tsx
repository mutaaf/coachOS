"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { GuidedTour, startTour } from "@/components/guided-tour";
import { getTourContext, type TourContext } from "@/lib/actions/onboarding";
import { getReleaseState, type ReleaseState } from "@/lib/actions/releases";
import { WhatsNewDialog } from "@/components/whats-new";
import { ReportProblemDialog } from "@/components/report-problem";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  School,
  Users,
  UserCheck,
  ClipboardList,
  Calendar,
  CreditCard,
  MessageSquare,
  Target,
  Trophy,
  Globe,
  Settings,
  LogOut,
  PlayCircle,
  LifeBuoy,
  MessageSquareWarning,
  Menu,
  X,
} from "lucide-react";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Programs", href: "/programs", icon: Trophy },
  { name: "Schools", href: "/schools", icon: School },
  { name: "Students", href: "/students", icon: Users },
  { name: "Registrations", href: "/registrations", icon: ClipboardList },
  { name: "Coaches", href: "/coaches", icon: UserCheck },
  { name: "Schedule", href: "/schedule", icon: Calendar },
  { name: "Payments", href: "/payments", icon: CreditCard },
  { name: "Messaging", href: "/messaging", icon: MessageSquare },
  { name: "Marketing", href: "/marketing", icon: Target },
  { name: "Website", href: "/website", icon: Globe },
  { name: "Settings", href: "/settings", icon: Settings },
  { name: "Help", href: "/help", icon: LifeBuoy },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [firstVisit, setFirstVisit] = useState(false);
  const [tourContext, setTourContext] = useState<TourContext | null>(null);
  const [releases, setReleases] = useState<ReleaseState | null>(null);
  const [reporting, setReporting] = useState(false);

  // The tour starts by itself until she has finished or skipped it once, on
  // any device — it is recorded on her account.
  useEffect(() => {
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (data.user && !data.user.user_metadata?.tour_completed_at) setFirstVisit(true);
      });
    getTourContext().then(setTourContext);
    getReleaseState().then(setReleases);
  }, []);

  // The slide-out menu on a phone: Escape closes it, it takes focus while
  // open and hands it back to the menu button after.
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sidebarOpen) return;
    drawerRef.current?.focus({ preventScroll: true });
    const menuButton = menuButtonRef.current;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSidebarOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      menuButton?.focus({ preventScroll: true });
    };
  }, [sidebarOpen]);

  // A link tapped in the menu closes it; so does arriving anywhere else.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const current = navigation.find(
    (item) => pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href))
  );

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function SidebarContent({ mobile = false }: { mobile?: boolean }) {
    return (
      <div className="flex h-full flex-col">
        {/* Logo */}
        <div className={cn("flex h-16 flex-shrink-0 items-center gap-3 border-b px-6", mobile && "pr-16")}>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-bold">
            CO
          </div>
          <span className="text-lg font-semibold tracking-tight">CoachOS</span>
        </div>

        {/* Navigation */}
        <nav
          aria-label="Main"
          className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-3 lg:py-4"
        >
          {navigation.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/dashboard" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.name}
                href={item.href}
                onClick={() => setSidebarOpen(false)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors lg:min-h-0 lg:text-sm",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <item.icon className="h-5 w-5 flex-shrink-0" />
                {item.name}
              </Link>
            );
          })}
        </nav>

        {/* Tour + Sign Out */}
        <div className="flex-shrink-0 border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:pb-3">
          <button
            onClick={() => {
              setSidebarOpen(false);
              startTour();
            }}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:min-h-0 lg:text-sm"
          >
            <PlayCircle className="h-5 w-5 flex-shrink-0" />
            Take the tour
          </button>
          <button
            onClick={() => {
              setSidebarOpen(false);
              setReporting(true);
            }}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:min-h-0 lg:text-sm"
          >
            <MessageSquareWarning className="h-5 w-5 flex-shrink-0" />
            Report a problem
          </button>
          <button
            onClick={handleSignOut}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:min-h-0 lg:text-sm"
          >
            <LogOut className="h-5 w-5 flex-shrink-0" />
            Sign Out
          </button>
          {releases?.current && (
            <Link
              href="/help?tab=new"
              onClick={() => setSidebarOpen(false)}
              data-testid="app-version"
              className="mt-1 block px-3 py-2 font-mono text-xs text-muted-foreground hover:text-foreground lg:py-0"
            >
              v{releases.current} · what&rsquo;s new
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen h-dvh overflow-hidden bg-gray-50/50">
      {/* Mobile backdrop */}
      <div
        aria-hidden
        className={cn(
          "fixed inset-0 z-40 bg-black/30 backdrop-blur-sm transition-opacity duration-200 lg:hidden",
          sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={() => setSidebarOpen(false)}
      />

      {/* Mobile sidebar */}
      <div
        id="mobile-menu"
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        tabIndex={-1}
        // Off screen, its links shouldn't take focus. React 18 has no typed
        // inert prop, so it goes on as a plain attribute.
        {...(sidebarOpen ? {} : ({ inert: "" } as object))}
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[min(18rem,85vw)] transform bg-white pt-[env(safe-area-inset-top)] pl-[env(safe-area-inset-left)] shadow-xl outline-none transition-transform duration-200 ease-out lg:hidden",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="absolute right-2 top-[calc(env(safe-area-inset-top)+0.625rem)] z-10">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
        <SidebarContent mobile />
      </div>

      {/* Desktop sidebar */}
      <div className="hidden w-64 flex-shrink-0 border-r bg-white lg:block">
        <SidebarContent />
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="flex-shrink-0 border-b bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
          <div className="flex h-14 items-center gap-2 pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
            <Button
              ref={menuButtonRef}
              variant="ghost"
              size="icon"
              aria-label="Open menu"
              aria-expanded={sidebarOpen}
              aria-controls="mobile-menu"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-6 w-6" />
            </Button>
            <Link href="/dashboard" className="flex min-w-0 items-center gap-2" aria-label="CoachOS home">
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground text-xs font-bold">
                CO
              </div>
              <span className="text-sm font-semibold">CoachOS</span>
            </Link>
            {current && current.href !== "/dashboard" && (
              <span className="ml-auto truncate text-sm font-medium text-muted-foreground" aria-hidden>
                {current.name}
              </span>
            )}
          </div>
        </header>

        <Suspense fallback={null}>
          <GuidedTour autoStart={firstVisit} ctx={tourContext} />
        </Suspense>
        {!firstVisit && releases && releases.unseen.length > 0 && (
          <WhatsNewDialog
            releases={releases.unseen}
            onDone={() => setReleases((r) => (r ? { ...r, unseen: [] } : r))}
          />
        )}
        <ReportProblemDialog open={reporting} onOpenChange={setReporting} />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto overscroll-contain">
          <div className="mx-auto max-w-7xl px-4 pt-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-8 lg:pb-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
