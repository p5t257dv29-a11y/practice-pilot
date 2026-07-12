"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

interface SearchResults {
  clients: { id: string; client_name: string; entity_type: string }[];
  jobs: { id: string; job_name: string; job_type: string | null; clients: { client_name: string } | null }[];
  quotes: { id: string; quote_number: string; status: string; clients: { client_name: string } | null }[];
  invoices: { id: string; invoice_number: string; status: string; clients: { client_name: string } | null }[];
  fixedAssets: { id: string; description: string; clients: { client_name: string } | null }[];
  capitalGains: { id: string; asset_description: string; clients: { client_name: string } | null }[];
  corporationTax: { id: string; period_start: string; period_end: string; clients: { client_name: string } | null }[];
  personalTax: { id: string; tax_year: string; clients: { client_name: string } | null }[];
}

export default function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults(null);
      setIsOpen(false);
      return;
    }

    const timeout = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setResults(data);
        setIsOpen(true);
      } catch {
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const go = (href: string) => {
    setIsOpen(false);
    setQuery("");
    router.push(href);
  };

  const hasResults = results && (
    results.clients.length + results.jobs.length + results.quotes.length + results.invoices.length +
    results.fixedAssets.length + results.capitalGains.length + results.corporationTax.length + results.personalTax.length
  ) > 0;

  const ResultRow = ({ href, icon, title, subtitle }: { href: string; icon: string; title: string; subtitle: string }) => (
    <button
      onClick={() => go(href)}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-slate-800 transition-colors text-left"
    >
      <span className="text-sm flex-shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white truncate">{title}</p>
        <p className="text-xs text-slate-400 truncate">{subtitle}</p>
      </div>
    </button>
  );

  return (
    <div ref={containerRef} className="relative px-4 pt-4 pb-2">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.trim().length >= 2 && setIsOpen(true)}
          placeholder="Search clients, jobs, quotes..."
          className="w-full rounded-xl bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {isOpen && (
        <div className="absolute left-4 right-4 mt-2 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl max-h-[70vh] overflow-y-auto z-50 p-2">
          {loading && (
            <p className="text-xs text-slate-500 text-center py-4">Searching...</p>
          )}

          {!loading && !hasResults && (
            <p className="text-xs text-slate-500 text-center py-4">No results for "{query}"</p>
          )}

          {!loading && results && (
            <>
              {results.clients.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-1">Clients</p>
                  {results.clients.map((c) => (
                    <ResultRow key={c.id} href={`/clients/${c.id}`} icon="👥" title={c.client_name} subtitle={c.entity_type || "Client"} />
                  ))}
                </div>
              )}

              {results.jobs.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-1">Jobs</p>
                  {results.jobs.map((j) => (
                    <ResultRow key={j.id} href={`/jobs/${j.id}`} icon="💼" title={j.job_name} subtitle={`${j.clients?.client_name || "No client"}${j.job_type ? ` · ${j.job_type}` : ""}`} />
                  ))}
                </div>
              )}

              {results.quotes.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-1">Quotes</p>
                  {results.quotes.map((q) => (
                    <ResultRow key={q.id} href={`/quotes/${q.id}`} icon="📋" title={q.quote_number} subtitle={`${q.clients?.client_name || "No client"} · ${q.status}`} />
                  ))}
                </div>
              )}

              {results.invoices.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-1">Invoices</p>
                  {results.invoices.map((i) => (
                    <ResultRow key={i.id} href={`/invoices/${i.id}`} icon="🧾" title={i.invoice_number} subtitle={`${i.clients?.client_name || "No client"} · ${i.status}`} />
                  ))}
                </div>
              )}

              {results.fixedAssets.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-1">Fixed Assets</p>
                  {results.fixedAssets.map((a) => (
                    <ResultRow key={a.id} href={`/fixed-assets`} icon="🏭" title={a.description} subtitle={a.clients?.client_name || "No client"} />
                  ))}
                </div>
              )}

              {results.capitalGains.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-1">Capital Gains</p>
                  {results.capitalGains.map((g) => (
                    <ResultRow key={g.id} href={`/capital-gains/${g.id}`} icon="📈" title={g.asset_description} subtitle={g.clients?.client_name || "No client"} />
                  ))}
                </div>
              )}

              {results.corporationTax.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-1">Corporation Tax</p>
                  {results.corporationTax.map((c) => (
                    <ResultRow key={c.id} href={`/corporation-tax/${c.id}`} icon="🏢"
                      title={c.clients?.client_name || "No client"}
                      subtitle={`${new Date(c.period_start).toLocaleDateString("en-GB")} – ${new Date(c.period_end).toLocaleDateString("en-GB")}`} />
                  ))}
                </div>
              )}

              {results.personalTax.length > 0 && (
                <div className="mb-2">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-1">Personal Tax</p>
                  {results.personalTax.map((t) => (
                    <ResultRow key={t.id} href={`/tax/${t.id}`} icon="🧮" title={t.clients?.client_name || "No client"} subtitle={`Tax Year ${t.tax_year}`} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
