import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import SignOutButton from "./signout-button";

const geist = Geist({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PracticePilot",
  description: "Accountancy practice management",
};

const navItems = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/clients", label: "Clients", icon: "👥" },
  { href: "/jobs", label: "Jobs", icon: "💼" },
  { href: "/services", label: "Services", icon: "🏷️" },
  { href: "/quotes", label: "Quotes", icon: "📋" },
  { href: "/onboarding", label: "Onboarding", icon: "🚀" },
];

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={geist.className}>
        <div className="flex min-h-screen bg-slate-50">

          {/* Sidebar */}
          <aside className="w-64 bg-slate-900 text-white flex flex-col fixed h-full">

            {/* Logo */}
            <div className="p-6 border-b border-slate-700/50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center text-sm font-bold">
                  PP
                </div>
                <div>
                  <h1 className="text-sm font-bold text-white">PracticePilot</h1>
                  <p className="text-xs text-slate-400">Practice Management</p>
                </div>
              </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 p-4 space-y-1">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 mb-3">
                Main Menu
              </p>

              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white transition-all duration-150 text-sm font-medium"
                >
                  <span className="text-base">{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </nav>

            {/* Bottom */}
            <div className="p-4 border-t border-slate-700/50">
              <div className="flex items-center gap-3 px-3 py-2">
                <div className="w-7 h-7 bg-slate-600 rounded-full flex items-center justify-center text-xs font-bold">
                  P
                </div>
                <div>
                  <p className="text-xs font-medium text-slate-300">Paul Robinson</p>
                  <p className="text-xs text-slate-500">Administrator</p>
                </div>
              </div>
              <SignOutButton />
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 ml-64 min-h-screen">
            {children}
          </main>

        </div>
      </body>
    </html>
  );
}
