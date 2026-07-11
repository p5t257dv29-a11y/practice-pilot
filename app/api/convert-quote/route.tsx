import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Simple keyword match against the standard job types, so auto-created jobs
// start with a sensible type instead of always landing on "blank"
function guessJobType(description: string): string | null {
  const d = description.toLowerCase();
  if (d.includes("vat")) return "VAT Return";
  if (d.includes("payroll")) return "Payroll";
  if (d.includes("self assessment") || d.includes("sa100") || d.includes("personal tax")) return "Self Assessment";
  if (d.includes("corporation tax") || d.includes("ct600")) return "Corporation Tax Return";
  if (d.includes("confirmation statement") || d.includes("companies house")) return "Companies House Filing";
  if (d.includes("management account")) return "Management Accounts";
  if (d.includes("bookkeeping") || d.includes("book-keeping")) return "Bookkeeping";
  if (d.includes("year end") || d.includes("annual account") || d.includes("statutory account")) return "Year End Accounts";
  return null;
}

export async function POST(request: NextRequest) {
  const { quoteId, clientId, jobId, createJobs, dueDate, subtotal, vat, total } = await request.json();

  if (!quoteId || !clientId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Generate invoice number
  const { count } = await supabase
    .from("invoices")
    .select("*", { count: "exact", head: true });

  const invoiceNumber = `INV-${String((count || 0) + 1).padStart(4, "0")}`;

  // Get quote lines to copy to invoice
  const { data: quoteLines } = await supabase
    .from("quote_lines")
    .select("*")
    .eq("quote_id", quoteId);

  // Optionally create a job for each quote line item
  let createdJobId: string | null = jobId || null;
  let createdJobCount = 0;

  if (createJobs && quoteLines && quoteLines.length > 0) {
    const { data: newJobs, error: jobsError } = await supabase
      .from("jobs")
      .insert(
        quoteLines.map((line) => ({
          client_id: clientId,
          job_name: line.description,
          job_type: guessJobType(line.description),
          status: "Draft",
          workflow_stage: "Not Started",
          due_date: dueDate || null,
        }))
      )
      .select();

    if (jobsError) {
      console.error("Could not create jobs from quote lines:", jobsError.message);
    } else if (newJobs && newJobs.length > 0) {
      createdJobCount = newJobs.length;
      // Link the invoice to the first created job for WIP reporting purposes —
      // an invoice can only reference one job, but all jobs are still created
      createdJobId = newJobs[0].id;
    }
  }

  // Create invoice
  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      invoice_number: invoiceNumber,
      client_id: clientId,
      job_id: createdJobId,
      quote_id: quoteId,
      status: "Draft",
      invoice_date: new Date().toISOString().split("T")[0],
      due_date: dueDate || null,
      subtotal,
      vat,
      total,
    })
    .select()
    .single();

  if (error || !invoice) {
    return NextResponse.json({ error: error?.message || "Failed to create invoice" }, { status: 500 });
  }

  // Copy quote lines to invoice lines
  if (quoteLines && quoteLines.length > 0) {
    await supabase.from("invoice_lines").insert(
      quoteLines.map((line) => ({
        invoice_id: invoice.id,
        description: line.description,
        qty: line.qty,
        price: line.price,
        vat_rate: line.vat_rate,
        line_total: line.line_total,
      }))
    );
  }

  // Update quote status to invoiced
  await supabase
    .from("quotes")
    .update({ status: "Accepted" })
    .eq("id", quoteId);

  return NextResponse.json({ success: true, invoiceId: invoice.id, jobsCreated: createdJobCount });
}
