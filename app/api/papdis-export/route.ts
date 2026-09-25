import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function csvEscape(value: any): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function splitName(fullName: string): { forename: string; surname: string } {
  const parts = (fullName || "").trim().split(/\s+/);
  if (parts.length === 0) return { forename: "", surname: "" };
  if (parts.length === 1) return { forename: parts[0], surname: "" };
  const surname = parts[parts.length - 1];
  const forename = parts.slice(0, -1).join(" ");
  return { forename, surname };
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "";
  // PAPDIS / NEST template expects DD/MM/YYYY
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return "";
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = dt.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const browseClientId = searchParams.get("browseClient");
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");

  if (!browseClientId) {
    return new Response("Missing browseClient parameter", { status: 400 });
  }

  const today = new Date();
  const taxYearStart = today.getMonth() < 3 || (today.getMonth() === 3 && today.getDate() < 6)
    ? `${today.getFullYear() - 1}-04-06`
    : `${today.getFullYear()}-04-06`;
  const effectiveFrom = dateFrom || taxYearStart;
  const effectiveTo = dateTo || today.toISOString().split("T")[0];

  const { data: client } = await supabase
    .from("clients")
    .select("client_name, paye_reference")
    .eq("id", browseClientId)
    .single();

  const { data: runsData } = await supabase
    .from("payroll_runs")
    .select("*, payroll_employees(name, ni_number, date_of_birth, gender, address, email, pension_scheme_name, employee_pension_rate, employer_pension_rate, pension_opted_out, start_date)")
    .eq("client_id", browseClientId)
    .gte("payment_date", effectiveFrom)
    .lte("payment_date", effectiveTo)
    .order("payment_date", { ascending: true });

  const runs = runsData || [];

  const byEmployee = new Map<string, any>();
  runs.forEach((r: any) => {
    const key = r.employee_id;
    const emp = r.payroll_employees;
    if (!byEmployee.has(key)) {
      byEmployee.set(key, {
        name: emp?.name || "Unknown",
        niNumber: emp?.ni_number || "",
        dob: emp?.date_of_birth || "",
        gender: emp?.gender || "",
        address: emp?.address || "",
        email: emp?.email || "",
        schemeName: emp?.pension_scheme_name || "",
        optedOut: emp?.pension_opted_out || false,
        startDate: emp?.start_date || "",
        pensionableEarnings: 0,
        employeeContribution: 0,
        employerContribution: 0,
      });
    }
    const entry = byEmployee.get(key);
    entry.pensionableEarnings += Number(r.gross_pay || 0);
    entry.employeeContribution += Number(r.employee_pension || 0);
    entry.employerContribution += Number(r.employer_pension || 0);
  });

  const rows = Array.from(byEmployee.values())
    .filter((e) => !e.optedOut && (e.employeeContribution > 0 || e.employerContribution > 0))
    .sort((a, b) => a.name.localeCompare(b.name));

  const headers = [
    "Employer PAYE Reference",
    "Pension Scheme Reference",
    "Payroll ID",
    "Title",
    "Forename",
    "Surname",
    "Gender",
    "Date of Birth",
    "NI Number",
    "Address Line 1",
    "Postcode",
    "Email Address",
    "Pay Reference Period Start Date",
    "Pay Reference Period End Date",
    "Payment Due Date",
    "Contribution Frequency",
    "Pensionable Earnings",
    "Employee Contribution Amount",
    "Employer Contribution Amount",
    "AVC Amount",
    "Joiner Flag",
  ];

  const lines = [headers.map(csvEscape).join(",")];

  rows.forEach((r) => {
    const { forename, surname } = splitName(r.name);
    const line = [
      client?.paye_reference || "",
      r.schemeName,
      "",
      "",
      forename,
      surname,
      r.gender,
      fmtDate(r.dob),
      r.niNumber,
      r.address,
      "",
      r.email,
      fmtDate(effectiveFrom),
      fmtDate(effectiveTo),
      fmtDate(effectiveTo),
      "Monthly",
      r.pensionableEarnings.toFixed(2),
      r.employeeContribution.toFixed(2),
      r.employerContribution.toFixed(2),
      "0.00",
      "N",
    ];
    lines.push(line.map(csvEscape).join(","));
  });

  const csv = lines.join("\r\n");
  const clientNameSlug = (client?.client_name || "client").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const filename = `papdis-${clientNameSlug}-${effectiveFrom}-to-${effectiveTo}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}