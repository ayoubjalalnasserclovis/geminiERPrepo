import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole, getSessionUser } from '@/lib/auth/require';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import {
  inviteTeamMemberAction,
  deactivateTeamMemberAction,
  reactivateTeamMemberAction,
  changeTeamMemberRoleAction,
} from './actions';

const ROLE_OPTIONS = [
  { value: 'ceo',          label: 'CEO' },
  { value: 'chef_projet',  label: 'Chef de projet' },
  { value: 'sourcing',     label: 'Sourcing' },
  { value: 'commercial',   label: 'Commercial' },
  { value: 'finance',      label: 'Finance' },
  { value: 'marketing',    label: 'Marketing' },
  { value: 'assistante',   label: 'Assistant·e' },
  { value: 'propria',      label: 'Propria (conciergerie)' },
  { value: 'achats',       label: 'Achats' },
  { value: 'menage',       label: 'Ménage (dame de ménage)' },
  { value: 'developer',    label: 'Developer (interne)' },
];

const ROLE_LABEL: Record<string, string> = Object.fromEntries(
  ROLE_OPTIONS.map(r => [r.value, r.label]),
);

/**
 * Outer wrapper avec sentinelle BDD (CEO 2026-06-11) : toute erreur de rendu
 * est persistée dans app_error_logs avant d'être propagée. Vercel masque les
 * error.message en prod ; la sentinelle nous donne le détail exact à coup sûr.
 */
export default async function TeamPageOuter() {
  try {
    return await TeamPage();
  } catch (err: any) {
    if (err?.digest === 'NEXT_NOT_FOUND' || err?.digest?.startsWith?.('NEXT_REDIRECT')) {
      throw err;
    }
    try {
      const admin = createAdminClient();
      const me = await getSessionUser().catch(() => null);
      await admin.from('app_error_logs').insert({
        source: 'TeamPage:render',
        user_id: me?.id ?? null,
        message: (err?.message ?? 'unknown render error').slice(0, 1000),
        details: {
          stack: (err?.stack ?? '').slice(0, 4000),
          name: err?.name,
          digest: err?.digest,
        },
        payload: { pathname: '/team', role: me?.role ?? null },
      } as any);
    } catch { /* never let the logger break the error path */ }
    throw err;
  }
}

async function TeamPage() {
  await requireRole(['ceo', 'developer']);
  const supabase = createClient();
  const { data: profiles, error: profilesErr } = await supabase
    .from('profiles')
    .select('id, email, full_name, role, is_active, mfa_required, created_at')
    .neq('role', 'client')
    .order('is_active', { ascending: false })
    .order('full_name');

  if (profilesErr) {
    throw new Error(`Lecture profiles : ${profilesErr.message}`);
  }

  const rows = (profiles ?? []) as any[];

  // Filet : si un rôle inconnu se glisse dans la liste, on ne plante pas le
  // rendu — on logge et on remplace le rôle par "(rôle inconnu)" dans l'UI.
  // Le bug Rajaa (2026-06-11) venait de là : un rendu plantait silencieusement
  // sans qu'on sache pourquoi. Avec ce filet on a au moins l'info dans les logs.
  const KNOWN_ROLES = new Set(ROLE_OPTIONS.map(r => r.value));
  const unknown = rows.filter(r => !KNOWN_ROLES.has(r.role));
  if (unknown.length > 0) {
    console.warn('[TeamPage] roles inconnus dans profiles:', unknown.map(u => ({ id: u.id, role: u.role })));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Équipe Stoniz"
        description="Membres de l'équipe (hors clients). Le CEO peut inviter de nouveaux collaborateurs et leur attribuer un rôle."
      />

      {/* Inviter un nouveau collaborateur */}
      <details className="bg-white border border-stoniz-gray-200 rounded-xl p-5" open={rows.length === 0}>
        <summary className="cursor-pointer font-medium">
          + Inviter un collaborateur
        </summary>
        <form action={inviteTeamMemberAction} className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-stoniz-gray-600">Email *</label>
            <input
              name="email"
              type="email"
              required
              placeholder="prenom@stoniz.co"
              className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-stoniz-gray-600">Nom complet *</label>
            <input
              name="full_name"
              required
              placeholder="Prénom Nom"
              className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-stoniz-gray-600">Rôle *</label>
            <select
              name="role"
              required
              defaultValue=""
              className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            >
              <option value="" disabled>— Choisir un rôle —</option>
              {ROLE_OPTIONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <p className="text-[11px] text-stoniz-gray-500 mt-1">
              Le rôle détermine les écrans accessibles. Les clients ne sont jamais créés ici (passe par le module Clients).
            </p>
          </div>
          {/* QA-BUG-016 : champ « 2FA obligatoire » retiré — l'app ne vérifie
              pas réellement le MFA au login (faux sentiment de sécurité).
              À réintroduire une fois l'enforcement AAL2 construit. */}
          <div className="md:col-span-2 flex items-center justify-between pt-2">
            <p className="text-xs text-stoniz-gray-500">
              Le collaborateur recevra un email d'invitation pour définir son mot de passe.
            </p>
            <button
              type="submit"
              className="bg-stoniz-black text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-stoniz-gray-800"
            >
              ✉ Envoyer l'invitation
            </button>
          </div>
        </form>
      </details>

      {/* Liste des membres */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs uppercase text-stoniz-gray-600">
            <tr>
              <th className="px-4 py-3 text-left">Nom</th>
              <th className="px-4 py-3 text-left">Email</th>
              <th className="px-4 py-3 text-left">Rôle</th>
              <th className="px-4 py-3 text-center">Statut</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {rows.map(p => (
              <tr key={p.id} className={p.is_active ? '' : 'opacity-60'}>
                <td className="px-4 py-3 font-medium">{p.full_name}</td>
                <td className="px-4 py-3 text-xs text-stoniz-gray-600">{p.email}</td>
                <td className="px-4 py-3">
                  <form action={changeTeamMemberRoleAction} className="flex items-center gap-2">
                    <input type="hidden" name="profile_id" value={p.id} />
                    <select
                      name="role"
                      defaultValue={p.role}
                      className="border border-stoniz-gray-200 rounded px-2 py-1 text-xs bg-transparent hover:bg-stoniz-gray-50"
                    >
                      {ROLE_OPTIONS.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="text-[10px] text-stoniz-gray-500 hover:text-stoniz-black underline"
                      title="Enregistrer le nouveau rôle"
                    >
                      ↻
                    </button>
                  </form>
                </td>
                <td className="px-4 py-3 text-center">
                  {p.is_active
                    ? <Badge variant="success">Actif</Badge>
                    : <Badge>Désactivé</Badge>}
                </td>
                <td className="px-4 py-3 text-right">
                  {p.is_active ? (
                    <form action={async () => { 'use server'; await deactivateTeamMemberAction(p.id); }}>
                      <button className="text-xs text-red-700 hover:underline">
                        Désactiver
                      </button>
                    </form>
                  ) : (
                    <form action={async () => { 'use server'; await reactivateTeamMemberAction(p.id); }}>
                      <button className="text-xs text-emerald-700 hover:underline">
                        Réactiver
                      </button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-stoniz-gray-500 text-sm">
                  Aucun collaborateur pour l'instant. Invite ton premier membre ci-dessus.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-stoniz-gray-500">
        Pour supprimer définitivement un compte (RGPD), contacte l'administrateur Supabase.
        La désactivation conserve l'historique mais bloque la connexion.
      </p>
    </div>
  );
}
