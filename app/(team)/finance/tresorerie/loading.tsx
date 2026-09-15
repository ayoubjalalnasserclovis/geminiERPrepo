/**
 * Skeleton loading pour /finance/tresorerie.
 * CEO 2026-06-23 — P1.11 : feedback visuel pendant le chargement serveur.
 */
export default function Loading() {
  return (
    <div className="space-y-8 max-w-7xl animate-pulse">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="h-7 w-64 bg-stoniz-gray-200 rounded" />
          <div className="h-3 w-96 bg-stoniz-gray-100 rounded" />
        </div>
        <div className="flex gap-2">
          <div className="h-10 w-32 bg-stoniz-gray-100 rounded" />
          <div className="h-10 w-32 bg-stoniz-gray-100 rounded" />
        </div>
      </div>

      {/* 3 cards consolidation */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="border border-stoniz-gray-200 rounded-md p-5 bg-white">
            <div className="h-3 w-20 bg-stoniz-gray-100 rounded mb-3" />
            <div className="h-8 w-32 bg-stoniz-gray-200 rounded mb-2" />
            <div className="h-3 w-24 bg-stoniz-gray-100 rounded" />
          </div>
        ))}
      </div>

      {/* Tableau soldes */}
      <div className="border border-stoniz-gray-200 rounded-md p-5 bg-white">
        <div className="h-5 w-40 bg-stoniz-gray-200 rounded mb-4" />
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 bg-stoniz-gray-100 rounded" />
          ))}
        </div>
      </div>

      {/* Tableau transactions */}
      <div className="border border-stoniz-gray-200 rounded-md p-5 bg-white">
        <div className="h-5 w-48 bg-stoniz-gray-200 rounded mb-4" />
        <div className="h-9 w-full bg-stoniz-gray-100 rounded mb-3" />
        <div className="space-y-1.5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-7 bg-stoniz-gray-100 rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}
