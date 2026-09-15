import { createClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function createComputation(formData: FormData) {
  "use server";
  const get = (key: string) => String(formData.get(key) || "").trim();

  const clientId = get("client_id");
  const employeeChoice = get("employee_choice");
  const manualName = get("employee_name_manual");
  const taxYear = get("tax_year") || "2026/27";

  if (!clientId || !employeeChoice) return;

  let employeeName = manualName;
  let employeeClientId: string | null = null;

  // If a real payroll employee was picked (rather than "Someone else"),
  // pull their name and — if they're already linked to their own Personal
  // Tax client record — carry that link across too, so this P11D
  // computation is properly connected to both sides from the start.
  if (employeeChoice !== "OTHER") {
    const { data: payrollEmployee } = await supabase
      .from("payroll_employees")
      .select("name, linked_client_id")
      .eq("id", employeeChoice)
      .single();
    if (payrollEmployee) {
      employeeName = payrollEmployee.name;
      employeeClientId = payrollEmployee.linked_client_id;
    }
  }

  if (!employeeName) return;

  const { data: newComp, error } = await supabase.from("p11d_computations").insert({
    client_id: clientId,
    employee_name: employeeName,
    employee_client_id: employeeClientId,
    tax_year: taxYear,
    car_list_price: 0,
    car_benefit_percentage: 0,
    car_capital_contribution: 0,
    car_available_days: 0,
    fuel_provided: false,
    fuel_benefit_multiplier: 0,
    van_provided: false,
    van_is_zero_emission: false,
    van_available_days: 0,
    van_employee_contribution: 0,
    van_fuel_provided: false,
    medical_premium: 0,
    medical_employee_contribution: 0,
    loan_balance: 0,
    loan_interest_paid: 0,
    official_rate_of_interest: 3.75,
    other_benefits_amount: 0,
  }).select().single();

  if (error || !newComp) {
    throw new Error(`Failed to create P11D computation: ${error?.message}`);
  }

  redirect(`/p11d/${newComp.id}`);
}

export default async function NewP11DPage({
  searchParams,
}: {
  searchParams: Promise<{ client_id?: string }>;
}) {
  const { client_id: selectedClientId } = await searchParams;

  const { data: clients } = await supabase
    .from("clients")
    .select("id, client_name")
    .order("client_name", { ascending: true });

  const { data: payrollEmployees } = selectedClientId
    ? await supabase
        .from("payroll_employees")
        .select("id, name, linked_client_id")
        .eq("client_id", selectedClientId)
        .eq("is_active", true)
        .order("name", { ascending: true })
    : { data: [] };

  const selectedClientName = (clients || []).find((c) => c.id === selectedClientId)?.client_name;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6">
        <a href="/p11d" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">← Back to P11D</a>
        <h1 className="text-2xl font-bold text-slate-900 mt-4">New P11D Computation</h1>
        <p className="text-sm text-slate-500 mt-0.5">Set up the client and employee, then add benefit detail on the next screen.</p>
      </div>

      <div className="p-8 max-w-2xl">
        <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">

          {/* Step 1 — pick the client, reload to see their payroll employees */}
          <form method="get" className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Client *</label>
              <select name="client_id" required defaultValue={selectedClientId || ""}
                className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                <option value="" disabled>Select a client</option>
                {(clients || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.client_name}</option>
                ))}
              </select>
            </div>
            {!selectedClientId && (
              <button type="submit"
                className="rounded-xl bg-slate-100 px-6 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-200 transition-colors">
                Continue →
              </button>
            )}
          </form>

          {/* Step 2 — employee (from payroll) + tax year + create */}
          {selectedClientId && (
            <>
              <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 p-3">
                <p className="text-sm text-slate-700">Client: <span className="font-bold">{selectedClientName}</span></p>
                <a href="/p11d/new" className="text-xs font-semibold text-blue-600 hover:underline">Change client</a>
              </div>

              <form action={createComputation} className="mt-6 space-y-4">
                <input type="hidden" name="client_id" value={selectedClientId} />

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Employee *</label>
                  <select name="employee_choice" required defaultValue=""
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="" disabled>Select an employee</option>
                    {(payrollEmployees || []).map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}{e.linked_client_id ? " (synced to Personal Tax)" : ""}
                      </option>
                    ))}
                    <option value="OTHER">Someone else (not in Payroll — type name below)</option>
                  </select>
                  {(!payrollEmployees || payrollEmployees.length === 0) && (
                    <p className="text-xs text-amber-700 mt-1">
                      No active payroll employees found for this client — set them up in Payroll first, or use "Someone else" below.
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Name (only needed if "Someone else" is selected above)
                  </label>
                  <input name="employee_name_manual" placeholder="Full name"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400" />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tax Year</label>
                  <select name="tax_year" defaultValue="2026/27"
                    className="w-full rounded-xl border border-slate-200 p-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-400">
                    <option value="2026/27">2026/27</option>
                  </select>
                </div>

                <button type="submit"
                  className="w-full rounded-xl bg-slate-900 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-700 transition-colors">
                  Create Computation →
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}