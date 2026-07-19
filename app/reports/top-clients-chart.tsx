"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

type ClientBar = { name: string; wip: number; invoiced: number };

function shortName(name: string) {
  return name.length > 20 ? name.slice(0, 18) + "…" : name;
}

export default function TopClientsChart({ data }: { data: ClientBar[] }) {
  const chartData = data.map((d) => ({ ...d, shortName: shortName(d.name) }));

  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
          <XAxis type="number" tickFormatter={(v) => `£${v}`} tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="shortName" width={110} tick={{ fontSize: 12, fill: "#334155" }} axisLine={false} tickLine={false} />
          <Tooltip
            formatter={(value: any, key: any) => [`£${Number(value).toFixed(2)}`, key === "wip" ? "WIP" : "Invoiced"]}
            labelFormatter={(_: any, payload: any) => payload?.[0]?.payload?.name || ""}
            contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
          />
          <Bar dataKey="invoiced" fill="#2563eb" radius={[0, 4, 4, 0]} barSize={10} />
          <Bar dataKey="wip" fill="#f97316" radius={[0, 4, 4, 0]} barSize={10} />
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-1 justify-end">
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#2563eb" }} /> Invoiced
        </span>
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: "#f97316" }} /> WIP
        </span>
      </div>
    </div>
  );
}
