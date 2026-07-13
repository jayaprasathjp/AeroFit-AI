import { useState } from "react";

/**
 * DecisionCard — renders the structured "approved alternate parts" decision
 * returned by the backend as a scannable card with classification badges.
 *
 * Props:
 *   decision: {
 *     primary_part, nomenclature, revision, document,
 *     alternates: [{ part_number, classification, notes, restrictions,
 *                    hardware, el_signoff }]
 *   }
 */

// Visual style per alternate-part classification.
const CLASSIFICATION_STYLES = {
  "true alternate": {
    label: "TRUE ALTERNATE",
    badge: "bg-green-100 text-green-800 border-green-300",
    bar: "border-l-green-500",
    icon: "✅",
  },
  "oversized version": {
    label: "OVERSIZED",
    badge: "bg-amber-100 text-amber-800 border-amber-300",
    bar: "border-l-amber-500",
    icon: "⚠️",
  },
  "optional fit": {
    label: "OPTIONAL FIT",
    badge: "bg-red-100 text-red-800 border-red-300",
    bar: "border-l-red-500",
    icon: "🚫",
  },
};

function styleFor(classification) {
  const key = (classification || "").trim().toLowerCase();
  return (
    CLASSIFICATION_STYLES[key] || {
      label: (classification || "ALTERNATE").toUpperCase(),
      badge: "bg-slate-200 text-slate-700 border-slate-300",
      bar: "border-l-slate-400",
      icon: "🔧",
    }
  );
}

// Ranking so the most fit-for-purpose classification sorts first.
const CLASSIFICATION_RANK = {
  "true alternate": 0,
  "oversized version": 1,
  "optional fit": 2,
};

function classificationRank(classification) {
  const key = (classification || "").trim().toLowerCase();
  return CLASSIFICATION_RANK[key] ?? 3;
}

// Order alternates so in-stock parts come first, then by classification fit.
// Uses index as a stable tiebreaker to keep the backend's original order.
function prioritize(alternates) {
  return alternates
    .map((alt, index) => ({ alt, index }))
    .sort((a, b) => {
      const aStock = (a.alt.stock ?? 0) > 0 ? 0 : 1;
      const bStock = (b.alt.stock ?? 0) > 0 ? 0 : 1;
      if (aStock !== bStock) return aStock - bStock;
      const rank =
        classificationRank(a.alt.classification) -
        classificationRank(b.alt.classification);
      if (rank !== 0) return rank;
      return a.index - b.index;
    })
    .map((entry) => entry.alt);
}

// Green "in stock" / red "out of stock" chip.
function StockChip({ stock }) {
  const inStock = stock > 0;
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
        inStock ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"
      }`}
    >
      {inStock ? `✅ ${stock} in stock` : "❌ 0 in stock"}
    </span>
  );
}

export default function DecisionCard({
  decision,
  sources = [],
  citations = [],
  onSourceClick,
}) {
  const [copied, setCopied] = useState(false);

  if (!decision || !decision.alternates || decision.alternates.length === 0) {
    return null;
  }

  const {
    primary_part,
    primary_stock = 0,
    nomenclature,
    revision,
    revision_current = true,
    document,
    stock_checked_at,
    stock_source,
    alternates,
  } = decision;

  const orderedAlternates = prioritize(alternates);
  // The first entry is "recommended" only if it is actually in stock.
  const recommendedPart =
    (orderedAlternates[0]?.stock ?? 0) > 0
      ? orderedAlternates[0].part_number
      : null;

  // Prefer citations (page + confidence); fall back to bare page numbers.
  const citationList =
    citations.length > 0
      ? citations
      : sources.map((page) => ({ page, score: null }));

  let checkedAtLabel = "";
  if (stock_checked_at) {
    const d = new Date(stock_checked_at);
    if (!Number.isNaN(d.getTime())) checkedAtLabel = d.toLocaleTimeString();
  }

  // Build a plain-text summary the mechanic can paste into a work order / EL email.
  const buildSummary = () => {
    const lines = [];
    lines.push("APPROVED PARTS DECISION — AeroFit Resolver");
    lines.push(
      `Primary: ${primary_part}${nomenclature ? ` (${nomenclature})` : ""} — ${
        primary_stock > 0 ? `${primary_stock} in stock` : "OUT OF STOCK"
      } (AMAP)`
    );
    if (document || revision) {
      lines.push(
        `Source: ${document || "manual"}${revision ? ` · Rev ${revision}` : ""}${
          revision_current ? " (active)" : " (SUPERSEDED)"
        }`
      );
    }
    lines.push("");
    lines.push("Approved alternates:");
    orderedAlternates.forEach((alt, i) => {
      const stock =
        (alt.stock ?? 0) > 0 ? `${alt.stock} in stock` : "0 in stock";
      lines.push(
        `${i + 1}. ${alt.part_number} — ${alt.classification} — ${stock}${
          alt.part_number === recommendedPart ? "  [RECOMMENDED]" : ""
        }`
      );
      if (alt.notes) lines.push(`   Notes: ${alt.notes}`);
      if (alt.hardware) lines.push(`   Hardware: ${alt.hardware}`);
      if (alt.restrictions) lines.push(`   Restriction: ${alt.restrictions}`);
      if (alt.el_signoff) lines.push(`   ** Requires Engineering Liaison sign-off **`);
    });
    if (citationList.length > 0) {
      lines.push("");
      lines.push(
        "References: " +
          citationList
            .map((c) => `${c.doc_type ? `${c.doc_type} ` : ""}p${c.page}`)
            .join(", ")
      );
    }
    return lines.join("\n");
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildSummary());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-slate-300 bg-white">
      {/* Header: primary part + revision compliance badge */}
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-slate-400">
              Primary part
            </div>
            <div className="truncate font-semibold text-slate-800">
              {primary_part || "—"}
            </div>
            {nomenclature && (
              <div className="truncate text-xs text-slate-500">
                {nomenclature}
              </div>
            )}
          </div>
          <div className="shrink-0 text-right">
            {revision &&
              (revision_current ? (
                <span className="inline-block rounded-full border border-green-300 bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-800">
                  ✅ Active · Rev {revision} · verified
                </span>
              ) : (
                <span className="inline-block rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-800">
                  ⚠️ SUPERSEDED · Rev {revision}
                </span>
              ))}
            {document && (
              <div className="mt-1 text-[11px] font-medium text-slate-500">
                {document}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Stock alert banner when the primary part is unavailable */}
      {primary_stock === 0 && (
        <div className="border-b border-orange-200 bg-orange-50 px-3 py-2 text-xs font-medium text-orange-800">
          ⚠️ {primary_part} is out of stock in AMAP. Showing certified
          alternates.
        </div>
      )}

      {/* Live inventory freshness indicator */}
      {(stock_source || checkedAtLabel) && (
        <div className="flex items-center gap-1.5 border-b border-slate-100 px-3 py-1 text-[10px] text-slate-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
          Live {stock_source || "inventory"} check
          {checkedAtLabel && ` · ${checkedAtLabel}`}
        </div>
      )}

      {/* Approved alternates */}
      <ul className="divide-y divide-slate-100">
        {orderedAlternates.map((alt, i) => {
          const s = styleFor(alt.classification);
          const isRecommended =
            recommendedPart && alt.part_number === recommendedPart;
          return (
            <li
              key={i}
              className={`border-l-4 ${s.bar} px-3 py-2 ${
                isRecommended ? "bg-green-50" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 font-mono text-sm font-semibold text-slate-800">
                  {alt.part_number || "—"}
                  {isRecommended && (
                    <span className="rounded-full bg-green-600 px-1.5 py-0.5 font-sans text-[9px] font-bold text-white">
                      ⭐ RECOMMENDED
                    </span>
                  )}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  <StockChip stock={alt.stock ?? 0} />
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${s.badge}`}
                  >
                    {s.icon} {s.label}
                  </span>
                </div>
              </div>

              {alt.notes && (
                <p className="mt-1 text-xs text-slate-600">{alt.notes}</p>
              )}

              <div className="mt-1 flex flex-wrap gap-1">
                {alt.hardware && (
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
                    🔩 {alt.hardware}
                  </span>
                )}
                {alt.restrictions && (
                  <span className="rounded bg-orange-50 px-1.5 py-0.5 text-[10px] text-orange-700">
                    ⛔ {alt.restrictions}
                  </span>
                )}
                {alt.el_signoff && (
                  <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">
                    ✍️ EL sign-off required
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Source citations + copy-for-EL action */}
      <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-200 bg-slate-50 px-3 py-2">
        {citationList.length > 0 && (
          <>
            <span className="text-[11px] font-medium text-slate-500">
              Sources:
            </span>
            {citationList.map(({ page, score, doc_type, file }, idx) => (
              <button
                key={`${file || "doc"}-${page}-${idx}`}
                type="button"
                onClick={() => onSourceClick && onSourceClick(page, file)}
                className="rounded border border-ups-brown-200 bg-white px-2 py-0.5 text-[11px] font-medium text-ups-brown-700 transition hover:border-ups-gold hover:bg-ups-gold-50"
              >
                {doc_type ? `${doc_type} ` : ""}Page {page}
                {score != null && (
                  <span className="ml-1 text-slate-400">
                    {Math.round(score * 100)}%
                  </span>
                )}
              </button>
            ))}
          </>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="ml-auto rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-700 transition hover:bg-slate-100"
        >
          {copied ? "✓ Copied" : "📋 Copy for EL"}
        </button>
      </div>
    </div>
  );
}
