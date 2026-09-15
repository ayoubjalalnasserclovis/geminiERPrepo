import { MapPin, Video, Home, Coins } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { calculateKPIs, type PropertyKPIs } from '@/lib/finance/property-calc';

type PropertyData = {
  id?: string;
  name: string;
  quartier?: string | null;
  badge_label?: string | null;
  description?: string | null;
  video_url?: string | null;
  google_maps_url?: string | null;
  superficie?: number | null;
  terrasse_m2?: number | null;
  floor?: string | null;
  nb_suites?: number | null;
  nb_lots_residence?: number | null;
  price?: number | null;
  estimated_rent?: number | null;
  agency_fees?: number | null;
  notary_fees?: number | null;
  travaux_budget_estimate?: number | null;
  charges_mensuelles_immeuble?: number | null;
  revenu_locatif_brut_annuel?: number | null;
  taux_occupation?: number | null;
  frais_fonctionnement_annuel?: number | null;
  conciergerie_annuel?: number | null;
  emprunt_mensuel?: number | null;
  impots_annuel?: number | null;
  avantages?: string[] | null;
  points_negatifs?: string[] | null;
};

type Media = { id: string; type: string; url: string | null; is_cover: boolean };

export function PropertyPresentation({
  property,
  media = [],
}: {
  property: PropertyData;
  media?: Media[];
}) {
  const kpis = calculateKPIs(property);
  const validMedia = Array.isArray(media) ? media.filter(m => m && m.url) : [];
  const coverPhoto = validMedia.find(m => m.is_cover && m.type === 'photo') ?? validMedia.find(m => m.type === 'photo');
  const interiorPhotos = validMedia.filter(m => m.type === 'photo' && m.id !== coverPhoto?.id);
  const partiesCommunes = validMedia.filter(m => m.type === 'video_parties_communes' || m.type === 'video_facade');
  const videoBien = validMedia.find(m => m.type === 'video_bien');

  return (
    <div className="space-y-8">
      {/* ─── HERO ────────────────────────────────────────────────────────── */}
      <section className="grid md:grid-cols-2 gap-6 items-start">
        <div className="space-y-4">
          {property.badge_label && (
            <Badge variant="default" className="border border-stoniz-black/20">{property.badge_label}</Badge>
          )}
          <h1 className="font-display text-4xl md:text-5xl">{property.name}</h1>
          {property.description && (
            <p className="text-stoniz-gray-600 leading-relaxed text-sm md:text-base">
              {property.description}
            </p>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            {property.google_maps_url && (
              <a href={property.google_maps_url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 bg-stoniz-black text-white px-4 py-2 rounded-md text-sm font-medium hover:opacity-85">
                <MapPin className="w-4 h-4" />
                Voir sur Google Maps
              </a>
            )}
            {property.video_url && (
              <a href={property.video_url} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-2 border border-stoniz-black text-stoniz-black px-4 py-2 rounded-md text-sm font-medium hover:bg-stoniz-gray-100">
                <Video className="w-4 h-4" />
                Voir la vidéo du bien
              </a>
            )}
          </div>
        </div>
        {coverPhoto?.url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverPhoto.url} alt={property.name}
            loading="eager" decoding="async"
            className="w-full aspect-[4/3] object-cover rounded-2xl" />
        )}
      </section>

      {/* ─── KPI grid 4x3 ─────────────────────────────────────────────── */}
      <section className="grid grid-cols-2 md:grid-cols-4 border rounded-2xl overflow-hidden bg-white">
        <KpiCell label="Prix d'achat" value={<Money amount={kpis.prix_achat} />} />
        <KpiCell label="Budget travaux" value={<Money amount={kpis.travaux} />} />
        <KpiCell label="Prix d'achat + travaux" value={<Money amount={kpis.prix_achat_plus_travaux} />} highlight />
        <KpiCell label="Coût total du projet" value={<Money amount={kpis.cout_total_projet} />} />
        <KpiCell label="Surface" value={property.superficie ? `${property.superficie} m²` : '—'} />
        <KpiCell label="Prix au m² fini" value={kpis.prix_m2_fini ? <Money amount={kpis.prix_m2_fini} /> : '—'} highlight />
        <KpiCell label="Loyer brut mensuel" value={property.estimated_rent ? <Money amount={property.estimated_rent} /> : '—'} />
        <KpiCell label="Quartier" value={property.quartier ?? '—'} />
        <KpiCell label="Cashflow mensuel" value={<Money amount={kpis.cashflow_mensuel} />} />
        <KpiCell label="Rendement brut" value={`${kpis.rendement_brut_pct.toFixed(2)} %`} />
        <KpiCell label="Rendement net" value={`${kpis.rendement_net_pct.toFixed(2)} %`} highlight />
        <KpiCell label="Coût conciergerie /an" value={<Money amount={kpis.conciergerie_annuel} />} />
      </section>

      {/* ─── Avantages / Points négatifs ─────────────────────────────── */}
      {(property.avantages?.length || property.points_negatifs?.length) ? (
        <section>
          <h2 className="font-display text-2xl mb-4">Ce qu'il faut savoir sur ce bien</h2>

          {property.avantages && property.avantages.length > 0 && (
            <div className="mb-5">
              <h3 className="font-display text-lg mb-1">Les <span className="bg-yellow-100 px-1">avantages</span> de ce bien</h3>
              <p className="text-sm text-stoniz-gray-500 mb-3">
                Voici les éléments à prendre en compte dans la valorisation du bien
              </p>
              <div className="flex flex-wrap gap-2">
                {property.avantages.map((a, i) => (
                  <span key={i} className="border border-stoniz-black/30 rounded-full px-3 py-1 text-sm">{a}</span>
                ))}
              </div>
            </div>
          )}

          {property.points_negatifs && property.points_negatifs.length > 0 && (
            <div>
              <h3 className="font-display text-lg mb-1">Les points négatifs de ce bien</h3>
              <p className="text-sm text-stoniz-gray-500 mb-3">
                Voici les éléments qui pourraient avoir un impact sur la rentabilité future
              </p>
              <div className="flex flex-wrap gap-2">
                {property.points_negatifs.map((p, i) => (
                  <span key={i} className="border border-stoniz-black/30 rounded-full px-3 py-1 text-sm">{p}</span>
                ))}
              </div>
            </div>
          )}
        </section>
      ) : null}

      {/* ─── Photos intérieur ──────────────────────────────────────────── */}
      {interiorPhotos.length > 0 && (
        <section>
          <h2 className="font-display text-2xl mb-1">Photos de l'intérieur</h2>
          <p className="text-sm text-stoniz-gray-500 mb-4">Découvrez un aperçu des parties qui seront à rénover dans le projet</p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {interiorPhotos.map(m => m.url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={m.id} src={m.url} alt="" loading="lazy" decoding="async" className="w-full aspect-video object-cover rounded-lg" />
            ))}
          </div>
        </section>
      )}

      {/* ─── Parties communes ─────────────────────────────────────────── */}
      {partiesCommunes.length > 0 && (
        <section>
          <h2 className="font-display text-2xl mb-1">Les parties communes</h2>
          <p className="text-sm text-stoniz-gray-500 mb-3">Découvrez un aperçu de l'intérieur de l'immeuble du bien</p>
          <div className="flex gap-4 text-sm text-stoniz-gray-600 mb-4">
            {property.nb_lots_residence != null && (
              <div className="flex items-center gap-1.5">
                <Home className="w-4 h-4" />
                {property.nb_lots_residence} lots dans la résidence
              </div>
            )}
            {property.charges_mensuelles_immeuble != null && (
              <div className="flex items-center gap-1.5">
                <Coins className="w-4 h-4" />
                <Money amount={property.charges_mensuelles_immeuble} /> charges mensuelles
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {partiesCommunes.map(m => m.url && (
              m.type === 'video_facade' || m.type === 'video_parties_communes' ?
                m.url.match(/\.(mp4|mov|webm)$/i) ?
                  <video key={m.id} src={m.url} controls preload="metadata" className="w-full aspect-video object-cover rounded-lg" />
                  :
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={m.id} src={m.url} alt="" loading="lazy" decoding="async" className="w-full aspect-video object-cover rounded-lg" />
                : null
            ))}
          </div>
        </section>
      )}

      {/* ─── Vidéo du bien ─────────────────────────────────────────────── */}
      {videoBien?.url && (
        <section>
          <h2 className="font-display text-2xl mb-3">Vidéo du bien</h2>
          <video src={videoBien.url} controls preload="metadata" className="w-full max-w-3xl aspect-video object-cover rounded-2xl bg-stoniz-gray-100" />
        </section>
      )}

      {/* ─── Données financières ─────────────────────────────────────── */}
      <section>
        <h2 className="font-display text-2xl mb-1">Données financières</h2>
        <p className="text-sm text-stoniz-gray-500 mb-4">Obtenez des informations sur la première modélisation économique réalisée</p>

        <Card className="space-y-6">
          <FinancialBlock title="Investissement" rows={[
            ['Prix d\'achat',          kpis.prix_achat],
            ['Travaux',                kpis.montant_travaux],
            ['Ameublement',            kpis.montant_ameublement],
            ['Frais de notaire',       kpis.frais_notaire],
            ['Frais d\'agence',        kpis.frais_agence],
            ['Frais Stoniz',           kpis.frais_stoniz],
          ]} total={['Coût total du projet', kpis.cout_total_projet]} />

          <FinancialBlock title="Charges" rows={[
            ['Frais de fonctionnement', kpis.frais_fonctionnement_annuel],
            ['Conciergerie',            kpis.conciergerie_annuel],
            ['Emprunt',                 kpis.emprunt_annuel],
          ]} total={['Total des charges estimées', kpis.charges_total_annuel]} />

          <FinancialBlock title="Revenus" rows={[
            ['Revenu locatif brut',  kpis.revenu_locatif_brut_annuel],
            ['Taux d\'occupation',   `${kpis.taux_occupation_pct.toFixed(2)} %`],
          ]} total={['Total des revenus estimés', kpis.revenu_locatif_net_annuel]} />

          <FinancialBlock title="Rendement" rows={[
            ['Revenus locatifs nets',  kpis.revenu_locatif_net_apres_charges],
            ['Rendement brut',         `${kpis.rendement_brut_pct.toFixed(2)} %`],
            ['Impôts (IR ou IS)',      kpis.impots_annuel],
          ]} total={['Rendement net', `${kpis.rendement_net_pct.toFixed(2)} %`]} totalColor="text-green-700" />
        </Card>
      </section>
    </div>
  );
}

// ─── Sous-composants ────────────────────────────────────────────────────
function KpiCell({ label, value, highlight }: { label: string; value: React.ReactNode; highlight?: boolean }) {
  return (
    <div className="p-4 md:p-6 border-r border-b last:border-r-0 [&:nth-child(4)]:border-r-0 [&:nth-last-child(-n+4)]:border-b-0">
      <div className="font-display text-2xl md:text-3xl mb-1">{value}</div>
      <div className={`text-xs md:text-sm ${highlight ? 'bg-yellow-100 inline px-1' : 'text-stoniz-gray-500'}`}>{label}</div>
    </div>
  );
}

function FinancialBlock({
  title,
  rows,
  total,
  totalColor,
}: {
  title: string;
  rows: [string, number | string][];
  total: [string, number | string];
  totalColor?: string;
}) {
  return (
    <div>
      <h3 className="font-display text-lg mb-3">{title}</h3>
      <ul className="space-y-1.5 text-sm">
        {rows.map(([label, value], i) => (
          <li key={i} className="flex justify-between py-1 border-b border-stoniz-gray-100">
            <span className="text-stoniz-gray-600">{label}</span>
            <span className="font-medium">
              {typeof value === 'number' ? <Money amount={value} /> : value}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-2 bg-stoniz-gray-100 px-3 py-2 rounded-md flex justify-between font-medium text-sm">
        <span>{total[0]}</span>
        <span className={totalColor}>
          {typeof total[1] === 'number' ? <Money amount={total[1]} /> : total[1]}
        </span>
      </div>
    </div>
  );
}
