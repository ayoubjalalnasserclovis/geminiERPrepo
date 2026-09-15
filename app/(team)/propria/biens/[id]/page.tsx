import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PropriaBienForm } from '@/components/propria/propria-bien-form';
import { PropriaBienWarningsBanner } from '@/components/propria/propria-bien-warnings-banner';
import { DeletePropertyButton } from '@/components/propria/delete-property-button';
import { PropriaUnitsList } from '@/components/propria/propria-units-list';
import { PropriaBienReviewsSection } from '@/components/propria/propria-bien-reviews-section';
import { PropriaBienAvisCommentsSection } from '@/components/propria/propria-bien-avis-comments-section';
import { PropriaBienPerformanceSection } from '@/components/propria/propria-bien-performance-section';
import { PropriaBienCheckupsSection } from '@/components/propria/propria-bien-checkups-section';
import { PropriaBienQualitySection } from '@/components/propria/propria-bien-quality-section';
import { PropriaBienCleaningCostSection } from '@/components/propria/propria-bien-cleaning-cost-section';
import { PropriaAuditTimeline } from '@/components/propria/propria-audit-timeline';
import { PropriaUnitKeysSection } from '@/components/propria/propria-unit-keys-section';
import { BackLink } from '@/components/ui/back-link';
import { updatePropriaPropertyAction } from '../actions';
import {
  ClipboardList, CalendarCheck, ListChecks, BedDouble, Star, ExternalLink,
} from 'lucide-react';

export default async function PropriaBienDetailPage({ params }: { params: { id: string } }) {
  const me = await requireRole(['ceo','developer','assistante','propria']);
  const supabase = createClient();

  const [bienRes, providersRes, intStatsRes, maintRes, lastListingRes, projectRes, unitsCountRes] = await Promise.all([
    supabase.from('properties').select('*').eq('id', params.id).single(),
    supabase.from('propria_providers').select('id, name, function')
      .eq('is_active', true).is('deleted_at', null).order('name'),
    supabase.from('propria_interventions').select('id, status, urgency')
      .eq('property_id', params.id).is('deleted_at', null),
    supabase.from('propria_maintenance_visits').select('id, quarter, status, due_date')
      .eq('property_id', params.id).is('deleted_at', null).order('due_date', { ascending: false }).limit(4),
    supabase.from('propria_listing_metrics').select('platform, rating, nb_reviews, measured_at')
      .eq('property_id', params.id).is('deleted_at', null).order('measured_at', { ascending: false }).limit(4),
    supabase.from('projects').select('id, reference').eq('property_id', params.id).is('deleted_at', null).maybeSingle(),
    supabase.from('propria_units').select(`
      id, code,
      propria_apartment_door, propria_capacity_voyageurs, propria_nb_chambres, propria_type_lits,
      propria_lock_code, propria_key_box_suite, propria_nb_keys,
      propria_key_box_location, propria_arrival_instructions,
      propria_security_key_location, propria_security_key_code,
      propria_wifi_ssid, propria_airbnb_url, propria_booking_url,
      propria_base_price_per_night, propria_drive_photos_url, propria_observations,
      propria_listing_published_at, propria_default_provider_id,
      order_index
    `).eq('property_id', params.id).is('deleted_at', null).order('order_index'),
  ]);

  if (!bienRes.data || !bienRes.data.propria_managed_at) notFound();
  const bien = bienRes.data;

  // Accès & Clés : statut dérivé + jeux physiques de tous les lots du bien
  const unitIds = ((unitsCountRes.data ?? []) as any[]).map((u) => u.id);
  const [keysStatusRes, keysRes] = await Promise.all([
    unitIds.length
      ? supabase.from('propria_unit_keys_status').select('*').in('propria_unit_id', unitIds)
      : Promise.resolve({ data: [] as any[] }),
    unitIds.length
      ? supabase.from('propria_keys')
          .select('id, propria_unit_id, key_number, key_type, current_location, label')
          .in('propria_unit_id', unitIds)
          .is('deleted_at', null)
          .order('key_number')
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const keysStatusByUnit = new Map(((keysStatusRes.data ?? []) as any[]).map((s) => [s.propria_unit_id, s]));
  const keysByUnit = new Map<string, any[]>();
  for (const k of (keysRes.data ?? []) as any[]) {
    if (!keysByUnit.has(k.propria_unit_id)) keysByUnit.set(k.propria_unit_id, []);
    keysByUnit.get(k.propria_unit_id)!.push(k);
  }
  const ints = (intStatsRes.data ?? []) as any[];
  const intActive = ints.filter(i => ['a_traiter','en_cours'].includes(i.status)).length;
  const intCrit = ints.filter(i => i.urgency === 'critique' && ['a_traiter','en_cours'].includes(i.status)).length;

  // ✏️ on bind l'id à l'action
  const updateAction = updatePropriaPropertyAction.bind(null, params.id);

  return (
    <div className="max-w-5xl">
      <BackLink href="/propria/biens" label="Retour aux biens gérés" />
      <div className="mb-6 mt-2">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
          <Link href="/propria/biens" className="hover:text-stoniz-black">Biens gérés</Link>
          {bien.propria_internal_code && <> · {bien.propria_internal_code}</>}
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl md:text-3xl font-display">{bien.name}</h1>
          <div className="flex flex-wrap gap-2">
            {projectRes.data && (
              <Link
                href={`/projects/${projectRes.data.id}`}
                className="bg-stoniz-black text-white text-xs px-3 py-1 rounded-full hover:bg-stoniz-gray-800"
              >
                Projet Stoniz · {projectRes.data.reference}
              </Link>
            )}
            {bien.propria_airbnb_url && (
              <a
                href={bien.propria_airbnb_url}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1 text-xs bg-pink-100 text-pink-800 px-3 py-1 rounded-full hover:bg-pink-200"
              >
                Airbnb <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {bien.propria_booking_url && (
              <a
                href={bien.propria_booking_url}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-800 px-3 py-1 rounded-full hover:bg-blue-200"
              >
                Booking <ExternalLink className="w-3 h-3" />
              </a>
            )}
            <DeletePropertyButton
              propertyId={bien.id}
              propertyName={bien.name}
              ownerName={bien.propria_owner_name}
              userRole={me.role}
              unitsCount={(unitsCountRes.data ?? []).length}
            />
          </div>
        </div>
      </div>

      {/* Raccourcis */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        <Link
          href={`/propria/interventions?property=${bien.id}`}
          className="bg-white border border-stoniz-gray-200 rounded-lg p-4 hover:border-stoniz-gray-400"
        >
          <ClipboardList className="w-4 h-4 text-stoniz-gray-500 mb-2" />
          <div className="text-xl font-display">{intActive}</div>
          <div className="text-xs text-stoniz-gray-600">interventions actives</div>
          {intCrit > 0 && (
            <div className="text-[10px] text-red-600 mt-1">🔴 {intCrit} critique(s)</div>
          )}
        </Link>
        <Link
          href={`/propria/maintenance?property=${bien.id}`}
          className="bg-white border border-stoniz-gray-200 rounded-lg p-4 hover:border-stoniz-gray-400"
        >
          <CalendarCheck className="w-4 h-4 text-stoniz-gray-500 mb-2" />
          <div className="text-xs text-stoniz-gray-600">Maintenance préventive</div>
          {(maintRes.data ?? []).slice(0, 1).map((m: any) => (
            <div key={m.id} className="text-xs mt-1">
              {m.quarter} ·{' '}
              <span className={
                m.status === 'realise' ? 'text-emerald-600' :
                m.status === 'en_retard' ? 'text-red-600' : 'text-amber-600'
              }>
                {m.status === 'realise' ? '✓ fait' :
                 m.status === 'en_retard' ? '⚠ en retard' :
                 m.status === 'planifie' ? '🕓 planifié' : 'à planifier'}
              </span>
            </div>
          ))}
        </Link>
        <Link
          href={`/propria/inventaires?property=${bien.id}`}
          className="bg-white border border-stoniz-gray-200 rounded-lg p-4 hover:border-stoniz-gray-400"
        >
          <ListChecks className="w-4 h-4 text-stoniz-gray-500 mb-2" />
          <div className="text-xs text-stoniz-gray-600">Inventaires</div>
        </Link>
        <Link
          href={`/propria/reservations-cash?property=${bien.id}`}
          className="bg-white border border-stoniz-gray-200 rounded-lg p-4 hover:border-stoniz-gray-400"
        >
          <BedDouble className="w-4 h-4 text-stoniz-gray-500 mb-2" />
          <div className="text-xs text-stoniz-gray-600">Réservations cash</div>
        </Link>
        <Link
          href={`/propria/listings?property=${bien.id}`}
          className="bg-white border border-stoniz-gray-200 rounded-lg p-4 hover:border-stoniz-gray-400"
        >
          <Star className="w-4 h-4 text-stoniz-gray-500 mb-2" />
          <div className="text-xs text-stoniz-gray-600">Notes annonces</div>
          {(lastListingRes.data ?? []).slice(0, 1).map((l: any, i) => (
            <div key={i} className="text-xs mt-1">
              {l.platform}: {l.rating ?? '—'} ({l.nb_reviews ?? 0})
            </div>
          ))}
        </Link>
      </div>

      <div className="mb-6">
        <PropriaBienWarningsBanner bien={bien} />
      </div>

      {/* Liste des lots du bien — version complète */}
      <div className="mb-6">
        <PropriaUnitsList
          units={(unitsCountRes.data ?? []) as any}
          propertyId={bien.id}
          compact={false}
          providers={providersRes.data ?? []}
        />
      </div>

      {/* Accès & Clés — chantier 1 marathon (un bloc par lot) */}
      {((unitsCountRes.data ?? []) as any[]).map((u: any) => (
        <PropriaUnitKeysSection
          key={u.id}
          unit={u}
          propertyId={bien.id}
          status={keysStatusByUnit.get(u.id) ?? null}
          keys={keysByUnit.get(u.id) ?? []}
          userRole={me.role}
        />
      ))}

      <h2 className="font-display text-xl mb-4">Fiche bien</h2>
      <PropriaBienForm
        initial={bien}
        providers={providersRes.data ?? []}
        action={updateAction}
        submitLabel="Mettre à jour"
      />

      {/* Pilotage qualité — chantier 11.c (5 dates clés + score consolidé dérivé) */}
      <PropriaBienQualitySection propertyId={bien.id} />

      {/* Coût ménage — chantier 15 sujet 4 (matrice de coûts à aujourd'hui, dérivé) */}
      <PropriaBienCleaningCostSection propertyId={bien.id} />

      {/* Check-ups logement — chantier 11.a (derniers check-ups + rapport) */}
      <PropriaBienCheckupsSection propertyId={bien.id} />

      {/* Performance 12 mois — occupation, revenus, note */}
      <PropriaBienPerformanceSection propertyId={bien.id} />

      {/* Avis voyageurs — note moyenne + 5 derniers avis */}
      <PropriaBienReviewsSection propertyId={bien.id} />

      {/* Commentaires internes laissés sur les avis du bien (chantier 7, lecture seule) */}
      <PropriaBienAvisCommentsSection propertyId={bien.id} />

      {/* Historique des modifications — qui a fait quoi sur ce bien */}
      <PropriaAuditTimeline table="properties" recordId={bien.id} />
    </div>
  );
}
