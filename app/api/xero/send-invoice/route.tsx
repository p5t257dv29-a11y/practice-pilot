import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const DEFAULT_SALES_ACCOUNT_CODE = process.env.XERO_SALES_ACCOUNT_CODE || "200";

const JOB_TYPE_ACCOUNT_CODES: Record<string, string> = {
  "Year End Accounts": "201",
  "Corporation Tax Return": "202",
  "VAT Return": "203",
  "Payroll": "204",
  "Self Assessment": "205",
  "Bookkeeping": "206",
  "Management Accounts": "207",
  "Companies House Filing": "208",
  "Capital Gains Tax": "209",
  "Partnership Tax": "210",
  "P11D / Benefits in Kind": "211",
};

function accountCodeForJobType(jobType: string | null | undefined): string {
  if (!jobType) return DEFAULT_SALES_ACCOUNT_CODE;
  return JOB_TYPE_ACCOUNT_CODES[jobType] || DEFAULT_SALES_ACCOUNT_CODE;
}
async function getValidAccessToken() {
  const { data: connection } = await supabase
    .from("xero_connections")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!connection) {
    throw new Error("No Xero connection found. Connect to Xero from Integrations first.");
  }

  const expiresAt = new Date(connection.expires_at).getTime();
  const now = Date.now();

  // Refresh if the token expires within the next 60 seconds.
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

    if (!refreshRes.ok) {
      const errText = await refreshRes.text();
      throw new Error(`Could not refresh Xero token: ${errText}`);
    }

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

async function findOrCreateContact(
  accessToken: string,
  tenantId: string,
  clientId: string,
  clientName: string,
  existingXeroContactId: string | null,
  email: string | null
) {
  if (existingXeroContactId) {
    return existingXeroContactId;
  }

  const searchRes = await fetch(
    `https://api.xero.com/api.xro/2.0/Contacts?where=${encodeURIComponent(`Name=="${clientName}"`)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        Accept: "application/json",
      },
    }
  );

  if (searchRes.ok) {
    const searchData = await searchRes.json();
    if (searchData.Contacts && searchData.Contacts.length > 0) {
      const contactId = searchData.Contacts[0].ContactID;
      await supabase.from("clients").update({ xero_contact_id: contactId }).eq("id", clientId);
      return contactId;
    }
  }

  const createRes = await fetch("https://api.xero.com/api.xro/2.0/Contacts", {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": tenantId,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      Contacts: [
        {
          Name: clientName,
          EmailAddress: email || undefined,
        },
      ],
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Could not create Xero contact: ${errText}`);
  }

  const createData = await createRes.json();
  const contactId = createData.Contacts[0].ContactID;
  await supabase.from("clients").update({ xero_contact_id: contactId }).eq("id", clientId);
  return contactId;
}

function taxTypeForRate(vatRate: number): string {
  if (vatRate === 20) return "OUTPUT2";
  if (vatRate === 5) return "RROUTPUT";
  return "NONE";
}

export async function POST(request: NextRequest) {
  try {
    const { invoiceId } = await request.json();

    if (!invoiceId) {
      return NextResponse.json({ error: "Missing invoiceId" }, { status: 400 });
    }

    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("*, clients(id, client_name, email, xero_contact_id)")
      .eq("id", invoiceId)
      .single();

    if (invoiceError || !invoice) {
      return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
    }

    if (invoice.xero_invoice_id) {
      return NextResponse.json({ error: "This invoice has already been sent to Xero" }, { status: 400 });
    }

    const { data: lines, error: linesError } = await supabase
      .from("invoice_lines")
.select("*, jobs(job_type)")
      .eq("invoice_id", invoiceId);

    if (linesError || !lines || lines.length === 0) {
      return NextResponse.json({ error: "No line items found for this invoice" }, { status: 400 });
    }

    const client = invoice.clients as any;
    if (!client) {
      return NextResponse.json({ error: "No client linked to this invoice" }, { status: 400 });
    }

    const { accessToken, tenantId } = await getValidAccessToken();

    const contactId = await findOrCreateContact(
      accessToken,
      tenantId,
      client.id,
      client.client_name,
      client.xero_contact_id,
      client.email
    );

    const xeroPayload = {
      Invoices: [
        {
          Type: "ACCREC",
          Contact: { ContactID: contactId },
          Date: invoice.invoice_date,
          DueDate: invoice.due_date || invoice.invoice_date,
          InvoiceNumber: invoice.invoice_number,
          Status: "DRAFT",
   LineItems: lines.map((l: any) => {
            const resolvedCode = accountCodeForJobType(l.jobs?.job_type);
            console.log(`Line "${l.description}" — job_type: ${JSON.stringify(l.jobs?.job_type)} — resolved AccountCode: ${resolvedCode}`);
            return {
              Description: l.description,
              Quantity: l.qty,
              UnitAmount: l.price,
              AccountCode: resolvedCode,
              TaxType: taxTypeForRate(Number(l.vat_rate) || 0),
            };
          }),     },
      ],
    };

    const invoiceRes = await fetch("https://api.xero.com/api.xro/2.0/Invoices", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Xero-tenant-id": tenantId,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(xeroPayload),
    });

    if (!invoiceRes.ok) {
      const errText = await invoiceRes.text();
      console.error("Xero invoice creation failed:", errText);
      return NextResponse.json({ error: "Failed to create invoice in Xero", detail: errText }, { status: 500 });
    }

    const invoiceData = await invoiceRes.json();
    const xeroInvoiceId = invoiceData.Invoices[0].InvoiceID;

    await supabase
      .from("invoices")
      .update({ xero_invoice_id: xeroInvoiceId })
      .eq("id", invoiceId);

    return NextResponse.json({
      success: true,
      xeroInvoiceId,
      xeroUrl: `https://go.xero.com/AccountsReceivable/Edit.aspx?InvoiceID=${xeroInvoiceId}`,
    });
  } catch (err) {
    console.error("Send to Xero failed:", err);
    return NextResponse.json(
      { error: "Unexpected error sending to Xero", detail: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}