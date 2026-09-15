import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';

function fmtDate(d: any): string {
  if (!d) return '—';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}

export default async function PvPrintPage({ params }: { params: { id: string } }) {
  const user = await requireRole(['client','ceo','chef_projet']);
  const supabase = createClient();

  const { data: project } = await supabase
    .from('projects')
    .select(`
      id, reference,
      client:clients(full_name, email),
      property:properties(name, address, quartier)
    `)
    .eq('id', params.id).single();
  if (!project) notFound();

  const [pvRes, itemsRes, reservesRes] = await Promise.all([
    supabase.from('project_reception_pvs')
      .select('*').eq('project_id', params.id).maybeSingle(),
    supabase.from('project_reception_pv_items')
      .select('id, category, name, status, observations, display_order')
      .order('display_order'),
    supabase.from('project_reception_pv_reserves')
      .select('id, description, responsible_role, deadline, status'),
  ]);

  const pv = pvRes.data;
  const items = (itemsRes.data ?? []) as any[];
  const reserves = (reservesRes.data ?? []) as any[];

  if (!pv) notFound();

  // Filtre items du PV (via RLS, mais on s'en assure)
  const groupedItems = items.reduce((acc: Record<string, any[]>, it) => {
    if (!acc[it.category]) acc[it.category] = [];
    acc[it.category].push(it);
    return acc;
  }, {});

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          @page { margin: 1.5cm; size: A4; }
          .no-print { display: none !important; }
          body { font-size: 11pt; }
          h1 { font-size: 18pt; }
          h2 { font-size: 14pt; page-break-after: avoid; }
          .pv-section { page-break-inside: avoid; }
        }
        body { font-family: 'Manrope', sans-serif; color: #1a1a1a; background: white; }
        .pv-doc { max-width: 800px; margin: 0 auto; padding: 40px 32px; background: white; }
        .pv-section { margin-bottom: 24px; padding-bottom: 16px; border-bottom: 1px solid #e8e4d8; }
        .pv-section:last-child { border-bottom: none; }
        h1 { font-weight: 800; margin: 0 0 8px 0; }
        h2 { font-weight: 700; margin: 24px 0 12px 0; letter-spacing: -0.01em; }
        h3 { font-weight: 600; margin: 16px 0 8px 0; font-size: 13pt; }
        .pv-header { border-bottom: 2px solid #1a1a1a; padding-bottom: 16px; margin-bottom: 24px; }
        .pv-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 10pt; color: #555; }
        .pv-meta dt { font-weight: 600; color: #1a1a1a; }
        .item-ok { color: #16a34a; }
        .item-reserve { color: #f59e0b; }
        .item-refus { color: #dc2626; }
        .signature-box { margin-top: 48px; padding-top: 24px; border-top: 1px dashed #999; }
        .stamp { display: inline-block; padding: 8px 16px; border: 2px solid #16a34a; color: #16a34a; font-weight: 600; transform: rotate(-3deg); }
      ` }} />

      <div className="no-print" style={{
        background: '#fef3c7',
        padding: '12px',
        textAlign: 'center',
        borderBottom: '1px solid #f59e0b'
      }}>
        <button
          onClick={() => window.print()}
          style={{
            background: '#1a1a1a',
            color: 'white',
            padding: '8px 16px',
            borderRadius: '6px',
            fontSize: '14px',
            border: 'none',
            cursor: 'pointer'
          }}
        >
          🖨 Imprimer / Enregistrer en PDF
        </button>
        <span style={{ marginLeft: '16px', fontSize: '12px', color: '#92400e' }}>
          Utilise Ctrl/Cmd+P puis "Enregistrer en PDF"
        </span>
      </div>

      <div className="pv-doc">
        <div className="pv-header">
          <h1>Procès-verbal de réception</h1>
          <p style={{ fontSize: '11pt', color: '#555', margin: '4px 0' }}>
            Référence projet : <strong>{project.reference}</strong>
          </p>
          <p style={{ fontSize: '11pt', color: '#555', margin: '4px 0' }}>
            Date de réception : <strong>{fmtDate(pv.reception_date)}</strong>
          </p>
          {pv.status === 'validated' && (
            <div style={{ marginTop: '12px' }}>
              <span className="stamp">✓ SIGNÉ ÉLECTRONIQUEMENT</span>
            </div>
          )}
        </div>

        <section className="pv-section">
          <h2>1. Identification</h2>
          <dl className="pv-meta">
            <div>
              <dt>Bien</dt>
              <dd>{(project.property as any)?.name ?? '—'}</dd>
            </div>
            <div>
              <dt>Adresse</dt>
              <dd>{(project.property as any)?.address ?? '—'}</dd>
            </div>
            <div>
              <dt>Quartier</dt>
              <dd>{(project.property as any)?.quartier ?? '—'}</dd>
            </div>
            <div>
              <dt>Propriétaire</dt>
              <dd>{(project.client as any)?.full_name ?? '—'}</dd>
            </div>
          </dl>
        </section>

        <section className="pv-section">
          <h2>2. Parties présentes</h2>
          <dl className="pv-meta">
            <div>
              <dt>Côté Stoniz</dt>
              <dd>{pv.parties_stoniz ?? '—'}</dd>
            </div>
            <div>
              <dt>Côté propriétaire</dt>
              <dd>{pv.parties_client ?? '—'}</dd>
            </div>
            {pv.weather_conditions && (
              <div>
                <dt>Conditions</dt>
                <dd>{pv.weather_conditions}</dd>
              </div>
            )}
          </dl>
        </section>

        {(pv.meter_electricity_reading || pv.meter_water_reading || pv.meter_gas_reading) && (
          <section className="pv-section">
            <h2>3. Relevés compteurs au jour J</h2>
            <dl className="pv-meta" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
              {pv.meter_electricity_reading && (
                <div>
                  <dt>Électricité (kWh)</dt>
                  <dd style={{ fontFamily: 'monospace' }}>{pv.meter_electricity_reading}</dd>
                </div>
              )}
              {pv.meter_water_reading && (
                <div>
                  <dt>Eau (m³)</dt>
                  <dd style={{ fontFamily: 'monospace' }}>{pv.meter_water_reading}</dd>
                </div>
              )}
              {pv.meter_gas_reading && (
                <div>
                  <dt>Gaz</dt>
                  <dd style={{ fontFamily: 'monospace' }}>{pv.meter_gas_reading}</dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {(pv.keys_count || pv.keys_details) && (
          <section className="pv-section">
            <h2>4. Clés et accès remis</h2>
            <p>
              {pv.keys_count && <strong>{pv.keys_count} clé(s) / accès</strong>}
              {pv.keys_details && <span> · {pv.keys_details}</span>}
            </p>
          </section>
        )}

        <section className="pv-section">
          <h2>5. Inspection détaillée</h2>
          {Object.entries(groupedItems).map(([cat, list]) => (
            <div key={cat} style={{ marginBottom: '16px' }}>
              <h3>{cat}</h3>
              <table style={{ width: '100%', fontSize: '10pt', borderCollapse: 'collapse' }}>
                <tbody>
                  {(list as any[]).map(it => (
                    <tr key={it.id} style={{ borderBottom: '1px solid #f0ede4' }}>
                      <td style={{ padding: '4px 8px 4px 0', width: '60%' }}>{it.name}</td>
                      <td style={{ padding: '4px 8px', width: '15%', textAlign: 'center' }}>
                        {it.status === 'ok' && <span className="item-ok">✓ Conforme</span>}
                        {it.status === 'reserve' && <span className="item-reserve">⚠ Réserve</span>}
                        {it.status === 'refus' && <span className="item-refus">❌ Refus</span>}
                        {!it.status && <span style={{ color: '#999' }}>—</span>}
                      </td>
                      <td style={{ padding: '4px 0 4px 8px', color: '#666', fontSize: '9pt' }}>
                        {it.observations ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>

        {reserves.length > 0 && (
          <section className="pv-section">
            <h2>6. Réserves contradictoires</h2>
            <p style={{ fontSize: '10pt', color: '#666', marginBottom: '12px' }}>
              Les points listés ci-dessous doivent être levés dans les délais indiqués.
              La signature du présent PV vaut acceptation avec ces réserves.
            </p>
            <ol style={{ paddingLeft: '20px' }}>
              {reserves.map(r => (
                <li key={r.id} style={{ marginBottom: '8px' }}>
                  <strong>{r.description}</strong>
                  <div style={{ fontSize: '10pt', color: '#666' }}>
                    Responsable : {r.responsible_role ?? '—'}
                    {r.deadline && ` · Délai : ${fmtDate(r.deadline)}`}
                    {r.status === 'resolved' && ' · ✓ Levée'}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}

        {pv.general_observations && (
          <section className="pv-section">
            <h2>7. Observations générales</h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>{pv.general_observations}</p>
          </section>
        )}

        <section className="signature-box pv-section">
          <h2>Signatures</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', marginTop: '24px' }}>
            <div>
              <p style={{ fontSize: '10pt', color: '#666', marginBottom: '8px' }}>Côté Stoniz</p>
              <p style={{ fontWeight: 600 }}>{pv.parties_stoniz ?? 'Stoniz'}</p>
            </div>
            <div>
              <p style={{ fontSize: '10pt', color: '#666', marginBottom: '8px' }}>Côté propriétaire</p>
              {pv.client_signed_at ? (
                <>
                  <p style={{ fontWeight: 600 }}>{pv.client_signed_full_name}</p>
                  <p style={{ fontSize: '9pt', color: '#666', marginTop: '4px' }}>
                    Signé électroniquement le {fmtDate(pv.client_signed_at)}
                  </p>
                  <p style={{ fontSize: '8pt', color: '#999', marginTop: '2px', fontFamily: 'monospace' }}>
                    IP : {pv.client_signed_ip ?? '—'}
                  </p>
                </>
              ) : (
                <p style={{ color: '#999' }}>En attente de signature</p>
              )}
            </div>
          </div>
          <p style={{ fontSize: '9pt', color: '#999', marginTop: '32px', textAlign: 'center' }}>
            PV généré par Stoniz le {fmtDate(new Date().toISOString())} · Conforme à la loi 53-05 sur la signature électronique
          </p>
        </section>
      </div>
    </>
  );
}
