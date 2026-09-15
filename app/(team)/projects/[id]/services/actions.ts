'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { logDeletion } from '@/lib/audit/deletion';
import { cascadeDeallocateOnDelete } from '@/lib/finance/cascade-deallocate';

const SERVICE_CATEGORIES = [
  'architecte','geometre','bureau_etudes','juridique_notariat',
  'photo_video','decoration_design','marketing_communication',
  'conseil','autre_service',
] as const;

const LOT_STATUSES = ['a_planifier','devis_recu','en_cours','livre','termine','annule'] as const;
const PAYMENT_STATUSES = ['planifie','partiel','paye','annule'] as const;

// ─── Création d'un lot services ───────────────────────────────────────────
const createLotSchema = z.object({
  project_id: z.string().uuid(),
  service_category: z.enum(SERVICE_CATEGORIES),
  provider_id: z.string().uuid().optional().nullable(),
  budget_estimate_mad: z.string().optional().nullable(),
  devis_prestataire_mad: z.string().optional().nullable(),
  status: z.enum(LOT_STATUSES).default('a_planifier'),
  description: z.string().optional().nullable(),
});

export async function createServiceLotAction(formData: FormData) {
  await assertRole(['ceo', 'chef_projet', 'finance']);
  const supabase = createClient();

  const raw: Record<string, any> = {};
  for (const [k, v] of formData.entries()) raw[k] = v === '' ? null : v;
  const data = createLotSchema.parse(raw);

  const { error } = await supabase
    .from('services_lots')
    .insert({
      project_id: data.project_id,
      service_category: data.service_category,
      provider_id: data.provider_id ?? null,
      budget_estimate_mad: data.budget_estimate_mad ? Number(data.budget_estimate_mad) : null,
      devis_prestataire_mad: data.devis_prestataire_mad ? Number(data.devis_prestataire_mad) : null,
      status: data.status,
      description: data.description ?? null,
    } as any);

  if (error) throw new Error(`Création lot services : ${error.message}`);

  revalidatePath(`/projects/${data.project_id}/services`);
  revalidatePath(`/projects/${data.project_id}`);
}

// ─── Édition d'un lot ─────────────────────────────────────────────────────
const updateLotSchema = z.object({
  lot_id: z.string().uuid(),
  project_id: z.string().uuid(),
  service_category: z.enum(SERVICE_CATEGORIES).optional(),
  provider_id: z.string().uuid().optional().nullable(),
  budget_estimate_mad: z.string().optional().nullable(),
  devis_prestataire_mad: z.string().optional().nullable(),
  facture_prestataire_mad: z.string().optional().nullable(),
  status: z.enum(LOT_STATUSES).optional(),
  description: z.string().optional().nullable(),
});

export async function updateServiceLotAction(formData: FormData) {
  await assertRole(['ceo', 'chef_projet', 'finance']);
  const supabase = createClient();

  const raw: Record<string, any> = {};
  for (const [k, v] of formData.entries()) raw[k] = v === '' ? null : v;
  const data = updateLotSchema.parse(raw);

  const update: Record<string, any> = {};
  if (data.service_category) update.service_category = data.service_category;
  if (data.provider_id !== undefined) update.provider_id = data.provider_id;
  if (data.budget_estimate_mad !== undefined)
    update.budget_estimate_mad = data.budget_estimate_mad ? Number(data.budget_estimate_mad) : null;
  if (data.devis_prestataire_mad !== undefined)
    update.devis_prestataire_mad = data.devis_prestataire_mad ? Number(data.devis_prestataire_mad) : null;
  if (data.facture_prestataire_mad !== undefined)
    update.facture_prestataire_mad = data.facture_prestataire_mad ? Number(data.facture_prestataire_mad) : null;
  if (data.status) update.status = data.status;
  if (data.description !== undefined) update.description = data.description;

  const { error } = await supabase
    .from('services_lots')
    .update(update)
    .eq('id', data.lot_id);

  if (error) throw new Error(`Édition lot : ${error.message}`);

  revalidatePath(`/projects/${data.project_id}/services`);
}

// ─── Soft-delete d'un lot Services ────────────────────────────────────────
// Aligné sur le canon travaux/achats : ouvert à CEO + chef_projet + finance + achats.
// On retourne { ok, error } au lieu de throw pour éviter de faire crasher
// le re-render du Server Component (UX prod = page d'erreur générique).
export async function deleteServiceLotAction(
  lotId: string,
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let user;
  try {
    user = await assertRole(['ceo', 'chef_projet', 'finance', 'achats']);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Permission refusée' };
  }
  const supabase = createClient();

  // Snapshot AVANT pour la corbeille admin
  const { data: lot } = await supabase
    .from('services_lots')
    .select('*')
    .eq('id', lotId)
    .single();

  const { error } = await supabase
    .from('services_lots')
    .update({ deleted_at: new Date().toISOString() } as any)
    .eq('id', lotId);

  if (error) return { ok: false, error: `Suppression : ${error.message}` };

  await logDeletion({
    table: 'services_lots',
    recordId: lotId,
    actorId: user.id,
    label: lot ? `Lot services - ${(lot as any).service_category ?? 'inconnu'} - ${(lot as any).devis_prestataire_mad ?? 0} MAD` : 'Lot services',
    snapshot: lot,
  });

  revalidatePath(`/projects/${projectId}/services`);
  return { ok: true };
}

// ─── Ajout d'un paiement (acompte) sur un lot ─────────────────────────────
//
// Deux cas de saisie :
//   • Paiement DÉJÀ EFFECTUÉ : paid_at renseigné → status='paye',
//     amount_paid = amount saisi.
//   • Paiement PROGRAMMÉ (à décaisser) : scheduled_date renseigné, paid_at vide
//     → status='planifie', amount_paid=0, amount_total = montant prévu.
//
// L'un des deux dates doit être présent. Cela permet de piloter la trésorerie
// à décaisser via le module Projection (qui lit scheduled_date).
const addPaymentSchema = z.object({
  lot_id: z.string().uuid(),
  project_id: z.string().uuid(),
  amount_paid: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  acompte_index: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

const SERVICE_PAYMENT_ROLES = ['ceo', 'chef_projet', 'finance', 'achats'] as const;

export async function addServicePaymentAction(formData: FormData) {
  await assertRole([...SERVICE_PAYMENT_ROLES]);
  const supabase = createClient();

  const raw: Record<string, any> = {};
  for (const [k, v] of formData.entries()) raw[k] = v === '' ? null : v;
  const data = addPaymentSchema.parse(raw);

  // Au moins une date doit être présente : payé ou planifié.
  if (!data.paid_at && !data.scheduled_date) {
    throw new Error('Renseigne soit une date de paiement effectif, soit une date d’échéance prévue.');
  }

  // Récupère le lot pour son provider_id
  const { data: lot } = await supabase
    .from('services_lots')
    .select('id, project_id, provider_id, devis_prestataire_mad')
    .eq('id', data.lot_id)
    .single();
  if (!lot) throw new Error('Lot introuvable');

  const amount = Number(data.amount_paid);
  const acompteIdx = data.acompte_index ? Number(data.acompte_index) : null;
  if (acompteIdx != null && (acompteIdx < 1 || acompteIdx > 6)) {
    throw new Error("L'index d'acompte doit être entre 1 et 6");
  }

  // Statut dérivé : payé si paid_at, sinon planifié.
  const isPaid = !!data.paid_at;

  const { error } = await supabase
    .from('services_payments')
    .insert({
      project_id: data.project_id,
      lot_id: data.lot_id,
      provider_id: (lot as any).provider_id ?? null,
      acompte_index: acompteIdx,
      paid_at: isPaid ? data.paid_at : null,
      scheduled_date: data.scheduled_date ?? null,
      amount_total: amount,
      amount_paid: isPaid ? amount : 0,
      status: isPaid ? 'paye' : 'planifie',
      description: data.description ?? null,
      notes: data.notes ?? null,
    } as any);

  if (error) throw new Error(`Ajout paiement : ${error.message}`);

  revalidatePath(`/projects/${data.project_id}/services`);
}

// ─── Édition d'un paiement (montant + dates + notes) ──────────────────────
const updatePaymentSchema = z.object({
  payment_id: z.string().uuid(),
  project_id: z.string().uuid(),
  amount_paid: z.string().regex(/^-?\d+(\.\d{1,2})?$/).optional().nullable(),
  paid_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  description: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

/**
 * Met à jour un paiement existant. Si paid_at devient non-null, le statut
 * passe à 'paye' et amount_paid = amount_total. Si paid_at est null mais
 * scheduled_date présent, statut 'planifie'. Sinon erreur.
 */
export async function updateServicePaymentAction(input: unknown) {
  await assertRole([...SERVICE_PAYMENT_ROLES]);
  const data = updatePaymentSchema.parse(input);

  const supabase = createClient();

  // Lit l'état courant pour préserver les champs non envoyés
  const { data: cur, error: readErr } = await supabase
    .from('services_payments')
    .select('id, amount_total, status')
    .eq('id', data.payment_id)
    .single();
  if (readErr || !cur) throw new Error('Paiement introuvable');

  const newAmount = data.amount_paid != null ? Number(data.amount_paid) : Number((cur as any).amount_total);
  const isPaid = !!data.paid_at;
  if (!isPaid && !data.scheduled_date) {
    throw new Error('Renseigne soit une date de paiement effectif, soit une date d’échéance prévue.');
  }

  const patch: Record<string, any> = {
    amount_total: newAmount,
    amount_paid: isPaid ? newAmount : 0,
    paid_at: isPaid ? data.paid_at : null,
    scheduled_date: data.scheduled_date ?? null,
    status: isPaid ? 'paye' : 'planifie',
    description: data.description ?? null,
    notes: data.notes ?? null,
  };

  const { error } = await supabase
    .from('services_payments')
    .update(patch)
    .eq('id', data.payment_id);
  if (error) throw new Error(`Mise à jour paiement : ${error.message}`);

  revalidatePath(`/projects/${data.project_id}/services`);
}

// ─── Soft-delete d'un paiement ────────────────────────────────────────────
export async function deleteServicePaymentAction(
  paymentId: string,
  projectId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let user;
  try {
    user = await assertRole([...SERVICE_PAYMENT_ROLES]);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Permission refusée' };
  }
  const supabase = createClient();

  const { data: pay } = await supabase
    .from('services_payments')
    .select('*')
    .eq('id', paymentId)
    .single();

  const { error } = await supabase
    .from('services_payments')
    .update({ deleted_at: new Date().toISOString() } as any)
    .eq('id', paymentId);

  if (error) return { ok: false, error: `Suppression paiement : ${error.message}` };

  await logDeletion({
    table: 'services_payments',
    recordId: paymentId,
    actorId: user.id,
    label: pay ? `Paiement service - ${(pay as any).amount_paid ?? 0} MAD` : 'Paiement service',
    snapshot: pay,
  });
  // Cascade : retire les allocations banque qui pointaient sur ce paiement.
  await cascadeDeallocateOnDelete({ table: 'services_payments', recordId: paymentId, actorId: user.id });

  revalidatePath(`/projects/${projectId}/services`);
  revalidatePath('/finance/tresorerie');
  revalidatePath('/finance/tresorerie/reconciliation');
  return { ok: true };
}

// ─── Création rapide d'un prestataire (extension artisan-combobox pattern) ──
const createProviderSchema = z.object({
  name: z.string().min(2),
  provider_type: z.enum(['artisan_travaux', 'fournisseur_achats', 'prestataire_service']),
  service_category: z.enum(SERVICE_CATEGORIES).optional().nullable(),
});

export async function createProviderMinimalAction(input: {
  name: string;
  provider_type: 'artisan_travaux' | 'fournisseur_achats' | 'prestataire_service';
  service_category?: string | null;
}): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  try {
    await assertRole(['ceo', 'chef_projet', 'finance']);
  } catch {
    return { ok: false, error: 'Permission refusée' };
  }
  const supabase = createClient();

  let data;
  try {
    data = createProviderSchema.parse(input);
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Données invalides' };
  }

  // Vérifie qu'il n'existe pas déjà avec le même nom (case-insensitive)
  const { data: existing } = await supabase
    .from('artisans')
    .select('id, name')
    .ilike('name', data.name.trim())
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();

  if (existing) {
    return { ok: true, id: (existing as any).id, name: (existing as any).name };
  }

  // Note BDD : la colonne legacy `type` (artisans.type) est NOT NULL avec un
  // check ('artisan_local','autre','entreprise_generale','fournisseur'). Elle
  // n'a pas de sens pour un prestataire de services ; on force 'autre' pour
  // passer la contrainte, en s'appuyant sur provider_type/business_scope pour
  // la vraie classification métier.
  const { data: created, error } = await supabase
    .from('artisans')
    .insert({
      name: data.name.trim(),
      type: 'autre',
      provider_type: data.provider_type,
      service_category: data.service_category ?? null,
      status: 'actif',
    } as any)
    .select('id, name')
    .single();

  if (error || !created) {
    return { ok: false, error: error?.message ?? 'Erreur création' };
  }

  return { ok: true, id: (created as any).id, name: (created as any).name };
}
