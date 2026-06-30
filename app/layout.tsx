import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fitness & Portfolio Tracker",
  description: "Ein privater Tracker fuer Spaziergaenge, Aktienpositionen und Performance.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
