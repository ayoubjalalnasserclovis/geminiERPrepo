/**
 * Skeleton loading pour /finance/tresorerie/reconciliation.
 * CEO 2026-06-23 — P1.11 : feedback visuel pendant le chargement serveur.
 */
export default function Loading() {
  return (
    <div className="max-w-7xl space-y-6 animate-pulse">
      {/* Header */}
      <div>
        <div className="h-4 w-32 bg-stoniz-gray-100 rounded mb-2" />
        <div className="h-7 w-80 bg-stoniz-gray-200 rounded mb-2" />
        <div className="h-3 w-96 bg-stoniz-gray-100 rounded" />
      </div>

      {/* Toolbar */}
      <div className="border border-stoniz-gray-200 rounded-md p-4 bg-white">
        <div className="h-9 w-full bg-stoniz-gray-100 rounded mb-3" />
        <div className="flex gap-2">
          <div className="h-7 w-20 bg-stoniz-gray-100 rounded" />
          <div className="h-7 w-20 bg-stoniz-gray-100 rounded" />
          <div className="h-7 w-20 bg-stoniz-gray-100 rounded" />
        </div>
      </div>

      {/* 4 stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="border border-stoniz-gray-200 rounded-md p-4 bg-white">
            <div className="h-3 w-24 bg-stoniz-gray-100 rounded mb-2" />
            <div className="h-8 w-16 bg-stoniz-gray-200 rounded mb-1" />
            <div className="h-3 w-20 bg-stoniz-gray-100 rounded" />
          </div>
        ))}
      </div>

      {/* Bandeau impact */}
      <div className="h-14 bg-stoniz-gray-100 rounded-md" />

      {/* Tableau transactions */}
      <div className="border border-stoniz-gray-200 rounded-md p-5 bg-white">
        <div className="h-5 w-64 bg-stoniz-gray-200 rounded mb-4" />
        <div className="space-y-1.5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-7 bg-stoniz-gray-100 rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}
