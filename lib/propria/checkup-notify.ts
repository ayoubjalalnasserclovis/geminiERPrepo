import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { createClient } from '@/lib/supabase/server';
import { notifyUsers } from '@/lib/propria/notify';
import {
  sendCheckupAssignedToTeam,
  sendCheckupToValidateToTeam,
  sendCheckupLowQualityToCeo,
  sendCheckupOverdueToTeam,
} from '@/lib/email/templates';
import { getCeoRecipients } from '@/lib/notifications/recipients';

/**
 * Centralise les triggers de notification pour le module Propria/Checkups.
 * Best-effort partout : un échec d'email ou d'insertion in-app ne fait
 * jamais échouer l'action métier appelante (try/catch + console.warn).
 *
 * Pourquoi un fichier dédié ? Pour DRY entre :
 *   - createCheckupAction (assignation à la création)
 *   - updateCheckupAction (ré-assignation)
 *   - submitCheckupAction (envoi à valider)
 *   - validateCheckupAction (notif terrain + alerte CEO si C/D)
 *   - cron daily-reminders (overdue 3/7/14/30 j)
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

// ─── Helpers internes ────────────────────────────────────────────────────

type AdminLike = SupabaseClient<any, 'public', any>;

async function resolvePropertyLabel(
  admin: AdminLike,
  propertyId: string | null,
  propriaUnitId: string | null,
): Promise<string> {
  try {
    if (propriaUnitId) {
      const { data: unit } = await admin
        .from('propria_units')
        .select('code, order_index, property:properties(name, propria_internal_code)')
        .eq('id', propriaUnitId)
        .maybeSingle();
      const u: any = unit ?? {};
      const p: any = u.property ?? {};
      const bien = p.propria_internal_code ?? p.name ?? 'Bien';
      const suite = u.code ?? (u.order_index != null ? `Suite ${u.order_index}` : 'Suite');
      return `${bien} · ${suite}`;
    }
    if (propertyId) {
      const { data: prop } = await admin
        .from('properties')
        .select('name, propria_internal_code')
        .eq('id', propertyId)
        .maybeSingle();
      const p: any = prop ?? {};
      return `${p.propria_internal_code ?? p.name ?? 'Bien'} · Bien entier`;
    }
  } catch (e: any) {
    console.warn('[checkup-notify] resolvePropertyLabel:', e?.message ?? e);
  }
  return 'Check-up Propria';
}

async function resolveProfile(
  admin: AdminLike,
  profileId: string | null | undefined,
): Promise<{ id: string; email: string; full_name: string | null } | null> {
  if (!profileId) return null;
  try {
    const { data } = await admin
      .from('profiles')
      .select('id, email, full_name')
      .eq('id', profileId)
      .maybeSingle();
    if (!data || !(data as any).email) return null;
    return data as any;
  } catch {
    return null;
  }
}

// ─── Triggers publics ────────────────────────────────────────────────────

/**
 * A. Checkup assigné : in-app + email à l'assigné.
 * À déclencher après createCheckupAction (si assigned_to_id fourni) ET
 * updateCheckupAction (uniquement si assigned_to_id a CHANGÉ).
 */
export async function notifyCheckupAssigned(opts: {
  supabase: ReturnType<typeof createClient>;
  admin: AdminLike;
  actorId: string;
  checkupId: string;
  assignedToId: string;
  propertyId: string | null;
  propriaUnitId: string | null;
  dueDate: string | null;
  projectId?: string | null;
}): Promise<void> {
  try {
    // 1) In-app via le client RLS de l'appelant (auto-exclusion soi-même)
    await notifyUsers({
      supabase: opts.supabase,
      actorId: opts.actorId,
      userIds: [opts.assignedToId],
      kind: 'assignation',
      title: "On t'a assigné un checkup",
      body: opts.dueDate ? `À faire pour le ${opts.dueDate}` : null,
      href: `/propria/checkups/${opts.checkupId}`,
    });

    // 2) Email transactionnel
    const profile = await resolveProfile(opts.admin, opts.assignedToId);
    if (!profile) return; // pas d'email = on s'arrête en silence
    const propertyName = await resolvePropertyLabel(
      opts.admin,
      opts.propertyId,
      opts.propriaUnitId,
    );
    await sendCheckupAssignedToTeam({
      to: profile.email,
      recipient_name: profile.full_name ?? profile.email,
      checkup_id: opts.checkupId,
      property_name: propertyName,
      due_date: opts.dueDate,
      project_id: opts.projectId ?? null,
    });
  } catch (e: any) {
    console.warn('[checkup-notify] notifyCheckupAssigned:', e?.message ?? e);
  }
}

/**
 * B. Checkup à valider : email aux CEO + assistantes.
 * Pas de notif in-app pour limiter le bruit — l'email suffit.
 */
export async function notifyCheckupToValidate(opts: {
  admin: AdminLike;
  checkupId: string;
  propertyId: string | null;
  propriaUnitId: string | null;
  classification: 'A' | 'B' | 'C' | 'D';
  summary: string;
}): Promise<void> {
  try {
    const propertyName = await resolvePropertyLabel(
      opts.admin,
      opts.propertyId,
      opts.propriaUnitId,
    );
    const ceos = await getCeoRecipients(opts.admin);
    // Assistantes en plus du CEO (validation back-office)
    const { data: assistantes } = await opts.admin
      .from('profiles')
      .select('id, email, full_name, role')
      .eq('role', 'assistante')
      .eq('is_active', true)
      .not('email', 'like', '%+%@%');
    const merged = new Map<string, { email: string; full_name: string | null }>();
    for (const r of ceos) {
      if (r.email) merged.set(r.email.toLowerCase(), { email: r.email, full_name: r.full_name });
    }
    for (const r of (assistantes ?? []) as any[]) {
      if (r.email) {
        merged.set(r.email.toLowerCase(), { email: r.email, full_name: r.full_name });
      }
    }
    for (const r of merged.values()) {
      await sendCheckupToValidateToTeam({
        to: r.email,
        recipient_name: r.full_name ?? r.email,
        checkup_id: opts.checkupId,
        property_name: propertyName,
        classification: opts.classification,
        summary: opts.summary,
      });
    }
  } catch (e: any) {
    console.warn('[checkup-notify] notifyCheckupToValidate:', e?.message ?? e);
  }
}

/**
 * C. Checkup validé : in-app au terrain (assignée d'origine) + alerte CEO si C/D.
 */
export async function notifyCheckupValidated(opts: {
  supabase: ReturnType<typeof createClient>;
  admin: AdminLike;
  actorId: string;
  checkupId: string;
  originalAssignedToId: string | null;
  propertyId: string | null;
  propriaUnitId: string | null;
  classification: 'A' | 'B' | 'C' | 'D' | null;
}): Promise<void> {
  try {
    if (opts.originalAssignedToId && opts.classification) {
      await notifyUsers({
        supabase: opts.supabase,
        actorId: opts.actorId,
        userIds: [opts.originalAssignedToId],
        kind: 'autre',
        title: `Ton checkup a été validé en ${opts.classification}`,
        body: null,
        href: `/propria/checkups/${opts.checkupId}`,
      });
    }

    if (opts.classification === 'C' || opts.classification === 'D') {
      const propertyName = await resolvePropertyLabel(
        opts.admin,
        opts.propertyId,
        opts.propriaUnitId,
      );
      const ceos = await getCeoRecipients(opts.admin);
      for (const r of ceos) {
        await sendCheckupLowQualityToCeo({
          to: r.email,
          recipient_name: r.full_name ?? r.email,
          checkup_id: opts.checkupId,
          property_name: propertyName,
          classification: opts.classification,
        });
      }
    }
  } catch (e: any) {
    console.warn('[checkup-notify] notifyCheckupValidated:', e?.message ?? e);
  }
}

/**
 * D. Checkup échu (overdue) : utilisé par le cron daily-reminders.
 * Renvoie le nombre d'emails envoyés (pour le compteur du cron).
 */
export async function notifyCheckupOverdue(opts: {
  admin: AdminLike;
  checkupId: string;
  propertyId: string | null;
  propriaUnitId: string | null;
  assignedToId: string | null;
  daysOverdue: number;
  todayIso: string;
}): Promise<number> {
  try {
    const propertyName = await resolvePropertyLabel(
      opts.admin,
      opts.propertyId,
      opts.propriaUnitId,
    );

    let recipients: { email: string; full_name: string | null }[] = [];
    if (opts.assignedToId) {
      const profile = await resolveProfile(opts.admin, opts.assignedToId);
      if (profile) recipients = [{ email: profile.email, full_name: profile.full_name }];
    }

    // Fallback : si pas d'assigné, on alerte CEO + assistantes
    if (recipients.length === 0) {
      const ceos = await getCeoRecipients(opts.admin);
      const { data: assistantes } = await opts.admin
        .from('profiles')
        .select('id, email, full_name')
        .eq('role', 'assistante')
        .eq('is_active', true)
        .not('email', 'like', '%+%@%');
      const merged = new Map<string, { email: string; full_name: string | null }>();
      for (const r of ceos) {
        if (r.email) merged.set(r.email.toLowerCase(), { email: r.email, full_name: r.full_name });
      }
      for (const r of (assistantes ?? []) as any[]) {
        if (r.email) merged.set(r.email.toLowerCase(), { email: r.email, full_name: r.full_name });
      }
      recipients = Array.from(merged.values());
    }

    let sent = 0;
    for (const r of recipients) {
      await sendCheckupOverdueToTeam({
        to: r.email,
        recipient_name: r.full_name ?? r.email,
        checkup_id: opts.checkupId,
        property_name: propertyName,
        days_overdue: opts.daysOverdue,
        idempotency_key: `rem-checkup-overdue-${opts.checkupId}-d${opts.daysOverdue}-${opts.todayIso}`,
      });
      sent++;
    }
    return sent;
  } catch (e: any) {
    console.warn('[checkup-notify] notifyCheckupOverdue:', e?.message ?? e);
    return 0;
  }
}

export { APP_URL as CHECKUP_APP_URL };
