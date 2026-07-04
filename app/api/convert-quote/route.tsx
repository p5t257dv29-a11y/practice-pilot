import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const { quoteId, clientId, jobId, dueDate, subtotal, vat, total } = await request.json();

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

  // Create invoice
  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      invoice_number: invoiceNumber,
      client_id: clientId,
      job_id: jobId || null,
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

  return NextResponse.json({ success: true, invoiceId: invoice.id });
}
