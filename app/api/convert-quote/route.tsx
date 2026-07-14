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
  const {
    quoteId, clientId, jobId, createJobs, dueDate, subtotal, vat, total,
    splitRecurring, numInstalments, frequency, firstDueDate,
  } = await request.json();

  if (!quoteId || !clientId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Get quote lines to copy to invoice — include the linked service (if any) so
  // job creation can use its real Job Type Link rather than guessing from text
  const { data: quoteLines } = await supabase
    .from("quote_lines")
    .select("*, services(job_template)")
    .eq("quote_id", quoteId);

  const { data: quote } = await supabase.from("quotes").select("quote_number").eq("id", quoteId).single();

  // Optionally create a job for each quote line item
  let createdJobId: string | null = jobId || null;
  let createdJobCount = 0;
  let jobIdsByLineIndex: (string | null)[] = quoteLines ? quoteLines.map(() => jobId || null) : [];

  if (createJobs && quoteLines && quoteLines.length > 0) {
    const { data: newJobs, error: jobsError } = await supabase
      .from("jobs")
      .insert(
        quoteLines.map((line) => ({
          client_id: clientId,
          job_name: line.description,
          job_type: (line.services as any)?.job_template || guessJobType(line.description),
          status: "Draft",
          workflow_stage: "Not Started",
          due_date: dueDate || firstDueDate || null,
        }))
      )
      .select();

    if (jobsError) {
      console.error("Could not create jobs from quote lines:", jobsError.message);
    } else if (newJobs && newJobs.length > 0) {
      createdJobCount = newJobs.length;
      // Supabase returns inserted rows in the same order they were submitted,
      // so each new job lines up with the quote line that created it
      jobIdsByLineIndex = newJobs.map((j) => j.id);
      // Link the invoice to the first created job for WIP reporting purposes —
      // an invoice can only reference one job, but all jobs are still created
      createdJobId = newJobs[0].id;
    }
  }

  // Split into N recurring instalment invoices instead of one lump sum
  if (splitRecurring && numInstalments && numInstalments >= 2) {
    const { count } = await supabase.from("invoices").select("*", { count: "exact", head: true });
    let nextNumber = (count || 0) + 1;

    const rawInstalment = Math.round((total / numInstalments) * 100) / 100;
    const rawSubtotal = Math.round((subtotal / numInstalments) * 100) / 100;
    const rawVat = Math.round((vat / numInstalments) * 100) / 100;

    const startDate = firstDueDate ? new Date(firstDueDate) : new Date();
    const createdInvoiceIds: string[] = [];

    for (let i = 0; i < numInstalments; i++) {
      const isLast = i === numInstalments - 1;
      // Last instalment absorbs any rounding remainder so the total matches exactly
      const instalmentTotal = isLast ? Math.round((total - rawInstalment * (numInstalments - 1)) * 100) / 100 : rawInstalment;
      const instalmentSubtotal = isLast ? Math.round((subtotal - rawSubtotal * (numInstalments - 1)) * 100) / 100 : rawSubtotal;
      const instalmentVat = isLast ? Math.round((vat - rawVat * (numInstalments - 1)) * 100) / 100 : rawVat;

      const instalmentDueDate = new Date(startDate);
      if (frequency === "Weekly") instalmentDueDate.setDate(instalmentDueDate.getDate() + i * 7);
      else if (frequency === "Quarterly") instalmentDueDate.setMonth(instalmentDueDate.getMonth() + i * 3);
      else instalmentDueDate.setMonth(instalmentDueDate.getMonth() + i);

      const invoiceNumber = `INV-${String(nextNumber).padStart(4, "0")}`;
      nextNumber++;

      const { data: invoice, error } = await supabase
        .from("invoices")
        .insert({
          invoice_number: invoiceNumber,
          client_id: clientId,
          job_id: createdJobId,
          quote_id: quoteId,
          status: "Draft",
          invoice_date: new Date().toISOString().split("T")[0],
          due_date: instalmentDueDate.toISOString().split("T")[0],
          subtotal: instalmentSubtotal,
          vat: instalmentVat,
          total: instalmentTotal,
        })
        .select()
        .single();

      if (error || !invoice) {
        return NextResponse.json({ error: error?.message || "Failed to create instalment invoices" }, { status: 500 });
      }

      await supabase.from("invoice_lines").insert({
        invoice_id: invoice.id,
        description: `Instalment ${i + 1} of ${numInstalments} — ${quote?.quote_number || "Quote"}`,
        qty: 1,
        price: instalmentTotal - instalmentVat,
        vat_rate: instalmentSubtotal > 0 ? Math.round((instalmentVat / instalmentSubtotal) * 100) : 0,
        line_total: instalmentSubtotal,
      });

      createdInvoiceIds.push(invoice.id);
    }

    await supabase.from("quotes").update({ status: "Accepted" }).eq("id", quoteId);

    return NextResponse.json({ success: true, invoiceIds: createdInvoiceIds, jobsCreated: createdJobCount });
  }

  // Create invoice
  const { count: singleCount } = await supabase.from("invoices").select("*", { count: "exact", head: true });
  const invoiceNumber = `INV-${String((singleCount || 0) + 1).padStart(4, "0")}`;

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

  // Copy quote lines to invoice lines, each carrying its own job_id
  if (quoteLines && quoteLines.length > 0) {
    await supabase.from("invoice_lines").insert(
      quoteLines.map((line, i) => ({
        invoice_id: invoice.id,
        job_id: jobIdsByLineIndex[i] || null,
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
