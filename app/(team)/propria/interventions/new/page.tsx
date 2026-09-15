import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { InterventionForm } from '@/components/propria/intervention-form';
import { BackLink } from '@/components/ui/back-link';
import { buildScopeGroups } from '@/lib/propria/intervention-scope';
import { getUpcomingResaOptions } from '@/lib/propria/reservations';
import { createInterventionAction } from '../actions';

export default async function NewInterventionPage({
  searchParams,
}: { searchParams: { property?: string; unit?: string } }) {
  const me = await requireRole(['ceo','developer','assistante','propria']);
  const supabase = createClient();

  const [propsRes, unitsRes, typesRes, provRes, profRes, walletsRes, resaOptions] = await Promise.all([
    supabase.from('properties').select('id, name, propria_internal_code')
      .not('propria_managed_at', 'is', null).is('deleted_at', null).order('propria_internal_code'),
    supabase.from('propria_units').select('id, code, order_index, property_id')
      .is('deleted_at', null).eq('is_active', true),
    supabase.from('propria_intervention_types').select('id, name, category')
      .eq('is_active', true).order('display_order'),
    supabase.from('propria_providers').select('id, name, function')
      .eq('is_active', true).is('deleted_at', null).order('name'),
    // Responsable interne = collaborateurs équipe Propria + supervision CEO/chef de projet
    supabase.from('profiles').select('id, full_name, role')
      .eq('is_active', true)
      .in('role', ['propria', 'ceo', 'chef_projet'])
      .order('full_name'),
    // Caisses Propria actives avec solde et propriétaire (pour le sélecteur "Payé depuis…")
    supabase.from('propria_wallets')
      .select('id, label, profile_id, is_active, owner:profiles!propria_wallets_profile_id_fkey(full_name)')
      .eq('is_active', true)
      .order('label'),
    // Chantier 14 : résas en cours/à venir pour le sélecteur « Réservation liée »
    getUpcomingResaOptions(),
  ]);

  // Charge les soldes en parallèle (vue séparée)
  const { data: balanceRows } = await supabase
    .from('propria_wallet_balances')
    .select('wallet_id, solde_mad');
  const balanceById = new Map<string, number>(
    ((balanceRows ?? []) as any[]).map((b) => [b.wallet_id, Number(b.solde_mad ?? 0)])
  );

  const wallets = ((walletsRes.data ?? []) as any[]).map((w) => {
    const ownerName = (w as any).owner?.full_name ?? null;
    return {
      id: w.id,
      label: ownerName ? `${ownerName} (${w.label ?? 'Caisse'})` : (w.label ?? 'Caisse'),
      balance_mad: balanceById.get(w.id) ?? 0,
      is_validated_lock: false,
      profile_id: w.profile_id,
    };
  });

  // Caisse par défaut = celle du créateur (si rôle propria et qu'il a une caisse)
  const defaultWalletId = wallets.find((w) => w.profile_id === me.id)?.id ?? null;

  const scopeGroups = buildScopeGroups(propsRes.data ?? [], unitsRes.data ?? []);
  const initialScope = searchParams.unit
    ? `unit:${searchParams.unit}`
    : searchParams.property
      ? `property:${searchParams.property}`
      : '';

  return (
    <div className="max-w-3xl">
      <BackLink href="/propria/interventions" label="Retour aux interventions" />
      <div className="mb-6 mt-2">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
          <Link href="/propria/interventions" className="hover:text-stoniz-black">Interventions</Link> · Nouvelle
        </div>
        <h1 className="text-3xl font-display">Nouvelle intervention</h1>
      </div>

      <InterventionForm
        initial={initialScope ? { scope: initialScope } : undefined}
        scopeGroups={scopeGroups}
        types={(typesRes.data ?? []).map((t: any) => ({ id: t.id, label: `${t.name} (${t.category})` }))}
        providers={(provRes.data ?? []).map((p: any) => ({
          id: p.id, label: `${p.name}${p.function ? ' · ' + p.function : ''}`,
        }))}
        profiles={(profRes.data ?? []).map((p: any) => ({ id: p.id, label: p.full_name }))}
        wallets={wallets}
        defaultWalletId={defaultWalletId}
        reservations={resaOptions}
        action={createInterventionAction}
        submitLabel="Créer l'intervention"
      />
    </div>
  );
}
