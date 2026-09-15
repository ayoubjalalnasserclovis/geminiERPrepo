import { z } from 'zod';
import { optionalEmail, optionalUrl } from './zod-helpers';
import { CODE_REGEX } from '@/lib/utils/slug';

// ─── Codes lisibles (slug client) ──────────────────────────────────────────
// Format strict aligné sur la fonction SQL slugify(). Vide → null géré par le
// trigger BDD qui auto-génère le code à la création.
export const codeSchema = z
  .string()
  .min(1, 'Code requis')
  .max(60, 'Code trop long (60 max)')
  .regex(CODE_REGEX, 'Code invalide : lowercase, chiffres et tirets uniquement (ex: bennani, bennani-2)');

// ─── Énumérations ────────────────────────────────────────────────────────
export const projectPhase = z.enum([
  'onboarding','sourcing','design','travaux','livraison','mise_en_location','termine'
]);

export const propertyStatus = z.enum([
  'sourcing','disponible','propose','offre','vendu','perdu','a_verifier'
]);

export const roleSchema = z.enum([
  'ceo','chef_projet','sourcing','commercial','finance','marketing','assistante','client'
]);

// ─── Clients ─────────────────────────────────────────────────────────────
export const clientCreateSchema = z.object({
  full_name: z.string().min(2, 'Nom requis'),
  email: z.string().email('Email invalide'),
  phone: z.string().optional().nullable(),
  nationality: z.string().optional().nullable(),
  budget_min: z.coerce.number().min(0).optional().nullable(),
  budget_max: z.coerce.number().min(0).optional().nullable(),
  available_savings: z.coerce.number().min(0).optional().nullable(),
  credit_type: z.enum(['yes','no','islamic']).optional().nullable(),
  has_procuration: z.boolean().default(false),
  signature_mode: z.enum(['distance','presentiel']).optional().nullable(),
  location_preferences: z.array(z.string()).default([]),
  property_type_preferences: z.array(z.string()).default([]),
  specificities: z.string().optional().nullable(),
  comments: z.string().optional().nullable(),
}).refine(
  d => !d.budget_min || !d.budget_max || d.budget_min <= d.budget_max,
  { message: 'Budget min ne peut pas être > budget max', path: ['budget_max'] }
);

// ─── Partners ────────────────────────────────────────────────────────────
export const partnerCreateSchema = z.object({
  agency_name: z.string().min(2),
  contact_name: z.string().optional().nullable(),
  phone: z.string()
    .min(1, 'Téléphone obligatoire')
    .regex(/^\+\d{1,4}[\s\d-]{6,}$/, 'Téléphone : indicatif pays requis (ex : +212 6 12 34 56 78)'),
  email: optionalEmail,
  // address et quartiers_covered ne sont plus exposés dans le formulaire
  // mais conservés en BDD pour rétro-compatibilité avec les anciennes fiches
  address: z.string().optional().nullable(),
  quartiers_covered: z.array(z.string()).default([]),
  status: z.enum(['actif','inactif','prospect']).default('actif'),
  contract_signed: z.boolean().default(false),
  contract_date: z.string().optional().nullable(),
  has_whatsapp_group: z.boolean().default(false),
  evaluation: z.coerce.number().int().min(1).max(3).optional().nullable(),
  notes: z.string().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
});

// ─── Properties ──────────────────────────────────────────────────────────
export const propertyCreateSchema = z.object({
  name: z.string().min(2),
  type: z.enum(['Appartement','Riad','Terrain','Villa']).optional().nullable(),
  quartier: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  superficie: z.coerce.number().min(0).optional().nullable(),
  terrasse_m2: z.coerce.number().min(0).optional().nullable(),
  floor: z.string().optional().nullable(),
  apartment_number: z.string().optional().nullable(),
  nb_suites: z.coerce.number().int().min(0).optional().nullable(),
  nb_lots_residence: z.coerce.number().int().min(0).optional().nullable(),
  year_built: z.coerce.number().int().min(1800).max(2100).optional().nullable(),
  google_maps_url: optionalUrl,
  video_url: optionalUrl,
  description: z.string().optional().nullable(),
  badge_label: z.string().optional().nullable(),
  avantages: z.array(z.string()).default([]),
  points_negatifs: z.array(z.string()).default([]),
  charges_mensuelles_immeuble: z.coerce.number().min(0).optional().nullable(),
  frais_fonctionnement_annuel: z.coerce.number().min(0).optional().nullable(),
  conciergerie_annuel: z.coerce.number().min(0).optional().nullable(),
  emprunt_mensuel: z.coerce.number().min(0).optional().nullable(),
  revenu_locatif_brut_annuel: z.coerce.number().min(0).optional().nullable(),
  taux_occupation: z.coerce.number().min(0).max(100).optional().nullable(),
  impots_annuel: z.coerce.number().min(0).optional().nullable(),
  exposure: z.array(z.string()).default([]),
  exterior: z.array(z.string()).default([]),
  has_elevator: z.boolean().default(false),
  has_parking: z.boolean().default(false),
  price: z.coerce.number().min(0).optional().nullable(),
  initial_asking_price: z.coerce.number().min(0).optional().nullable(),
  estimated_rent: z.coerce.number().min(0).optional().nullable(),
  agency_fees: z.coerce.number().min(0).optional().nullable(),
  notary_fees: z.coerce.number().min(0).optional().nullable(),
  travaux_budget_estimate: z.coerce.number().min(0).optional().nullable(),
  stoniz_reduction: z.coerce.number().min(0).default(0),
  evaluation: z.coerce.number().int().min(1).max(3).optional().nullable(),
  drive_url: optionalUrl,
  conditions_offre: z.string().optional().nullable(),
  partner_id: z.string().uuid().optional().nullable(),
  partner_agent_id: z.string().uuid().optional().nullable(),
  sourcing_commission_rate: z.coerce.number().min(0).max(100).default(2.5),
  // sourcing_date n'est plus saisi : on utilise created_at comme date de sourcing
  sourcing_date: z.string().optional().nullable(),
  first_visit_date: z.string().optional().nullable(),
  offer_date: z.string().optional().nullable(),
  status: propertyStatus.default('sourcing'),
  // ─── Nouveau workflow sourcing ────────────────────────────────────────
  sourcing_type: z.enum(['partenaire','direct']).optional().nullable(),
  sourcing_direct_channel: z.string().optional().nullable(),
  assigned_chasseur: z.string().uuid().optional().nullable(),
  is_published: z.boolean().optional(),
});

// ─── Projects ────────────────────────────────────────────────────────────
export const projectCreateSchema = z.object({
  client_id: z.string().uuid('Client invalide'),
  assigned_chef_projet: z.string().uuid().optional().nullable(),
  onboarding_date: z.string().optional().nullable(),
  travaux_budget: z.coerce.number().min(0).optional().nullable(),
  // code et code_locked sont auto-générés par le trigger BDD à l'insert.
  // L'app peut éventuellement les fournir explicitement pour overrider.
  code: codeSchema.optional(),
  code_locked: z.boolean().optional(),
});

// Renommage manuel du code d'un projet (verrouille automatiquement).
export const projectRenameCodeSchema = z.object({
  project_id: z.string().uuid(),
  new_code: codeSchema,
});

// ─── Propria units ───────────────────────────────────────────────────────
// Création d'un lot Propria sur un bien (Bennani-1, Bennani-2...).
// code et order_index sont auto-générés par le trigger BDD si omis.
export const propriaUnitCreateSchema = z.object({
  property_id: z.string().uuid(),
  code: codeSchema.optional(),
  order_index: z.coerce.number().int().min(1).optional(),
  propria_apartment_door: z.string().optional().nullable(),
  propria_capacity_voyageurs: z.coerce.number().int().min(1).optional().nullable(),
  propria_nb_chambres: z.coerce.number().int().min(0).optional().nullable(),
  propria_nb_sdb: z.coerce.number().int().min(0).optional().nullable(),
  propria_type_lits: z.string().optional().nullable(),
  propria_smart_lock: z.boolean().optional(),
  propria_lock_code: z.string().optional().nullable(),
  // propria_key_box_home supprimé le 2026-06-09 : doublon de propria_key_box_suite
  propria_key_box_location: z.string().optional().nullable(),
  propria_nb_keys: z.coerce.number().int().min(0).optional().nullable(),
  propria_key_box_suite: z.string().optional().nullable(),
  propria_wifi_ssid: z.string().optional().nullable(),
  propria_wifi_password: z.string().optional().nullable(),
  // Déplacés depuis properties le 2026-06-09 (par suite)
  propria_arrival_video_url: z.string().optional().nullable(),
  propria_arrival_instructions: z.string().optional().nullable(),
  propria_airbnb_url: optionalUrl,
  propria_booking_url: optionalUrl,
  propria_listing_published_at: z.string().optional().nullable(),
  propria_base_price_per_night: z.coerce.number().min(0).optional().nullable(),
  propria_drive_photos_url: optionalUrl,
  propria_default_provider_id: z.string().uuid().optional().nullable(),
  propria_info_sheet_to_send: z.boolean().optional(),
  propria_app_admin_access: z.boolean().optional(),
  propria_observations: z.string().optional().nullable(),
});

export const propriaUnitRenameCodeSchema = z.object({
  unit_id: z.string().uuid(),
  new_code: codeSchema,
});

// ─── Tasks ───────────────────────────────────────────────────────────────
export const taskCreateSchema = z.object({
  project_id: z.string().uuid().optional().nullable(),
  partner_id: z.string().uuid().optional().nullable(),
  phase: projectPhase.optional().nullable(),
  title: z.string().min(2),
  description: z.string().optional().nullable(),
  assigned_to: z.string().uuid().optional().nullable(),
  priority: z.enum(['low','normal','high','urgent']).default('normal'),
  due_date: z.string().optional().nullable(),
  is_blocking: z.boolean().default(false),
}).refine(d => d.project_id || d.partner_id, {
  message: 'Une tâche doit être liée à un projet ou un partenaire',
  path: ['project_id'],
});

export const taskUpdateStatusSchema = z.object({
  task_id: z.string().uuid(),
  status: z.enum(['todo','in_progress','done','blocked']),
});

// ─── Payments ────────────────────────────────────────────────────────────
export const paymentUpdateSchema = z.object({
  payment_id: z.string().uuid(),
  amount_paid: z.coerce.number().min(0),
  paid_at: z.string().optional().nullable(),
  payment_method: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  // Échéance & montant attendu : éditables par CEO + finance uniquement
  // (contrôle d'autorisation côté Server Action). Non envoyés = colonnes
  // BDD non touchées.
  due_date: z.string().optional().nullable(),
  amount_expected: z.coerce.number().optional().nullable(),
});

// Édition CEO-only de l'échéancier honoraires : montant attendu + date + libellé
// de chaque échéance existante (on ne crée rien : modèle événementiel).
export const stonizScheduleUpdateSchema = z.object({
  project_id: z.string().uuid(),
  items: z.array(z.object({
    payment_id: z.string().uuid(),
    amount_expected: z.coerce.number().min(0),
    due_date: z.string().optional().nullable(),
    label: z.string().trim().max(120).optional().nullable(),
  })).min(1),
});

export const travauxPaymentCreateSchema = z.object({
  project_id: z.string().uuid(),
  artisan_name: z.string().min(1),
  artisan_type: z.string().optional().nullable(),
  category: z.enum(['gros_oeuvre','plomberie','electricite','menuiserie','peinture','deco','fournitures','autre']).optional().nullable(),
  description: z.string().optional().nullable(),
  currency: z.enum(['MAD','EUR']).default('MAD'),
  amount_total: z.coerce.number().min(0),
  exchange_rate_eur: z.coerce.number().min(0).optional().nullable(),
  payment_type: z.enum(['acompte','solde','autre']).default('acompte'),
  scheduled_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// ─── Proposals ───────────────────────────────────────────────────────────
export const proposalResponseSchema = z.object({
  proposal_id: z.string().uuid(),
  response: z.enum(['accepted','refused','more_info']),
  refusal_reason: z.string().optional().nullable(),
  message: z.string().optional().nullable(),
});

export const sendProposalSchema = z.object({
  project_id: z.string().uuid(),
  property_id: z.string().uuid(),
});

// ─── Phase advance ───────────────────────────────────────────────────────
export const advancePhaseSchema = z.object({
  project_id: z.string().uuid(),
  new_phase: projectPhase,
});

// ─── Login ───────────────────────────────────────────────────────────────
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export type ClientCreateInput = z.infer<typeof clientCreateSchema>;
export type PartnerCreateInput = z.infer<typeof partnerCreateSchema>;
export type PropertyCreateInput = z.infer<typeof propertyCreateSchema>;
export type ProjectCreateInput = z.infer<typeof projectCreateSchema>;
export type TaskCreateInput = z.infer<typeof taskCreateSchema>;
export type ProposalResponseInput = z.infer<typeof proposalResponseSchema>;
