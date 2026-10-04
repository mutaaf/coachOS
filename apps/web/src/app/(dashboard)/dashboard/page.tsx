import Link from "next/link";
// The server's clock is UTC; the greeting and "Today"/"Tomorrow" go by Dallas.
import { businessToday, dayLabel, greeting } from "@/lib/dates";
import { createServerSupabase } from "@/lib/supabase/server";
import { cn, formatCurrency } from "@/lib/utils";
import { getOnboarding } from "@/lib/queries/onboarding";
import { getOverdueSummary } from "@/lib/queries/payments";
import { GettingStarted } from "@/components/getting-started";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import {
  School,
  Users,
  DollarSign,
  AlertCircle,
  Calendar,
  UserPlus,
  CreditCard,
  MessageSquare,
  TrendingUp,
  TrendingDown,
  Clock,
} from "lucide-react";

// Every dashboard page reads live business data behind a login, so it must be
// rendered per request. Without this Next prerenders it at build time and the
// page keeps serving whatever the database held when it was deployed.
export const dynamic = "force-dynamic";

function formatSessionTime(time: string): string {
  const [hours, minutes] = time.split(":");
  const h = parseInt(hours, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayHour}:${minutes} ${ampm}`;
}

export default async function DashboardPage() {
  const supabase = createServerSupabase();

  // Fetch all dashboard data in parallel
  const today = businessToday();

  const [
    schoolsResult,
    studentsResult,
    invoicesResult,
    overdue,
    sessionsResult,
    unreadMessagesResult,
  ] = await Promise.all([
    // Total active schools
    supabase
      .from("schools")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),

    // Total active students
    supabase
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("status", "active"),

    // Monthly revenue (paid invoices for current month)
    supabase
      .from("invoices")
      .select("amount")
      .eq("status", "paid")
      .gte("month", today.slice(0, 7))
      .lte("month", today.slice(0, 7)),

    // Overdue invoices: all of them counted, the oldest five listed
    getOverdueSummary(),

    // Upcoming sessions
    supabase
      .from("sessions")
      .select("id, date, start_time, end_time, status, programs(name, schools(name))")
      .gte("date", today)
      .eq("status", "scheduled")
      .order("date", { ascending: true })
      .order("start_time", { ascending: true })
      .limit(5),

    // Unread / pending messages
    supabase
      .from("message_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
  ]);

  const totalSchools = schoolsResult.count ?? 0;
  const totalStudents = studentsResult.count ?? 0;
  const monthlyRevenue = (invoicesResult.data ?? []).reduce(
    (sum, inv) => sum + (inv.amount ?? 0),
    0
  );
  const overdueInvoices = overdue.preview;
  const overdueCount = overdue.count;
  const upcomingSessions = sessionsResult.data ?? [];
  const pendingMessages = unreadMessagesResult.count ?? 0;

  const statCards = [
    {
      label: "Total Schools",
      value: totalSchools.toString(),
      icon: School,
      trend: null,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "Active Students",
      value: totalStudents.toString(),
      icon: Users,
      trend: null,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      label: "Monthly Revenue",
      value: formatCurrency(monthlyRevenue),
      icon: DollarSign,
      trend: monthlyRevenue > 0 ? "up" : null,
      color: "text-violet-600",
      bg: "bg-violet-50",
    },
    {
      label: "Overdue Payments",
      value: overdueCount.toString(),
      icon: AlertCircle,
      trend: overdueCount > 0 ? "down" : null,
      color: overdueCount > 0 ? "text-red-600" : "text-gray-600",
      bg: overdueCount > 0 ? "bg-red-50" : "bg-gray-50",
    },
  ];

  const onboarding = await getOnboarding();

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {greeting()}, Boss
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Here&apos;s what&apos;s happening with your programs today.
        </p>
      </div>

      {onboarding && !onboarding.hidden && <GettingStarted items={onboarding.items} />}

      {/* Stat Cards */}
      <div data-tour="dashboard-stats" className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card
            key={stat.label}
            data-testid={`stat-${stat.label.toLowerCase().replace(/ /g, "-")}`}
            className="border-0 shadow-sm"
          >
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 space-y-1.5 sm:space-y-2">
                  <p className="text-[13px] font-medium leading-tight text-muted-foreground sm:text-sm">
                    {stat.label}
                  </p>
                  <p className="whitespace-nowrap text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">
                    {stat.value}
                  </p>
                </div>
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl sm:h-10 sm:w-10 ${stat.bg}`}
                >
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
              </div>
              {stat.trend && (
                <div className="mt-2 flex items-start gap-1 text-xs sm:mt-3">
                  {stat.trend === "up" ? (
                    <TrendingUp className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-500" />
                  ) : (
                    <TrendingDown className="mt-px h-3.5 w-3.5 shrink-0 text-red-500" />
                  )}
                  <span
                    className={
                      stat.trend === "up"
                        ? "text-emerald-600"
                        : "text-red-600"
                    }
                  >
                    {stat.trend === "up"
                      ? "Revenue this month"
                      : <><span className="whitespace-nowrap tabular-nums">{formatCurrency(overdue.amount)}</span> owed</>}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main Content Grid */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Upcoming Sessions */}
        <Card className="border-0 shadow-sm lg:col-span-2">
          <CardHeader className="p-4 pb-3 sm:p-6 sm:pb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-base font-semibold">
                  Upcoming practices
                </CardTitle>
                <CardDescription>Your next scheduled practices</CardDescription>
              </div>
              <Link
                href="/schedule"
                className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "h-10 shrink-0 text-sm")}
              >
                View All
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            {upcomingSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                  <Calendar className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="mt-3 text-sm font-medium">
                  No upcoming practices
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Practices will appear here once scheduled.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {upcomingSessions.map((session: any) => (
                  <div
                    key={session.id}
                    className="flex items-center gap-3 rounded-xl bg-gray-50/80 p-3 sm:gap-4 sm:p-3.5"
                  >
                    <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 sm:flex">
                      <Calendar className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 text-sm font-medium leading-snug sm:truncate">
                        {session.programs?.name ?? "Practice"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {session.programs?.schools?.name ?? ""}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="whitespace-nowrap text-sm font-medium">
                        {dayLabel(session.date)}
                      </p>
                      <p className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {formatSessionTime(session.start_time)} -{" "}
                        {formatSessionTime(session.end_time)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Alerts */}
        <Card className="border-0 shadow-sm">
          <CardHeader className="p-4 pb-3 sm:p-6 sm:pb-3">
            <CardTitle className="text-base font-semibold">
              Recent Alerts
            </CardTitle>
            <CardDescription>Items that need your attention</CardDescription>
          </CardHeader>
          <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
            {overdueCount === 0 && pendingMessages === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50">
                  <TrendingUp className="h-6 w-6 text-emerald-500" />
                </div>
                <p className="mt-3 text-sm font-medium">All clear!</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  No alerts at the moment.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {overdueInvoices.map((invoice: any) => (
                  <div
                    key={invoice.id}
                    className="flex items-start gap-3 rounded-xl bg-red-50/60 p-3"
                  >
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-red-700">
                        Overdue Payment
                      </p>
                      <p className="text-xs text-red-600/80">
                        {(invoice as any).students?.first_name}{" "}
                        {(invoice as any).students?.last_name} -{" "}
                        <span className="whitespace-nowrap tabular-nums">
                          {formatCurrency(invoice.amount)}
                        </span>
                      </p>
                    </div>
                  </div>
                ))}

                {overdueCount > overdueInvoices.length && (
                  <Link
                    href="/payments?status=overdue"
                    className="flex h-11 items-center justify-center rounded-xl text-sm font-medium text-red-600 hover:bg-red-50 hover:underline"
                  >
                    See all {overdueCount}
                  </Link>
                )}

                {pendingMessages > 0 && (
                  <div className="flex items-start gap-3 rounded-xl bg-amber-50/60 p-3">
                    <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                    <div>
                      <p className="text-sm font-medium text-amber-700">
                        Pending Messages
                      </p>
                      <p className="text-xs text-amber-700/80">
                        {pendingMessages} message{pendingMessages !== 1 ? "s" : ""}{" "}
                        waiting to be sent
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="border-0 shadow-sm">
        <CardHeader className="p-4 pb-3 sm:p-6 sm:pb-3">
          <CardTitle className="text-base font-semibold">
            Quick Actions
          </CardTitle>
          <CardDescription>Common tasks at your fingertips</CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
          <div className="grid gap-3 sm:flex sm:flex-wrap">
            <Link
              href="/students?action=add"
              className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full gap-2 rounded-xl sm:w-auto")}
            >
              <UserPlus className="h-4 w-4" />
              Add Student
            </Link>
            <Link
              href="/payments?action=record"
              className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full gap-2 rounded-xl sm:w-auto")}
            >
              <CreditCard className="h-4 w-4" />
              Record Payment
            </Link>
            <Link
              href="/messaging?action=compose"
              className={cn(buttonVariants({ variant: "outline" }), "h-11 w-full gap-2 rounded-xl sm:w-auto")}
            >
              <MessageSquare className="h-4 w-4" />
              Send Message
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
