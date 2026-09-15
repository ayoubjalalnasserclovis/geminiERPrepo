import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { BackLink } from '@/components/ui/back-link';
import { activatePropriaForProjectAction } from './actions';
import { LOST_STATUS } from '@/lib/projects/lost';
import { CheckCircle2, Info } from 'lucide-react';

// Phases pour lesquelles le bien est "prêt" à passer en gestion Propria
const ELIGIBLE_PHASES = ['travaux','livraison','mise_en_location','termine'];
const PHASE_LABEL: Record<string, string> = {
  travaux: '🛠 Travaux',
  livraison: '📦 Livraison',
  mise_en_location: '🏠 Mise en location',
  termine: '✅ Terminé',
};

export default async function ActivatePropriaPage({
  searchParams,
}: {
  searchParams: { project_id?: string };
}) {
  await requireRole(['ceo','developer','assistante','propria']);
  const supabase = createClient();

  // ─── MODE 1 : Pas de project_id → liste des projets éligibles ───────────
  if (!searchParams.project_id) {
    const { data: projects } = await supabase
      .from('projects')
      .select(`
        id, reference, current_phase, status,
        client:clients(full_name),
        property:properties(id, name, propria_internal_code, propria_managed_at, address, quartier)
      `)
      .in('current_phase', ELIGIBLE_PHASES)
      // Canon : exclusion = « pas perdu » (un projet en pause reste activable)
      // + jamais de projet supprimé dans une liste d'action.
      .neq('status', LOST_STATUS)
      .is('deleted_at', null)
      .order('current_phase', { ascending: false });

    // On ne garde que les projets dont le bien existe ET n'est pas déjà Propria
    const rows = (projects ?? []).filter((p: any) =>
      p.property && !p.property.propria_managed_at,
    );

    return (
      <div className="max-w-4xl">
        <BackLink href="/propria/biens" label="Retour aux biens gérés" />
        <h1 className="text-3xl font-display mb-2">Activer la gestion Propria</h1>
        <p className="text-sm text-stoniz-gray-600 mb-6">
          Sélectionne un projet Stoniz pour passer son bien en gestion Propria.
          Toutes les infos déjà collectées (adresse, surface, compteurs) seront héritées.
        </p>

        <div className="bg-blue-50 border border-blue-200 text-blue-900 text-sm rounded-md p-4 mb-6 flex gap-3">
          <Info className="w-5 h-5 text-blue-700 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-medium mb-1">Pourquoi partir d'un projet ?</div>
            Le bien d'un client Stoniz est lié à son projet d'accompagnement. En activant
            depuis le projet, on récupère automatiquement les infos déjà collectées
            (adresse, surface, contrats eau/élec/internet…) sans avoir à les ressaisir.
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="bg-white border border-stoniz-gray-200 rounded-xl p-10 text-center">
            <p className="font-medium mb-2">Aucun projet éligible</p>
            <p className="text-sm text-stoniz-gray-600 mb-4">
              Les projets doivent être en phase Travaux, Livraison, Mise en location
              ou Terminé — et leur bien ne doit pas être déjà sous gestion Propria.
            </p>
            <Link
              href="/propria/biens/new"
              className="inline-block bg-stoniz-black text-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-800"
            >
              Ajouter un bien externe à la place
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((p: any) => (
              <Link
                key={p.id}
                href={`/propria/biens/activate?project_id=${p.id}`}
                className="block bg-white border border-stoniz-gray-200 hover:border-stoniz-black rounded-xl p-4 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-xs text-stoniz-gray-500">{p.reference}</span>
                      <span className="text-[10px] bg-stoniz-gray-100 text-stoniz-gray-800 px-2 py-0.5 rounded-full">
                        {PHASE_LABEL[p.current_phase] ?? p.current_phase}
                      </span>
                    </div>
                    <div className="font-medium">
                      {p.property.name}
                      {p.property.quartier && (
                        <span className="text-sm text-stoniz-gray-600"> · {p.property.quartier}</span>
                      )}
                    </div>
                    <div className="text-xs text-stoniz-gray-500 mt-0.5">
                      Client : {p.client?.full_name ?? '—'}
                    </div>
                  </div>
                  <div className="text-xs text-stoniz-black flex-shrink-0">Activer →</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── MODE 2 : Project_id → formulaire pré-rempli ───────────────────────
  const { data: project } = await supabase
    .from('projects')
    .select(`
      id, reference, current_phase, status,
      client:clients(full_name, email, phone),
      property:properties(*)
    `)
    .eq('id', searchParams.project_id)
    .single();

  if (!project) notFound();
  const property = (project as any).property;
  if (!property) {
    return (
      <div className="max-w-2xl">
        <BackLink href="/propria/biens/activate" label="Retour à la liste" />
        <h1 className="text-3xl font-display mb-4">Activation impossible</h1>
        <p className="text-sm text-stoniz-gray-700">
          Le projet <strong>{(project as any).reference}</strong> n'a pas encore de bien
          associé. Lie d'abord un bien au projet, puis reviens ici.
        </p>
      </div>
    );
  }
  if (property.propria_managed_at) {
    return (
      <div className="max-w-2xl">
        <BackLink href="/propria/biens/activate" label="Retour à la liste" />
        <h1 className="text-3xl font-display mb-4">Déjà sous gestion Propria</h1>
        <p className="text-sm text-stoniz-gray-700">
          Le bien <strong>{property.name}</strong> est déjà sous gestion Propria depuis le{' '}
          {new Date(property.propria_managed_at).toLocaleDateString('fr-FR')}.
        </p>
        <Link
          href={`/propria/biens/${property.id}`}
          className="inline-block mt-4 bg-stoniz-black text-white px-4 py-2 rounded-md text-sm"
        >
          Voir le bien Propria →
        </Link>
      </div>
    );
  }

  // Champs HÉRITÉS depuis le projet/bien (affichés en lecture seule)
  const inheritedFields = [
    { label: 'Nom du bien',    value: property.name },
    { label: 'Type',           value: property.type ?? '—' },
    { label: 'Quartier',       value: property.quartier ?? '—' },
    { label: 'Adresse',        value: property.address ?? '—' },
    { label: 'Surface (m²)',   value: property.superficie ? `${property.superficie} m²` : '—' },
    { label: 'Étage',          value: property.floor ?? '—' },
    { label: 'Nb suites',      value: property.nb_suites ?? '—' },
    { label: 'Ascenseur',      value: property.has_elevator ? 'Oui' : 'Non' },
    { label: 'Parking',        value: property.has_parking ? 'Oui' : 'Non' },
  ];

  const inputCls = 'mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stoniz-black/30';
  const labelCls = 'text-xs text-stoniz-gray-600';

  return (
    <div className="max-w-4xl">
      <BackLink href="/propria/biens/activate" label="Changer de projet" />
      <h1 className="text-3xl font-display mb-2">
        Activer Propria sur <span className="text-stoniz-gray-500">{(project as any).reference}</span>
      </h1>
      <p className="text-sm text-stoniz-gray-600 mb-6">
        Bien : <strong>{property.name}</strong> · Client : <strong>{(project as any).client?.full_name ?? '—'}</strong>
      </p>

      {/* Bandeau infos héritées */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-6">
        <div className="flex items-center gap-2 mb-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-700" />
          <span className="text-sm font-medium text-emerald-900">
            {inheritedFields.length} infos héritées du projet — pas besoin de ressaisir
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-xs text-emerald-900">
          {inheritedFields.map((f, i) => (
            <div key={i}>
              <span className="opacity-70">{f.label} :</span>{' '}
              <span className="font-medium">{f.value}</span>
            </div>
          ))}
        </div>
      </div>

      <form action={activatePropriaForProjectAction} className="space-y-6">
        <input type="hidden" name="project_id" value={(project as any).id} />

        {/* ─── Identifiant Propria ─── */}
        <section className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
          <h2 className="font-display text-lg mb-4">Identifiant Propria</h2>
          <div>
            <label className={labelCls}>Code interne *</label>
            <input
              name="propria_internal_code"
              required
              placeholder="ex: AF-1, ATLAS-2, MAJORELLE"
              defaultValue={property.propria_internal_code ?? ''}
              className={`${inputCls} font-mono`}
            />
            <p className="text-[11px] text-stoniz-gray-500 mt-1">
              Code court utilisé pour identifier le bien sur le terrain et dans les rapports.
            </p>
          </div>
        </section>

        {/* ─── Propriétaire ─── */}
        <section className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
          <h2 className="font-display text-lg mb-1">Propriétaire</h2>
          <p className="text-xs text-stoniz-gray-500 mb-4">
            Par défaut le client Stoniz du projet. Modifie si le propriétaire est différent (SCI, conjoint…).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Nom</label>
              <input
                name="propria_owner_name"
                defaultValue={property.propria_owner_name ?? (project as any).client?.full_name ?? ''}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Téléphone</label>
              <input
                name="propria_owner_phone"
                defaultValue={property.propria_owner_phone ?? (project as any).client?.phone ?? ''}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Email</label>
              <input
                name="propria_owner_email"
                type="email"
                defaultValue={property.propria_owner_email ?? (project as any).client?.email ?? ''}
                className={inputCls}
              />
            </div>
          </div>
        </section>

        {/* ─── Capacités locatives & tarification ─── */}
        <section className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
          <h2 className="font-display text-lg mb-4">Capacités & tarification</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Capacité voyageurs</label>
              <input
                name="propria_capacity_voyageurs"
                type="number"
                min="1"
                defaultValue={property.propria_capacity_voyageurs ?? ''}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Nombre de chambres</label>
              <input
                name="propria_nb_chambres"
                type="number"
                min="1"
                defaultValue={property.propria_nb_chambres ?? property.nb_suites ?? ''}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Commission Propria (%)</label>
              <input
                name="propria_commission_rate"
                type="number"
                step="0.01"
                placeholder="ex: 20"
                defaultValue={property.propria_commission_rate ?? ''}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Prix de base / nuit (DH)</label>
              <input
                name="propria_base_price_per_night"
                type="number"
                step="0.01"
                placeholder="ex: 950"
                defaultValue={property.propria_base_price_per_night ?? ''}
                className={inputCls}
              />
            </div>
          </div>
        </section>

        {/* ─── Mandat ─── */}
        <section className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
          <h2 className="font-display text-lg mb-4">Mandat de gestion</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Date de début du mandat</label>
              <input
                name="propria_mandate_start"
                type="date"
                defaultValue={property.propria_mandate_start ?? new Date().toISOString().slice(0, 10)}
                className={inputCls}
              />
            </div>
          </div>
          <div className="mt-3">
            <label className={labelCls}>Conditions particulières (optionnel)</label>
            <textarea
              name="propria_mandate_conditions"
              rows={2}
              defaultValue={property.propria_mandate_conditions ?? ''}
              className={inputCls}
            />
          </div>
        </section>

        {/* ─── Annonces (optionnel à l'activation) ─── */}
        <section className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
          <h2 className="font-display text-lg mb-1">Annonces</h2>
          <p className="text-xs text-stoniz-gray-500 mb-4">
            Pourra être complété plus tard une fois le bien publié.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>URL Airbnb</label>
              <input
                name="propria_airbnb_url"
                type="url"
                placeholder="https://airbnb.com/rooms/…"
                defaultValue={property.propria_airbnb_url ?? ''}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>URL Booking</label>
              <input
                name="propria_booking_url"
                type="url"
                placeholder="https://booking.com/hotel/…"
                defaultValue={property.propria_booking_url ?? ''}
                className={inputCls}
              />
            </div>
          </div>
        </section>

        {/* ─── Compteurs & contrats ─── */}
        <section className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
          <h2 className="font-display text-lg mb-1">Compteurs & contrats</h2>
          <p className="text-xs text-stoniz-gray-500 mb-4">
            Si déjà saisis pendant la phase travaux, ils sont pré-remplis. Sinon, remplis-les ici.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>N° contrat eau</label>
              <input
                name="propria_water_contract"
                defaultValue={property.propria_water_contract ?? ''}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>N° compteur eau</label>
              <input
                name="propria_water_meter"
                defaultValue={property.propria_water_meter ?? ''}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>N° contrat électricité</label>
              <input
                name="propria_electricity_contract"
                defaultValue={property.propria_electricity_contract ?? ''}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>N° compteur électricité</label>
              <input
                name="propria_electricity_meter"
                defaultValue={property.propria_electricity_meter ?? ''}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Fournisseur internet</label>
              <input
                name="propria_internet_provider"
                placeholder="ex: Inwi, Orange, IAM"
                defaultValue={property.propria_internet_provider ?? ''}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>N° contrat internet</label>
              <input
                name="propria_internet_contract"
                defaultValue={property.propria_internet_contract ?? ''}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>SSID Wifi</label>
              <input
                name="propria_wifi_ssid"
                defaultValue={property.propria_wifi_ssid ?? ''}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Mot de passe Wifi</label>
              <input
                name="propria_wifi_password"
                defaultValue={property.propria_wifi_password ?? ''}
                className={inputCls}
              />
            </div>
          </div>
        </section>

        {/* ─── Syndic ─── */}
        <section className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
          <h2 className="font-display text-lg mb-4">Syndic & charges immeuble</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Nom du syndic</label>
              <input
                name="propria_syndic_name"
                defaultValue={property.propria_syndic_name ?? ''}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Téléphone syndic</label>
              <input
                name="propria_syndic_phone"
                defaultValue={property.propria_syndic_phone ?? ''}
                className={inputCls}
              />
            </div>
            <div className="flex items-center gap-2 mt-1">
              <input
                type="checkbox"
                id="propria_syndic_to_pay"
                name="propria_syndic_to_pay"
                defaultChecked={property.propria_syndic_to_pay ?? false}
                className="rounded"
              />
              <label htmlFor="propria_syndic_to_pay" className="text-sm">
                Propria règle les charges syndic pour ce bien
              </label>
            </div>
            <div>
              <label className={labelCls}>Montant mensuel syndic (DH)</label>
              <input
                name="propria_syndic_amount"
                type="number"
                step="0.01"
                defaultValue={property.propria_syndic_amount ?? ''}
                className={inputCls}
              />
            </div>
          </div>
        </section>

        {/* Submit */}
        <div className="flex items-center justify-end gap-3 sticky bottom-4 bg-stoniz-cream pt-3">
          <Link
            href="/propria/biens/activate"
            className="px-4 py-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black"
          >
            Annuler
          </Link>
          <button
            type="submit"
            className="bg-stoniz-black text-white px-6 py-2.5 rounded-md text-sm font-medium hover:bg-stoniz-gray-800 shadow-lg"
          >
            ✓ Activer la gestion Propria
          </button>
        </div>
      </form>
    </div>
  );
}
