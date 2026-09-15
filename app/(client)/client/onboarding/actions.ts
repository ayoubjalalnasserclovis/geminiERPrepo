'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';

const ALLOWED_MIME = [
  'application/pdf','image/png','image/jpeg','image/webp','image/heic','image/heif',
];
const MAX_SIZE = 25 * 1024 * 1024;

const onboardingSchema = z.object({
  first_name: z.string().min(1, 'Prénom requis'),
  last_name: z.string().min(1, 'Nom requis'),
  email: z.string().email('Email invalide'),
  phone: z.string().regex(/^\+\d[\d\s-]{7,}$/, 'Téléphone au format international (ex: +33 6 12 34 56 78)'),
  nationality: z.string().min(2, 'Nationalité requise'),
  credit_type: z.enum(['no','yes','islamic']),
  available_savings: z.coerce.number().min(0),
  budget_max: z.coerce.number().min(0),
  expected_rent: z.coerce.number().min(0),
  expected_gross_yield_pct: z.coerce.number().min(0).max(100),
  expected_net_yield_pct: z.coerce.number().min(0).max(100),
  quartiers: z.array(z.string()).min(1, 'Sélectionnez au moins un quartier'),
  // Structure d'investissement
  investment_holding: z.enum(['nom_propre','societe']),
  company_name: z.string().optional().nullable(),
  company_registration_number: z.string().optional().nullable(),
  investment_party_count: z.coerce.number().int().min(1).max(11),
  // Adresse de facturation
  billing_address_line: z.string().min(2, 'Adresse de facturation requise'),
  billing_city: z.string().min(1, 'Ville requise'),
  billing_postal_code: z.string().min(1, 'Code postal requis'),
  billing_country: z.string().min(2, 'Pays requis'),
  // Accompagnement bancaire
  needs_bank_account_opening: z.enum(['yes','no']),
  bank_account_notes: z.string().optional().nullable(),
}).superRefine((d, ctx) => {
  if (d.investment_holding === 'societe') {
    if (!d.company_name || d.company_name.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['company_name'], message: 'Raison sociale requise' });
    }
    if (!d.company_registration_number || d.company_registration_number.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['company_registration_number'], message: 'N° d\'immatriculation requis' });
    }
  }
});

function validateIdFile(file: File | null, label: string): string | null {
  if (!file || !file.size) return `${label} requise`;
  if (file.size > MAX_SIZE) return `${label} trop volumineuse (max 25 MB)`;
  if (!ALLOWED_MIME.includes(file.type)) return `${label} : format non supporté (${file.type})`;
  return null;
}

export async function completeOnboardingAction(formData: FormData) {
  const me = await assertRole(['client']);
  // Lecture via le client RLS-aware (verifie le bon profil client)
  const supabase = createClient();
  // Ecritures (Storage + INSERT documents/co_investors/clients) via admin
  // pour eviter les soucis RLS pendant l'onboarding (pas encore de projet).
  const admin = createAdminClient();

  const { data: client } = await supabase
    .from('clients').select('id, onboarding_completed_at').eq('profile_id', me.id).single();
  if (!client) return { ok: false, error: 'Profil client introuvable' };
  if (client.onboarding_completed_at) return { ok: false, error: 'Onboarding déjà complété' };

  // ─── 1. Validation Zod du payload texte ─────────────────────────────────
  const quartiers = formData.getAll('quartiers').map(String).filter(Boolean);
  const raw = {
    first_name: formData.get('first_name'),
    last_name: formData.get('last_name'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    nationality: formData.get('nationality'),
    credit_type: formData.get('credit_type'),
    available_savings: formData.get('available_savings'),
    budget_max: formData.get('budget_max'),
    expected_rent: formData.get('expected_rent'),
    expected_gross_yield_pct: formData.get('expected_gross_yield_pct'),
    expected_net_yield_pct: formData.get('expected_net_yield_pct'),
    quartiers,
    investment_holding: formData.get('investment_holding'),
    company_name: formData.get('company_name') || null,
    company_registration_number: formData.get('company_registration_number') || null,
    investment_party_count: formData.get('investment_party_count'),
    billing_address_line: formData.get('billing_address_line'),
    billing_city: formData.get('billing_city'),
    billing_postal_code: formData.get('billing_postal_code'),
    billing_country: formData.get('billing_country'),
    needs_bank_account_opening: formData.get('needs_bank_account_opening'),
    bank_account_notes: formData.get('bank_account_notes') || null,
  };
  const parsed = onboardingSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;

  // ─── 2. Validation des pièces d'identité (client + co-investisseurs) ───
  const mainFile = formData.get('piece_identite') as File | null;
  const mainErr = validateIdFile(mainFile, 'Votre pièce d\'identité');
  if (mainErr) return { ok: false, error: mainErr };

  const coCount = Math.max(0, d.investment_party_count - 1);
  const coInvestors: { full_name: string; relation: string | null; file: File }[] = [];
  for (let i = 0; i < coCount; i++) {
    const full_name = String(formData.get(`co_full_name_${i}`) ?? '').trim();
    const relation = String(formData.get(`co_relation_${i}`) ?? '').trim() || null;
    const file = formData.get(`co_piece_identite_${i}`) as File | null;
    if (!full_name) return { ok: false, error: `Nom du co-investisseur #${i + 2} requis` };
    const fileErr = validateIdFile(file, `Pièce d'identité de ${full_name}`);
    if (fileErr) return { ok: false, error: fileErr };
    coInvestors.push({ full_name, relation, file: file as File });
  }

  // ─── 3. Récupère un projet pour rattacher la pièce du client principal ─
  const { data: projects } = await supabase
    .from('projects').select('id').eq('client_id', client.id).is('deleted_at', null).limit(1);
  const project_id = projects?.[0]?.id ?? null;

  // ─── 4. Upload pièce d'identité principale ────────────────────────────
  const uploadedPaths: string[] = []; // rollback en cas d'erreur

  async function uploadIdFile(file: File, folder: string): Promise<{ path: string } | { error: string }> {
    const ext = file.name.split('.').pop();
    const path = `${folder}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await admin.storage.from('documents')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (upErr) return { error: upErr.message };
    uploadedPaths.push(path);
    return { path };
  }

  async function rollbackUploads() {
    if (uploadedPaths.length > 0) {
      await admin.storage.from('documents').remove(uploadedPaths);
    }
  }

  const mainFolder = project_id
    ? `projects/${project_id}/piece_identite`
    : `clients/${client.id}/piece_identite`;
  const mainUp = await uploadIdFile(mainFile as File, mainFolder);
  if ('error' in mainUp) return { ok: false, error: `Upload pièce principale : ${mainUp.error}` };

  const { error: mainDocErr } = await admin.from('documents').insert({
    project_id,
    client_id: client.id,
    name: (mainFile as File).name,
    type: 'piece_identite',
    uploaded_by: me.id,
    uploaded_by_role: 'client',
    storage_path: mainUp.path,
    size_bytes: (mainFile as File).size,
    mime_type: (mainFile as File).type,
    is_visible_to_client: true,
    status: 'recu',
  });
  if (mainDocErr) {
    await rollbackUploads();
    return { ok: false, error: `Enregistrement document : ${mainDocErr.message}` };
  }

  // ─── 5. Upload pièces des co-investisseurs ────────────────────────────
  const coFolder = `clients/${client.id}/co_investors`;
  const coRows: any[] = [];
  for (const co of coInvestors) {
    const up = await uploadIdFile(co.file, coFolder);
    if ('error' in up) {
      await rollbackUploads();
      return { ok: false, error: `Upload pièce de ${co.full_name} : ${up.error}` };
    }
    coRows.push({
      client_id: client.id,
      full_name: co.full_name,
      relation: co.relation,
      piece_identite_path: up.path,
      piece_identite_size_bytes: co.file.size,
      piece_identite_mime: co.file.type,
    });
  }

  if (coRows.length > 0) {
    const { error: coErr } = await admin.from('client_co_investors').insert(coRows);
    if (coErr) {
      await rollbackUploads();
      return { ok: false, error: `Enregistrement co-investisseurs : ${coErr.message}` };
    }
  }

  // ─── 6. Update du client (toutes les pièces sont OK) ──────────────────
  const { error: updErr } = await admin.from('clients').update({
    first_name: d.first_name,
    last_name: d.last_name,
    full_name: `${d.first_name} ${d.last_name}`.trim(),
    email: d.email,
    phone: d.phone,
    nationality: d.nationality,
    credit_type: d.credit_type,
    available_savings: d.available_savings,
    budget_max: d.budget_max,
    expected_rent: d.expected_rent,
    expected_gross_yield_pct: d.expected_gross_yield_pct,
    expected_net_yield_pct: d.expected_net_yield_pct,
    location_preferences: d.quartiers,
    investment_holding: d.investment_holding,
    company_name: d.investment_holding === 'societe' ? d.company_name : null,
    company_registration_number: d.investment_holding === 'societe' ? d.company_registration_number : null,
    investment_party_count: d.investment_party_count,
    billing_address_line: d.billing_address_line,
    billing_city: d.billing_city,
    billing_postal_code: d.billing_postal_code,
    billing_country: d.billing_country,
    needs_bank_account_opening: d.needs_bank_account_opening === 'yes',
    bank_account_notes: d.needs_bank_account_opening === 'yes' ? d.bank_account_notes : null,
    consent_at: new Date().toISOString(),
    consent_version: 'v2-onboarding',
    onboarding_completed_at: new Date().toISOString(),
  }).eq('id', client.id);

  if (updErr) {
    await rollbackUploads();
    return { ok: false, error: updErr.message };
  }

  revalidatePath('/client', 'layout');
  redirect('/client');
}
