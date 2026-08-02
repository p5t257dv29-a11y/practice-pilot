import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function verifySignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  const hmac = crypto
    .createHmac("sha256", process.env.XERO_WEBHOOK_KEY!)
    .update(rawBody)
    .digest("base64");
  return hmac === signature;
}

async function getValidAccessToken() {
  const { data: connection } = await supabase
    .from("xero_connections")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!connection) return null;

  const expiresAt = new Date(connection.expires_at).getTime();
  const now = Date.now();

  if (expiresAt - now < 60000) {
    const basicAuth = Buffer.from(
      `${process.env.XERO_CLIENT_ID}:${process.env.XERO_CLIENT_SECRET}`
    ).toString("base64");

    const refreshRes = await fetch("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: connection.refresh_token,
      }),
    });

    if (!refreshRes.ok) return null;

    const refreshData = await refreshRes.json();
    const newExpiresAt = new Date(Date.now() + refreshData.expires_in * 1000).toISOString();

    await supabase
      .from("xero_connections")
      .update({
        access_token: refreshData.access_token,
        refresh_token: refreshData.refresh_token,
        expires_at: newExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", connection.tenant_id);

    return { accessToken: refreshData.access_token, tenantId: connection.tenant_id };
  }

  return { accessToken: connection.access_token, tenantId: connection.tenant_id };
}

async function processInvoiceEvent(xeroInvoiceId: string) {
  const auth = await getValidAccessToken();
  if (!auth) {
    console.error("Xero webhook: no valid connection to process invoice event.");
    return;
  }

  const res = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${xeroInvoiceId}`, {
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      "Xero-tenant-id": auth.tenantId,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    console.error("Xero webhook: could not fetch invoice", xeroInvoiceId, await res.text());
    return;
  }

  const data = await res.json();
  const invoice = data.Invoices?.[0];
  if (!invoice) return;

  if (invoice.Status === "PAID" || invoice.AmountDue === 0) {
    const { error } = await supabase
      .from("invoices")
      .update({
        status: "Paid",
        paid_at: new Date().toISOString(),
      })
      .eq("xero_invoice_id", xeroInvoiceId)
      .neq("status", "Paid");

    if (error) {
      console.error("Xero webhook: failed to update invoice as paid:", error.message);
    } else {
      console.log(`Xero webhook: marked invoice ${xeroInvoiceId} as Paid.`);
    }
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-xero-signature");

  // Xero performs an "intent to receive" check with an empty/test payload when
  // the webhook is first saved, and expects a 200 with a valid signature to pass.
  if (!verifySignature(rawBody, signature)) {
    console.error("Xero webhook: signature verification failed.");
    return new NextResponse(null, { status: 401 });
  }

  // Respond immediately — Xero requires a response within 5 seconds.
  // Process events after responding so a slow Xero API call doesn't cause a timeout.
  const response = new NextResponse(null, { status: 200 });

try {
    const body = JSON.parse(rawBody);
    console.log("Xero webhook payload:", JSON.stringify(body));
    const events = body.events || [];
    for (const event of events) {
      if (event.eventCategory === "INVOICE" && event.eventType === "UPDATE") {
        processInvoiceEvent(event.resourceId).catch((err) =>
          console.error("Xero webhook: error processing invoice event:", err)
        );
      }
    }
  } catch (err) {
    console.error("Xero webhook: error parsing payload:", err);
  }

  return response;
}