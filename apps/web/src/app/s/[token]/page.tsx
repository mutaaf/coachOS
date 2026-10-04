import { AttendanceSheet } from "@/components/attendance-sheet";

// The register changes as it is taken; never serve a cached copy.
export const dynamic = "force-dynamic";

// Edge to edge on phones, so the Save bar can sit above the home indicator.
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f8fafc",
};

export const metadata = {
  title: "Attendance — Rising Stars",
  // A register link should not turn up in a search result.
  robots: { index: false, follow: false },
};

export default function AttendanceSheetPage({ params }: { params: { token: string } }) {
  // Nothing is fetched here. The roster only exists behind the passcode, so the
  // server renders an empty shell and the sheet is loaded once the coach is in.
  return <AttendanceSheet token={params.token} />;
}
