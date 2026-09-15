import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PoliceRecordForm, type PoliceRecordFormSubmit } from '@/components/propria/police-record-form';
import { createPoliceRecordAction } from '../actions';

export default async function NewPoliceRecordPage({
  searchParams,
}: {
  searchParams: { source?: string; source_id?: string };
}) {
  await requireRole(['ceo', 'propria', 'assistante']);
  const supabase = createClient();

  const [propsRes, unitsRes] = await Promise.all([
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

  const properties = (propsRes.data ?? []).map((p: any) => ({
    id: p.id as string,
    label: (p.propria_internal_code ?? p.name) as string,
  }));
  const units = (unitsRes.data ?? []).map((u: any) => ({
    id: u.id as string,
    label: (u.code ?? (u.order_index != null ? `Suite ${u.order_index}` : 'Suite')) as string,
    property_id: u.property_id as string,
  }));

  // Permet de pré-remplir si on arrive depuis "Créer fiche" sur une réservation
  const reservationSource = searchParams.source ?? null;
  const reservationSourceId = searchParams.source_id ?? null;
  const initialReservation =
    reservationSource && reservationSourceId
      ? {
          reservation_source: reservationSource as 'hostaway' | 'direct' | 'cash',
          reservation_source_id: reservationSourceId,
        }
      : null;

  async function action(payload: PoliceRecordFormSubmit) {
    'use server';
    const res = await createPoliceRecordAction({
      ...payload,
      ...(initialReservation ?? {}),
    });
    if (!res.ok) return res;
    redirect(`/propria/fiches-police/${res.id}`);
  }

  return (
    <div className="max-w-7xl">
      <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
        <Link href="/propria" className="hover:text-stoniz-black">Propria</Link>
        {' · '}
        <Link href="/propria/fiches-police" className="hover:text-stoniz-black">Fiches police</Link>
        {' · Nouvelle'}
      </div>
      <h1 className="text-3xl font-display mb-6">🛂 Nouvelle fiche de police</h1>

      {initialReservation && (
        <div className="mb-4 text-xs bg-blue-50 border border-blue-200 text-blue-900 rounded p-3">
          Pré-remplissage automatique depuis la réservation{' '}
          <strong>{initialReservation.reservation_source}</strong>.
        </div>
      )}

      <PoliceRecordForm
        properties={properties}
        units={units}
        onSubmit={action}
        submitLabel="Créer la fiche (brouillon)"
      />
    </div>
  );
}
