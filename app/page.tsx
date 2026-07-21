import { createClient } from "@supabase/supabase-js";
import { computeDeadlines } from "./deadlines/page";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export default async function DashboardPage() {
  const [
    { count: totalClients },
    { data: invoices },
    { data: amlClients },
    { data: deadlineClients },
    { data: sentTax },
    { data: sentAccounts },
    { data: sentCT },
    { data: engagementLetters },
    { data: onboardingRequests },
    { data: sentP11D },
  ] = await Promise.all([
    supabase.from("clients").select("*", { count: "exact", head: true }),
    supabase.from("invoices").select("status, total"),
    supabase.from("clients").select("id, onboarding_status, aml_risk_rating, aml_id_verified, aml_next_review_due"),
    supabase.from("clients").select("id, client_name, company_number, entity_type, accounts_next_due, confirmation_statement_next_due, requires_self_assessment, vat_stagger_group, paye_reference"),
    supabase.from("tax_computations").select("id", { count: "exact" }).eq("status", "Sent"),
    supabase.from("trial_balances").select("id", { count: "exact" }).eq("approval_status", "Sent"),
    supabase.from("corporation_tax_computations").select("id", { count: "exact" }).eq("status", "Sent"),
    supabase.from("engagement_letters").select("id, status"),
    supabase.from("onboarding_requests").select("id, status"),
    supabase.from("p11d_computations").select("id", { count: "exact" }).eq("status", "Sent"),
  ]);

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // 1. Total Clients
  const clientsCount = totalClients ?? 0;

  // 2. Outstanding fees — sum of all invoices not yet paid
  const outstandingFees = (invoices || []).filter((i) => i.status !== "Paid").reduce((s, i) => s + Number(i.total || 0), 0);

  // 3. Outstanding AML — same "needs attention" logic as the client detail page,
  // only counting clients actually onboard/active (not prospects not yet taken on)
  const amlOutstandingCount = (amlClients || [])
    .filter((c) => c.onboarding_status === "Active Client" || c.onboarding_status === "Onboarding")
    .filter((c) => {
      const reviewOverdue = c.aml_next_review_due && new Date(c.aml_next_review_due) < new Date();
      return !c.aml_id_verified || !c.aml_risk_rating || reviewOverdue;
    }).length;

  // 4. Upcoming deadlines — same calculation as the Deadlines page, within the next 30 days (includes overdue)
  const allDeadlines = computeDeadlines(deadlineClients || []);
  const upcomingDeadlinesCount = allDeadlines.filter((d) => d.days <= 30).length;

  // 5. Awaiting approval — split by module.
  const accountsAwaitingCount = sentAccounts?.length ?? 0;
  const ctAwaitingCount = sentCT?.length ?? 0;
  const personalTaxAwaitingCount = sentTax?.length ?? 0;
  const p11dAwaitingCount = sentP11D?.length ?? 0;

  // 6. Outstanding engagement letters — anything not yet Signed
  const outstandingEngagementCount = (engagementLetters || []).filter((l) => l.status !== "Signed").length;

  // 7. Outstanding onboarding — anything not yet Complete
  const outstandingOnboardingCount = (onboardingRequests || []).filter((r) => r.status !== "Complete").length;

  // Standard stat box: quiet by default, an amber left-edge tab and tinted
  // number when there's something to act on, calm grey when clear.
  const StatBox = ({
    href, label, value, needsAttention,
  }: { href: string; label: string; value: string | number; needsAttention: boolean }) => (
    <a href={href}
      className={`group block rounded-2xl bg-white border border-slate-100 border-l-[3px] p-5 transition-all hover:shadow-md hover:border-slate-200 ${
        needsAttention ? "border-l-amber-500" : "border-l-slate-200"
      }`}>
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`mt-2 text-3xl font-bold font-mono tabular-nums ${
        needsAttention ? "text-amber-700" : "text-slate-400"
      }`}>
        {value}
      </p>
    </a>
  );

  // Hero box: the one place full-strength color is spent, reserved for AML —
  // the genuinely highest-stakes item on this page.
  const HeroBox = ({ href, label, value }: { href: string; label: string; value: number }) => (
    <a href={href}
      className={`block rounded-2xl p-5 transition-all ${
        value > 0 ? "bg-red-600 hover:bg-red-700" : "bg-white border border-slate-100 border-l-[3px] border-l-slate-200 hover:shadow-md hover:border-slate-200"
      }`}>
      <p className={`text-xs font-medium uppercase tracking-wide ${value > 0 ? "text-red-100" : "text-slate-500"}`}>{label}</p>
      <p className={`mt-2 text-3xl font-bold font-mono tabular-nums ${value > 0 ? "text-white" : "text-slate-400"}`}>
        {value}
      </p>
      {value === 0 && <p className="mt-1 text-xs text-slate-400">All clients up to date</p>}
    </a>
  );

  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">{children}</p>
  );

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
            <p className="text-sm text-slate-500 mt-0.5">{today}</p>
          </div>
          <div className="flex gap-2">
            <a href="/clients?new=true" className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">+ New Client</a>
            <a href="/jobs" className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">+ New Job</a>
            <a href="/quotes/new" className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">+ New Quote</a>
            <a href="/invoices/new" className="rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors">+ New Invoice</a>
          </div>
        </div>
      </div>

      <div className="p-8 max-w-6xl space-y-8">

        {/* Practice Overview */}
        <div>
          <SectionLabel>Practice Overview</SectionLabel>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatBox href="/clients" label="Total Clients" value={clientsCount} needsAttention={false} />
            <StatBox href="/invoices" label="Outstanding Fees" value={`£${outstandingFees.toFixed(0)}`} needsAttention={outstandingFees > 0} />
            <StatBox href="/deadlines" label="Upcoming Deadlines" value={upcomingDeadlinesCount} needsAttention={upcomingDeadlinesCount > 0} />
          </div>
        </div>

        {/* Compliance */}
        <div>
          <SectionLabel>Compliance</SectionLabel>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <HeroBox href="/clients" label="Outstanding AML" value={amlOutstandingCount} />
          </div>
        </div>

        {/* Awaiting Client Response */}
        <div>
          <SectionLabel>Awaiting Client Response</SectionLabel>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatBox href="/communications?status=Sent&type=Accounts" label="Accounts" value={accountsAwaitingCount} needsAttention={accountsAwaitingCount > 0} />
            <StatBox href="/communications?status=Sent&type=Corporation+Tax" label="Corporation Tax" value={ctAwaitingCount} needsAttention={ctAwaitingCount > 0} />
            <StatBox href="/communications?status=Sent&type=Personal+Tax" label="Personal Tax" value={personalTaxAwaitingCount} needsAttention={personalTaxAwaitingCount > 0} />
            <StatBox href="/communications?status=Sent&type=P11D" label="P11D" value={p11dAwaitingCount} needsAttention={p11dAwaitingCount > 0} />
          </div>
        </div>

        {/* Practice Admin */}
        <div>
          <SectionLabel>Practice Admin</SectionLabel>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatBox href="/engagement" label="Outstanding Engagement Letters" value={outstandingEngagementCount} needsAttention={outstandingEngagementCount > 0} />
            <StatBox href="/onboarding" label="Outstanding Onboarding" value={outstandingOnboardingCount} needsAttention={outstandingOnboardingCount > 0} />
          </div>
        </div>

      </div>
    </div>
  );
}