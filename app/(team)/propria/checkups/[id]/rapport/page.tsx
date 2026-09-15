import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { CheckupPrintButton } from '@/components/propria/checkup-print-button';
import {
  CHECKUP_CHECKLIST,
  CHECKUP_STATUS_META,
  type CheckupItemStatus,
} from '@/lib/propria/checkup-checklist';
import { getCheckupProofUrls } from '../../actions';

/**
 * Rapport check-up imprimable (chantier 11.a — MVP).
 * Server-rendered, bouton « Imprimer / PDF » = window.print() + CSS print
 * (décision MVP : PAS de génération PDF server-side).
 */
export default async function CheckupRapportPage({ params }: { params: { id: string } }) {
  await requireRole(['ceo', 'developer', 'assistante', 'propria']);
  const supabase = createClient();

  const [checkupRes, itemsRes, createdRes, profRes] = await Promise.all([
    supabase.from('propria_checkups').select('*').eq('id', params.id).single(),
    supabase.from('propria_checkup_items')
      .select('item_key, status, note')
      .eq('checkup_id', params.id).is('deleted_at', null),
    supabase.from('propria_interventions')
      .select('id, kind, description, status')
      .eq('source_checkup_id', params.id).is('deleted_at', null)
      .order('created_at', { ascending: true }),
    supabase.from('profiles').select('id, full_name'),
  ]);

  if (!checkupRes.data || checkupRes.data.deleted_at) notFound();
  const checkup = checkupRes.data;

  // Libellé bien / lot
  let scopeLabel = '—';
  if (checkup.propria_unit_id) {
    const { data: u } = await supabase
      .from('propria_units')
      .select('code, order_index, property:properties(name, propria_internal_code)')
      .eq('id', checkup.propria_unit_id).single();
    const p = (u as any)?.property;
    scopeLabel = `${p?.propria_internal_code ?? p?.name ?? 'Bien'} · ${(u as any)?.code ?? `Suite ${(u as any)?.order_index ?? ''}`}`;
  } else if (checkup.property_id) {
    const { data: p } = await supabase
      .from('properties').select('name, propria_internal_code')
      .eq('id', checkup.property_id).single();
    scopeLabel = `${(p as any)?.propria_internal_code ?? (p as any)?.name ?? 'Bien'} · Bien entier`;
  }

  const profs = new Map(((profRes.data ?? []) as any[]).map((p) => [p.id, p.full_name]));
  const itemsByKey = new Map(
    ((itemsRes.data ?? []) as { item_key: string; status: CheckupItemStatus; note: string | null }[])
      .map((i) => [i.item_key, i]),
  );
  const proofs = await getCheckupProofUrls(params.id);
  const proofsByKey = new Map<string, typeof proofs>();
  for (const p of proofs) {
    const k = p.itemKey ?? '__general__';
    const arr = proofsByKey.get(k) ?? [];
    arr.push(p);
    proofsByKey.set(k, arr);
  }

  const createdTasks = (createdRes.data ?? []) as any[];
  const nbProblems = Array.from(itemsByKey.values()).filter((i) => i.status === 'probleme').length;

  const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('fr-FR') : '—';
  const statusCell = (s: CheckupItemStatus | undefined) => {
    if (!s) return <span style={{ color: '#999' }}>non renseigné</span>;
    const m = CHECKUP_STATUS_META[s];
    const color = s === 'ok' ? '#16a34a' : s === 'probleme' ? '#ea580c' : '#666';
    return <span style={{ color, fontWeight: 600 }}>{m.icon} {m.label}</span>;
  };

  return (
    <div className="max-w-3xl">
      {/* CSS print : on masque la sidebar/nav du layout (team) et le bandeau */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          aside, nav, header, .no-print { display: none !important; }
          main { padding: 0 !important; overflow: visible !important; }
          body { background: white; }
          .checkup-report { border: none !important; box-shadow: none !important; }
          .checkup-report section { break-inside: avoid; }
          a { text-decoration: none; color: inherit; }
        }
      ` }} />

      {/* Bandeau actions (non imprimé) */}
      <div className="no-print flex items-center justify-between mb-4">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider">
          <Link href="/propria" className="hover:text-stoniz-black">Propria</Link>
          {' · '}
          <Link href="/propria/checkups" className="hover:text-stoniz-black">Check-ups</Link>
          {' · '}
          <Link href={`/propria/checkups/${params.id}`} className="hover:text-stoniz-black">Fiche</Link>
          {' · Rapport'}
        </div>
        <CheckupPrintButton />
      </div>

      <div className="checkup-report bg-white border border-stoniz-gray-200 rounded-xl p-6 md:p-8">
        {/* En-tête */}
        <header className="border-b-2 border-stoniz-black pb-4 mb-6">
          <h1 className="text-2xl font-display">🩺 Rapport de check-up logement</h1>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-3 text-sm">
            <div><span className="text-stoniz-gray-500">Bien / lot :</span> <strong>{scopeLabel}</strong></div>
            <div><span className="text-stoniz-gray-500">Date :</span> <strong>{fmtDate(checkup.due_date ?? checkup.submitted_at ?? checkup.created_at)}</strong></div>
            <div><span className="text-stoniz-gray-500">Contrôleur :</span> <strong>{profs.get(checkup.assigned_to_id) ?? '—'}</strong></div>
            <div>
              <span className="text-stoniz-gray-500">Validé :</span>{' '}
              <strong>
                {checkup.validated_at
                  ? `${fmtDate(checkup.validated_at)}${profs.get(checkup.validated_by) ? ` par ${profs.get(checkup.validated_by)}` : ''}`
                  : 'non'}
              </strong>
            </div>
            <div>
              <span className="text-stoniz-gray-500">Problèmes relevés :</span>{' '}
              <strong className={nbProblems > 0 ? 'text-orange-700' : 'text-emerald-700'}>
                {nbProblems > 0 ? `⚠ ${nbProblems}` : 'aucun'}
              </strong>
            </div>
            <div><span className="text-stoniz-gray-500">Statut :</span> <strong>{checkup.status}</strong></div>
          </div>
          {checkup.observations && (
            <p className="text-sm text-stoniz-gray-700 mt-3 italic">Consignes : {checkup.observations}</p>
          )}
        </header>

        {/* Tableau par section */}
        {CHECKUP_CHECKLIST.map((section) => (
          <section key={section.key} className="mb-6">
            <h2 className="font-display text-lg mb-2">{section.emoji} {section.title}</h2>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs uppercase text-stoniz-gray-500 border-b border-stoniz-gray-200">
                  <th className="py-1.5 pr-2 w-2/5">Item</th>
                  <th className="py-1.5 pr-2 w-1/5">Statut</th>
                  <th className="py-1.5">Note</th>
                </tr>
              </thead>
              <tbody>
                {section.items.map((item) => {
                  const row = itemsByKey.get(item.key);
                  const itemProofs = proofsByKey.get(item.key) ?? [];
                  return (
                    <tr key={item.key} className="border-b border-stoniz-gray-100 align-top">
                      <td className="py-2 pr-2">{item.emoji} {item.label}</td>
                      <td className="py-2 pr-2 whitespace-nowrap">{statusCell(row?.status)}</td>
                      <td className="py-2">
                        {row?.note ?? <span className="text-stoniz-gray-300">—</span>}
                        {itemProofs.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-1.5">
                            {itemProofs.map((p) => p.signedUrl && !(p.mimeType ?? '').startsWith('video/') ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img key={p.id} src={p.signedUrl} alt={item.label}
                                className="w-20 h-20 object-cover rounded border border-stoniz-gray-200" />
                            ) : (
                              <span key={p.id} className="text-[10px] text-stoniz-gray-500 border border-stoniz-gray-200 rounded px-1.5 py-1">🎬 vidéo</span>
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}

        {/* Photos générales */}
        {(proofsByKey.get('__general__') ?? []).length > 0 && (
          <section className="mb-6">
            <h2 className="font-display text-lg mb-2">📷 Photos générales</h2>
            <div className="flex flex-wrap gap-2">
              {(proofsByKey.get('__general__') ?? []).map((p) => p.signedUrl && !(p.mimeType ?? '').startsWith('video/') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p.id} src={p.signedUrl} alt="Photo générale"
                  className="w-24 h-24 object-cover rounded border border-stoniz-gray-200" />
              ) : null)}
            </div>
          </section>
        )}

        {/* Tâches créées */}
        <section>
          <h2 className="font-display text-lg mb-2">🔧 Tâches & interventions créées</h2>
          {createdTasks.length === 0 ? (
            <p className="text-sm text-stoniz-gray-500">Aucune tâche créée depuis ce check-up.</p>
          ) : (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-xs uppercase text-stoniz-gray-500 border-b border-stoniz-gray-200">
                  <th className="py-1.5 pr-2">Type</th>
                  <th className="py-1.5 pr-2">Description</th>
                  <th className="py-1.5">Statut</th>
                </tr>
              </thead>
              <tbody>
                {createdTasks.map((t) => (
                  <tr key={t.id} className="border-b border-stoniz-gray-100">
                    <td className="py-2 pr-2 whitespace-nowrap">{t.kind === 'tache' ? '📌 Tâche' : '🔧 Intervention'}</td>
                    <td className="py-2 pr-2">
                      <Link href={`/propria/interventions/${t.id}`} className="hover:underline">{t.description}</Link>
                    </td>
                    <td className="py-2 whitespace-nowrap">{t.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <footer className="mt-8 pt-4 border-t border-stoniz-gray-200 text-[11px] text-stoniz-gray-500">
          Rapport généré le {new Date().toLocaleDateString('fr-FR')} · Stoniz — Propria · Check-up {params.id.slice(0, 8)}
        </footer>
      </div>
    </div>
  );
}
