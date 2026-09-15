import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { CheckupForm } from '@/components/propria/checkup-form';
import { CheckupChecklistGrid, type CheckupItemRow, type TransformedByItem } from '@/components/propria/checkup-checklist-grid';
import { CheckupProofUploader, type CheckupProof } from '@/components/propria/checkup-proof-uploader';
import { CheckupWorkflowActions, type CheckupProblemItem } from '@/components/propria/checkup-workflow-actions';
import { CheckupInventoryGrid, type InventoryRow, type MeasurementRow } from '@/components/propria/checkup-inventory-grid';
import { PropriaDeleteButton } from '@/components/propria/propria-delete-button';
import { CommentsThread } from '@/components/propria/comments-thread';
import { buildScopeGroups, scopeValue } from '@/lib/propria/intervention-scope';
import { TOTAL_CHECKUP_ITEMS, findCheckupItem } from '@/lib/propria/checkup-checklist';
import { updateCheckupAction, getCheckupProofUrls } from '../actions';

const STATUS_META: Record<string, { label: string; icon: string }> = {
  a_faire: { label: 'À faire', icon: '⏳' },
  en_cours: { label: 'En cours', icon: '🔄' },
  a_valider: { label: 'À valider', icon: '📋' },
  valide: { label: 'Validé', icon: '✓' },
  annule: { label: 'Annulé', icon: '✕' },
};

const STEPS = [
  { key: 'a_faire', label: 'À faire' },
  { key: 'en_cours', label: 'En cours' },
  { key: 'a_valider', label: 'À valider' },
  { key: 'valide', label: 'Validé' },
] as const;

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export default async function CheckupDetailPage({ params }: { params: { id: string } }) {
  const user = await requireRole(['ceo', 'developer', 'assistante', 'propria']);
  const supabase = createClient();

  const [checkupRes, propsRes, unitsRes, profRes, itemsRes, createdRes, invRes, measRes, createdLitigesRes] = await Promise.all([
    supabase.from('propria_checkups').select('*').eq('id', params.id).single(),
    supabase.from('properties').select('id, name, propria_internal_code')
      .not('propria_managed_at', 'is', null).is('deleted_at', null).order('propria_internal_code'),
    supabase.from('propria_units').select('id, code, order_index, property_id')
      .is('deleted_at', null).eq('is_active', true),
    supabase.from('profiles').select('id, full_name, role').eq('is_active', true)
      .neq('role', 'client').order('full_name'),
    supabase.from('propria_checkup_items')
      .select('item_key, status, note')
      .eq('checkup_id', params.id).is('deleted_at', null),
    supabase.from('propria_interventions')
      .select('id, kind, description, status, urgency, source_checkup_item_key')
      .eq('source_checkup_id', params.id).is('deleted_at', null)
      .order('created_at', { ascending: true }),
    supabase.from('propria_checkup_inventory')
      .select('item_key, expected_qty, actual_qty, missing_list, note')
      .eq('checkup_id', params.id).is('deleted_at', null),
    supabase.from('propria_checkup_measurements')
      .select('item_key, value_numeric, unit, note')
      .eq('checkup_id', params.id).is('deleted_at', null),
    supabase.from('propria_litiges')
      .select('id, type, description, kanban_column, source_checkup_item_key')
      .eq('source_checkup_id', params.id).is('deleted_at', null)
      .order('created_at', { ascending: true }),
  ]);

  if (!checkupRes.data || checkupRes.data.deleted_at) notFound();
  const checkup = checkupRes.data;

  const properties = propsRes.data ?? [];
  const units = unitsRes.data ?? [];
  const scopeGroups = buildScopeGroups(properties, units);
  const propsMap = new Map(properties.map((p: any) => [p.id, p.propria_internal_code ?? p.name]));
  const unitsMap = new Map(units.map((u: any) => [u.id, { label: u.code ?? `Suite ${u.order_index}`, property_id: u.property_id }]));

  let scopeLabel = '—';
  let bienId: string | null = checkup.property_id ?? null;
  if (checkup.propria_unit_id) {
    const u = unitsMap.get(checkup.propria_unit_id) as any;
    if (u) {
      scopeLabel = `${propsMap.get(u.property_id) ?? 'Bien'} · ${u.label}`;
      bienId = u.property_id;
    }
  } else if (checkup.property_id) {
    scopeLabel = `${propsMap.get(checkup.property_id) ?? 'Bien'} · Bien entier`;
  }

  const items = (itemsRes.data ?? []) as CheckupItemRow[];
  const proofs = (await getCheckupProofUrls(params.id)) as CheckupProof[];
  const uploaderNames: Record<string, string> = Object.fromEntries(
    (profRes.data ?? []).map((p: any) => [p.id, p.full_name]),
  );

  // ─── Dérivés (jamais stockés) : blocage soumission + items problème ──────
  const proofKeys = new Set(proofs.map((p) => p.itemKey).filter(Boolean));
  const missingCount = TOTAL_CHECKUP_ITEMS - items.length;
  const problems = items.filter((i) => i.status === 'probleme');
  const problemsMissingNote = problems.filter((i) => !(i.note ?? '').trim()).length;
  const problemsMissingPhoto = problems.filter((i) => !proofKeys.has(i.item_key)).length;
  const problemItems: CheckupProblemItem[] = problems.map((i) => {
    const ref = findCheckupItem(i.item_key);
    return { item_key: i.item_key, label: ref?.label ?? i.item_key, emoji: ref?.emoji ?? '⚠️', note: i.note };
  });

  const isBackOffice = ['ceo', 'assistante', 'developer'].includes(user.role);
  const canValidate = ['ceo', 'assistante'].includes(user.role);
  const canEditChecklist = checkup.status === 'en_cours';
  const generalProofs = proofs.filter((p) => !p.itemKey);
  const createdTasks = (createdRes.data ?? []) as any[];
  const createdLitiges = (createdLitigesRes.data ?? []) as any[];
  const inventory = (invRes.data ?? []) as InventoryRow[];
  const measurements = (measRes.data ?? []) as MeasurementRow[];

  // ─── Phase C1 — Transformations inline ─────────────────────────────────
  // 1. canTransform : rôle propria + ceo + assistante (pas menage, pas developer).
  //    Le rôle menage n'a pas accès à cette page (router guard), mais on garde
  //    la double sécurité au cas où. Independent du statut : on permet de
  //    transformer même sur 'a_valider' (avant validation finale) ou 'valide'
  //    (retroactif). On bloque uniquement sur 'annule' (côté server action).
  const canTransform =
    ['ceo', 'assistante', 'propria'].includes(user.role)
    && checkup.status !== 'annule';
  // 2. Mapping item_key → ids créés (idempotence UI + badge "Transformé")
  const transformedByItem: TransformedByItem = {};
  for (const t of createdTasks) {
    const key = t.source_checkup_item_key as string | null;
    if (!key) continue;
    const slot = transformedByItem[key] ?? {};
    if (t.kind === 'tache') slot.tache = t.id;
    else if (t.kind === 'intervention') slot.intervention = t.id;
    transformedByItem[key] = slot;
  }
  for (const l of createdLitiges) {
    const key = l.source_checkup_item_key as string | null;
    if (!key) continue;
    const slot = transformedByItem[key] ?? {};
    slot.litige = l.id;
    transformedByItem[key] = slot;
  }
  // 3. hasHostawayContext : true si une résa Hostaway < 30j existe sur ce lot.
  //    Reproduit la garde de validateCheckupAction. Utilisé pour activer ou
  //    désactiver la checkbox "Litige" dans la modale.
  let hasHostawayContext = false;
  if (checkup.propria_unit_id) {
    const monthAgoIso = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const { data: listings } = await supabase
      .from('hostaway_listings')
      .select('id')
      .is('deleted_at', null)
      .eq('propria_unit_id', checkup.propria_unit_id);
    const listingIds = ((listings ?? []) as any[]).map((l) => l.id);
    if (listingIds.length > 0) {
      const { data: resas } = await supabase
        .from('hostaway_reservations')
        .select('hostaway_id')
        .in('hostaway_listing_db_id', listingIds)
        .in('status', ['new', 'modified'])
        .is('deleted_at', null)
        .gte('departure_date', monthAgoIso)
        .limit(1);
      hasHostawayContext = ((resas ?? []) as any[]).length > 0;
    }
  }

  const updateAction = updateCheckupAction.bind(null, params.id);
  const meta = STATUS_META[checkup.status] ?? { label: checkup.status, icon: '•' };
  const currentIdx = STEPS.findIndex((s) => s.key === checkup.status);
  const assignedName = checkup.assigned_to_id ? uploaderNames[checkup.assigned_to_id] : null;
  const validatedName = checkup.validated_by ? uploaderNames[checkup.validated_by] : null;

  return (
    <div className="max-w-5xl">
      <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
        <Link href="/propria" className="hover:text-stoniz-black">Propria</Link>
        {' · '}
        <Link href="/propria/checkups" className="hover:text-stoniz-black">Check-ups</Link>
        {' · '}
        Détail
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-6 mb-6">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-teal-700 mb-1">🩺 Check-up logement</div>
          <h1 className="text-2xl font-display">{scopeLabel}</h1>
          <div className="text-sm text-stoniz-gray-600 mt-1">
            {checkup.due_date && <>échéance {new Date(checkup.due_date).toLocaleDateString('fr-FR')} · </>}
            {bienId && (
              <Link href={`/propria/biens/${bienId}`} className="hover:underline">fiche bien →</Link>
            )}
          </div>
        </div>
        <div className="flex flex-col items-stretch sm:items-end gap-2">
          <span className="text-xs uppercase tracking-wider text-stoniz-gray-500 sm:text-right">{meta.icon} {meta.label}</span>
          <CheckupWorkflowActions
            id={params.id}
            status={checkup.status}
            canValidate={canValidate}
            isBackOffice={isBackOffice}
            missingCount={missingCount}
            problemsMissingNote={problemsMissingNote}
            problemsMissingPhoto={problemsMissingPhoto}
            problemItems={problemItems}
          />
          <Link
            href={`/propria/checkups/${params.id}/rapport`}
            className="text-xs text-stoniz-gray-500 hover:text-stoniz-black sm:text-right"
          >
            🖨 Voir le rapport imprimable →
          </Link>
        </div>
      </div>

      {/* Classification finale + résumé exécutif (chantier 4) */}
      {checkup.final_classification && (
        <div className={`border-2 rounded-xl p-4 mb-5 ${
          checkup.final_classification === 'A' ? 'bg-emerald-50 border-emerald-300' :
          checkup.final_classification === 'B' ? 'bg-amber-50 border-amber-300' :
          checkup.final_classification === 'C' ? 'bg-orange-50 border-orange-300' :
          'bg-red-50 border-red-300'
        }`}>
          <div className="flex items-baseline gap-3 mb-1.5">
            <span className="font-display text-4xl leading-none">{checkup.final_classification}</span>
            <span className="text-sm font-medium">
              {checkup.final_classification === 'A' && 'Parfait — aucune action'}
              {checkup.final_classification === 'B' && 'Quelques retouches'}
              {checkup.final_classification === 'C' && 'Travaux à prévoir'}
              {checkup.final_classification === 'D' && 'Bloquant pour exploitation'}
            </span>
          </div>
          {checkup.final_summary && (
            <p className="text-sm text-stoniz-gray-800 whitespace-pre-wrap">{checkup.final_summary}</p>
          )}
        </div>
      )}

      {/* Stepper */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4 mb-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <span className={`px-2 py-1 rounded-full ${
                i === currentIdx ? 'bg-stoniz-black text-white' :
                i < currentIdx ? 'bg-emerald-100 text-emerald-700' : 'bg-stoniz-gray-100 text-stoniz-gray-500'
              }`}>
                {i < currentIdx ? '✓' : ''} {s.label}
              </span>
              {i < STEPS.length - 1 && <span className="text-stoniz-gray-300">→</span>}
            </div>
          ))}
          {checkup.status === 'annule' && (
            <span className="ml-2 text-stoniz-gray-500 italic">✕ Annulé</span>
          )}
        </div>
      </div>

      {/* Infos clés */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-3">
          <div className="text-[11px] uppercase text-stoniz-gray-500">Contrôleur</div>
          <div className="text-sm font-medium">{assignedName ?? <span className="text-orange-600">Non assigné</span>}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-3">
          <div className="text-[11px] uppercase text-stoniz-gray-500">Démarré</div>
          <div className="text-sm font-medium">{formatDateTime(checkup.started_at)}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-3">
          <div className="text-[11px] uppercase text-stoniz-gray-500">Soumis</div>
          <div className="text-sm font-medium">{formatDateTime(checkup.submitted_at)}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-3">
          <div className="text-[11px] uppercase text-stoniz-gray-500">Validé</div>
          <div className="text-sm font-medium">
            {formatDateTime(checkup.validated_at)}
            {validatedName && <span className="text-stoniz-gray-500 text-xs"> · {validatedName}</span>}
          </div>
        </div>
      </div>

      {/* Checklist interactive */}
      <div className="mb-5">
        <CheckupChecklistGrid
          checkupId={params.id}
          items={items}
          proofs={proofs}
          uploaderNames={uploaderNames}
          canEdit={canEditChecklist}
          canDelete={isBackOffice}
          canTransform={canTransform}
          transformedByItem={transformedByItem}
          hasHostawayContext={hasHostawayContext}
        />
      </div>

      {/* Inventaire & mesures chiffrées */}
      <div className="mb-5">
        <CheckupInventoryGrid
          checkupId={params.id}
          inventory={inventory}
          measurements={measurements}
          canEdit={canEditChecklist}
        />
      </div>

      {/* Tâches / interventions / litiges créés depuis ce check-up (traçabilité) */}
      {(createdTasks.length > 0 || createdLitiges.length > 0) && (
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mb-5">
          <h2 className="font-display text-lg mb-3">
            🔧 Créés depuis ce check-up ({createdTasks.length + createdLitiges.length})
          </h2>
          <div className="space-y-1.5">
            {createdTasks.map((t) => {
              // Phase C1 : mapping item ↔ création — si source_checkup_item_key
              // est rempli, on affiche le label de l'item source.
              const itemRef = t.source_checkup_item_key
                ? findCheckupItem(t.source_checkup_item_key)
                : null;
              return (
                <Link key={t.id} href={`/propria/interventions/${t.id}`}
                  className="block border border-stoniz-gray-200 rounded-lg px-3 py-2 text-sm hover:bg-stoniz-gray-50">
                  <span className="text-[10px] uppercase text-stoniz-gray-500 mr-2">
                    {t.kind === 'tache' ? '📌 Tâche' : '🔧 Intervention'}
                  </span>
                  {itemRef && (
                    <span className="text-[10px] uppercase text-blue-700 mr-2">
                      {itemRef.emoji} {itemRef.label} →
                    </span>
                  )}
                  {t.description}
                  <span className="float-right text-xs text-stoniz-gray-400">{t.status}</span>
                </Link>
              );
            })}
            {createdLitiges.map((l: any) => {
              const itemRef = l.source_checkup_item_key
                ? findCheckupItem(l.source_checkup_item_key)
                : null;
              return (
                <Link key={l.id} href={`/propria/litiges#${l.id}`}
                  className="block border border-stoniz-gray-200 rounded-lg px-3 py-2 text-sm hover:bg-stoniz-gray-50">
                  <span className="text-[10px] uppercase text-red-700 mr-2">⚖️ Litige · {l.type}</span>
                  {itemRef && (
                    <span className="text-[10px] uppercase text-blue-700 mr-2">
                      {itemRef.emoji} {itemRef.label} →
                    </span>
                  )}
                  {l.description}
                  <span className="float-right text-xs text-stoniz-gray-400">{l.kanban_column}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* Photos générales (hors items) */}
      <div className="mb-5">
        <CheckupProofUploader
          checkupId={params.id}
          proofs={generalProofs}
          uploaderNames={uploaderNames}
          canUpload={checkup.status === 'en_cours' || isBackOffice}
          canDelete={isBackOffice}
          itemKey={null}
          title={`📷 Photos générales (${generalProofs.length})`}
        />
      </div>

      {/* Fil de commentaires partagé (chantier 6, entity élargie au checkup) */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mb-5">
        <CommentsThread
          entityType="checkup"
          entityId={params.id}
          profiles={(profRes.data ?? []).map((p: any) => ({ id: p.id, full_name: p.full_name }))}
          canDelete={user.role === 'ceo'}
        />
      </div>

      {/* Édition (lot / assigné / échéance / consignes) */}
      <h2 className="font-display text-lg mb-3">Détails</h2>
      <CheckupForm
        initial={{
          ...checkup,
          due_date: checkup.due_date ?? '',
          scope: scopeValue(checkup),
        }}
        scopeGroups={scopeGroups}
        profiles={(profRes.data ?? []).map((p: any) => ({ id: p.id, label: p.full_name }))}
        action={updateAction}
        submitLabel="Mettre à jour"
      />

      <div className="flex justify-end mt-3">
        <PropriaDeleteButton table="propria_checkups" id={params.id} />
      </div>
    </div>
  );
}
