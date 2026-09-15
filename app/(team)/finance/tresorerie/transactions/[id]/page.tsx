import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { ArrowLeft, CheckCircle, AlertCircle, Sparkles } from 'lucide-react';
import {
  findReconcileCandidates,
  scoreToConfidence,
  type BankTransactionForRecon,
} from '@/lib/finance/bank-reconciliation';
import { CATEGORY_LABELS, ALLOCATION_LABELS } from '@/lib/finance/bank-categorizer';
import { AllocationForm } from './allocation-form';
import { AutoAttachButton } from './auto-attach-button';
import { RemoveAllocationButton } from './remove-allocation-button';
import { FinanceAuditButton } from '@/components/finance/finance-audit-timeline';

function fmtMad(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n) + ' MAD';
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR');
}

export default async function TransactionDetailPage({ params }: { params: { id: string } }) {
  const me = await requireRole(['ceo', 'finance', 'developer']);
  const canWrite = me.role === 'ceo' || me.role === 'finance';
  const supabase = createClient();

  // Récupère la transaction
  const { data: tx } = await supabase
    .from('bank_transactions')
    .select(`
      id, account_id, operation_date, value_date, label, reference,
      debit_mad, credit_mad, category_code, beneficiary, is_pending,
      imported_at, notes,
      account:bank_accounts(id, account_label, bank_label,
        company:bank_companies(name, business_unit)
      ),
      importer:profiles!bank_transactions_imported_by_fkey(full_name)
    `)
    .eq('id', params.id)
    .is('deleted_at', null)
    .single();

  if (!tx) notFound();
  const txAny = tx as any;

  // Récupère les allocations existantes
  const { data: allocations } = await supabase
    .from('bank_transaction_allocations')
    .select(`
      id, project_id, allocation_type, amount_mad, notes, allocated_at,
      travaux_lot_id, achats_lot_id, payment_id,
      project:projects(reference, client:clients(full_name)),
      allocator:profiles(full_name)
    `)
    .eq('transaction_id', params.id)
    .is('deleted_at', null)
    .order('allocated_at', { ascending: false });

  const allocs = (allocations ?? []) as any[];

  // Calculs allocation
  const txAmount = Math.abs(Number(txAny.debit_mad ?? txAny.credit_mad ?? 0));
  const allocatedTotal = allocs.reduce(
    (s, a) => s + Math.abs(Number(a.amount_mad)),
    0
  );
  const remaining = Math.max(0, txAmount - allocatedTotal);
  const isFullyAllocated = remaining < 0.01;

  // Recherche de candidats si pas encore totalement alloué.
  // CEO 2026-06-25 : on cherche sur le RESTE à allouer (et non le total), sinon
  // après une allocation partielle, on continue à proposer des matches au
  // montant brut de la transaction → toujours zéro résultat (ou faux positif).
  let candidates: Awaited<ReturnType<typeof findReconcileCandidates>> = [];
  if (!isFullyAllocated) {
    const isDebitTx = (Number(txAny.debit_mad ?? 0)) > 0;
    const reconAmount = Math.max(0, remaining);
    const txForRecon: BankTransactionForRecon = {
      id: txAny.id,
      account_id: txAny.account_id,
      operation_date: txAny.operation_date,
      value_date: txAny.value_date,
      label: txAny.label ?? '',
      reference: txAny.reference,
      // On reflète le reste à allouer sur le bon côté (debit/credit).
      // Si le reste est 0 on n'aurait pas appelé findReconcileCandidates.
      debit_mad: isDebitTx ? reconAmount : null,
      credit_mad: isDebitTx ? null : reconAmount,
      category_code: txAny.category_code,
      beneficiary: txAny.beneficiary,
    };
    try {
      candidates = await findReconcileCandidates(txForRecon, supabase as any, { minScore: 50, maxResults: 8 });
    } catch (err) {
      // Best-effort : un crash du moteur de matching ne doit pas faire tomber
      // toute la fiche de transaction. On log et on continue sans suggestions.
      console.warn('[tresorerie/transaction] findReconcileCandidates failed', { txId: txAny.id, err });
      candidates = [];
    }
  }

  // Pour le formulaire d'allocation : liste des projets actifs (perdus exclus)
  const { data: projects } = await supabase
    .from('projects')
    .select('id, reference, client:clients(full_name)')
    .is('deleted_at', null)
    .neq('status', 'perdu')
    .order('reference');

  // Lots travaux et achats — chargés en bulk côté serveur,
  // filtrés ensuite côté client selon le projet sélectionné.
  const [{ data: travauxLots }, { data: achatsLots }] = await Promise.all([
    supabase
      .from('travaux_lots')
      .select('id, project_id, artisan_name, category, description, status')
      .is('deleted_at', null)
      .order('artisan_name'),
    supabase
      .from('achats_lots')
      .select('id, project_id, supplier_name, category, description, status')
      .is('deleted_at', null)
      .order('supplier_name'),
  ]);

  const isDebit = (txAny.debit_mad ?? 0) > 0;
  const txAmountDisplay = txAny.debit_mad ?? txAny.credit_mad ?? 0;

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/finance/tresorerie"
            className="inline-flex items-center gap-2 text-sm text-stoniz-gray-500 hover:text-stoniz-black mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour à la trésorerie
          </Link>
          <h1 className="text-2xl font-display inline-flex items-center gap-2">
            Détail transaction
            <FinanceAuditButton table="bank_transactions" recordId={txAny.id} inline />
          </h1>
        </div>
      </div>

      {/* Bandeau résumé transaction */}
      <Card>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs uppercase text-stoniz-gray-500 mb-1">Date opération</div>
            <div className="text-lg font-medium">{fmtDate(txAny.operation_date)}</div>
            {txAny.value_date && txAny.value_date !== txAny.operation_date && (
              <div className="text-xs text-stoniz-gray-500">Valeur : {fmtDate(txAny.value_date)}</div>
            )}
          </div>
          <div>
            <div className="text-xs uppercase text-stoniz-gray-500 mb-1">Compte</div>
            <div className="text-sm font-medium">{txAny.account?.company?.name}</div>
            <div className="text-xs text-stoniz-gray-500">{txAny.account?.bank_label}</div>
          </div>
          <div>
            <div className="text-xs uppercase text-stoniz-gray-500 mb-1">Montant</div>
            <div className={`text-2xl font-display ${isDebit ? 'text-red-700' : 'text-emerald-700'}`}>
              {isDebit ? '−' : '+'} {fmtMad(Math.abs(Number(txAmountDisplay)))}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase text-stoniz-gray-500 mb-1">Catégorie auto</div>
            <div className="text-sm font-medium">
              {(CATEGORY_LABELS as any)[txAny.category_code] ?? txAny.category_code ?? 'Non catégorisé'}
            </div>
            {txAny.beneficiary && (
              <div className="text-xs text-stoniz-gray-500">
                Bénéficiaire : <strong>{txAny.beneficiary}</strong>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 pt-4 border-t">
          <div className="text-xs uppercase text-stoniz-gray-500 mb-1">Libellé brut Chaabi</div>
          <div className="font-mono text-sm text-stoniz-gray-800">{txAny.label}</div>
          {txAny.reference && (
            <div className="mt-2 text-xs text-stoniz-gray-500">
              Référence : <span className="font-mono">{txAny.reference}</span>
            </div>
          )}
        </div>
      </Card>

      {/* Statut allocation */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-display">Allocation</h2>
            <p className="text-xs text-stoniz-gray-500 mt-1">
              Rattachement de cette transaction à des projets / postes Stoniz
            </p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-display">
              {fmtMad(allocatedTotal)} / {fmtMad(txAmount)}
            </div>
            <div className={`text-xs font-medium mt-1 ${
              isFullyAllocated ? 'text-emerald-700' :
              allocatedTotal === 0 ? 'text-stoniz-gray-500' : 'text-orange-700'
            }`}>
              {isFullyAllocated ? (
                <span className="inline-flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Totalement alloué</span>
              ) : allocatedTotal === 0 ? (
                <span className="inline-flex items-center gap-1"><AlertCircle className="w-3.5 h-3.5" /> Pas encore alloué</span>
              ) : (
                <span>Reste {fmtMad(remaining)} à allouer</span>
              )}
            </div>
          </div>
        </div>

        {allocs.length > 0 ? (
          <div className="space-y-2 mb-4">
            {allocs.map((a) => (
              <div key={a.id} className="flex items-center justify-between bg-stoniz-gray-50 rounded p-3">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="text-xs uppercase px-2 py-0.5 rounded bg-white border text-stoniz-gray-700">
                      {(ALLOCATION_LABELS as any)[a.allocation_type] ?? a.allocation_type}
                    </span>
                    {a.project && (
                      <Link
                        href={`/projects/${a.project_id}`}
                        className="text-sm font-medium hover:underline"
                      >
                        {a.project.client?.full_name} · {a.project.reference}
                      </Link>
                    )}
                    {!a.project && (
                      <span className="text-sm text-stoniz-gray-500 italic">Pas de projet</span>
                    )}
                  </div>
                  {a.notes && <div className="text-xs text-stoniz-gray-500 mt-1">{a.notes}</div>}
                  <div className="text-[10px] text-stoniz-gray-400 mt-0.5">
                    Par {a.allocator?.full_name} · {fmtDate(a.allocated_at)}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-medium">{fmtMad(Number(a.amount_mad))}</div>
                  <div className="inline-flex items-center gap-2 mt-1">
                    <FinanceAuditButton table="bank_transaction_allocations" recordId={a.id} size="sm" />
                    {canWrite && (
                      <RemoveAllocationButton
                        allocationId={a.id}
                        transactionId={txAny.id}
                      />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-sm text-stoniz-gray-500 mb-4">
            Aucune allocation pour le moment.
          </div>
        )}
      </Card>

      {/* Suggestions de rapprochement */}
      {candidates.length > 0 && canWrite && !isFullyAllocated && (
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="w-5 h-5 text-purple-600" />
            <h2 className="text-lg font-display">Suggestions de rapprochement</h2>
          </div>
          <p className="text-xs text-stoniz-gray-500 mb-4">
            Le système a identifié {candidates.length} paiement{candidates.length > 1 ? 's' : ''} Stoniz potentiellement lié{candidates.length > 1 ? 's' : ''} à cette transaction (matching montant + date + bénéficiaire).
          </p>

          <div className="space-y-2">
            {candidates.map((c, i) => {
              const conf = scoreToConfidence(c.score);
              return (
                <div key={`${c.source}-${c.id}-${i}`} className="border border-stoniz-gray-200 rounded p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-1">
                        <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${
                          conf.color === 'green' ? 'bg-emerald-100 text-emerald-800' :
                          conf.color === 'orange' ? 'bg-orange-100 text-orange-800' :
                          'bg-stoniz-gray-100 text-stoniz-gray-700'
                        }`}>
                          {c.score}% · {conf.label}
                        </span>
                        <span className="text-xs text-stoniz-gray-500">{c.source.replace(/_/g, ' ')}</span>
                      </div>
                      <div className="text-sm">
                        {c.project_client && (
                          <strong>{c.project_client}</strong>
                        )}
                        {c.project_reference && (
                          <span className="text-stoniz-gray-500 ml-2 font-mono text-xs">{c.project_reference}</span>
                        )}
                      </div>
                      <div className="text-xs text-stoniz-gray-600 mt-0.5">{c.description}</div>
                      <div className="text-[10px] text-stoniz-gray-500 mt-1 flex gap-3">
                        <span>{fmtMad(c.amount_mad)} {c.match_amount && '✓'}</span>
                        <span>
                          {fmtDate(c.date)}
                          {c.match_date_days != null && ` (${c.match_date_days}j d'écart)`}
                        </span>
                        {c.beneficiary && (
                          <span>
                            {c.beneficiary} {c.match_beneficiary === 'exact' && '✓'}
                            {c.match_beneficiary === 'partial' && '≈'}
                          </span>
                        )}
                      </div>
                    </div>
                    <AutoAttachButton
                      transactionId={txAny.id}
                      source={c.source}
                      sourceId={c.id}
                      projectId={c.project_id}
                      amountMad={c.amount_mad}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Formulaire allocation manuelle */}
      {canWrite && !isFullyAllocated && (
        <Card>
          <h2 className="text-lg font-display mb-1">Allouer manuellement</h2>
          <p className="text-xs text-stoniz-gray-500 mb-4">
            Si la transaction concerne plusieurs projets (achat mutualisé), répète l'allocation
            avec des montants partiels jusqu'à atteindre {fmtMad(txAmount)} au total.
          </p>
          <AllocationForm
            transactionId={txAny.id}
            remaining={remaining}
            projects={(projects ?? []) as any[]}
            travauxLots={(travauxLots ?? []) as any[]}
            achatsLots={(achatsLots ?? []) as any[]}
            isDebit={isDebit}
            beneficiary={txAny.beneficiary ?? null}
          />
        </Card>
      )}
    </div>
  );
}
