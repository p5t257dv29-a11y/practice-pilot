import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function getDaysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr);
  due.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function getUrgencyColor(days: number) {
  if (days < 0) return {
    bg: "bg-red-50",
    border: "border-red-200",
    badge: "bg-red-100 text-red-700",
    label: "Overdue",
    dot: "bg-red-500"
  };
  if (days <= 30) return {
    bg: "bg-orange-50",
    border: "border-orange-200",
    badge: "bg-orange-100 text-orange-700",
    label: `${days} days`,
    dot: "bg-orange-500"
  };
  if (days <= 90) return {
    bg: "bg-yellow-50",
    border: "border-yellow-200",
    badge: "bg-yellow-100 text-yellow-700",
    label: `${days} days`,
    dot: "bg-yellow-500"
  };
  return {
    bg: "bg-white",
    border: "border-slate-100",
    badge: "bg-green-100 text-green-700",
    label: `${days} days`,
    dot: "bg-green-500"
  };
}

export default async function DeadlinesPage() {
  const { data: clients, error } = await supabase
    .from("clients")
    .select("id, client_name, company_number, accounts_next_due, confirmation_statement_next_due, onboarding_status")
    .order("client_name", { ascending: true });

  if (error) {
    return (
      <div className="p-8">
        <p className="text-red-600">Could not load deadlines: {error.message}</p>
      </div>
    );
  }

  type DeadlineEntry = {
    client_id: string;
    client_name: string;
    company_number: string | null;
    type: string;
    due_date: string;
    days: number;
  };

  const deadlines: DeadlineEntry[] = [];

  (clients || []).forEach((client) => {
    if (client.accounts_next_due) {
      deadlines.push({
        client_id: client.id,
        client_name: client.client_name,
        company_number: client.company_number,
        type: "Accounts Filing",
        due_date: client.accounts_next_due,
        days: getDaysUntil(client.accounts_next_due),
      });
    }
    if (client.confirmation_statement_next_due) {
      deadlines.push({
        client_id: client.id,
        client_name: client.client_name,
        company_number: client.company_number,
        type: "Confirmation Statement",
        due_date: client.confirmation_statement_next_due,
        days: getDaysUntil(client.confirmation_statement_next_due),
      });
    }
  });

  deadlines.sort((a, b) => a.days - b.days);

  const overdue = deadlines.filter(d => d.days < 0);
  const dueSoon = deadlines.filter(d => d.days >= 0 && d.days <= 30);
  const upcoming = deadlines.filter(d => d.days > 30 && d.days <= 90);
  const future = deadlines.filter(d => d.days > 90);

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const renderList = (list: DeadlineEntry[]) => (
    <div className="space-y-2">
      {list.map((d, i) => {
        const urgency = getUrgencyColor(d.days);
        return (
          <a key={i} href={`/clients/${d.client_id}`}
            className={`flex items-center justify-between rounded-xl border ${urgency.border} ${urgency.bg} p-4 hover:opacity-80 transition-opacity`}>
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full ${urgency.dot}`}></div>
              <div>
                <p className="font-semibold text-slate-900">{d.client_name}</p>
                <p className="text-xs text-slate-500">
                  {d.company_number && `${d.company_number} · `}{d.type}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <p className="text-sm text-slate-600">
                {new Date(d.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </p>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${urgency.badge}`}>
                {d.days < 0 ? `${Math.abs(d.days)} days overdue` : urgency.label}
              </span>
            </div>
          </a>
        );
      })}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Deadlines</h1>
            <p className="text-sm text-slate-500 mt-0.5">{today}</p>
          </div>
        </div>

        {/* Summary stats — click to jump to and expand that section */}
        <div className="mt-4 flex gap-6">
          <a href="#overdue-section" className="flex items-center gap-2 hover:opacity-70 transition-opacity">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
            <span className="text-sm text-slate-600"><span className="font-bold text-red-600">{overdue.length}</span> overdue</span>
          </a>
          <a href="#due-soon-section" className="flex items-center gap-2 hover:opacity-70 transition-opacity">
            <div className="w-2.5 h-2.5 rounded-full bg-orange-500"></div>
            <span className="text-sm text-slate-600"><span className="font-bold text-orange-600">{dueSoon.length}</span> due within 30 days</span>
          </a>
          <a href="#upcoming-section" className="flex items-center gap-2 hover:opacity-70 transition-opacity">
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500"></div>
            <span className="text-sm text-slate-600"><span className="font-bold text-yellow-600">{upcoming.length}</span> due within 90 days</span>
          </a>
          <a href="#future-section" className="flex items-center gap-2 hover:opacity-70 transition-opacity">
            <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
            <span className="text-sm text-slate-600"><span className="font-bold text-green-600">{future.length}</span> future</span>
          </a>
        </div>
      </div>

      <div className="p-8 space-y-4">

        {deadlines.length === 0 && (
          <div className="rounded-2xl bg-white p-12 shadow-sm border border-slate-100 text-center">
            <p className="text-slate-500">No deadlines found.</p>
            <p className="text-sm text-slate-400 mt-1">
              Add clients via Companies House lookup to automatically populate filing deadlines.
            </p>
          </div>
        )}

        {/* Overdue — open by default */}
        {overdue.length > 0 && (
          <details id="overdue-section" open className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <summary className="text-base font-bold text-red-600 flex items-center gap-2 cursor-pointer list-none">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500"></div>
              Overdue ({overdue.length})
            </summary>
            <div className="mt-3">{renderList(overdue)}</div>
          </details>
        )}

        {/* Due within 30 days — open by default */}
        {dueSoon.length > 0 && (
          <details id="due-soon-section" open className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <summary className="text-base font-bold text-orange-600 flex items-center gap-2 cursor-pointer list-none">
              <div className="w-2.5 h-2.5 rounded-full bg-orange-500"></div>
              Due within 30 days ({dueSoon.length})
            </summary>
            <div className="mt-3">{renderList(dueSoon)}</div>
          </details>
        )}

        {/* Due within 90 days — collapsed by default */}
        {upcoming.length > 0 && (
          <details id="upcoming-section" className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <summary className="text-base font-bold text-yellow-600 flex items-center gap-2 cursor-pointer list-none">
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500"></div>
              Due within 90 days ({upcoming.length})
            </summary>
            <div className="mt-3">{renderList(upcoming)}</div>
          </details>
        )}

        {/* Future — collapsed by default */}
        {future.length > 0 && (
          <details id="future-section" className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
            <summary className="text-base font-bold text-green-600 flex items-center gap-2 cursor-pointer list-none">
              <div className="w-2.5 h-2.5 rounded-full bg-green-500"></div>
              Future ({future.length})
            </summary>
            <div className="mt-3">{renderList(future)}</div>
          </details>
        )}

      </div>
    </div>
  );
}
