import { requireRole } from '@/lib/auth/require';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Trash2, RotateCcw, Clock } from 'lucide-react';
import { fetchDeletions, fetchDeletionStats } from '@/app/actions/deletions';
import { DeletionsTable } from '@/components/admin/deletions-table';

/**
 * Corbeille admin (CEO 2026-06-16).
 *
 * Liste centralisée de toutes les suppressions soft-delete du système avec
 * possibilité de restaurer (CEO uniquement). Filtres par type d'objet,
 * période, recherche libre dans le libellé.
 *
 * Accès : CEO + developer en lecture, restauration CEO uniquement.
 */
export default async function SuppressionsPage({
  searchParams,
}: {
  searchParams: { table?: string; period?: string; q?: string; restored?: string };
}) {
  const me = await requireRole(['ceo', 'developer']);

  const tableName = searchParams.table || null;
  const period = (searchParams.period as any) || '30d';
  const search = searchParams.q || null;
  const showRestored = searchParams.restored === '1';

  const [rows, stats] = await Promise.all([
    fetchDeletions({ tableName, period, search, showRestored, limit: 200 }),
    fetchDeletionStats(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Suppressions"
        description="Corbeille admin — qui a supprimé quoi et quand"
      />

      {/* Stats header */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 text-stoniz-gray-600 text-xs">
            <Trash2 className="w-3.5 h-3.5" />
            En attente (non restaurées)
          </div>
          <div className="text-2xl font-display mt-1">{stats.totalPending}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-stoniz-gray-600 text-xs">
            <Clock className="w-3.5 h-3.5" />
            7 derniers jours
          </div>
          <div className="text-2xl font-display mt-1">{stats.total7d}</div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 text-stoniz-gray-600 text-xs">
            <Clock className="w-3.5 h-3.5" />
            30 derniers jours
          </div>
          <div className="text-2xl font-display mt-1">{stats.total30d}</div>
        </Card>
      </div>

      {/* Répartition par type d'objet sur 30j (pour aider à filtrer rapidement) */}
      {stats.byTable.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-medium text-stoniz-gray-700 mb-2">
            Répartition par type (30j)
          </h3>
          <div className="flex flex-wrap gap-2 text-xs">
            {stats.byTable.map((t) => (
              <span
                key={t.table_name}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded bg-stoniz-gray-50 border border-stoniz-gray-200"
              >
                <span className="font-mono text-stoniz-gray-600">{t.table_name}</span>
                <span className="font-medium">{t.count}</span>
              </span>
            ))}
          </div>
        </Card>
      )}

      <DeletionsTable
        initialRows={rows}
        currentFilters={{ tableName, period, search, showRestored }}
        canRestore={me.role === 'ceo'}
      />
    </div>
  );
}
