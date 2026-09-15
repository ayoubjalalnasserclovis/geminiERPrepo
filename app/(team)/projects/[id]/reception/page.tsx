import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { BackLink } from '@/components/ui/back-link';
import { Badge } from '@/components/ui/badge';
import {
  createVctAction,
  createReceptionPvAction,
  validateVctAction,
  updatePvHeaderAction,
  sendPvToClientAction,
  sendPvReminderToClientAction,
  addPvReserveAction,
  resolvePvReserveAction,
  updateVctInternalNotesAction,
} from './actions';
import { ReceptionChecklist } from '@/components/projects/reception-checklist';
import { VctCorrectiveActions } from '@/components/projects/vct-corrective-actions';
import { PhotoGallery } from '@/components/projects/photo-gallery';

const VCT_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft:        { label: '○ À commencer',     cls: 'bg-stoniz-gray-100 text-stoniz-gray-700' },
  in_progress:  { label: '🔄 En cours',         cls: 'bg-blue-100 text-blue-800' },
  with_actions: { label: '⚠ Actions ouvertes',  cls: 'bg-orange-100 text-orange-800' },
  validated:    { label: '✅ Validée',          cls: 'bg-emerald-100 text-emerald-800' },
};

const PV_STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft:           { label: '○ Brouillon',         cls: 'bg-stoniz-gray-100 text-stoniz-gray-700' },
  sent_to_client:  { label: '📤 Envoyé au client',  cls: 'bg-blue-100 text-blue-800' },
  validated:       { label: '✅ Signé par client',  cls: 'bg-emerald-100 text-emerald-800' },
  rejected:        { label: '❌ Refusé',            cls: 'bg-red-100 text-red-800' },
  closed:          { label: '🔒 Clos (réserves levées)', cls: 'bg-stoniz-gray-200 text-stoniz-gray-700' },
};

function fmtDate(d: any): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('fr-FR');
}

export default async function ReceptionPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: { tab?: string };
}) {
  await requireRole(['ceo','chef_projet','developer']);
  const supabase = createClient();

  const projectId = params.id;
  const activeTab = searchParams.tab === 'pv' ? 'pv' : 'vct';

  const { data: project } = await supabase
    .from('projects')
    .select(`
      id, reference, current_phase, status,
      client:clients(full_name, email)
    `)
    .eq('id', projectId).single();
  if (!project) notFound();

  const [vctRes, pvRes, artisansRes] = await Promise.all([
    supabase.from('project_vct').select('*').eq('project_id', projectId).maybeSingle(),
    supabase.from('project_reception_pvs').select('*').eq('project_id', projectId).maybeSingle(),
    supabase.from('artisans').select('id, name, phone, whatsapp, speciality').is('deleted_at', null).order('name'),
  ]);

  const vct = vctRes.data;
  const pv = pvRes.data;
  const artisans = (artisansRes.data ?? []) as any[];

  // Charge items + actions correctives en parallèle si VCT existe
  // + toutes les photos du projet (jointes ensuite par entity_id côté JS)
  const [vctItemsRes, actionsRes, pvItemsRes, reservesRes, photosRes] = await Promise.all([
    vct ? supabase.from('project_vct_items')
        .select('id, category, name, display_order, status, observations')
        .eq('vct_id', vct.id).order('display_order') : Promise.resolve({ data: [] }),
    vct ? supabase.from('project_vct_corrective_actions')
        .select('*').eq('vct_id', vct.id).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
    pv ? supabase.from('project_reception_pv_items')
        .select('id, category, name, display_order, status, observations')
        .eq('pv_id', pv.id).order('display_order') : Promise.resolve({ data: [] }),
    pv ? supabase.from('project_reception_pv_reserves')
        .select('*').eq('pv_id', pv.id).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
    supabase.from('project_photos')
      .select('id, entity_type, entity_id, kind, storage_path, caption, width, height')
      .eq('project_id', projectId).is('deleted_at', null)
      .order('uploaded_at'),
  ]);

  const allPhotos = (photosRes.data ?? []) as any[];

  // Map photos par entity_id pour distribution rapide
  const photosByEntity = new Map<string, any[]>();
  for (const p of allPhotos) {
    const arr = photosByEntity.get(p.entity_id) ?? [];
    arr.push(p);
    photosByEntity.set(p.entity_id, arr);
  }

  // Injecte les photos sur chaque entité (items + actions + réserves)
  const vctItems = ((vctItemsRes.data ?? []) as any[]).map(it => ({
    ...it,
    photos: photosByEntity.get(it.id) ?? [],
  }));
  const actions = ((actionsRes.data ?? []) as any[]).map(a => ({
    ...a,
    photos: photosByEntity.get(a.id) ?? [],
  }));
  const pvItems = ((pvItemsRes.data ?? []) as any[]).map(it => ({
    ...it,
    photos: photosByEntity.get(it.id) ?? [],
  }));
  const reserves = ((reservesRes.data ?? []) as any[]).map(r => ({
    ...r,
    photos: photosByEntity.get(r.id) ?? [],
  }));

  return (
    <div className="space-y-6 max-w-6xl">
      <BackLink href={`/projects/${projectId}`} label={`Retour au projet ${project.reference}`} />

      <div>
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
          {project.reference} · Réception
        </div>
        <h1 className="text-3xl font-display">Réception du chantier</h1>
        <p className="text-sm text-stoniz-gray-600 mt-2">
          Client : <strong>{(project.client as any)?.full_name ?? '—'}</strong> ·
          Phase actuelle : <Badge variant={project.current_phase as any}>{project.current_phase}</Badge>
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-stoniz-gray-200 flex gap-1">
        <Link
          href={`/projects/${projectId}/reception?tab=vct`}
          className={`px-4 py-2 text-sm border-b-2 -mb-px ${
            activeTab === 'vct'
              ? 'border-stoniz-black text-stoniz-black font-medium'
              : 'border-transparent text-stoniz-gray-600 hover:text-stoniz-black'
          }`}
        >
          1. Contrôle technique (interne)
          {vct && <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${VCT_STATUS_LABEL[vct.status]?.cls}`}>
            {VCT_STATUS_LABEL[vct.status]?.label}
          </span>}
        </Link>
        <Link
          href={`/projects/${projectId}/reception?tab=pv`}
          className={`px-4 py-2 text-sm border-b-2 -mb-px ${
            activeTab === 'pv'
              ? 'border-stoniz-black text-stoniz-black font-medium'
              : 'border-transparent text-stoniz-gray-600 hover:text-stoniz-black'
          }`}
        >
          2. PV de réception (avec client)
          {pv && <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${PV_STATUS_LABEL[pv.status]?.cls}`}>
            {PV_STATUS_LABEL[pv.status]?.label}
          </span>}
        </Link>
      </div>

      {/* ──────────────────────── TAB VCT ──────────────────────── */}
      {activeTab === 'vct' && (
        <div className="space-y-6">
          {!vct ? (
            <div className="bg-stoniz-beige border border-stoniz-gray-200 rounded-xl p-10 text-center">
              <p className="font-medium mb-2">Aucune VCT pour ce projet</p>
              <p className="text-sm text-stoniz-gray-600 mb-4">
                La VCT (Visite Contrôle Technique) est une inspection interne du chef projet
                avant de présenter le bien au client. Elle pré-remplit ensuite le PV de réception.
              </p>
              <form action={async () => { 'use server'; await createVctAction(projectId); }}>
                <button className="bg-stoniz-black text-white px-5 py-2.5 rounded-md text-sm font-medium hover:bg-stoniz-gray-800">
                  🛠 Démarrer la VCT
                </button>
              </form>
            </div>
          ) : (
            <>
              <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-0.5">
                    Statut VCT
                  </div>
                  <Badge>{VCT_STATUS_LABEL[vct.status]?.label ?? vct.status}</Badge>
                  {vct.validated_at && (
                    <span className="text-xs text-emerald-700 ml-2">
                      Validée le {fmtDate(vct.validated_at)}
                    </span>
                  )}
                </div>

                {/* Bouton de validation contextuel — visible sur tous les statuts non-validés.
                    Le statut se recalcule auto à chaque coche, mais le clic final reste un acte métier
                    du chef projet (engagement qualité). */}
                {vct.status !== 'validated' && (() => {
                  const itemsChecked = vctItems.filter((i: any) => i.status != null).length;
                  const itemsTotal = vctItems.length;
                  const openActionsCount = actions.filter((a: any) =>
                    !['verified','cancelled'].includes(a.status)).length;
                  const isReady = itemsChecked === itemsTotal && itemsTotal > 0 && openActionsCount === 0;

                  return (
                    <div className="flex flex-col items-end gap-1">
                      <form action={async () => { 'use server'; await validateVctAction(vct.id, projectId); }}>
                        <button
                          className={`text-xs px-4 py-2 rounded font-medium ${
                            isReady
                              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                              : 'bg-amber-500 text-white hover:bg-amber-600'
                          }`}
                          title={isReady
                            ? 'Tout est prêt — valider la VCT'
                            : 'Forcer la validation malgré les éléments en cours (déconseillé)'}
                        >
                          {isReady ? '✓ Valider la VCT' : '⚠ Forcer la validation'}
                        </button>
                      </form>
                      <div className="text-[10px] text-stoniz-gray-500 text-right">
                        {itemsChecked}/{itemsTotal} items
                        {openActionsCount > 0 && ` · ${openActionsCount} action${openActionsCount > 1 ? 's' : ''} ouverte${openActionsCount > 1 ? 's' : ''}`}
                        {isReady && ' · prêt à valider ✓'}
                      </div>
                    </div>
                  );
                })()}
              </div>

              {/* Note interne chef projet (jamais visible client — la VCT est 100% interne par nature) */}
              <details className="bg-amber-50/50 border-2 border-amber-200 rounded-xl p-4">
                <summary className="cursor-pointer font-medium text-sm text-amber-900 flex items-center gap-2">
                  🔒 Note interne chef projet
                  {vct.internal_notes && (
                    <span className="text-[10px] bg-amber-200 text-amber-900 px-1.5 py-0.5 rounded-full">
                      remplie
                    </span>
                  )}
                </summary>
                <form action={updateVctInternalNotesAction} className="mt-3 space-y-2">
                  <input type="hidden" name="vct_id" value={vct.id} />
                  <input type="hidden" name="project_id" value={projectId} />
                  <textarea
                    name="internal_notes"
                    defaultValue={vct.internal_notes ?? ''}
                    rows={3}
                    placeholder="Ex : Chantier complexe — peinture salon mal exécutée par le 1er artisan, repris par Khalid. Vigilance sur la finition du parquet."
                    className="w-full border border-amber-300 rounded px-3 py-2 text-sm bg-white"
                  />
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-amber-800">
                      ⚠ Strictement interne · jamais transmis au client.
                    </p>
                    <button className="text-xs bg-stoniz-black text-white px-3 py-1.5 rounded hover:bg-stoniz-gray-800">
                      Enregistrer
                    </button>
                  </div>
                </form>
              </details>

              {/* Actions correctives en haut (urgence !) */}
              <VctCorrectiveActions
                vctId={vct.id}
                projectId={projectId}
                projectReference={project.reference}
                actions={actions}
                artisans={artisans}
              />

              {/* Checklist VCT */}
              <ReceptionChecklist
                mode="vct"
                parentId={vct.id}
                projectId={projectId}
                items={vctItems}
                isLocked={vct.status === 'validated'}
              />
            </>
          )}
        </div>
      )}

      {/* ──────────────────────── TAB PV ───────────────────────── */}
      {activeTab === 'pv' && (
        <div className="space-y-6">
          {!pv ? (
            <div className="bg-stoniz-beige border border-stoniz-gray-200 rounded-xl p-10 text-center">
              <p className="font-medium mb-2">PV de réception non créé</p>
              {!vct ? (
                <p className="text-sm text-stoniz-gray-600 mb-4">
                  Démarre d'abord la VCT (onglet 1) pour pré-remplir le PV automatiquement.
                </p>
              ) : vct.status !== 'validated' ? (
                <p className="text-sm text-orange-700 mb-4">
                  ⚠ La VCT n'est pas encore validée. Tu peux quand même créer le PV mais il
                  sera plus pertinent une fois la VCT terminée.
                </p>
              ) : (
                <p className="text-sm text-stoniz-gray-600 mb-4">
                  Tout est prêt — la VCT est validée. Le PV sera pré-rempli avec les items contrôlés.
                </p>
              )}
              <form action={async () => { 'use server'; await createReceptionPvAction(projectId); }}>
                <button className="bg-stoniz-black text-white px-5 py-2.5 rounded-md text-sm font-medium hover:bg-stoniz-gray-800">
                  📋 Créer le PV de réception
                </button>
              </form>
            </div>
          ) : (
            <>
              <PvHeaderEditor pv={pv} projectId={projectId} />

              {/* Statut + envoi client */}
              <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <Badge>{PV_STATUS_LABEL[pv.status]?.label ?? pv.status}</Badge>
                  {pv.sent_to_client_at && (
                    <span className="text-xs text-stoniz-gray-600 ml-2">
                      Envoyé au client le {fmtDate(pv.sent_to_client_at)}
                    </span>
                  )}
                  {pv.client_signed_at && (
                    <div className="text-xs text-emerald-700 mt-1">
                      ✓ Signé par <strong>{pv.client_signed_full_name}</strong> le {fmtDate(pv.client_signed_at)}
                    </div>
                  )}
                </div>
                {pv.status === 'draft' && (
                  <form action={async () => { 'use server'; await sendPvToClientAction(pv.id, projectId); }}>
                    <button className="bg-stoniz-black text-white px-4 py-2 rounded text-sm hover:bg-stoniz-gray-800">
                      📤 Envoyer au client pour signature
                    </button>
                  </form>
                )}
                {pv.status === 'sent_to_client' && (
                  <ReminderControls pv={pv} projectId={projectId} />
                )}
              </div>

              {/* Réserves */}
              <ReservesSection
                pvId={pv.id}
                projectId={projectId}
                reserves={reserves}
                artisans={artisans}
                isLocked={pv.status === 'validated'}
              />

              {/* Checklist PV */}
              <ReceptionChecklist
                mode="pv"
                parentId={pv.id}
                projectId={projectId}
                items={pvItems}
                isLocked={pv.status === 'validated'}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Composant éditeur header PV ──────────────────────────────────────────
function PvHeaderEditor({ pv, projectId }: { pv: any; projectId: string }) {
  return (
    <details className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
      <summary className="cursor-pointer font-medium">📝 Informations PV (parties, compteurs, clés)</summary>
      <form action={updatePvHeaderAction} className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <input type="hidden" name="pv_id" value={pv.id} />
        <input type="hidden" name="project_id" value={projectId} />

        <div className="md:col-span-2">
          <label className="text-xs text-stoniz-gray-600">Date de réception</label>
          <input
            name="reception_date"
            type="date"
            defaultValue={pv.reception_date ?? ''}
            className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-stoniz-gray-600">Présents côté Stoniz</label>
          <input
            name="parties_stoniz"
            defaultValue={pv.parties_stoniz ?? ''}
            placeholder="Othmane El Azzouzi, ..."
            className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-stoniz-gray-600">Présents côté client</label>
          <input
            name="parties_client"
            defaultValue={pv.parties_client ?? ''}
            placeholder="Nom du client + conjoint éventuel"
            className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
          />
        </div>

        <div className="md:col-span-2">
          <label className="text-xs text-stoniz-gray-600">Observations générales</label>
          <textarea
            name="general_observations"
            defaultValue={pv.general_observations ?? ''}
            rows={2}
            className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
          />
          <p className="text-[10px] text-stoniz-gray-500 mt-0.5">
            ✓ Visible côté client et dans le PDF du PV
          </p>
        </div>

        <div className="md:col-span-2 border-t border-amber-300 pt-3 mt-2 bg-amber-50/40 -mx-5 px-5 pb-3 -mb-2">
          <label className="text-xs text-amber-900 font-medium flex items-center gap-1.5">
            🔒 Note interne chef projet
          </label>
          <textarea
            name="internal_notes"
            defaultValue={pv.internal_notes ?? ''}
            rows={3}
            placeholder="Ex : Client mécontent suite incident lot peinture, à gérer avec délicatesse. Re-livraison prévue avec CEO."
            className="mt-1 w-full border border-amber-300 rounded px-3 py-2 text-sm bg-white"
          />
          <p className="text-[10px] text-amber-800 mt-1">
            ⚠ STRICTEMENT INTERNE — jamais visible côté client, ni dans le PDF généré.
            À utiliser pour le contexte sensible (relation client, alertes équipe…).
          </p>
        </div>

        <div className="md:col-span-2 flex justify-end">
          <button className="bg-stoniz-black text-white px-4 py-2 rounded text-sm hover:bg-stoniz-gray-800">
            Enregistrer
          </button>
        </div>
      </form>
    </details>
  );
}

// ─── Composant Réserves ──────────────────────────────────────────────────
function ReservesSection({
  pvId, projectId, reserves, artisans, isLocked,
}: {
  pvId: string;
  projectId: string;
  reserves: any[];
  artisans: any[];
  isLocked: boolean;
}) {
  const openReserves = reserves.filter(r => r.status === 'open');
  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden">
      <header className="px-4 py-3 bg-stoniz-gray-50 border-b border-stoniz-gray-200">
        <h3 className="font-medium">📝 Réserves contradictoires</h3>
        <p className="text-xs text-stoniz-gray-600 mt-0.5">
          Les réserves listées ici ne sont PAS bloquantes pour le passage en mise en location,
          mais doivent être suivies jusqu'à levée.
          {openReserves.length > 0 && <strong> · {openReserves.length} ouverte(s)</strong>}
        </p>
      </header>

      {!isLocked && (
        <form action={addPvReserveAction} className="p-4 bg-stoniz-gray-50 border-b border-stoniz-gray-200 grid grid-cols-1 md:grid-cols-4 gap-2">
          <input type="hidden" name="pv_id" value={pvId} />
          <input type="hidden" name="project_id" value={projectId} />
          <input
            name="description" required
            placeholder="Description de la réserve *"
            className="md:col-span-2 border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
          />
          <select name="artisan_id" className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm">
            <option value="">— Artisan (optionnel) —</option>
            {artisans.map((a: any) => (
              <option key={a.id} value={a.id}>
                {a.name}{a.speciality ? ` · ${a.speciality}` : ''}
              </option>
            ))}
          </select>
          <input
            name="deadline" type="date"
            className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
          />
          <select name="responsible_role" defaultValue="artisan"
            className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm">
            <option value="artisan">Artisan</option>
            <option value="stoniz">Stoniz</option>
            <option value="client">Client</option>
          </select>
          <button className="md:col-span-3 bg-stoniz-black text-white py-2 rounded text-sm">
            + Ajouter une réserve
          </button>
        </form>
      )}

      {reserves.length === 0 ? (
        <div className="p-6 text-center text-sm text-stoniz-gray-500">
          Aucune réserve. Idéal pour une livraison clean ✨
        </div>
      ) : (
        <ul className="divide-y divide-stoniz-gray-100">
          {reserves.map(r => (
            <li key={r.id} className={`p-4 flex items-start justify-between gap-3 ${r.status === 'resolved' ? 'opacity-50' : ''}`}>
              <div className="flex-1 min-w-0">
                <p className="text-sm">{r.description}</p>
                <div className="text-xs text-stoniz-gray-600 mt-1">
                  Responsable : {r.responsible_role ?? '—'}
                  {r.deadline && ` · Deadline : ${fmtDate(r.deadline)}`}
                  {r.resolved_at && ` · Levée le ${fmtDate(r.resolved_at)}`}
                </div>
                <PhotoGallery
                  projectId={projectId}
                  entityType="pv_reserve"
                  entityId={r.id}
                  photos={r.photos ?? []}
                  canEdit={!isLocked && r.status !== 'resolved'}
                  compact
                />
              </div>
              {r.status === 'open' && !isLocked && (
                <form action={async () => {
                  'use server';
                  await resolvePvReserveAction(r.id, projectId);
                }}>
                  <button className="text-xs text-emerald-700 hover:underline">
                    ✓ Lever la réserve
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Composant Relances client ────────────────────────────────────────────
function ReminderControls({ pv, projectId }: { pv: any; projectId: string }) {
  const lastReminderAt = pv.last_reminder_sent_at ? new Date(pv.last_reminder_sent_at) : null;
  const reminderCount = pv.reminder_count ?? 0;

  // Cooldown 24h
  const hoursSinceLastReminder = lastReminderAt
    ? (Date.now() - lastReminderAt.getTime()) / (1000 * 60 * 60)
    : Infinity;
  const cooldownRemainingH = Math.max(0, Math.ceil(24 - hoursSinceLastReminder));
  const canSend = cooldownRemainingH === 0;

  // Délai depuis envoi initial
  const daysSinceSent = pv.sent_to_client_at
    ? Math.floor((Date.now() - new Date(pv.sent_to_client_at).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={async () => {
        'use server';
        await sendPvReminderToClientAction(pv.id, projectId);
      }}>
        <button
          type="submit"
          disabled={!canSend}
          className={`px-4 py-2 rounded text-sm flex items-center gap-1.5 ${
            canSend
              ? (daysSinceSent >= 7 || reminderCount >= 3
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-orange-600 text-white hover:bg-orange-700')
              : 'bg-stoniz-gray-200 text-stoniz-gray-500 cursor-not-allowed'
          }`}
        >
          📨 {reminderCount > 0 ? `Relancer (${reminderCount + 1}e)` : 'Relancer le client'}
        </button>
      </form>
      {!canSend && (
        <div className="text-[11px] text-stoniz-gray-500">
          Prochaine relance possible dans ~{cooldownRemainingH}h
        </div>
      )}
      {reminderCount > 0 && lastReminderAt && (
        <div className="text-[11px] text-stoniz-gray-500">
          {reminderCount} relance{reminderCount > 1 ? 's' : ''} envoyée{reminderCount > 1 ? 's' : ''}
          {' · dernière le '}{lastReminderAt.toLocaleDateString('fr-FR')}
        </div>
      )}
      {daysSinceSent >= 7 && reminderCount === 0 && (
        <div className="text-[11px] text-red-700 font-medium">
          ⚠ {daysSinceSent} jours sans signature
        </div>
      )}
    </div>
  );
}
