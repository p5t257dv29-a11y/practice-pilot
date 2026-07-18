import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  const body = await request.json();
  const { clientId, lines, subtotal, vat, total, quoteDate, validUntil, notes } = body;

  if (!clientId || !Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json({ error: "Client and at least one line item are required." }, { status: 400 });
  }

  // Same quote number sequence logic used elsewhere
  const { data: allQuotes } = await supabase.from("quotes").select("quote_number");
  let highest = 4; // sequence starts at Q-0005
  for (const q of allQuotes || []) {
    const match = q.quote_number?.match(/Q-(\d+)/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (match[1].length <= 4 && num > highest) highest = num;
    }
  }
  const quoteNumber = `Q-${String(highest + 1).padStart(4, "0")}`;

  const { data: newQuote, error: quoteError } = await supabase
    .from("quotes")
    .insert({
      quote_number: quoteNumber,
      client_id: clientId,
      quote_date: quoteDate || null,
      valid_until: validUntil || null,
      status: "Draft",
      notes: notes || "",
      subtotal,
      vat,
      total,
    })
    .select()
    .single();

  if (quoteError || !newQuote) {
    return NextResponse.json({ error: quoteError?.message || "Could not create quote." }, { status: 500 });
  }

  const lineRows = lines.map((l: any) => ({
    quote_id: newQuote.id,
    service_id: l.service_id || null,
    description: l.description,
    qty: l.qty,
    price: l.price,
    vat_rate: l.vat_rate,
    line_total: l.qty * l.price,
  }));

  const { error: linesError } = await supabase.from("quote_lines").insert(lineRows);
  if (linesError) {
    console.error("Could not insert quote lines:", linesError.message);
  }

  // Create the linked engagement letter, pre-filled with the same services/fee
  // summary the detail page's syncEngagementLetter keeps in sync afterward
  const { data: client } = await supabase.from("clients").select("email").eq("id", clientId).single();

  const servicesDescription = lines.map((l: any) => l.description).join("\n");
  const feeDescription =
    `Subtotal: £${Number(subtotal).toFixed(2)}\n` +
    `VAT: £${Number(vat).toFixed(2)}\n` +
    `Total: £${Number(total).toFixed(2)}`;

  const { error: elError } = await supabase.from("engagement_letters").insert({
    client_id: clientId,
    quote_id: newQuote.id,
    client_email: client?.email || null,
    status: "Draft",
    services_description: servicesDescription,
    fee_description: feeDescription,
  });

  if (elError) {
    console.error("Could not create linked engagement letter:", elError.message);
  }

  return NextResponse.json({ quoteId: newQuote.id });
}
