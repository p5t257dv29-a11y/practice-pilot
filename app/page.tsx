import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const formatCurrency = (amount: number | string) => {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "£0";
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(num);
};

export default async function DashboardPage() {
  // Practice Overview
  const totalActiveClients = 9;
  const unpaidInvoicesAmount = 5376;
  const outstandingQuotesCount = 2;
  const upcomingDeadlinesCount = 1;

  // Compliance & Risk
  const outstandingAmlChecks = 3;
  const outstandingClearances = 2;

  // Onboarding
  const unsignedEngagementLetters = 1;
  const incompleteOnboarding = 1;

  // Awaiting Client Sign-off
  const awaitingSignOff = [
    { label: "Accounts Production", val: 0, href: "/accounts" },
    { label: "Corporation Tax", val: 0, href: "/corporation-tax" },
    { label: "Director's Loan & s455", val: 0, href: "/directors-loan" },
    { label: "Capital Gains", val: 0, href: "/capital-gains" },
    { label: "Personal Tax", val: 0, href: "/personal-tax" },
    { label: "Partnership Tax", val: 0, href: "/partnership-tax" },
    { label: "P11D Computations", val: 0, href: "/p11d" },
  ];

  const totalAwaitingSignoff = awaitingSignOff.reduce((acc, item) => acc + item.val, 0);

  return (
    <div className="min-h-screen bg-slate-50/50 p-8 space-y-8 text-slate-800">
      {/* Top Bar / Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Practice Dashboard
          </h1>
          <p className="text-xs font-medium text-slate-500 mt-1">
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>

        {/* Quick Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/clients/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 transition-all"
          >
            <span>+</span> New Client
          </a>
          <a
            href="/jobs/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-all"
          >
            <span>+</span> Job
          </a>
          <a
            href="/quotes/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-all"
          >
            <span>+</span> Quote
          </a>
          <a
            href="/invoices/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50 transition-all"
          >
            <span>+</span> Invoice
          </a>
        </div>
      </div>

      {/* 1. PRACTICE OVERVIEW */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
            Practice Overview
          </h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Active Clients */}
          <a
            href="/clients"
            className="group relative rounded-xl bg-white p-5 shadow-sm border border-slate-200/60 hover:border-slate-300 hover:shadow-md transition-all"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500">Active Clients</p>
              <span className="text-slate-300 group-hover:text-slate-600 transition-colors">→</span>
            </div>
            <p className="text-3xl font-extrabold text-slate-900 mt-3 tracking-tight">
              {totalActiveClients}
            </p>
          </a>

          {/* Unpaid Invoices */}
          <a
            href="/invoices"
            className="group relative rounded-xl bg-white p-5 shadow-sm border border-slate-200/60 hover:border-slate-300 hover:shadow-md transition-all"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500">Unpaid Invoices</p>
              <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                Outstanding
              </span>
            </div>
            <p className="text-3xl font-extrabold text-slate-900 mt-3 tracking-tight">
              {formatCurrency(unpaidInvoicesAmount)}
            </p>
          </a>

          {/* Outstanding Quotes */}
          <a
            href="/quotes"
            className="group relative rounded-xl bg-white p-5 shadow-sm border border-slate-200/60 hover:border-slate-300 hover:shadow-md transition-all"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500">Outstanding Quotes</p>
              <span className="rounded-full bg-purple-50 border border-purple-200 px-2 py-0.5 text-[10px] font-bold text-purple-700">
                Pending
              </span>
            </div>
            <p className="text-3xl font-extrabold text-slate-900 mt-3 tracking-tight">
              {outstandingQuotesCount}
            </p>
          </a>

          {/* Upcoming Deadlines */}
          <a
            href="/deadlines"
            className="group relative rounded-xl bg-white p-5 shadow-sm border border-slate-200/60 hover:border-slate-300 hover:shadow-md transition-all"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500">Upcoming Deadlines</p>
              <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                Next 30 Days
              </span>
            </div>
            <p className="text-3xl font-extrabold text-slate-900 mt-3 tracking-tight">
              {upcomingDeadlinesCount}
            </p>
          </a>
        </div>
      </section>

      {/* 2. TWO-COLUMN SPLIT: COMPLIANCE & ONBOARDING */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Compliance & Risk */}
        <section className="space-y-3">
          <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
            Compliance & Risk
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <a
              href="/clients?filter=aml"
              className="group rounded-xl bg-white p-5 shadow-sm border border-slate-200/60 hover:border-slate-300 hover:shadow-md transition-all"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500">AML Checks</p>
                <span className="rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[10px] font-bold text-red-600">
                  Review Needed
                </span>
              </div>
              <p className="text-3xl font-extrabold text-slate-900 mt-3 tracking-tight">
                {outstandingAmlChecks}
              </p>
            </a>

            <a
              href="/onboarding?filter=clearance"
              className="group rounded-xl bg-white p-5 shadow-sm border border-slate-200/60 hover:border-slate-300 hover:shadow-md transition-all"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500">Prof. Clearances</p>
                <span className="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                  Awaiting
                </span>
              </div>
              <p className="text-3xl font-extrabold text-slate-900 mt-3 tracking-tight">
                {outstandingClearances}
              </p>
            </a>
          </div>
        </section>

        {/* Onboarding & Contracts */}
        <section className="space-y-3">
          <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
            Onboarding & Contracts
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <a
              href="/engagement"
              className="group rounded-xl bg-white p-5 shadow-sm border border-slate-200/60 hover:border-slate-300 hover:shadow-md transition-all"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500">Unsigned Letters</p>
                <span className="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-bold text-blue-600">
                  Pending
                </span>
              </div>
              <p className="text-3xl font-extrabold text-slate-900 mt-3 tracking-tight">
                {unsignedEngagementLetters}
              </p>
            </a>

            <a
              href="/onboarding"
              className="group rounded-xl bg-white p-5 shadow-sm border border-slate-200/60 hover:border-slate-300 hover:shadow-md transition-all"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500">Incomplete Onboarding</p>
                <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  In Progress
                </span>
              </div>
              <p className="text-3xl font-extrabold text-slate-900 mt-3 tracking-tight">
                {incompleteOnboarding}
              </p>
            </a>
          </div>
        </section>
      </div>

      {/* 3. AWAITING CLIENT SIGN-OFF (Structured List Card) */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
            Awaiting Client Sign-off
          </h2>
          <span className="text-xs font-semibold text-slate-500">
            Total Pending: <strong className="text-slate-900">{totalAwaitingSignoff}</strong>
          </span>
        </div>

        {/* Clean, Scannable Grid List Card */}
        <div className="rounded-2xl bg-white border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 divide-y sm:divide-y-0 divide-slate-100">
            {awaitingSignOff.map((item, idx) => {
              const hasItems = item.val > 0;
              return (
                <a
                  key={item.label}
                  href={item.href}
                  className={`group p-4 flex items-center justify-between transition-colors border-slate-100 ${
                    idx < awaitingSignOff.length - 1 ? "sm:border-r" : ""
                  } hover:bg-slate-50/80`}
                >
                  <span className="text-xs font-semibold text-slate-600 group-hover:text-slate-900 transition-colors">
                    {item.label}
                  </span>
                  <span
                    className={`inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
                      hasItems
                        ? "bg-amber-500 text-white shadow-xs"
                        : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {item.val}
                  </span>
                </a>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}