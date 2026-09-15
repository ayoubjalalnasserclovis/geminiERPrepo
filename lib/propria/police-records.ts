import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Module : Fiches de police voyageurs Propria (V1)
 * Voir docs/propria/fiche-police-format.md pour le format & les décisions CEO 2026-06-19.
 *
 * Sources de données prod :
 *   - hostaway_reservations : flux principal (Airbnb/Booking via Hostaway).
 *     -> Lien bien : hostaway_listings.propria_unit_id (puis propria_units.property_id).
 *     -> Pas de champ `property_id` direct.
 *     -> guest_name est un seul champ (pas de first/last name séparés).
 *     -> Dates = arrival_date / departure_date (text 'YYYY-MM-DD').
 *     -> Statuts "valides" = ('new', 'modified').
 *   - propria_direct_reservations : saisie manuelle propria (avec propria_unit_id).
 *   - propria_cash_reservations : encaissement cash terrain (avec property_id + propria_unit_id).
 *
 * Pas de FK directe vers ces 3 tables : on stocke (reservation_source, reservation_source_id)
 * comme couple polymorphe sur propria_police_records.
 */

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type PoliceRecordStatus = 'draft' | 'complete' | 'submitted' | 'archived';
export type PoliceRecordIdType = 'cin' | 'passport' | 'other';
export type PoliceRecordSource =
  | 'hostaway_portal'
  | 'manual_checkin'
  | 'whatsapp'
  | 'unknown';
export type PoliceRecordMotif =
  | 'tourisme'
  | 'affaires'
  | 'famille'
  | 'transit'
  | 'autre';
export type PoliceRecordReservationSource = 'hostaway' | 'direct' | 'cash';
export type PoliceRecordGender = 'M' | 'F' | 'autre';

export type AccompanyingPerson = {
  last_name: string;
  first_name: string;
  birth_date?: string | null;
  nationality?: string | null;
  id_type?: PoliceRecordIdType | null;
  id_number?: string | null;
  /** 'conjoint', 'enfant', 'parent', 'ami', 'autre' */
  relation?: string | null;
};

export type PoliceRecord = {
  id: string;

  // Lien réservation polymorphe
  reservation_source: PoliceRecordReservationSource | null;
  reservation_source_id: string | null;

  property_id: string | null;
  propria_unit_id: string | null;

  // Chef de famille
  head_last_name: string;
  head_first_name: string;
  head_gender: PoliceRecordGender | null;
  head_birth_date: string | null;
  head_birth_place: string | null;
  head_nationality: string | null;
  head_profession: string | null;
  head_id_type: PoliceRecordIdType | null;
  head_id_number: string | null;
  head_id_issue_date: string | null;
  head_id_expiry_date: string | null;
  head_id_issue_country: string | null;
  head_residence_country: string | null;
  head_residence_address: string | null;

  // Séjour
  arrival_date_morocco: string | null;
  arrival_date_property: string | null;
  expected_departure_date: string | null;
  motif_sejour: PoliceRecordMotif | null;

  // Accompagnants + total dérivé (colonne générée côté BDD)
  accompanying_persons: AccompanyingPerson[];
  total_persons_count: number;

  // Workflow & source
  status: PoliceRecordStatus;
  data_source: PoliceRecordSource;
  notes: string | null;

  submitted_at: string | null;
  submitted_by: string | null;

  // Audit standard
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
};

// -----------------------------------------------------------------------------
// Constantes
// -----------------------------------------------------------------------------

export const POLICE_RECORDS_TABLE = 'propria_police_records' as const;

/**
 * Rôles autorisés à lire les fiches de police.
 * Reflet de la policy RLS "staff read police records".
 */
export const POLICE_RECORDS_READ_ROLES = [
  'ceo',
  'propria',
  'assistante',
  'developer',
] as const;

/**
 * Rôles autorisés à écrire les fiches de police.
 * Reflet des policies RLS "staff insert/update/delete police records".
 * Note : developer EXCLU (lecture seule).
 */
export const POLICE_RECORDS_WRITE_ROLES = [
  'ceo',
  'propria',
  'assistante',
] as const;

/**
 * Champs REQUIS pour qu'une fiche soit considérée 'complete' et utilisable
 * pour le dépôt commissariat. Si un seul manque → reste 'draft'.
 *
 * Source : docs/propria/fiche-police-format.md § 3 "Champs OBLIGATOIRES".
 */
export const REQUIRED_FIELDS_FOR_COMPLETE = [
  'head_last_name',
  'head_first_name',
  'head_gender',
  'head_birth_date',
  'head_birth_place',
  'head_nationality',
  'head_id_type',
  'head_id_number',
  'head_id_issue_country',
  'head_residence_country',
  'head_residence_address',
  'arrival_date_property',
  'expected_departure_date',
  'motif_sejour',
] as const satisfies ReadonlyArray<keyof PoliceRecord>;

export type PoliceRecordRequiredField =
  (typeof REQUIRED_FIELDS_FOR_COMPLETE)[number];

// -----------------------------------------------------------------------------
// Pure helpers (calcul complétude / statut)
// -----------------------------------------------------------------------------

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string' && v.trim() === '') return true;
  return false;
}

/** Liste les champs obligatoires manquants. Tableau vide = fiche complète. */
export function computeMissingFields(
  record: Partial<PoliceRecord>,
): PoliceRecordRequiredField[] {
  const missing: PoliceRecordRequiredField[] = [];
  for (const field of REQUIRED_FIELDS_FOR_COMPLETE) {
    if (isEmpty((record as Record<string, unknown>)[field])) {
      missing.push(field);
    }
  }
  return missing;
}

export function isComplete(record: Partial<PoliceRecord>): boolean {
  return computeMissingFields(record).length === 0;
}

/**
 * Calcule le statut "naturel" à partir des champs.
 * Ne change PAS un statut figé (submitted/archived).
 * À appeler côté server action avant insert/update.
 */
export function computeNextStatus(
  record: Partial<PoliceRecord>,
  current?: PoliceRecordStatus,
): PoliceRecordStatus {
  if (current === 'submitted' || current === 'archived') return current;
  return isComplete(record) ? 'complete' : 'draft';
}

/**
 * Parse en best-effort le `guest_name` (single field Hostaway) en (first, last).
 * Convention : dernier token = last name, le reste = first name.
 * Fallback : si un seul token → tout dans last_name.
 */
export function splitGuestName(fullName: string | null | undefined): {
  first_name: string;
  last_name: string;
} {
  const cleaned = (fullName ?? '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return { first_name: '', last_name: '' };
  const parts = cleaned.split(' ');
  if (parts.length === 1) return { first_name: '', last_name: parts[0]! };
  const last = parts.pop()!;
  return { first_name: parts.join(' '), last_name: last };
}

// -----------------------------------------------------------------------------
// Pré-remplissage depuis les sources de réservation
// -----------------------------------------------------------------------------

/**
 * Pré-remplit un brouillon depuis une réservation Hostaway.
 * - Charge le lien bien via hostaway_listings.propria_unit_id → propria_units.property_id.
 * - Split du `guest_name` (single field Hostaway) en first/last.
 * - Dates : arrival_date → arrival_date_property, departure_date → expected_departure_date.
 *
 * Retourne {} si la réservation est introuvable ou soft-deleted.
 */
export async function pullDataFromHostawayReservation(
  supabase: SupabaseClient,
  reservationId: string,
): Promise<Partial<PoliceRecord>> {
  const { data: res } = await supabase
    .from('hostaway_reservations')
    .select(
      `
      id,
      hostaway_listing_db_id,
      guest_name,
      number_of_guests,
      arrival_date,
      departure_date,
      deleted_at
    `,
    )
    .eq('id', reservationId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!res) return {};
  const r = res as {
    id: string;
    hostaway_listing_db_id: string | null;
    guest_name: string | null;
    number_of_guests: number | null;
    arrival_date: string | null;
    departure_date: string | null;
  };

  // Remonter au propria_unit + property via le listing
  let propria_unit_id: string | null = null;
  let property_id: string | null = null;
  if (r.hostaway_listing_db_id) {
    const { data: listing } = await supabase
      .from('hostaway_listings')
      .select('propria_unit_id')
      .eq('id', r.hostaway_listing_db_id)
      .maybeSingle();
    propria_unit_id = (listing as { propria_unit_id: string | null } | null)
      ?.propria_unit_id ?? null;

    if (propria_unit_id) {
      const { data: unit } = await supabase
        .from('propria_units')
        .select('property_id')
        .eq('id', propria_unit_id)
        .maybeSingle();
      property_id = (unit as { property_id: string | null } | null)
        ?.property_id ?? null;
    }
  }

  const { first_name, last_name } = splitGuestName(r.guest_name);

  return {
    reservation_source: 'hostaway',
    reservation_source_id: r.id,
    property_id,
    propria_unit_id,
    head_first_name: first_name,
    head_last_name: last_name,
    arrival_date_property: r.arrival_date ?? null,
    expected_departure_date: r.departure_date ?? null,
    data_source: 'hostaway_portal',
  };
}

/**
 * Pré-remplit un brouillon depuis une réservation directe (saisie manuelle propria).
 */
export async function pullDataFromDirectReservation(
  supabase: SupabaseClient,
  reservationId: string,
): Promise<Partial<PoliceRecord>> {
  const { data: res } = await supabase
    .from('propria_direct_reservations')
    .select(
      `
      id,
      propria_unit_id,
      guest_name,
      arrival_date,
      departure_date,
      deleted_at
    `,
    )
    .eq('id', reservationId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!res) return {};
  const r = res as {
    id: string;
    propria_unit_id: string | null;
    guest_name: string | null;
    arrival_date: string | null;
    departure_date: string | null;
  };

  let property_id: string | null = null;
  if (r.propria_unit_id) {
    const { data: unit } = await supabase
      .from('propria_units')
      .select('property_id')
      .eq('id', r.propria_unit_id)
      .maybeSingle();
    property_id = (unit as { property_id: string | null } | null)?.property_id
      ?? null;
  }

  const { first_name, last_name } = splitGuestName(r.guest_name);

  return {
    reservation_source: 'direct',
    reservation_source_id: r.id,
    property_id,
    propria_unit_id: r.propria_unit_id,
    head_first_name: first_name,
    head_last_name: last_name,
    arrival_date_property: r.arrival_date ?? null,
    expected_departure_date: r.departure_date ?? null,
    data_source: 'manual_checkin',
  };
}

/**
 * Pré-remplit un brouillon depuis une réservation cash.
 */
export async function pullDataFromCashReservation(
  supabase: SupabaseClient,
  reservationId: string,
): Promise<Partial<PoliceRecord>> {
  const { data: res } = await supabase
    .from('propria_cash_reservations')
    .select(
      `
      id,
      property_id,
      propria_unit_id,
      voyageur_name,
      arrival_date,
      departure_date,
      deleted_at
    `,
    )
    .eq('id', reservationId)
    .is('deleted_at', null)
    .maybeSingle();

  if (!res) return {};
  const r = res as {
    id: string;
    property_id: string | null;
    propria_unit_id: string | null;
    voyageur_name: string | null;
    arrival_date: string | null;
    departure_date: string | null;
  };

  const { first_name, last_name } = splitGuestName(r.voyageur_name);

  return {
    reservation_source: 'cash',
    reservation_source_id: r.id,
    property_id: r.property_id,
    propria_unit_id: r.propria_unit_id,
    head_first_name: first_name,
    head_last_name: last_name,
    arrival_date_property: r.arrival_date ?? null,
    expected_departure_date: r.departure_date ?? null,
    data_source: 'manual_checkin',
  };
}

// -----------------------------------------------------------------------------
// Helper pour le cron daily-reminders
// -----------------------------------------------------------------------------

export type CheckInNeedingRecord = {
  reservation_source: PoliceRecordReservationSource;
  reservation_source_id: string;
  property_id: string | null;
  propria_unit_id: string | null;
  guest_name: string;
  arrival_date: string;
  departure_date: string | null;
};

/**
 * Retourne les réservations dont le check-in est aujourd'hui ET qui n'ont pas
 * encore de fiche police créée. Scanne les 3 sources (Hostaway + Direct + Cash).
 *
 * À appeler depuis le cron daily-reminders (autre agent) avec un client admin
 * (service-role) pour bypasser RLS.
 *
 * Hostaway : on filtre status IN ('new','modified') — les statuts opérationnels
 * (cancelled, expired, inquiry*) sont exclus.
 */
export async function findCheckInsNeedingPoliceRecord(
  admin: SupabaseClient,
  today: string,
): Promise<CheckInNeedingRecord[]> {
  const out: CheckInNeedingRecord[] = [];

  // 1) Hostaway
  const { data: hostaway } = await admin
    .from('hostaway_reservations')
    .select('id, hostaway_listing_db_id, guest_name, arrival_date, departure_date, status')
    .eq('arrival_date', today)
    .in('status', ['new', 'modified'])
    .is('deleted_at', null);

  const hostawayRows = (hostaway ?? []) as Array<{
    id: string;
    hostaway_listing_db_id: string | null;
    guest_name: string | null;
    arrival_date: string;
    departure_date: string | null;
  }>;

  // Résoudre listing -> unit -> property en batch (1 round-trip listings)
  const listingIds = Array.from(
    new Set(hostawayRows.map((r) => r.hostaway_listing_db_id).filter(Boolean)),
  ) as string[];
  const listingMap = new Map<string, string | null>(); // listing.id -> propria_unit_id
  if (listingIds.length > 0) {
    const { data: listings } = await admin
      .from('hostaway_listings')
      .select('id, propria_unit_id')
      .in('id', listingIds);
    for (const l of (listings ?? []) as Array<{
      id: string;
      propria_unit_id: string | null;
    }>) {
      listingMap.set(l.id, l.propria_unit_id);
    }
  }
  const unitIds = Array.from(
    new Set(Array.from(listingMap.values()).filter(Boolean)),
  ) as string[];
  const unitMap = new Map<string, string | null>(); // unit.id -> property_id
  if (unitIds.length > 0) {
    const { data: units } = await admin
      .from('propria_units')
      .select('id, property_id')
      .in('id', unitIds);
    for (const u of (units ?? []) as Array<{
      id: string;
      property_id: string | null;
    }>) {
      unitMap.set(u.id, u.property_id);
    }
  }

  for (const r of hostawayRows) {
    const unitId = r.hostaway_listing_db_id
      ? listingMap.get(r.hostaway_listing_db_id) ?? null
      : null;
    const propId = unitId ? unitMap.get(unitId) ?? null : null;
    out.push({
      reservation_source: 'hostaway',
      reservation_source_id: r.id,
      property_id: propId,
      propria_unit_id: unitId,
      guest_name: (r.guest_name ?? '').trim(),
      arrival_date: r.arrival_date,
      departure_date: r.departure_date,
    });
  }

  // 2) Propria Direct
  const { data: direct } = await admin
    .from('propria_direct_reservations')
    .select('id, propria_unit_id, guest_name, arrival_date, departure_date')
    .eq('arrival_date', today)
    .is('deleted_at', null);

  const directRows = (direct ?? []) as Array<{
    id: string;
    propria_unit_id: string | null;
    guest_name: string | null;
    arrival_date: string;
    departure_date: string | null;
  }>;
  const directUnitIds = Array.from(
    new Set(directRows.map((r) => r.propria_unit_id).filter(Boolean)),
  ) as string[];
  const directUnitMap = new Map<string, string | null>();
  if (directUnitIds.length > 0) {
    const { data: units } = await admin
      .from('propria_units')
      .select('id, property_id')
      .in('id', directUnitIds);
    for (const u of (units ?? []) as Array<{
      id: string;
      property_id: string | null;
    }>) {
      directUnitMap.set(u.id, u.property_id);
    }
  }
  for (const r of directRows) {
    const propId = r.propria_unit_id
      ? directUnitMap.get(r.propria_unit_id) ?? null
      : null;
    out.push({
      reservation_source: 'direct',
      reservation_source_id: r.id,
      property_id: propId,
      propria_unit_id: r.propria_unit_id,
      guest_name: (r.guest_name ?? '').trim(),
      arrival_date: r.arrival_date,
      departure_date: r.departure_date,
    });
  }

  // 3) Propria Cash
  const { data: cash } = await admin
    .from('propria_cash_reservations')
    .select('id, property_id, propria_unit_id, voyageur_name, arrival_date, departure_date')
    .eq('arrival_date', today)
    .is('deleted_at', null);

  for (const r of (cash ?? []) as Array<{
    id: string;
    property_id: string | null;
    propria_unit_id: string | null;
    voyageur_name: string | null;
    arrival_date: string;
    departure_date: string | null;
  }>) {
    out.push({
      reservation_source: 'cash',
      reservation_source_id: r.id,
      property_id: r.property_id,
      propria_unit_id: r.propria_unit_id,
      guest_name: (r.voyageur_name ?? '').trim(),
      arrival_date: r.arrival_date,
      departure_date: r.departure_date,
    });
  }

  if (out.length === 0) return [];

  // Filtre les résa qui ont déjà une fiche (anti-doublon supplémentaire au
  // niveau applicatif ; un index unique partiel double déjà la protection BDD).
  // On groupe par source pour 1 requête par source.
  const bySource = new Map<PoliceRecordReservationSource, string[]>();
  for (const r of out) {
    const arr = bySource.get(r.reservation_source) ?? [];
    arr.push(r.reservation_source_id);
    bySource.set(r.reservation_source, arr);
  }

  const existingKeys = new Set<string>();
  for (const [source, ids] of bySource.entries()) {
    if (ids.length === 0) continue;
    const { data: existing } = await admin
      .from(POLICE_RECORDS_TABLE)
      .select('reservation_source, reservation_source_id')
      .eq('reservation_source', source)
      .in('reservation_source_id', ids)
      .is('deleted_at', null);
    for (const e of (existing ?? []) as Array<{
      reservation_source: PoliceRecordReservationSource;
      reservation_source_id: string;
    }>) {
      existingKeys.add(`${e.reservation_source}:${e.reservation_source_id}`);
    }
  }

  return out.filter(
    (r) => !existingKeys.has(`${r.reservation_source}:${r.reservation_source_id}`),
  );
}

// -----------------------------------------------------------------------------
// Garde-fous d'accompagnants (validation JSON côté serveur avant insert)
// -----------------------------------------------------------------------------

/**
 * Normalise/valide le tableau d'accompagnants reçu depuis l'UI.
 * Filtre les entrées vides, trim les strings, ignore les champs inconnus.
 */
export function normalizeAccompanyingPersons(
  raw: unknown,
): AccompanyingPerson[] {
  if (!Array.isArray(raw)) return [];
  const out: AccompanyingPerson[] = [];
  const allowedIdTypes = new Set<PoliceRecordIdType>([
    'cin',
    'passport',
    'other',
  ]);
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const last_name = typeof e.last_name === 'string' ? e.last_name.trim() : '';
    const first_name = typeof e.first_name === 'string' ? e.first_name.trim() : '';
    // Ignore les lignes totalement vides (UI peut envoyer une ligne placeholder)
    if (!last_name && !first_name) continue;
    const id_type =
      typeof e.id_type === 'string' && allowedIdTypes.has(e.id_type as PoliceRecordIdType)
        ? (e.id_type as PoliceRecordIdType)
        : null;
    out.push({
      last_name,
      first_name,
      birth_date: typeof e.birth_date === 'string' && e.birth_date ? e.birth_date : null,
      nationality:
        typeof e.nationality === 'string' && e.nationality.trim()
          ? e.nationality.trim()
          : null,
      id_type,
      id_number:
        typeof e.id_number === 'string' && e.id_number.trim()
          ? e.id_number.trim()
          : null,
      relation:
        typeof e.relation === 'string' && e.relation.trim()
          ? e.relation.trim()
          : null,
    });
  }
  return out;
}
