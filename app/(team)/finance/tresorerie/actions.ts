'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { CATEGORY_LABELS } from '@/lib/finance/bank-categorizer';
import { resolvePeriodRange } from '@/lib/finance/period-helpers';
import { logFinanceAudit, computeFinanceDiff } from '@/lib/finance/audit';

// Pattern défensif partagé : redirects Next.js doivent re-throw.
function isNextRedirect(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'digest' in e
    && typeof (e as any).digest === 'string'
    && (e as any).digest.startsWith('NEXT_REDIRECT');
}
function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Erreur inconnue';
}

/**
 * Module Trésorerie — Server Actions (CEO 2026-06-03)
 *
 * Permissions : CEO + finance peuvent écrire ; developer voit en lecture
 * mais ne peut rien modifier.
 */

// ─── Édition du seuil d'alerte sur un compte ─────────────────────────────
export type SetThresholdResult = { ok: true } | { ok: false; error: string };

export async function setAccountAlertThresholdAction(
  accountId: string,
  threshold: string | null
): Promise<SetThresholdResult> {
  let me;
  try {
    me = await assertRole(['ceo', 'finance']);
  } catch {
    return { ok: false, error: 'Permission refusée' };
  }
  const supabase = createClient();

  let value: number | null = null;
  if (threshold && threshold.trim() !== '') {
    const n = Number(threshold);
    if (isNaN(n) || n < 0) {
      return { ok: false, error: 'Seuil invalide — entrer un montant positif en MAD' };
    }
    value = n;
  }

  // Lecture du before pour le diff audit (best-effort)
  const { data: before } = await supabase
    .from('bank_accounts')
    .select('alert_threshold_mad, account_label, bank_label')
    .eq('id', accountId)
    .maybeSingle();

  const { error } = await supabase
    .from('bank_accounts')
    .update({ alert_threshold_mad: value } as any)
    .eq('id', accountId);

  if (error) {
    return { ok: false, error: `Échec de l'enregistrement : ${error.message}` };
  }

  // Audit log (après le commit — best-effort)
  const beforeAny = before as any;
  const diff = computeFinanceDiff(
    beforeAny ?? null,
    { alert_threshold_mad: value },
    ['alert_threshold_mad'],
  );
  if (Object.keys(diff).length > 0) {
    await logFinanceAudit({
      table: 'bank_accounts',
      recordId: accountId,
      action: 'status_change',
      actorId: me.id,
      label: `Seuil d'alerte modifié`,
      payload: {
        ...diff,
        account_label: beforeAny?.account_label ?? null,
        bank_label: beforeAny?.bank_label ?? null,
      },
    });
  }

  revalidatePath('/finance/tresorerie');
  return { ok: true };
}

// ─── Saisie d'un nouveau solde manuel ────────────────────────────────────
const recordBalanceSchema = z.object({
  account_id: z.string().uuid(),
  balance_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format date invalide (YYYY-MM-DD)'),
  balance_amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'Montant invalide'),
  notes: z.string().optional().nullable(),
});

export async function recordBalanceAction(formData: FormData) {
  const me = await assertRole(['ceo', 'finance']);
  const supabase = createClient();

  const raw: Record<string, any> = {};
  for (const [k, v] of formData.entries()) raw[k] = v === '' ? null : v;
  const data = recordBalanceSchema.parse(raw);

  // Récupère la devise du compte pour la stocker en snapshot
  const { data: account, error: accountErr } = await supabase
    .from('bank_accounts')
    .select('currency, account_label, bank_label, deleted_at')
    .eq('id', data.account_id)
    .single();

  if (accountErr || !account || account.deleted_at) {
    throw new Error('Compte introuvable ou supprimé');
  }

  const { data: inserted, error } = await supabase
    .from('bank_balances')
    .insert({
      account_id: data.account_id,
      balance_date: data.balance_date,
      balance_amount: data.balance_amount,
      currency: account.currency,
      source: 'manual',
      notes: data.notes ?? null,
      recorded_by: me.id,
    } as any)
    .select('id')
    .single();

  if (error) {
    throw new Error(`Impossible d'enregistrer le solde : ${error.message}`);
  }

  // Audit log (best-effort)
  if (inserted) {
    await logFinanceAudit({
      table: 'bank_balances',
      recordId: (inserted as any).id,
      action: 'create',
      actorId: me.id,
      label: `Solde saisi (${Number(data.balance_amount).toFixed(2)} ${account.currency})`,
      payload: {
        balance_amount: data.balance_amount,
        balance_date: data.balance_date,
        account_id: data.account_id,
        account_label: (account as any).account_label ?? null,
        bank_label: (account as any).bank_label ?? null,
        source: 'manual',
      },
    });
  }

  revalidatePath('/finance/tresorerie');
}

// ─── Ajout d'un nouveau compte bancaire ──────────────────────────────────
const addAccountSchema = z.object({
  company_id: z.string().uuid(),
  bank_code: z.string().min(2).max(50),
  bank_label: z.string().min(2),
  account_label: z.string().min(2),
  account_number: z.string().optional().nullable(),
  currency: z.enum(['MAD', 'EUR', 'USD']).default('MAD'),
});

export async function addAccountAction(formData: FormData) {
  const me = await assertRole(['ceo', 'finance']);
  const supabase = createClient();

  const raw: Record<string, any> = {};
  for (const [k, v] of formData.entries()) raw[k] = v === '' ? null : v;
  const data = addAccountSchema.parse(raw);

  const { data: inserted, error } = await supabase
    .from('bank_accounts')
    .insert({
      company_id: data.company_id,
      bank_code: data.bank_code,
      bank_label: data.bank_label,
      account_label: data.account_label,
      account_number: data.account_number ?? null,
      currency: data.currency,
    } as any)
    .select('id')
    .single();

  if (error) {
    throw new Error(`Impossible d'ajouter le compte : ${error.message}`);
  }

  // Audit log (best-effort) — RIB tronqué pour ne pas tout exposer
  if (inserted) {
    const acctNum = data.account_number ?? null;
    const truncatedAccountNumber = acctNum
      ? acctNum.length > 6
        ? `${acctNum.slice(0, 4)}…${acctNum.slice(-2)}`
        : acctNum
      : null;
    await logFinanceAudit({
      table: 'bank_accounts',
      recordId: (inserted as any).id,
      action: 'create',
      actorId: me.id,
      label: `Compte ajouté : ${data.bank_label} · ${data.account_label}`,
      payload: {
        bank_code: data.bank_code,
        bank_label: data.bank_label,
        account_label: data.account_label,
        currency: data.currency,
        company_id: data.company_id,
        account_number_truncated: truncatedAccountNumber,
      },
    });
  }

  revalidatePath('/finance/tresorerie');
}

// ─── Désactivation d'un compte (soft-delete) ─────────────────────────────
export async function deactivateAccountAction(accountId: string) {
  const me = await assertRole(['ceo']); // CEO seul peut désactiver
  const supabase = createClient();

  // Snapshot pour audit (best-effort)
  const { data: before } = await supabase
    .from('bank_accounts')
    .select('account_label, bank_label, company_id, currency')
    .eq('id', accountId)
    .maybeSingle();

  const { error } = await supabase
    .from('bank_accounts')
    .update({ deleted_at: new Date().toISOString() } as any)
    .eq('id', accountId);

  if (error) {
    throw new Error(`Impossible de désactiver le compte : ${error.message}`);
  }

  const b = before as any;
  await logFinanceAudit({
    table: 'bank_accounts',
    recordId: accountId,
    action: 'delete',
    actorId: me.id,
    label: `Compte désactivé${b?.account_label ? ` : ${b.bank_label ?? ''} · ${b.account_label}` : ''}`,
    payload: {
      account_label: b?.account_label ?? null,
      bank_label: b?.bank_label ?? null,
      company_id: b?.company_id ?? null,
      currency: b?.currency ?? null,
    },
  });

  revalidatePath('/finance/tresorerie');
}

// ─── Ajout d'une nouvelle société ────────────────────────────────────────
const addCompanySchema = z.object({
  code: z.string().regex(/^[a-z0-9_]+$/, 'Code en lowercase (a-z, 0-9, _)'),
  name: z.string().min(2),
  legal_name: z.string().optional().nullable(),
  country_code: z.enum(['MA', 'FR', 'ES']).default('MA'),
  currency: z.enum(['MAD', 'EUR', 'USD']).default('MAD'),
  business_unit: z.enum(['stoniz', 'propria']),
  notes: z.string().optional().nullable(),
});

export async function addCompanyAction(formData: FormData) {
  const me = await assertRole(['ceo']); // CEO seul peut ajouter une société
  const supabase = createClient();

  const raw: Record<string, any> = {};
  for (const [k, v] of formData.entries()) raw[k] = v === '' ? null : v;
  const data = addCompanySchema.parse(raw);

  const { data: inserted, error } = await supabase
    .from('bank_companies')
    .insert({
      code: data.code,
      name: data.name,
      legal_name: data.legal_name ?? null,
      country_code: data.country_code,
      currency: data.currency,
      business_unit: data.business_unit,
      notes: data.notes ?? null,
    } as any)
    .select('id')
    .single();

  if (error) {
    throw new Error(`Impossible d'ajouter la société : ${error.message}`);
  }

  if (inserted) {
    await logFinanceAudit({
      table: 'bank_companies',
      recordId: (inserted as any).id,
      action: 'create',
      actorId: me.id,
      label: `Société ajoutée : ${data.name}`,
      payload: {
        code: data.code,
        name: data.name,
        legal_name: data.legal_name ?? null,
        country_code: data.country_code,
        currency: data.currency,
        business_unit: data.business_unit,
      },
    });
  }

  revalidatePath('/finance/tresorerie');
}

// ─── Export XLSX vue filtrée (CEO 2026-06-23) ────────────────────────────
export type ExportTransactionsXlsxResult =
  | {
      ok: true;
      base64: string;
      filename: string;
      /** True si la requête a touché la limite EXPORT_LIMIT (5000) — UI doit avertir. */
      truncated: boolean;
      /** Nombre total de lignes disponibles AVANT troncature (≤ 5001 vu la query). */
      totalCount: number;
      /** Nombre de lignes effectivement écrites dans le XLSX. */
      exportedCount: number;
    }
  | { ok: false; error: string };

/**
 * Export XLSX des transactions bancaires correspondant aux filtres URL passés
 * depuis le toolbar. Réplique la logique de la page (filtres + statut) et
 * sort 1 ligne par transaction avec date, libellé, débit, crédit, compte,
 * catégorie, statut allocation.
 *
 * Pattern défensif : try/catch global + {ok,error} + re-throw redirects.
 */
export async function exportTransactionsXlsxAction(
  searchParams: Record<string, string>
): Promise<ExportTransactionsXlsxResult> {
  try {
    await assertRole(['ceo', 'finance', 'developer']);
    const supabase = createClient();

    const filterType = searchParams.type ?? 'all';
    const filterStatus = searchParams.status ?? 'all';

    let txQuery = supabase
      .from('bank_transactions')
      .select(`
        id, operation_date, label, reference,
        debit_mad, credit_mad, category_code, beneficiary, is_pending,
        account:bank_accounts(account_label, bank_label,
          company:bank_companies(name)
        ),
        allocations:bank_transaction_allocations(amount_mad, deleted_at)
      `)
      .is('deleted_at', null);

    if (filterType === 'debit') txQuery = txQuery.gt('debit_mad', 0);
    else if (filterType === 'credit') txQuery = txQuery.gt('credit_mad', 0);

    // Période preset ou dates custom
    const periodPreset = searchParams.period ?? 'last_3_months';
    const { fromDate: presetFrom, toDate: presetTo } = resolvePeriodRange(periodPreset);
    const fromDate = searchParams.from || presetFrom;
    const toDate = searchParams.to || presetTo;
    if (fromDate) txQuery = txQuery.gte('operation_date', fromDate);
    if (toDate) txQuery = txQuery.lte('operation_date', toDate);

    if (searchParams.account_id) txQuery = txQuery.eq('account_id', searchParams.account_id);
    if (searchParams.category) txQuery = txQuery.eq('category_code', searchParams.category);

    if (searchParams.q) {
      const tokens = searchParams.q.trim().split(/\s+/).filter(Boolean);
      for (const tok of tokens) {
        const safe = tok.replace(/[%_,()]/g, ' ').trim();
        if (!safe) continue;
        const orParts = [
          `label.ilike.%${safe}%`,
          `beneficiary.ilike.%${safe}%`,
          `reference.ilike.%${safe}%`,
        ];
        if (/^\d+(\.\d+)?$/.test(safe)) {
          orParts.push(`debit_mad.eq.${safe}`);
          orParts.push(`credit_mad.eq.${safe}`);
        }
        txQuery = txQuery.or(orParts.join(','));
      }
    }
    const minAmt = searchParams.min ? Number(searchParams.min) : null;
    const maxAmt = searchParams.max ? Number(searchParams.max) : null;
    if (minAmt != null && !isNaN(minAmt)) {
      txQuery = txQuery.or(`debit_mad.gte.${minAmt},credit_mad.gte.${minAmt}`);
    }
    if (maxAmt != null && !isNaN(maxAmt)) {
      txQuery = txQuery.or(`debit_mad.lte.${maxAmt},credit_mad.lte.${maxAmt}`);
    }

    // Limite 5000 lignes pour ne pas exploser la mémoire serveur. Si l'utilisateur
    // a plus de transactions sur sa fenêtre filtrée, on tronque ET on le signale
    // dans la réponse (CEO doit pouvoir réagir : resserrer la période ou exporter
    // par lot). Limite légèrement augmentée à 5001 pour DÉTECTER le débordement.
    const EXPORT_LIMIT = 5000;
    txQuery = txQuery
      .order('operation_date', { ascending: false })
      .limit(EXPORT_LIMIT + 1);

    const { data, error } = await txQuery;
    if (error) return { ok: false, error: error.message };

    const rawRows = (data ?? []) as any[];
    const truncated = rawRows.length > EXPORT_LIMIT;
    const truncatedRows = truncated ? rawRows.slice(0, EXPORT_LIMIT) : rawRows;

    // Calcul statut alloc côté JS (idem page)
    const enriched = truncatedRows.map((t) => {
      const amount = Math.abs(Number(t.debit_mad ?? t.credit_mad ?? 0));
      const allocs = (t.allocations ?? []).filter((a: any) => a.deleted_at == null);
      const allocated = allocs.reduce((s: number, a: any) => s + Math.abs(Number(a.amount_mad)), 0);
      const remaining = Math.max(0, amount - allocated);
      let statusCode: 'unallocated' | 'partial' | 'allocated' | 'pending';
      if (t.is_pending) statusCode = 'pending';
      else if (remaining < 0.01 && allocated > 0) statusCode = 'allocated';
      else if (allocated > 0) statusCode = 'partial';
      else statusCode = 'unallocated';
      return { ...t, _statusCode: statusCode, _allocated: allocated, _remaining: remaining };
    });

    const filtered = filterStatus === 'all'
      ? enriched
      : enriched.filter((t) => t._statusCode === filterStatus);

    const STATUS_LABELS: Record<string, string> = {
      pending: 'En attente',
      allocated: 'Allouée',
      partial: 'Partielle',
      unallocated: 'Non allouée',
    };

    const sheetRows = filtered.map((t) => ({
      Date: t.operation_date ?? '',
      Société: t.account?.company?.name ?? '',
      Banque: t.account?.bank_label ?? '',
      Compte: t.account?.account_label ?? '',
      Libellé: t.label ?? '',
      Bénéficiaire: t.beneficiary ?? '',
      Référence: t.reference ?? '',
      'Débit (MAD)': t.debit_mad ?? '',
      'Crédit (MAD)': t.credit_mad ?? '',
      Catégorie: (CATEGORY_LABELS as any)[t.category_code ?? ''] ?? t.category_code ?? '',
      Statut: STATUS_LABELS[t._statusCode] ?? t._statusCode,
      'Alloué (MAD)': Number(t._allocated.toFixed(2)),
      'Restant (MAD)': Number(t._remaining.toFixed(2)),
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    XLSX.utils.book_append_sheet(wb, ws, 'Transactions');

    const buf = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' }) as string;

    const today = new Date().toISOString().slice(0, 10);
    const filename = `tresorerie-transactions-${today}.xlsx`;

    return {
      ok: true,
      base64: buf,
      filename,
      truncated,
      totalCount: rawRows.length,
      exportedCount: truncatedRows.length,
    };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}
