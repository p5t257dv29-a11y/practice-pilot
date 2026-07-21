import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Helper function to format currency with thousands commas
const formatCurrency = (amount: number | string) => {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "£0";

  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0, // Set to 2 if you prefer decimal places (£5,376.00)
  }).format(num);
};

export default async function DashboardPage() {
  // Replace these with your actual Supabase queries or state as needed
  const totalActiveClients = 9;
  const outstandingFees = 5376;
  const upcomingDeadlines = 1;
  const outstandingAmlChecks = 3;

  const awaitingSignOff = {
    accounts: 0,
    corporationTax: 0,
    personalTax: 0,
    p11d: 0,
  };

  const onboardingContracts = {
    unsignedEngagementLetters: 1,
    incompleteOnboarding: 1,
  };

  return (
    <div className="min-h-screen bg-slate-50/50 p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Practice Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">
            {new Date().toLocaleDateString("en-GB", {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          <a
            href="/clients/new"
            className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 transition-colors"
          >
            + New Client
          </a>
          <a
            href="/jobs/new"
            className="rounded-xl bg-slate-100 border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors"
          >
            + Job
          </a>
          <a
            href="/quotes/new"
            className="rounded-xl bg-slate-100 border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors"
          >
            + Quote
          </a>
          <a
            href="/invoices/new"
            className="rounded-xl bg-slate-100 border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-200 transition-colors"
          >
            + Invoice
          </a>
        </div>
      </div>

      {/* 1. PRACTICE OVERVIEW */}
      <section>
        <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase mb-3">
          Practice Overview
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Active Clients */}
          <a
            href="/clients"
            className="group rounded-2xl bg-white p-6 shadow-sm border border-slate-100 hover:border-slate-300 transition-all flex items-center justify-between"
          >
            <div>
              <p className="text-xs font-semibold text-slate-500">Total Active Clients</p>
              <p className="text-3xl font-bold text-slate-900 mt-2">
                {totalActiveClients}
              </p>
            </div>
            <span className="text-slate-300 group-hover:text-slate-600 transition-colors">
              →
            </span>
          </a>

          {/* Outstanding Fees */}
          <a
            href="/invoices"
            className="group rounded-2xl bg-white p-6 shadow-sm border border-slate-100 hover:border-slate-300 transition-all flex items-start justify-between"
          >
            <div>
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-slate-500">Outstanding Fees</p>
                <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                  Unpaid
                </span>
              </div>
              <p className="text-3xl font-bold text-slate-900 mt-2">
                {formatCurrency(outstandingFees)}
              </p>
            </div>
            <span className="text-slate-300 group-hover:text-slate-600 transition-colors">
              →
            </span>
          </a>

          {/* Upcoming Deadlines */}
          <a
            href="/deadlines"
            className="group rounded-2xl bg-white p-6 shadow-sm border border-slate-100 hover:border-slate-300 transition-all flex items-start justify-between"
          >
            <div>
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-slate-500">Upcoming Deadlines</p>
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  30 Days
                </span>
              </div>
              <p className="text-3xl font-bold text-slate-900 mt-2">
                {upcomingDeadlines}
              </p>
            </div>
            <span className="text-slate-300 group-hover:text-slate-600 transition-colors">
              →
            </span>
          </a>
        </div>
      </section>

      {/* 2. COMPLIANCE & RISK */}
      <section>
        <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase mb-3">
          Compliance & Risk
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <a
            href="/clients"
            className="group rounded-2xl bg-white p-6 shadow-sm border border-slate-100 hover:border-slate-300 transition-all flex items-start justify-between"
          >
            <div>
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-slate-500">
                  Outstanding AML Checks
                </p>
                <span className="rounded-md bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-600">
                  Requires Review
                </span>
              </div>
              <p className="text-3xl font-bold text-slate-900 mt-2">
                {outstandingAmlChecks}
              </p>
            </div>
            <span className="text-slate-300 group-hover:text-slate-600 transition-colors">
              →
            </span>
          </a>
        </div>
      </section>

      {/* 3. AWAITING CLIENT SIGN-OFF */}
      <section>
        <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase mb-3">
          Awaiting Client Sign-off
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {[
            { label: "Accounts", val: awaitingSignOff.accounts },
            { label: "Corporation Tax", val: awaitingSignOff.corporationTax },
            { label: "Personal Tax", val: awaitingSignOff.personalTax },
            { label: "P11D Computations", val: awaitingSignOff.p11d },
          ].map((item) => (
            <div
              key={item.label}
              className="group rounded-2xl bg-white p-6 shadow-sm border border-slate-100 flex items-center justify-between"
            >
              <div>
                <p className="text-xs font-semibold text-slate-500">{item.label}</p>
                <p className="text-3xl font-bold text-slate-900 mt-2">{item.val}</p>
              </div>
              <span className="text-slate-300 group-hover:text-slate-600 transition-colors">
                →
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* 4. ONBOARDING & CONTRACTS (Restored) */}
      <section>
        <h2 className="text-xs font-bold tracking-wider text-slate-400 uppercase mb-3">
          Onboarding & Contracts
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* Unsigned Engagement Letters */}
          <a
            href="/engagement"
            className="group rounded-2xl bg-white p-6 shadow-sm border border-slate-100 hover:border-slate-300 transition-all flex items-start justify-between"
          >
            <div>
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-slate-500">
                  Unsigned Engagement Letters
                </p>
                <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600">
                  Pending
                </span>
              </div>
              <p className="text-3xl font-bold text-slate-900 mt-2">
                {onboardingContracts.unsignedEngagementLetters}
              </p>
            </div>
            <span className="text-slate-300 group-hover:text-slate-600 transition-colors">
              →
            </span>
          </a>

          {/* Incomplete Onboarding */}
          <a
            href="/onboarding"
            className="group rounded-2xl bg-white p-6 shadow-sm border border-slate-100 hover:border-slate-300 transition-all flex items-start justify-between"
          >
            <div>
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-slate-500">
                  Incomplete Onboarding
                </p>
                <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">
                  In Progress
                </span>
              </div>
              <p className="text-3xl font-bold text-slate-900 mt-2">
                {onboardingContracts.incompleteOnboarding}
              </p>
            </div>
            <span className="text-slate-300 group-hover:text-slate-600 transition-colors">
              →
            </span>
          </a>
        </div>
      </section>
    </div>
  );
}