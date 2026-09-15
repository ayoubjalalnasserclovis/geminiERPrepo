import Link from 'next/link';
import { Mail, ArrowLeft, CheckCircle2, AlertTriangle, Clock, XCircle, Eye } from 'lucide-react';
import { requireRole } from '@/lib/auth/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { PageHeader } from '@/components/ui/page-header';
import { TestEmailButton, ResendQueuedButton } from '@/components/admin/email-action-buttons';

/**
 * Page admin /admin/emails — CEO 2026-06-18.
 *
 * Monitoring email :
 *  - KPI globaux (24h, 7j, 30j)
 *  - Liste des 200 derniers envois
 *  - Bouton "Envoyer email de test"
 *  - Bouton "Relancer les emails queued"
 *
 * Permissions : ceo + developer (lecture).
 */

const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  sent:       { label: 'Envoyé',     color: 'bg-blue-100 text-blue-800',         icon: Mail },
  delivered:  { label: 'Livré',      color: 'bg-emerald-100 text-emerald-800',   icon: CheckCircle2 },
  opened:     { label: 'Ouvert',     color: 'bg-emerald-100 text-emerald-900',   icon: Eye },
  queued:     { label: 'En attente', color: 'bg-amber-100 text-amber-800',       icon: Clock },
  failed:     { label: 'Échec',      color: 'bg-red-100 text-red-800',           icon: XCircle },
  bounced:    { label: 'Bounce',     color: 'bg-red-100 text-red-900',           icon: XCircle },
  complained: { label: 'Plainte',    color: 'bg-red-100 text-red-900',           icon: AlertTriangle },
  skipped:    { label: 'Ignoré',     color: 'bg-stoniz-gray-100 text-stoniz-gray-700', icon: AlertTriangle },
};

function fmt(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export default async function AdminEmailsPage() {
  await requireRole(['ceo', 'developer']);
  const admin = createAdminClient();

  // ─── KPI 24h / 7j / 30j ──────────────────────────────────────────────────
  const [counts24h, counts7d, counts30d] = await Promise.all([
    admin.from('email_logs').select('status').gte('status_updated_at', new Date(Date.now() - 24 * 3600_000).toISOString()),
    admin.from('email_logs').select('status').gte('status_updated_at', new Date(Date.now() - 7 * 24 * 3600_000).toISOString()),
    admin.from('email_logs').select('status').gte('status_updated_at', new Date(Date.now() - 30 * 24 * 3600_000).toISOString()),
  ]);

  function tally(rows: any[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
    return out;
  }
  const k24h = tally(counts24h.data ?? []);
  const k7d = tally(counts7d.data ?? []);
  const k30d = tally(counts30d.data ?? []);

  // ─── Compteur des queued (pour le bouton "Relancer") ─────────────────────
  const queuedRecent = (counts24h.data ?? []).filter((r: any) => r.status === 'queued').length;

  // ─── Liste des 200 derniers ──────────────────────────────────────────────
  const { data: recent } = await admin
    .from('email_logs')
    .select('id, recipient_email, template_id, subject, status, sent_at, status_updated_at, payload, resend_id, project_id')
    .order('status_updated_at', { ascending: false })
    .limit(200);

  const rows = (recent ?? []) as any[];

  return (
    <div className="max-w-7xl space-y-6">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black">
        <ArrowLeft className="w-4 h-4" /> Retour
      </Link>

      <PageHeader
        title="Monitoring emails"
        description="État des envois Resend (envoyés, en attente, échoués). Page CEO/developer uniquement."
      />

      {/* KPI cards 24h / 7j / 30j */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <KpiCard title="24h dernières" counts={k24h} />
        <KpiCard title="7 derniers jours" counts={k7d} />
        <KpiCard title="30 derniers jours" counts={k30d} />
      </div>

      {/* Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TestEmailButton />
        <ResendQueuedButton count={queuedRecent} />
      </div>

      {/* Tableau des 200 derniers */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-stoniz-gray-200">
          <h2 className="font-display text-lg">200 derniers envois</h2>
          <p className="text-xs text-stoniz-gray-500">Triés par dernière mise à jour (plus récents en haut)</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-stoniz-gray-50 text-stoniz-gray-600 uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Statut</th>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Destinataire</th>
                <th className="px-3 py-2 text-left">Template</th>
                <th className="px-3 py-2 text-left">Sujet</th>
                <th className="px-3 py-2 text-left">Info</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stoniz-gray-100">
              {rows.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-8 text-center text-stoniz-gray-500">Aucun envoi.</td></tr>
              )}
              {rows.map((r) => {
                const meta = STATUS_META[r.status] ?? STATUS_META.sent;
                const Icon = meta.icon;
                return (
                  <tr key={r.id} className="hover:bg-stoniz-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] ${meta.color}`}>
                        <Icon className="w-3 h-3" /> {meta.label}
                      </span>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-stoniz-gray-600">{fmt(r.sent_at ?? r.status_updated_at)}</td>
                    <td className="px-3 py-2 truncate max-w-[180px]">{r.recipient_email}</td>
                    <td className="px-3 py-2 font-mono text-stoniz-gray-700">{r.template_id}</td>
                    <td className="px-3 py-2 truncate max-w-[260px]">{r.subject}</td>
                    <td className="px-3 py-2 truncate max-w-[180px] text-stoniz-gray-500">
                      {r.status === 'skipped' && r.payload?.skip_reason && (
                        <span className="italic">{String(r.payload.skip_reason)}</span>
                      )}
                      {r.status === 'failed' && r.payload?.error && (
                        <span className="text-red-600">{String(r.payload.error).slice(0, 60)}</span>
                      )}
                      {r.resend_id && (
                        <span className="font-mono text-[10px] text-stoniz-gray-400">{r.resend_id.slice(0, 8)}…</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ title, counts }: { title: string; counts: Record<string, number> }) {
  const sent = counts.sent ?? 0;
  const delivered = counts.delivered ?? 0;
  const opened = counts.opened ?? 0;
  const queued = counts.queued ?? 0;
  const failed = (counts.failed ?? 0) + (counts.bounced ?? 0);
  const skipped = counts.skipped ?? 0;
  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
      <div className="text-xs uppercase text-stoniz-gray-500 mb-2">{title}</div>
      <div className="text-2xl font-display mb-2">{total} emails</div>
      <div className="grid grid-cols-2 gap-1 text-[11px]">
        <div className="text-blue-700">📤 Envoyé : {sent}</div>
        <div className="text-emerald-700">✓ Livré : {delivered}</div>
        <div className="text-emerald-900">👁 Ouvert : {opened}</div>
        <div className="text-amber-700">⏳ Queue : {queued}</div>
        <div className="text-red-700">✗ Échec : {failed}</div>
        <div className="text-stoniz-gray-600">⊘ Ignoré : {skipped}</div>
      </div>
    </div>
  );
}
