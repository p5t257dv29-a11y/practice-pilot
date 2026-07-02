import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const number = request.nextUrl.searchParams.get("number");

  if (!number) {
    return NextResponse.json({ error: "No company number provided" }, { status: 400 });
  }

  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "API key not configured" }, { status: 500 });
  }

  const credentials = Buffer.from(`${apiKey}:`).toString("base64");
  const baseUrl = "https://api.company-information.service.gov.uk";
  const companyNum = number.toUpperCase().trim();

  const headers = { Authorization: `Basic ${credentials}` };

  // Fetch all three endpoints in parallel
  const [companyRes, officersRes, pscsRes] = await Promise.all([
    fetch(`${baseUrl}/company/${companyNum}`, { headers }),
    fetch(`${baseUrl}/company/${companyNum}/officers?items_per_page=50`, { headers }),
    fetch(`${baseUrl}/company/${companyNum}/persons-with-significant-control?items_per_page=50`, { headers }),
  ]);

  if (!companyRes.ok) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const [company, officersData, pscsData] = await Promise.all([
    companyRes.json(),
    officersRes.ok ? officersRes.json() : { items: [] },
    pscsRes.ok ? pscsRes.json() : { items: [] },
  ]);

  // Format address
  const addr = company.registered_office_address;
  const address = [
    addr?.address_line_1,
    addr?.address_line_2,
    addr?.locality,
    addr?.region,
    addr?.postal_code,
    addr?.country,
  ].filter(Boolean).join(", ");

  // Map company type to entity type
  const entityTypeMap: Record<string, string> = {
    "ltd": "Limited Company",
    "private-limited-company": "Limited Company",
    "private-limited-guarant-nsc": "Limited Company",
    "plc": "Limited Company",
    "llp": "LLP",
    "limited-liability-partnership": "LLP",
    "sole-trader": "Sole Trader",
    "partnership": "Partnership",
  };

  const entityType = entityTypeMap[company.type?.toLowerCase()] || "Limited Company";

  // Format officers
  const officers = (officersData.items || []).map((o: any) => ({
    name: o.name,
    role: o.officer_role,
    appointed_on: o.appointed_on || null,
    resigned_on: o.resigned_on || null,
    nationality: o.nationality || null,
    country_of_residence: o.country_of_residence || null,
    date_of_birth_month: o.date_of_birth?.month || null,
    date_of_birth_year: o.date_of_birth?.year || null,
    address: [
      o.address?.premises,
      o.address?.address_line_1,
      o.address?.address_line_2,
      o.address?.locality,
      o.address?.postal_code,
    ].filter(Boolean).join(", "),
    is_active: !o.resigned_on,
  }));

  // Format PSCs
  const pscs = (pscsData.items || []).map((p: any) => ({
    name: p.name || p.kind,
    nationality: p.nationality || null,
    country_of_residence: p.country_of_residence || null,
    natures_of_control: p.natures_of_control || [],
    notified_on: p.notified_on || null,
    ceased_on: p.ceased_on || null,
    date_of_birth_month: p.date_of_birth?.month || null,
    date_of_birth_year: p.date_of_birth?.year || null,
    address: [
      p.address?.premises,
      p.address?.address_line_1,
      p.address?.address_line_2,
      p.address?.locality,
      p.address?.postal_code,
    ].filter(Boolean).join(", "),
    is_active: !p.ceased_on,
  }));

  return NextResponse.json({
    // Basic info
    company_name: company.company_name,
    company_number: company.company_number,
    company_status: company.company_status,
    company_type: company.type,
    entity_type: entityType,
    address,
    incorporation_date: company.date_of_creation || null,
    sic_codes: company.sic_codes || [],

    // Accounts
    accounts_next_due: company.accounts?.next_due || null,
    accounts_last_made_up: company.accounts?.last_accounts?.made_up_to || null,

    // Confirmation statement
    confirmation_statement_next_due: company.confirmation_statement?.next_due || null,
    confirmation_statement_last_made_up: company.confirmation_statement?.last_made_up_to || null,

    // Officers & PSCs
    officers,
    pscs,
  });
}
