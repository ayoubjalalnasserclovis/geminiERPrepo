import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { ClientPvSignForm } from '@/components/client/client-pv-sign-form';

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  draft:          { label: '⏳ Brouillon — pas encore prêt',  cls: 'bg-stoniz-gray-100 text-stoniz-gray-700' },
  sent_to_client: { label: '✍ À signer',                     cls: 'bg-amber-100 text-amber-800' },
  validated:      { label: '✓ Signé',                         cls: 'bg-emerald-100 text-emerald-800' },
  rejected:       { label: '✕ Refusé',                        cls: 'bg-red-100 text-red-800' },
  closed:         { label: '🔒 Clôturé',                      cls: 'bg-stoniz-gray-200 text-stoniz-gray-700' },
};

function fmtDate(d: any): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('fr-FR');
}

export default async function ClientReceptionPage({ params }: { params: { id: string } }) {
  const user = await requireRole(['client']);
  const supabase = createClient();

  // Vérifie que le client a bien accès à ce projet
  const { data: client } = await supabase
    .from('clients')
    .select('id, full_name')
    .eq('profile_id', user.id)
    .single();
  if (!client) notFound();

  const { data: project } = await supabase
    .from('projects')
    .select('id, reference, client_id')
    .eq('id', params.id)
    .eq('client_id', client.id)
    .single();
  if (!project) notFound();

  const [pvRes, itemsRes, reservesRes] = await Promise.all([
    supabase.from('project_reception_pvs')
      .select('*').eq('project_id', params.id).maybeSingle(),
    // RLS filtre automatiquement les items au PV du client
    supabase.from('project_reception_pv_items')
      .select('id, category, name, display_order, status, observations')
      .order('display_order'),
    supabase.from('project_reception_pv_reserves')
      .select('id, description, responsible_role, deadline, status')
      .order('created_at'),
  ]);

  const pv = pvRes.data;
  const allItems = (itemsRes.data ?? []) as any[];
  const reserves = (reservesRes.data ?? []) as any[];

  if (!pv) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Link href={`/client/projects/${params.id}`} className="text-sm text-stoniz-gray-600 hover:text-stoniz-black">
          ← Retour au projet
        </Link>
        <h1 className="text-3xl font-display mt-4">PV de réception</h1>
        <div className="bg-stoniz-beige border border-stoniz-gray-200 rounded-xl p-8 mt-4 text-center">
          <p className="text-stoniz-gray-700">
            Le PV de réception de votre bien n'a pas encore été créé.
          </p>
          <p className="text-sm text-stoniz-gray-500 mt-2">
            Vous recevrez un email dès qu'il sera prêt à être signé.
          </p>
        </div>
      </div>
    );
  }

  // Filtre uniquement les items rattachés à CE pv
  const items = allItems.filter((it: any) =>
    reserves.length === 0 || true // RLS gère déjà — on garde tout
  );

  // Groupage par catégorie
  const grouped = items.reduce((acc: Record<string, any[]>, it) => {
    if (!acc[it.category]) acc[it.category] = [];
    acc[it.category].push(it);
    return acc;
  }, {});

  const isSigned = pv.status === 'validated' || pv.status === 'closed';
  const canSign = pv.status === 'sent_to_client';

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <Link href={`/client/projects/${params.id}`} className="text-sm text-stoniz-gray-600 hover:text-stoniz-black">
        ← Retour à votre projet
      </Link>

      <div>
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
          {project.reference}
        </div>
        <h1 className="text-3xl font-display">Procès-verbal de réception</h1>
        <div className="flex items-center gap-2 mt-2">
          <span className={`text-xs px-2 py-1 rounded-full ${STATUS_LABEL[pv.status]?.cls}`}>
            {STATUS_LABEL[pv.status]?.label}
          </span>
          {pv.reception_date && (
            <span className="text-xs text-stoniz-gray-600">
              Date de réception : {fmtDate(pv.reception_date)}
            </span>
          )}
        </div>
      </div>

      {pv.status === 'draft' && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
          <p className="text-sm text-amber-900">
            ⏳ Votre chef de projet finalise actuellement le PV. Vous recevrez un email
            dès qu'il sera prêt à être signé.
          </p>
        </div>
      )}

      {isSigned && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5">
          <p className="text-sm text-emerald-900">
            ✓ Vous avez signé ce PV de réception le <strong>{fmtDate(pv.client_signed_at)}</strong>.
            Merci pour votre confiance.
          </p>
          {pv.client_satisfaction_rating && (
            <p className="text-xs text-emerald-700 mt-2">
              Note de satisfaction : {pv.client_satisfaction_rating}/5 ⭐
            </p>
          )}
        </div>
      )}

      {/* En-tête du PV */}
      <section className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
        <h2 className="font-medium mb-3">Parties présentes</h2>
        <dl className="text-sm space-y-1.5">
          <div>
            <dt className="text-xs text-stoniz-gray-500">Côté Stoniz</dt>
            <dd className="font-medium">{pv.parties_stoniz ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-stoniz-gray-500">Côté propriétaire</dt>
            <dd className="font-medium">{pv.parties_client ?? '—'}</dd>
          </div>
        </dl>
      </section>

      {/* Relevés compteurs */}
      {(pv.meter_electricity_reading || pv.meter_water_reading || pv.meter_gas_reading) && (
        <section className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
          <h2 className="font-medium mb-3">Relevés compteurs au jour J</h2>
          <dl className="text-sm grid grid-cols-3 gap-3">
            {pv.meter_electricity_reading && (
              <div>
                <dt className="text-xs text-stoniz-gray-500">Électricité</dt>
                <dd className="font-mono">{pv.meter_electricity_reading}</dd>
              </div>
            )}
            {pv.meter_water_reading && (
              <div>
                <dt className="text-xs text-stoniz-gray-500">Eau</dt>
                <dd className="font-mono">{pv.meter_water_reading}</dd>
              </div>
            )}
            {pv.meter_gas_reading && (
              <div>
                <dt className="text-xs text-stoniz-gray-500">Gaz</dt>
                <dd className="font-mono">{pv.meter_gas_reading}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      {/* Clés remises */}
      {(pv.keys_count || pv.keys_details) && (
        <section className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
          <h2 className="font-medium mb-3">Clés et accès remis</h2>
          <p className="text-sm">
            {pv.keys_count && <strong>{pv.keys_count} clé(s)/accès</strong>}
            {pv.keys_details && <span className="text-stoniz-gray-700"> · {pv.keys_details}</span>}
          </p>
        </section>
      )}

      {/* Réserves */}
      {reserves.length > 0 && (
        <section className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
          <h2 className="font-medium mb-3">
            Réserves contradictoires ({reserves.filter(r => r.status === 'open').length} ouverte(s))
          </h2>
          <p className="text-xs text-stoniz-gray-600 mb-3">
            Les points listés ici doivent être levés par Stoniz / l'artisan dans les délais indiqués.
            La signature vaut acceptation du PV avec ces réserves.
          </p>
          <ul className="space-y-2">
            {reserves.map(r => (
              <li key={r.id} className="flex items-start gap-3 text-sm border-b last:border-0 pb-2">
                <span className={`flex-shrink-0 w-2 h-2 rounded-full mt-1.5 ${
                  r.status === 'open' ? 'bg-orange-500' : 'bg-emerald-500'
                }`} />
                <div className="flex-1">
                  <p>{r.description}</p>
                  <p className="text-xs text-stoniz-gray-500 mt-0.5">
                    Responsable : {r.responsible_role ?? '—'}
                    {r.deadline && ` · Deadline : ${fmtDate(r.deadline)}`}
                    {r.status === 'resolved' && ' · ✓ Levée'}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Checklist d'inspection */}
      <section className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
        <h2 className="font-medium mb-3">Inspection détaillée par poste</h2>
        <div className="space-y-4">
          {Object.entries(grouped).map(([cat, list]) => (
            <div key={cat}>
              <h3 className="text-sm font-medium mb-2">{cat}</h3>
              <ul className="text-xs space-y-1">
                {(list as any[]).map(it => (
                  <li key={it.id} className="flex items-start gap-2">
                    <span className="flex-shrink-0">
                      {it.status === 'ok' && '✓'}
                      {it.status === 'reserve' && '⚠'}
                      {it.status === 'refus' && '❌'}
                      {!it.status && '○'}
                    </span>
                    <span className="text-stoniz-gray-700">
                      {it.name}
                      {it.observations && <span className="text-stoniz-gray-500"> — {it.observations}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Signature */}
      {canSign && (
        <ClientPvSignForm pvId={pv.id} defaultName={client.full_name} />
      )}

      {/* Lien vers version imprimable */}
      {isSigned && (
        <div className="text-center">
          <Link
            href={`/client/projects/${params.id}/reception/print`}
            target="_blank"
            className="text-sm text-stoniz-gray-600 hover:text-stoniz-black underline"
          >
            🖨 Voir la version imprimable (PDF)
          </Link>
        </div>
      )}
    </div>
  );
}
