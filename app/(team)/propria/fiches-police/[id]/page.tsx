import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import {
  POLICE_RECORDS_TABLE,
  computeMissingFields,
  type PoliceRecord,
} from '@/lib/propria/police-records';
import { PoliceRecordBadge } from '@/components/propria/police-record-badge';
import {
  PoliceRecordForm,
  type PoliceRecordFormSubmit,
} from '@/components/propria/police-record-form';
import { updatePoliceRecordAction } from '../actions';
import { WorkflowButtons } from './workflow-buttons';

export default async function PoliceRecordDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await requireRole(['ceo', 'propria', 'assistante', 'developer']);
  const supabase = createClient();

  const [recordRes, propsRes, unitsRes] = await Promise.all([
    supabase.from(POLICE_RECORDS_TABLE).select('*').eq('id', params.id).maybeSingle(),
    supabase
      .from('properties')
      .select('id, name, propria_internal_code')
      .not('propria_managed_at', 'is', null)
      .is('deleted_at', null)
      .order('propria_internal_code'),
    supabase
      .from('propria_units')
      .select('id, code, order_index, property_id')
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('order_index'),
  ]);

  if (!recordRes.data || (recordRes.data as any).deleted_at) notFound();
  const record = recordRes.data as PoliceRecord;

  const properties = (propsRes.data ?? []).map((p: any) => ({
    id: p.id as string,
    label: (p.propria_internal_code ?? p.name) as string,
  }));
  const units = (unitsRes.data ?? []).map((u: any) => ({
    id: u.id as string,
    label: (u.code ?? (u.order_index != null ? `Suite ${u.order_index}` : 'Suite')) as string,
    property_id: u.property_id as string,
  }));

  const readonly =
    user.role === 'developer' ||
    record.status === 'submitted' ||
    record.status === 'archived';
  const canWrite = !readonly;
  const canArchive = user.role === 'ceo';
  const canDelete = user.role === 'ceo';

  // Champs manquants pour passer en "complète"
  const missing = computeMissingFields(record);

  // Réservation source (lien vers la résa d'origine si possible)
  let reservationLink: { href: string; label: string } | null = null;
  if (record.reservation_source && record.reservation_source_id) {
    if (record.reservation_source === 'hostaway') {
      reservationLink = {
        href: `/propria/reservations`,
        label: 'Réservation Hostaway',
      };
    } else if (record.reservation_source === 'cash') {
      reservationLink = {
        href: `/propria/reservations-cash`,
        label: 'Réservation cash',
      };
    } else if (record.reservation_source === 'direct') {
      reservationLink = {
        href: `/propria/reservations`,
        label: 'Réservation directe',
      };
    }
  }

  // Bind l'action update à l'ID — server-only
  async function update(payload: PoliceRecordFormSubmit) {
    'use server';
    return await updatePoliceRecordAction(params.id, payload);
  }

  // Référence courte (les FP-YYYY-NNNN sont générées au PDF)
  const shortRef = record.id.slice(0, 8);

  return (
    <div className="max-w-7xl">
      <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
        <Link href="/propria" className="hover:text-stoniz-black">Propria</Link>
        {' · '}
        <Link href="/propria/fiches-police" className="hover:text-stoniz-black">Fiches police</Link>
        {' · '}{shortRef}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl md:text-3xl font-display">
              🛂 Fiche police <span className="font-mono text-base text-stoniz-gray-500">{shortRef}</span>
            </h1>
            <PoliceRecordBadge status={record.status} />
          </div>
          {readonly && user.role === 'developer' && (
            <p className="mt-2 inline-block bg-stoniz-gray-100 text-stoniz-gray-700 text-xs px-2 py-1 rounded">
              Lecture seule (developer)
            </p>
          )}
          {readonly && user.role !== 'developer' && (
            <p className="mt-2 inline-block bg-emerald-50 text-emerald-800 text-xs px-2 py-1 rounded border border-emerald-200">
              Fiche verrouillée ({record.status === 'submitted' ? 'déposée commissariat' : 'archivée'})
            </p>
          )}
        </div>
        <Link
          href="/propria/fiches-police"
          className="text-xs hover:underline whitespace-nowrap"
        >
          ← Retour à la liste
        </Link>
      </div>

      {/* Métadonnées rapides */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6 text-xs">
        <div className="bg-white border border-stoniz-gray-200 rounded p-3">
          <p className="text-stoniz-gray-500 uppercase">Créée le</p>
          <p className="font-medium">{new Date(record.created_at).toLocaleString('fr-FR')}</p>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded p-3">
          <p className="text-stoniz-gray-500 uppercase">Source données</p>
          <p className="font-medium">{record.data_source}</p>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded p-3">
          <p className="text-stoniz-gray-500 uppercase">Personnes</p>
          <p className="font-medium">{record.total_persons_count ?? 1}</p>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded p-3">
          <p className="text-stoniz-gray-500 uppercase">Déposée le</p>
          <p className="font-medium">
            {record.submitted_at
              ? new Date(record.submitted_at).toLocaleDateString('fr-FR')
              : '—'}
          </p>
        </div>
      </div>

      {reservationLink && (
        <div className="mb-4 text-xs">
          <Link href={reservationLink.href} className="text-blue-700 hover:underline">
            → Voir la {reservationLink.label} d'origine
          </Link>
        </div>
      )}

      {/* Workflow */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4 sm:p-6 mb-6">
        <p className="text-xs uppercase tracking-wider text-stoniz-gray-500 mb-3">
          Workflow
        </p>
        {record.status === 'draft' && missing.length > 0 && (
          <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded p-3 mb-3">
            <strong>Champs manquants pour passer en « Complète » :</strong>{' '}
            {missing.join(', ')}
          </div>
        )}
        <WorkflowButtons
          id={record.id}
          status={record.status}
          canWrite={canWrite}
          canArchive={canArchive}
          canDelete={canDelete}
        />
      </div>

      {/* Formulaire */}
      <PoliceRecordForm
        record={record}
        properties={properties}
        units={units}
        readonly={readonly}
        onSubmit={update}
        submitLabel="Sauvegarder les modifications"
        showMissingHighlight={record.status === 'draft'}
      />
    </div>
  );
}
