"use client";

export default function PrintPackButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-xl bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors cursor-pointer"
    >
      Print / Save Pack
    </button>
  );
}