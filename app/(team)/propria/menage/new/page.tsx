import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { CleaningForm } from '@/components/propria/cleaning-form';
import { buildScopeGroups } from '@/lib/propria/intervention-scope';
import { createCleaningAction } from '../actions';

export default async function NewCleaningPage() {
  await requireRole(['ceo', 'assistante', 'propria']);
  const supabase = createClient();

  const [propsRes, unitsRes, typesRes, profRes] = await Promise.all([
    supabase.from('properties').select('id, name, propria_internal_code')
      .not('propria_managed_at', 'is', null).is('deleted_at', null).order('propria_internal_code'),
    supabase.from('propria_units').select('id, code, order_index, property_id')
      .is('deleted_at', null).eq('is_active', true),
    supabase.from('propria_cleaning_types').select('id, name')
      .eq('is_active', true).order('display_order'),
    supabase.from('profiles').select('id, full_name, role').eq('is_active', true)
      .neq('role', 'client').order('full_name'),
  ]);

  const scopeGroups = buildScopeGroups(propsRes.data ?? [], unitsRes.data ?? []);

  return (
    <div className="max-w-7xl">
      <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
        <Link href="/propria" className="hover:text-stoniz-black">Propria</Link>
        {' · '}
        <Link href="/propria/menage" className="hover:text-stoniz-black">Ménage</Link>
        {' · Nouveau'}
      </div>
      <h1 className="text-3xl font-display mb-6">🧹 Nouveau ménage</h1>

      <CleaningForm
        scopeGroups={scopeGroups}
        types={(typesRes.data ?? []).map((t: any) => ({ id: t.id, label: t.name }))}
        profiles={(profRes.data ?? []).map((p: any) => ({ id: p.id, label: p.full_name }))}
        action={createCleaningAction}
        submitLabel="Créer le ménage"
      />
    </div>
  );
}
