type FunnelStep = {
  label: string;
  count: number;
  pct: number;
};

/**
 * Entonnoir de conversion en CSS pur.
 * Chaque étape = barre horizontale avec largeur proportionnelle au max,
 * + taux de conversion étape-à-étape entre les paliers.
 */
export function ConversionFunnel({ steps }: { steps: FunnelStep[] }) {
  const max = Math.max(1, ...steps.map((s) => s.count));
  return (
    <div className="space-y-1.5">
      {steps.map((step, i) => {
        const widthPct = (step.count / max) * 100;
        const prev = i > 0 ? steps[i - 1] : null;
        const stepToStep = prev && prev.count > 0
          ? Math.round((step.count / prev.count) * 100)
          : null;
        const color = i === 0
          ? 'bg-stoniz-gray-400'
          : i === steps.length - 1
            ? 'bg-emerald-500'
            : `bg-stoniz-blue opacity-${100 - i * 15}`;

        return (
          <div key={step.label}>
            {prev && stepToStep != null && (
              <div className="flex items-center gap-2 ml-3 my-1 text-[10px] text-stoniz-gray-500">
                <div className="w-px h-3 bg-stoniz-gray-300" />
                <span>{stepToStep}% passage</span>
              </div>
            )}
            <div className="flex items-center gap-3">
              <div className="w-32 text-sm text-stoniz-gray-700 flex-shrink-0">{step.label}</div>
              <div className="flex-1 relative h-7 bg-stoniz-gray-100 rounded">
                <div
                  className={`absolute inset-y-0 left-0 ${color} rounded transition-all`}
                  style={{ width: `${widthPct}%` }}
                />
                <div className="absolute inset-0 flex items-center justify-between px-3 text-xs font-medium">
                  <span className="text-stoniz-gray-900">{step.count}</span>
                  <span className="text-stoniz-gray-700">{step.pct}%</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
