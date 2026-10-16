import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "LeadLoop — Just talk. We’ll remember.",
  description:
    "A little less on your mind. Your business tasks, people, and reminders in one calm place.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
