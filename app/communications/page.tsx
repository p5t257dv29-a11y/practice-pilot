import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type CommEntry = {
  key: string;
  type: "Personal Tax" | "Accounts" | "Corporation Tax";
  label: string;
  client_name: string;
  status: string;
  client_email: string | null;
  sentDate: string | null;
  respondedDate: string | null;
  href: string;
  daysSinceSent: number | null;
};

export default async function CommunicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; type?: string }>;
}) {
  const { status: statusFilter, type: typeFilter } = await searchParams;

  const [{ data: taxComps }, { data: accounts }, { data: ctComps }] = await Promise.all([
    supabase
      .from("tax_computations")
      .select("id, tax_year, status, client_email, approved_at, queried_at, created_at, clients(client_name)")
      .not("status", "is", null)
      .neq("status", "Draft"),
    supabase
      .from("trial_balances")
      .select("id, period_end, accounts_type, approval_status, approval_client_email, approved_at, queried_at, clients(client_name)")
      .not("approval_status", "is", null),
    supabase
      .from("corporation_tax_computations")
      .select("id, period_end, status, client_email, approved_at, queried_at, clients(client_name)")
      .not("status", "is", null)
      .neq("status", "Draft"),
  ]);

  const getDaysSince = (dateStr: string | null): number | null => {
    if (!dateStr) return null;
    const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
    return days;
  };

  const entries: CommEntry[] = [
    ...(taxComps || []).map((t) => ({
      key: `tax-${t.id}`,
      type: "Personal Tax" as const,
      label: `Tax Year ${t.tax_year}`,
      client_name: (t.clients as any)?.client_name || "No client",
      status: t.status,
      client_email: t.client_email,
      sentDate: t.created_at,
      respondedDate: t.approved_at || t.queried_at || null,
      href: `/tax/${t.id}`,
      daysSinceSent: t.status === "Sent" ? getDaysSince(t.created_at) : null,
    })),
    ...(accounts || []).map((a) => ({
      key: `acc-${a.id}`,
      type: "Accounts" as const,
      label: `${a.accounts_type || "Accounts"} — Year Ended ${new Date(a.period_end).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`,
      client_name: (a.clients as any)?.client_name || "No client",
      status: a.approval_status,
      client_email: a.approval_client_email,
      sentDate: null,
      respondedDate: a.approved_at || a.queried_at || null,
      href: `/accounts-production/${a.id}`,
      daysSinceSent: null,
    })),
    ...(ctComps || []).map((c) => ({
      key: `ct-${c.id}`,
      type: "Corporation Tax" as const,
      label: `Period Ended ${new Date(c.period_end).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`,
      client_name: (c.clients as any)?.client_name || "No client",
      status: c.status,
      client_email: c.client_email,
      sentDate: null,
      respondedDate: c.approved_at || c.queried_at || null,
      href: `/corporation-tax/${c.id}`,
      daysSinceSent: null,
    })),
  ];

  const filtered = entries.filter((e) => {
    if (statusFilter && e.status !== statusFilter) return false;
    if (typeFilter && e.type !== typeFilter) return false;
    return true;
  });

  // Most recent activity first — responded items by response date, sent items by sent date if known
  filtered.sort((a, b) => {
    const aDate = a.respondedDate || a.sentDate || "";
    const bDate = b.respondedDate || b.sentDate || "";
    return bDate.localeCompare(aDate);
  });

  const sentCount = entries.filter((e) => e.status === "Sent").length;
  const approvedCount = entries.filter((e) => e.status === "Approved").length;
  const queriedCount = entries.filter((e) => e.status === "Queried").length;
  const needsChasing = entries.filter((e) => e.status === "Sent" && e.daysSinceSent !== null && e.daysSinceSent >= 7);

  const fmtDateTime = (iso: string) =>
    `${new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} at ${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-slate-900">Communications</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Every Personal Tax, Accounts, and Corporation Tax item ever sent for client approval.
        </p>

        <div className="mt-4 flex gap-6">
          <span className="text-sm text-slate-600"><span className="font-bold text-blue-600">{sentCount}</span> awaiting response</span>
          <span className="text-sm text-slate-600"><span className="font-bold text-green-600">{approvedCount}</span> approved</span>
          <span className="text-sm text-slate-600"><span className="font-bold text-yellow-600">{queriedCount}</span> queried</span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <a href="/communications" className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${!statusFilter ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>All statuses</a>
          <a href="/communications?status=Sent" className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${statusFilter === "Sent" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>Sent</a>
          <a href="/communications?status=Approved" className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${statusFilter === "Approved" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>Approved</a>
          <a href="/communications?status=Queried" className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${statusFilter === "Queried" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>Queried</a>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <a href={statusFilter ? `/communications?status=${statusFilter}` : "/communications"} className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${!typeFilter ? "bg-slate-700 text-white" : "bg-slate-50 text-slate-500 hover:bg-slate-100 border border-slate-200"}`}>All types</a>
          {["Personal Tax", "Accounts", "Corporation Tax"].map((t) => (
            <a key={t} href={`/communications?type=${encodeURIComponent(t)}${statusFilter ? `&status=${statusFilter}` : ""}`}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${typeFilter === t ? "bg-slate-700 text-white" : "bg-slate-50 text-slate-500 hover:bg-slate-100 border border-slate-200"}`}>
              {t}
            </a>
          ))}
        </div>
      </div>

      <div className="p-8 space-y-6">

        {needsChasing.length > 0 && (
          <div className="rounded-2xl bg-orange-50 border border-orange-200 p-4">
            <p className="text-sm font-bold text-orange-700">⚠ {needsChasing.length} item{needsChasing.length !== 1 ? "s" : ""} awaiting response for a week or more</p>
            <div className="mt-2 space-y-1">
              {needsChasing.map((e) => (
                <a key={e.key} href={e.href} className="block text-xs text-orange-600 hover:underline">
                  {e.client_name} — {e.label} ({e.daysSinceSent} days)
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">All Communications ({filtered.length})</h2>
          <div className="mt-4 space-y-2">
            {filtered.map((e) => (
              <a key={e.key} href={e.href}
                className="flex items-center justify-between rounded-xl border border-slate-100 p-4 hover:bg-slate-50 transition-colors">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-slate-900">{e.client_name}</p>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{e.type}</span>
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5">{e.label}</p>
                  {e.client_email && <p className="text-xs text-slate-400 mt-0.5">{e.client_email}</p>}
                </div>
                <div className="text-right">
                  <span className={`rounded-full px-3 py-1 text-xs font-bold ${
                    e.status === "Approved" ? "bg-green-100 text-green-700"
                    : e.status === "Queried" ? "bg-yellow-100 text-yellow-700"
                    : "bg-blue-100 text-blue-700"
                  }`}>
                    {e.status}
                  </span>
                  {e.respondedDate && (
                    <p className="text-xs text-slate-400 mt-1">{fmtDateTime(e.respondedDate)}</p>
                  )}
                  {!e.respondedDate && e.daysSinceSent !== null && (
                    <p className="text-xs text-slate-400 mt-1">{e.daysSinceSent} days ago</p>
                  )}
                </div>
              </a>
            ))}
            {filtered.length === 0 && (
              <p className="text-sm text-slate-500 text-center py-8">No communications match this filter.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
