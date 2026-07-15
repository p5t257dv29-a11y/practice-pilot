import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import fs from "fs";
import path from "path";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const eventId = request.nextUrl.searchParams.get("event_id");
  if (!eventId) {
    return NextResponse.json({ error: "Missing event_id" }, { status: 400 });
  }

  const { data: event, error } = await supabase
    .from("company_secretarial_events")
    .select("*, clients(client_name, company_number)")
    .eq("id", eventId)
    .single();

  if (error || !event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }
  if (event.event_type !== "Shares Allotted") {
    return NextResponse.json({ error: "SH01 only applies to Shares Allotted events" }, { status: 400 });
  }

  const client = event.clients as any;

  // Full current shareholder list, for the Statement of Capital section — grouped
  // by class, since SH01 reports totals per share class, not per individual holder
  const { data: holdings } = await supabase
    .from("company_shareholdings")
    .select("*")
    .eq("client_id", event.client_id);

  const byClass = new Map<string, number>();
  (holdings || []).forEach((h) => {
    const cls = h.share_class || "Ordinary";
    byClass.set(cls, (byClass.get(cls) || 0) + Number(h.num_shares));
  });
  const classRows = Array.from(byClass.entries()); // [ [class, totalShares], ... ]
  const totalSharesInIssue = classRows.reduce((s, [, n]) => s + n, 0);

  // Load the template
  const templatePath = path.join(process.cwd(), "public", "forms", "SH01.pdf");
  const templateBytes = fs.readFileSync(templatePath);
  const pdfDoc = await PDFDocument.load(templateBytes);
  const form = pdfDoc.getForm();

  const setField = (fieldName: string, value: string) => {
    try {
      form.getTextField(fieldName).setText(value);
    } catch {
      // Field doesn't exist on this template version — skip rather than crash
    }
  };

  // Section 1 — Company details
  const companyNumber = (client?.company_number || "").padStart(8, "0").slice(0, 8);
  const numberFieldIds = ["Company number 3", "Company number 4", "Company number 5", "Company number 6", "Company number 7", "Company number 8", "Company number 9", "Company number 10"];
  companyNumber.split("").forEach((digit, i) => setField(numberFieldIds[i], digit));
  setField("Company name 3", client?.client_name || "");

  // Section 2 — Allotment date (From Date only, per the form's own guidance for
  // shares allotted on a single day)
  const eventDate = new Date(event.event_date);
  const dd = String(eventDate.getDate()).padStart(2, "0");
  const mm = String(eventDate.getMonth() + 1).padStart(2, "0");
  const yyyy = String(eventDate.getFullYear());
  setField("Allotment day", dd[0]);
  setField("Allotment day 1", dd[1]);
  setField("Allotment month", mm[0]);
  setField("Allotment month 1", mm[1]);
  setField("Allotment year", yyyy[0]);
  setField("Allotment year 1", yyyy[1]);
  setField("Allotment year 2", yyyy[2]);
  setField("Allotment year 3", yyyy[3]);

  // Section 3 — Shares allotted (this specific allotment)
  setField("currency", "GBP");
  setField("Class of shares", event.share_class || "Ordinary");
  setField("Number of shares allotted", String(event.number_of_shares || ""));
  if (event.price_per_share) {
    setField("Amount paid", `£${Number(event.price_per_share).toFixed(2)}`);
  }
  // Nominal value and amount unpaid deliberately left blank — not tracked by PracticePilot

  // Section 4 — Statement of capital (Currency Table A, page 2), one row per share class
  const classFieldSets = [
    { currency: "currency 6", cls: "Class of shares 71", num: "Number of shares 4" },
    { currency: "currency 7", cls: "Class of shares 74", num: "Number of shares 5" },
    { currency: "currency 8", cls: "Class of shares 77", num: "Number of shares 6" },
  ];
  classRows.slice(0, 3).forEach(([cls, num], i) => {
    setField(classFieldSets[i].currency, "GBP");
    setField(classFieldSets[i].cls, cls);
    setField(classFieldSets[i].num, String(num));
  });
  setField("Total number of shares 4", String(totalSharesInIssue));

  // Total issued share capital table
  setField("Total number of shares", String(totalSharesInIssue));

  // Presenter information
  setField("Presenter information contact name 3", "E&P Accountancy Services Limited");
  setField("Presenter information company name 3", "E&P Accountancy Services Limited");

  const pdfBytes = await pdfDoc.save();

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="SH01-${(client?.client_name || "company").replace(/[^a-z0-9]/gi, "-")}.pdf"`,
    },
  });
}
