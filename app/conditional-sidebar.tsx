"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SignOutButton from "./signout-button";
import GlobalSearch from "./global-search";

const navSections = [
  {
    label: "Practice",
    items: [
      { href: "/", label: "Dashboard", icon: "📊" },
      { href: "/deadlines", label: "Deadlines", icon: "📅" },
      { href: "/reports", label: "Reports & WIP", icon: "📈" },
      { href: "/timesheets", label: "Timesheets", icon: "⏱️" },
    ],
  },
  {
    label: "Clients",
    items: [
      { href: "/clients", label: "Clients", icon: "👥" },
      { href: "/onboarding", label: "Onboarding", icon: "🚀" },
      { href: "/engagement", label: "Engagement", icon: "📝" },
      { href: "/quotes", label: "Quotes", icon: "📋" },
      { href: "/invoices", label: "Invoices", icon: "🧾" },
    ],
  },
  {
    label: "Work",
    items: [
      { href: "/jobs", label: "Jobs", icon: "💼" },
      { href: "/accounts-production", label: "Accounts Production", icon: "📊" },
      { href: "/fixed-assets", label: "Fixed Assets", icon: "🏭" },
      { href: "/corporation-tax", label: "Corporation Tax", icon: "🏢" },
      { href: "/tax", label: "Personal Tax", icon: "🧮" },
      { href: "/capital-gains", label: "Capital Gains", icon: "📈" },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/services", label: "Services", icon: "🏷️" },
      { href: "/checklists", label: "Checklists", icon: "✅" },
      { href: "/staff", label: "Staff", icon: "🧑‍💼" },
      { href: "/chart-of-accounts", label: "Chart of Accounts", icon: "📖" },
    ],
  },
];

export default function ConditionalSidebar({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isLoginPage = pathname === "/login";

  if (isLoginPage) {
    return <>{children}</>;
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="w-64 bg-slate-900 text-white flex flex-col fixed h-full overflow-y-auto">

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

        {/* Global Search */}
        <GlobalSearch />

        {/* Navigation */}
        <nav className="flex-1 p-4 space-y-6">
          {navSections.map((section) => (
            <div key={section.label}>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 mb-2">
                {section.label}
              </p>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-150 text-sm font-medium ${
                      pathname === item.href
                        ? "bg-slate-800 text-white"
                        : "text-slate-300 hover:bg-slate-800 hover:text-white"
                    }`}
                  >
                    <span className="text-base">{item.icon}</span>
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            </div>
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

      <main className="flex-1 ml-64 min-h-screen">
        {children}
      </main>
    </div>
  );
}
