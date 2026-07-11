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

export default function DecisionCard({ decision }) {
  if (!decision || !decision.alternates || decision.alternates.length === 0) {
    return null;
  }

  const { primary_part, nomenclature, revision, document, alternates } =
    decision;

  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-slate-300 bg-white">
      {/* Header: primary part + compliance/revision line */}
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
          {(document || revision) && (
            <div className="shrink-0 text-right text-[11px] text-slate-500">
              {document && <div className="font-medium">{document}</div>}
              {revision && <div>Rev {revision}</div>}
            </div>
          )}
        </div>
      </div>

      {/* Approved alternates */}
      <ul className="divide-y divide-slate-100">
        {alternates.map((alt, i) => {
          const s = styleFor(alt.classification);
          return (
            <li
              key={i}
              className={`border-l-4 ${s.bar} px-3 py-2`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold text-slate-800">
                  {alt.part_number || "—"}
                </span>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${s.badge}`}
                >
                  {s.icon} {s.label}
                </span>
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
    </div>
  );
}
