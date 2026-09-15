import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { formatDate } from '@/lib/utils/format';
import { PrintButton } from '@/components/brief/print-button';

const FINANCING_LABELS: Record<string, string> = {
  fonds_propres: 'Fonds propres',
  banque_classique: 'Banque traditionnelle',
  banque_islamique: 'Banque islamique',
  mixte: 'Mixte',
};
const RENTAL_LABELS: Record<string, string> = {
  courte_duree: 'Courte durée (Airbnb)',
  moyenne_duree: 'Moyenne durée (1-12 mois)',
  longue_duree: 'Longue durée (bail classique)',
  mixte: 'Mixte',
  indecis: 'À discuter',
};

/**
 * Vue imprimable du cahier des charges (Cmd+P → Save as PDF).
 * Format A4, sans navigation, optimisée pour impression.
 */
import { requireRole } from '@/lib/auth/require';

export default async function PrintBriefPage({ params }: { params: { id: string } }) {
  await requireRole(['ceo','chef_projet','developer','commercial','assistante']);
  const supabase = createClient();

  const [briefRes, projRes] = await Promise.all([
    supabase.from('project_briefs').select('*').eq('project_id', params.id).maybeSingle(),
    supabase.from('projects')
      .select('reference, client:clients(full_name, email, phone), chef:profiles!projects_assigned_chef_projet_fkey(full_name)')
      .eq('id', params.id).single(),
  ]);

  if (!briefRes.data || !projRes.data) notFound();
  const brief = briefRes.data;
  const project = projRes.data;
  const client = (project as any).client;

  const fmtEur = (v: any) => {
    if (v == null || v === '') return '—';
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(v));
  };

  return (
    <html lang="fr">
      <head>
        <title>Cahier des charges — {project.reference}</title>
        <style>{`
          @page { size: A4; margin: 20mm 18mm; }
          * { box-sizing: border-box; }
          body {
            font-family: 'Helvetica Neue', Arial, sans-serif;
            font-size: 11pt;
            line-height: 1.5;
            color: #1A1A1A;
            margin: 0;
            background: white;
          }
          .container { max-width: 800px; margin: 0 auto; padding: 24px 0; }
          h1 {
            font-family: Georgia, 'Playfair Display', serif;
            font-size: 28pt;
            font-weight: 500;
            margin: 0 0 8px 0;
          }
          h2 {
            font-family: Georgia, serif;
            font-size: 16pt;
            font-weight: 500;
            margin: 32px 0 12px 0;
            border-bottom: 1px solid #E2DDD6;
            padding-bottom: 8px;
          }
          .subtitle { color: #6B6560; font-size: 11pt; margin-bottom: 32px; }
          .meta { display: flex; gap: 24px; margin-bottom: 24px; font-size: 10pt; color: #6B6560; }
          .meta strong { color: #1A1A1A; }
          .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 32px; margin-bottom: 8px; }
          .row { display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid #F5F1EB; }
          .row .label { color: #6B6560; }
          .row .value { font-weight: 500; text-align: right; }
          .badge {
            display: inline-block; padding: 4px 12px; border-radius: 999px;
            font-size: 9pt; font-weight: 500;
          }
          .badge.validated { background: #DCFCE7; color: #166534; }
          .badge.pending { background: #FEF3C7; color: #92400E; }
          .badge.draft { background: #F5F1EB; color: #6B6560; }
          .signature {
            margin-top: 60px;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 48px;
          }
          .signature-block {
            border-top: 1px solid #1A1A1A;
            padding-top: 8px;
          }
          .signature-label { font-size: 9pt; color: #6B6560; }
          .signature-name { font-weight: 600; margin-top: 4px; }
          .footer {
            margin-top: 48px;
            padding-top: 16px;
            border-top: 1px solid #E2DDD6;
            font-size: 9pt;
            color: #6B6560;
            text-align: center;
          }
          .print-hide-btn {
            position: fixed; top: 16px; right: 16px;
            background: #1A1A1A; color: white;
            padding: 8px 16px; border-radius: 6px;
            border: none; cursor: pointer; font-size: 11pt;
          }
          @media print { .print-hide-btn { display: none; } }
          p { margin: 6px 0; }
          .quote { background: #F5F1EB; padding: 12px; border-radius: 4px; font-style: italic; }
        `}</style>
      </head>
      <body>
        <PrintButton />

        <div className="container">
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 14, color: '#6B6560', letterSpacing: 1 }}>STONIZ</div>
            <h1>Cahier des charges</h1>
            <p className="subtitle">{project.reference} · {client?.full_name}</p>

            <div className="meta">
              <div><strong>Client :</strong> {client?.full_name}</div>
              <div><strong>Email :</strong> {client?.email}</div>
              {client?.phone && <div><strong>Téléphone :</strong> {client.phone}</div>}
            </div>
            <div className="meta">
              <div><strong>Chef de projet :</strong> {(project as any).chef?.full_name ?? '—'}</div>
              <div><strong>Statut :</strong>{' '}
                <span className={`badge ${brief.status === 'validated' ? 'validated' : brief.status === 'sent_to_client' ? 'pending' : 'draft'}`}>
                  {brief.status === 'validated' ? `✓ Validé le ${formatDate(brief.validated_at)}` :
                   brief.status === 'sent_to_client' ? 'Envoyé au client' :
                   brief.status === 'rejected_by_client' ? 'Refusé par client' :
                   'Brouillon'}
                </span>
              </div>
            </div>
          </div>

          <h2>Type de bien & localisation</h2>
          <div className="row"><span className="label">Types acceptés</span>
            <span className="value">{(brief.property_types ?? []).join(', ') || '—'}</span></div>
          <div className="row"><span className="label">Quartiers ciblés</span>
            <span className="value">{(brief.quartiers ?? []).join(', ') || '—'}</span></div>

          <h2>Budget</h2>
          <div className="row"><span className="label">Budget total max</span><span className="value">{fmtEur(brief.budget_total_max)}</span></div>
          <div className="row"><span className="label">Acquisition max</span><span className="value">{fmtEur(brief.budget_acquisition_max)}</span></div>
          <div className="row"><span className="label">Travaux max</span><span className="value">{fmtEur(brief.budget_travaux_max)}</span></div>
          <div className="row"><span className="label">Déco / mobilier max</span><span className="value">{fmtEur(brief.budget_deco_max)}</span></div>
          <div className="row"><span className="label">Épargne disponible</span><span className="value">{fmtEur(brief.available_savings)}</span></div>
          <div className="row"><span className="label">Mode de financement</span>
            <span className="value">{FINANCING_LABELS[brief.financing_type] ?? '—'}</span></div>

          <h2>Caractéristiques recherchées</h2>
          <div className="row"><span className="label">Surface (m²)</span>
            <span className="value">
              {brief.superficie_min || brief.superficie_max
                ? `${brief.superficie_min ?? '?'} – ${brief.superficie_max ?? '?'}` : '—'}
            </span>
          </div>
          <div className="row"><span className="label">Suites minimum</span><span className="value">{brief.nb_suites_min ?? '—'}</span></div>
          <div className="row"><span className="label">Étage</span><span className="value">{brief.floor_preference ?? '—'}</span></div>
          <div className="row"><span className="label">Terrasse</span><span className="value">{brief.needs_terrace ? 'Exigée' : '—'}</span></div>
          <div className="row"><span className="label">Ascenseur</span><span className="value">{brief.needs_elevator ? 'Exigé' : '—'}</span></div>
          <div className="row"><span className="label">Parking</span><span className="value">{brief.needs_parking ? 'Exigé' : '—'}</span></div>
          <div className="row"><span className="label">Piscine</span><span className="value">{brief.needs_pool ? 'Souhaitée' : '—'}</span></div>
          <div className="row"><span className="label">Vue dégagée</span><span className="value">{brief.needs_view ? 'Souhaitée' : '—'}</span></div>

          <h2>Stratégie locative & objectifs</h2>
          <div className="row"><span className="label">Stratégie</span><span className="value">{RENTAL_LABELS[brief.rental_strategy] ?? '—'}</span></div>
          <div className="row"><span className="label">Loyer cible / mois</span><span className="value">{fmtEur(brief.expected_rent_monthly)}</span></div>
          <div className="row"><span className="label">Rendement brut cible</span><span className="value">{brief.expected_gross_yield_pct ? `${brief.expected_gross_yield_pct}%` : '—'}</span></div>
          <div className="row"><span className="label">Rendement net cible</span><span className="value">{brief.expected_net_yield_pct ? `${brief.expected_net_yield_pct}%` : '—'}</span></div>

          <h2>Travaux & contraintes</h2>
          <div className="row"><span className="label">Travaux lourds acceptés</span><span className="value">{brief.accept_heavy_works ? 'Oui' : 'Non'}</span></div>
          <div className="row"><span className="label">Division acceptée</span><span className="value">{brief.accept_division ? 'Oui' : 'Non'}</span></div>
          <div className="row"><span className="label">Mise en location souhaitée</span>
            <span className="value">{brief.delivery_deadline ? formatDate(brief.delivery_deadline) : '—'}</span></div>

          {(brief.specificities || brief.exclusions) && (
            <>
              <h2>Demandes spécifiques</h2>
              {brief.specificities && (
                <>
                  <p style={{ color: '#6B6560', marginBottom: 4 }}>Spécifications</p>
                  <div className="quote">{brief.specificities}</div>
                </>
              )}
              {brief.exclusions && (
                <>
                  <p style={{ color: '#6B6560', marginBottom: 4, marginTop: 12 }}>Exclusions</p>
                  <div className="quote">{brief.exclusions}</div>
                </>
              )}
            </>
          )}

          {brief.status === 'validated' && (
            <div className="signature">
              <div className="signature-block">
                <div className="signature-label">Pour Stoniz</div>
                <div className="signature-name">{(project as any).chef?.full_name ?? 'Chef de projet'}</div>
                <div style={{ fontSize: 9, color: '#6B6560', marginTop: 4 }}>Le {formatDate(brief.sent_at)}</div>
              </div>
              <div className="signature-block">
                <div className="signature-label">Pour le client</div>
                <div className="signature-name">{client?.full_name}</div>
                <div style={{ fontSize: 9, color: '#6B6560', marginTop: 4 }}>
                  Validé électroniquement le {formatDate(brief.validated_at)}
                </div>
              </div>
            </div>
          )}

          <div className="footer">
            Stoniz — Investissement immobilier clé en main au Maroc · contact@stoniz.co<br/>
            Document généré le {formatDate(new Date().toISOString())}
          </div>
        </div>
      </body>
    </html>
  );
}
