import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Steuerungs-Tracker",
  description: "Privater Tracker fuer Aktivitaet, Vermoegen, Sleep, LinkedIn-Kontakte, Monatsrueckblicke und Ziele.",
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
