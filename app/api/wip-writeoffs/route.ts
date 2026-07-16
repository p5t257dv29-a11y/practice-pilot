import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ALLOWED_CATEGORIES = [
  "Fee dispute",
  "Client insolvency / gone away",
  "Scope creep / goodwill",
  "Abortive work",
  "Fixed fee overrun",
  "Other",
];

export async function POST(request: Request) {
  const body = await request.json();
  const { jobId, amount, reasonCategory, notes } = body;

  if (!jobId || typeof jobId !== "string") {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  const parsedAmount = Number(amount);
  if (!parsedAmount || parsedAmount <= 0 || Number.isNaN(parsedAmount)) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }

  if (!ALLOWED_CATEGORIES.includes(reasonCategory)) {
    return NextResponse.json({ error: "Invalid reason category" }, { status: 400 });
  }

  // Recompute current WIP for this job server-side so the cap can't be
  // bypassed by tampering with the client-side form.
  const [
    { data: entries, error: entriesError },
    { data: invoices, error: invoicesError },
    { data: existingWriteoffs, error: writeoffsError },
  ] = await Promise.all([
    supabase.from("time_entries").select("hours, billable, hourly_rate").eq("job_id", jobId),
    supabase.from("invoices").select("subtotal").eq("job_id", jobId),
    supabase.from("wip_writeoffs").select("amount").eq("job_id", jobId),
  ]);

  if (entriesError || invoicesError || writeoffsError) {
    return NextResponse.json({ error: "Failed to load job data" }, { status: 500 });
  }

  const chargeOutValue = (entries || [])
    .filter((e) => e.billable)
    .reduce((sum, e) => sum + Number(e.hours) * Number(e.hourly_rate), 0);

  const invoicedAmount = (invoices || []).reduce((sum, i) => sum + Number(i.subtotal || 0), 0);

  const alreadyWrittenOff = (existingWriteoffs || []).reduce((sum, w) => sum + Number(w.amount), 0);

  const currentWip = Math.max(chargeOutValue - invoicedAmount - alreadyWrittenOff, 0);

  if (parsedAmount > currentWip) {
    return NextResponse.json(
      { error: `Write-off amount (£${parsedAmount.toFixed(2)}) exceeds current WIP balance (£${currentWip.toFixed(2)})` },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("wip_writeoffs")
    .insert({
      job_id: jobId,
      amount: parsedAmount,
      reason_category: reasonCategory,
      notes: notes || null,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: "Failed to record write-off" }, { status: 500 });
  }

  return NextResponse.json({ writeoff: data, remainingWip: currentWip - parsedAmount });
}
