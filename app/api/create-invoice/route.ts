import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  const {
    clientId, jobId, lines, subtotal, vat, total, dueDate,
    splitRecurring, numInstalments, frequency, firstDueDate,
  } = await request.json();

  if (!clientId || !lines || lines.length === 0) {
    return NextResponse.json({ error: "Missing client or line items" }, { status: 400 });
  }

  // Split into N recurring instalment invoices
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
          job_id: jobId || null,
          quote_id: null,
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
        description: `Instalment ${i + 1} of ${numInstalments}`,
        qty: 1,
        price: instalmentTotal - instalmentVat,
        vat_rate: instalmentSubtotal > 0 ? Math.round((instalmentVat / instalmentSubtotal) * 100) : 0,
        line_total: instalmentSubtotal,
      });

      createdInvoiceIds.push(invoice.id);
    }

    return NextResponse.json({ success: true, invoiceIds: createdInvoiceIds });
  }

  // Single invoice
  const { count } = await supabase.from("invoices").select("*", { count: "exact", head: true });
  const invoiceNumber = `INV-${String((count || 0) + 1).padStart(4, "0")}`;

  const { data: invoice, error } = await supabase
    .from("invoices")
    .insert({
      invoice_number: invoiceNumber,
      client_id: clientId,
      job_id: jobId || null,
      quote_id: null,
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

  await supabase.from("invoice_lines").insert(
    lines.map((l: any) => ({
      invoice_id: invoice.id,
      job_id: l.job_id || null,
      description: l.description,
      qty: l.qty,
      price: l.price,
      vat_rate: l.vat_rate,
      line_total: l.qty * l.price,
    }))
  );

  return NextResponse.json({ success: true, invoiceId: invoice.id });
}
