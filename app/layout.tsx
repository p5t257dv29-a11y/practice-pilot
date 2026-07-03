import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import SignOutButton from "./signout-button";
import ConditionalSidebar from "./conditional-sidebar";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PracticePilot",
  description: "Accountancy practice management",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={geist.className}>
        <ConditionalSidebar>
          {children}
        </ConditionalSidebar>
      </body>
    </html>
  );
}
