import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { calculateKPIs } from '@/lib/finance/property-calc';
import { requireRole } from '@/lib/auth/require';

export default async function ComparePage({
  searchParams,
}: {
  searchParams: { ids?: string };
}) {
  await requireRole(['ceo','chef_projet','developer','sourcing','commercial','finance','marketing','assistante']);
  const ids = (searchParams.ids ?? '').split(',').filter(Boolean);

  if (ids.length === 0) {
    return (
      <div className="space-y-4">
        <PageHeader title="Comparer des biens" />
        <EmptyState
          title="Aucun bien à comparer"
          description="Sélectionnez 2 à 4 biens depuis la page Biens en cochant les cases, puis cliquez sur Comparer."
          action={<Link href="/properties" className="text-stoniz-black underline">Voir les biens</Link>}
        />
      </div>
    );
  }

  const supabase = createClient();
  const { data: rows } = await supabase.from('properties_enriched')
    .select(`
      id, name, type, quartier, status, evaluation, badge_label,
      price, agency_fees, notary_fees, travaux_budget_estimate, estimated_rent,
      superficie, terrasse_m2, floor, apartment_number, nb_suites, nb_lots_residence,
      has_elevator, has_parking, year_built, address, google_maps_url,
      gross_yield
    `)
    .in('id', ids);

  const properties = (rows ?? []).slice(0, 4);
  const kpis = properties.map(p => calculateKPIs({
    price: p.price, superficie: p.superficie,
    agency_fees: p.agency_fees, notary_fees: p.notary_fees,
    travaux_budget_estimate: p.travaux_budget_estimate,
    estimated_rent: p.estimated_rent,
  }));

  // Helpers pour identifier le best/worst par metric
  const minMax = (vals: number[]) => ({
    min: Math.min(...vals.filter(v => v > 0)),
    max: Math.max(...vals),
  });

  const prices = minMax(properties.map(p => Number(p.price ?? 0)));
  const couts = minMax(kpis.map(k => k.cout_total_projet));
  const loyers = minMax(properties.map(p => Number(p.estimated_rent ?? 0)));
  const rendBruts = minMax(kpis.map(k => k.rendement_brut_pct));
  const rendNets = minMax(kpis.map(k => k.rendement_net_pct));
  const cashflows = minMax(kpis.map(k => k.cashflow_mensuel));
  const surfaces = minMax(properties.map(p => Number(p.superficie ?? 0)));

  return (
    <div className="space-y-6">
      <Link href="/properties"
        className="inline-flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black">
        <ArrowLeft className="w-4 h-4" /> Retour aux biens
      </Link>

      <PageHeader
        title={`Comparaison de ${properties.length} bien${properties.length > 1 ? 's' : ''}`}
        description="Les meilleures valeurs sont en vert, les moins bonnes en rouge."
      />

      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="text-left p-3 font-medium text-xs uppercase text-stoniz-gray-500 sticky left-0 bg-white">
                Critère
              </th>
              {properties.map(p => (
                <th key={p.id} className="text-left p-3 align-top min-w-[220px]">
                  <Link href={`/properties/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                  <div className="text-xs text-stoniz-gray-500 mt-0.5">{p.quartier ?? '—'}</div>
                  {p.badge_label && (
                    <div className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full bg-yellow text-stoniz-black mt-1">
                      {p.badge_label}
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            <Section label="Type" />
            <Row label="Type">
              {properties.map(p => <td key={p.id} className="p-3">{p.type ?? '—'}</td>)}
            </Row>
            <Row label="Évaluation">
              {properties.map(p => <td key={p.id} className="p-3">{p.evaluation ? '⭐'.repeat(p.evaluation) : '—'}</td>)}
            </Row>
            <Row label="Statut">
              {properties.map(p => (
                <td key={p.id} className="p-3"><Badge>{p.status}</Badge></td>
              ))}
            </Row>

            <Section label="Localisation & surfaces" />
            <Row label="Adresse">
              {properties.map(p => <td key={p.id} className="p-3 text-xs">{p.address ?? '—'}</td>)}
            </Row>
            <Row label="Étage / N° appt">
              {properties.map(p => (
                <td key={p.id} className="p-3">
                  {p.floor ?? '—'} {p.apartment_number ? `· ${p.apartment_number}` : ''}
                </td>
              ))}
            </Row>
            <Row label="Surface habitable">
              {properties.map(p => (
                <td key={p.id} className={`p-3 ${cellClass(Number(p.superficie ?? 0), surfaces, true)}`}>
                  {p.superficie ? `${p.superficie} m²` : '—'}
                </td>
              ))}
            </Row>
            <Row label="Terrasse">
              {properties.map(p => (
                <td key={p.id} className="p-3">{p.terrasse_m2 ? `${p.terrasse_m2} m²` : '—'}</td>
              ))}
            </Row>
            <Row label="Nb suites">
              {properties.map(p => <td key={p.id} className="p-3">{p.nb_suites ?? '—'}</td>)}
            </Row>
            <Row label="Ascenseur · Parking">
              {properties.map(p => (
                <td key={p.id} className="p-3 text-xs">
                  {p.has_elevator ? '🛗 ✓' : '🛗 ✗'} · {p.has_parking ? '🅿 ✓' : '🅿 ✗'}
                </td>
              ))}
            </Row>

            <Section label="Financier" />
            <Row label="Prix d'acquisition">
              {properties.map(p => (
                <td key={p.id} className={`p-3 font-medium ${cellClass(Number(p.price ?? 0), prices, false)}`}>
                  <Money amount={p.price} />
                </td>
              ))}
            </Row>
            <Row label="Frais d'agence">
              {properties.map(p => (
                <td key={p.id} className="p-3"><Money amount={p.agency_fees} /></td>
              ))}
            </Row>
            <Row label="Frais notaire">
              {properties.map(p => (
                <td key={p.id} className="p-3"><Money amount={p.notary_fees} /></td>
              ))}
            </Row>
            <Row label="Budget travaux">
              {properties.map(p => (
                <td key={p.id} className="p-3"><Money amount={p.travaux_budget_estimate} /></td>
              ))}
            </Row>
            <Row label="Coût total projet">
              {kpis.map((k, i) => (
                <td key={properties[i].id} className={`p-3 font-medium ${cellClass(k.cout_total_projet, couts, false)}`}>
                  <Money amount={k.cout_total_projet} />
                </td>
              ))}
            </Row>

            <Section label="Locatif" />
            <Row label="Loyer estimé / mois">
              {properties.map(p => (
                <td key={p.id} className={`p-3 ${cellClass(Number(p.estimated_rent ?? 0), loyers, true)}`}>
                  <Money amount={p.estimated_rent} />
                </td>
              ))}
            </Row>
            <Row label="Rendement brut">
              {kpis.map((k, i) => (
                <td key={properties[i].id} className={`p-3 font-medium ${cellClass(k.rendement_brut_pct, rendBruts, true)}`}>
                  {k.rendement_brut_pct > 0 ? `${k.rendement_brut_pct.toFixed(2)}%` : '—'}
                </td>
              ))}
            </Row>
            <Row label="Rendement net">
              {kpis.map((k, i) => (
                <td key={properties[i].id} className={`p-3 ${cellClass(k.rendement_net_pct, rendNets, true)}`}>
                  {k.rendement_net_pct > 0 ? `${k.rendement_net_pct.toFixed(2)}%` : '—'}
                </td>
              ))}
            </Row>
            <Row label="Cashflow mensuel">
              {kpis.map((k, i) => (
                <td key={properties[i].id} className={`p-3 ${cellClass(k.cashflow_mensuel, cashflows, true)}`}>
                  <Money amount={k.cashflow_mensuel} />
                </td>
              ))}
            </Row>

            <Section label="Année construction" />
            <Row label="Année">
              {properties.map(p => <td key={p.id} className="p-3">{p.year_built ?? '—'}</td>)}
            </Row>
            <Row label="Carte">
              {properties.map(p => (
                <td key={p.id} className="p-3">
                  {p.google_maps_url
                    ? <a href={p.google_maps_url} target="_blank" rel="noreferrer" className="text-stoniz-black underline text-xs">📍 Google Maps</a>
                    : <span className="text-stoniz-gray-400 text-xs">—</span>}
                </td>
              ))}
            </Row>
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function Section({ label }: { label: string }) {
  return (
    <tr className="bg-stoniz-gray-50">
      <td colSpan={5} className="px-3 py-2 text-xs uppercase text-stoniz-gray-600 font-medium">{label}</td>
    </tr>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="hover:bg-stoniz-gray-50/50">
      <th className="text-left p-3 font-normal text-stoniz-gray-600 sticky left-0 bg-white border-r">{label}</th>
      {children}
    </tr>
  );
}

function cellClass(val: number, range: { min: number; max: number }, higherIsBetter: boolean) {
  if (!val || range.min === range.max || !isFinite(range.min) || !isFinite(range.max)) return '';
  if (val === (higherIsBetter ? range.max : range.min)) return 'bg-green-50 text-green-800';
  if (val === (higherIsBetter ? range.min : range.max)) return 'bg-red-50 text-red-800';
  return '';
}
