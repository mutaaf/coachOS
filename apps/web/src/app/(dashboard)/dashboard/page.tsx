import Link from "next/link";
import { createServerSupabase } from "@/lib/supabase/server";
import { formatCurrency } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatSessionTime(time: string): string {
  const [hours, minutes] = time.split(":");
  const h = parseInt(hours, 10);
  const ampm = h >= 12 ? "PM" : "AM";
  const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${displayHour}:${minutes} ${ampm}`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr + "T00:00:00");
  const today = new Date();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";

  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default async function DashboardPage() {
  const supabase = createServerSupabase();

  // Fetch all dashboard data in parallel
  const today = new Date().toISOString().split("T")[0];

  const [
    schoolsResult,
    studentsResult,
    invoicesResult,
    overdueResult,
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

    // Overdue invoices
    supabase
      .from("invoices")
      .select("id, amount, parent_id, student_id, due_date, students(first_name, last_name)")
      .eq("status", "overdue")
      .order("due_date", { ascending: true })
      .limit(5),

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
  const overdueInvoices = overdueResult.data ?? [];
  const overdueCount = overdueInvoices.length;
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

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {getGreeting()}, Boss
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Here&apos;s what&apos;s happening with your programs today.
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.label} className="border-0 shadow-sm">
            <CardContent className="p-5">
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">
                    {stat.label}
                  </p>
                  <p className="text-2xl font-semibold tracking-tight">
                    {stat.value}
                  </p>
                </div>
                <div
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.bg}`}
                >
                  <stat.icon className={`h-5 w-5 ${stat.color}`} />
                </div>
              </div>
              {stat.trend && (
                <div className="mt-3 flex items-center gap-1 text-xs">
                  {stat.trend === "up" ? (
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <TrendingDown className="h-3.5 w-3.5 text-red-500" />
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
                      : `${overdueCount} need attention`}
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
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold">
                  Upcoming Sessions
                </CardTitle>
                <CardDescription>Your next scheduled sessions</CardDescription>
              </div>
              <Link href="/schedule">
                <Button variant="ghost" size="sm" className="text-xs">
                  View All
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {upcomingSessions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                  <Calendar className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="mt-3 text-sm font-medium">
                  No upcoming sessions
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sessions will appear here once scheduled.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {upcomingSessions.map((session: any) => (
                  <div
                    key={session.id}
                    className="flex items-center gap-4 rounded-xl bg-gray-50/80 p-3.5"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
                      <Calendar className="h-5 w-5 text-primary" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {session.programs?.name ?? "Session"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {session.programs?.schools?.name ?? ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium">
                        {formatDate(session.date)}
                      </p>
                      <p className="text-xs text-muted-foreground">
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
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">
              Recent Alerts
            </CardTitle>
            <CardDescription>Items that need your attention</CardDescription>
          </CardHeader>
          <CardContent>
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
                      <p className="text-xs text-red-600/70">
                        {(invoice as any).students?.first_name}{" "}
                        {(invoice as any).students?.last_name} -{" "}
                        {formatCurrency(invoice.amount)}
                      </p>
                    </div>
                  </div>
                ))}

                {pendingMessages > 0 && (
                  <div className="flex items-start gap-3 rounded-xl bg-amber-50/60 p-3">
                    <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                    <div>
                      <p className="text-sm font-medium text-amber-700">
                        Pending Messages
                      </p>
                      <p className="text-xs text-amber-600/70">
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
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold">
            Quick Actions
          </CardTitle>
          <CardDescription>Common tasks at your fingertips</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <Link href="/students?action=add">
              <Button variant="outline" className="gap-2 rounded-xl">
                <UserPlus className="h-4 w-4" />
                Add Student
              </Button>
            </Link>
            <Link href="/payments?action=record">
              <Button variant="outline" className="gap-2 rounded-xl">
                <CreditCard className="h-4 w-4" />
                Record Payment
              </Button>
            </Link>
            <Link href="/messaging?action=compose">
              <Button variant="outline" className="gap-2 rounded-xl">
                <MessageSquare className="h-4 w-4" />
                Send Message
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
