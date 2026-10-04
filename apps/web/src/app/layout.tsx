import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";

// viewport-fit=cover is what makes env(safe-area-inset-*) padding work at the
// notch and the home bar.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export const metadata: Metadata = {
  title: "CoachOS",
  description: "Youth Sports Business Operating System",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  );
}
