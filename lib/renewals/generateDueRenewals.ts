import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return toIsoDate(dt);
}

function addOneFinancialYearEnd(newStartStr: string): string {
  const [y, m, d] = newStartStr.split("-").map(Number);
  // e.g. 2027-04-01 -> 2028-03-31 (or 2028-03-01 -> 2029-02-28)
  const dt = new Date(Date.UTC(y + 1, m - 1, d - 1));
  return toIsoDate(dt);
}

function incrementYearLabel(text: string): string {
  return text.replace(/\b(20\d\d)\b/g, (yr) => String(Number(yr) + 1));
}

async function syncRenewalEngagementLetter(quoteId: string) {
  const [{ data: lines }, { data: quote }] = await Promise.all([
    supabase.from("quote_lines").select("*").eq("quote_id", quoteId),
    supabase.from("quotes").select("subtotal, vat, total").eq("id", quoteId).single(),
  ]);

  if (!quote) return;

  const servicesDescription = (lines || []).map((l) => l.description).join("\n");
  const fmt = (n: number) =>
    Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const feeDescription =
    `Subtotal: £${fmt(Number(quote.subtotal || 0))}\n` +
    `VAT: £${fmt(Number(quote.vat || 0))}\n` +
    `Total: £${fmt(Number(quote.total || 0))}`;

  await supabase
    .from("engagement_letters")
    .update({
      services_description: servicesDescription,
      fee_description: feeDescription,
    })
    .eq("quote_id", quoteId);
}

export async function generateDueRenewalDrafts(asOfDate = toIsoDate(new Date())) {
  const { data: clients, error: clientsError } = await supabase
    .from("clients")
    .select("id, client_name, year_end, onboarding_status")
    .eq("onboarding_status", "Active Client")
    .not("year_end", "is", null);

  if (clientsError) {
    throw new Error(`Could not load clients: ${clientsError.message}`);
  }

  const createdQuoteIds: string[] = [];

  for (const client of clients || []) {
    if (!client.year_end) continue;

    // Renewal triggers the day after the client's year_end
    const renewalStartDate = addDays(client.year_end, 1);
    if (renewalStartDate !== asOfDate) continue;

    const nextYearEnd = addOneFinancialYearEnd(renewalStartDate);

    // Idempotency guard: skip if a renewal quote already exists for this client & start date
    const { data: existingRenewal } = await supabase
      .from("quotes")
      .select("id")
      .eq("client_id", client.id)
      .eq("quote_date", renewalStartDate)
      .limit(1);

    if (existingRenewal && existingRenewal.length > 0) {
      continue;
    }

    // Find the client's latest accepted quote to carry forward ongoing lines
    const { data: sourceQuotes } = await supabase
      .from("quotes")
      .select("*, quote_lines(*)")
      .eq("client_id", client.id)
      .eq("status", "Accepted")
      .order("created_at", { ascending: false })
      .limit(1);

    const sourceQuote = sourceQuotes?.[0];
    if (!sourceQuote) continue;

    const renewableLines = (sourceQuote.quote_lines || []).filter(
      (line: any) => line.include_in_renewal !== false
    );

    if (renewableLines.length === 0) continue;

    const preparedLines = renewableLines.map((line: any) => {
      const qty = Number(line.qty) || 1;
      const price = Number(line.price) || 0;
      const vatRate = Number(line.vat_rate ?? 20);
      const lineTotal = qty * price;
      return {
        service_id: line.service_id || null,
        description: incrementYearLabel(line.description || "Recurring Service"),
        qty,
        price,
        vat_rate: vatRate,
        line_total: lineTotal,
        include_in_renewal: true,
      };
    });

    const subtotal = preparedLines.reduce(
  (sum: number, l: { line_total: number }) => sum + l.line_total,
  0
);
const vat = preparedLines.reduce(
  (sum: number, l: { line_total: number; vat_rate: number }) =>
    sum + (l.line_total * l.vat_rate) / 100,
  0
);
const total = subtotal + vat;

const quoteNumber = `REN-${renewalStartDate.replace(/-/g, "")}-${crypto
  .randomBytes(2)
  .toString("hex")
  .toUpperCase()}`;
const token = crypto.randomBytes(24).toString("hex");

const { data: newQuote, error: quoteError } = await supabase
  .from("quotes")
  .insert({
    client_id: client.id,
    quote_number: quoteNumber,
    status: "Draft",
    quote_date: renewalStartDate,
    valid_until: nextYearEnd,
    subtotal,
    vat,
    total,
    token,
    notes: `Auto-generated annual renewal for period ending ${nextYearEnd}`,
  })
  .select("id")
  .single();

if (quoteError || !newQuote) {
  throw new Error(`Could not create renewal quote for ${client.client_name}: ${quoteError?.message}`);
}

const { error: linesError } = await supabase.from("quote_lines").insert(
  preparedLines.map(
    (l: {
      service_id: string | null;
      description: string;
      qty: number;
      price: number;
      vat_rate: number;
      line_total: number;
      include_in_renewal: boolean;
    }) => ({
      ...l,
      quote_id: newQuote.id,
    })
  )
);
    

    if (linesError) {
      throw new Error(`Could not insert renewal quote lines for ${newQuote.id}: ${linesError.message}`);
    }

    await supabase.from("engagement_letters").insert({
      quote_id: newQuote.id,
      status: "Draft",
      start_date: renewalStartDate,
    });

    await syncRenewalEngagementLetter(newQuote.id);
    createdQuoteIds.push(newQuote.id);
  }

  return {
    runDate: asOfDate,
    createdCount: createdQuoteIds.length,
    createdQuoteIds,
  };
}