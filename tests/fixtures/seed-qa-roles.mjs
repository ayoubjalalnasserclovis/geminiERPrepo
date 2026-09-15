/**
 * Seed idempotent des 12 comptes QA (1 par rôle) : othmane+<role>@stoniz.co
 * Usage : SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... QA_TEST_PASSWORD=... node tests/fixtures/seed-qa-roles.mjs
 * - Ne touche JAMAIS un compte existant hors préfixe othmane+
 * - Re-run = no-op (comptes existants détectés, mot de passe resynchronisé)
 */
import { createClient } from '@supabase/supabase-js';

const ROLES = ['ceo','chef_projet','sourcing','commercial','finance','marketing','assistante','propria','developer','achats','client','menage'];
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const password = process.env.QA_TEST_PASSWORD;
if (!url || !key || !password) { console.error('env manquante'); process.exit(1); }

const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

// Index des users existants par email
const existing = new Map();
let page = 1;
for (;;) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  for (const u of data.users) existing.set((u.email || '').toLowerCase(), u);
  if (data.users.length < 200) break;
  page++;
}

const out = [];
for (const role of ROLES) {
  const email = `othmane+${role}@stoniz.co`;
  let user = existing.get(email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: `QA-${role}`, role },
    });
    if (error) { console.error(`ERREUR createUser ${email}:`, error.message); continue; }
    user = data.user;
  } else {
    // resync mot de passe (idempotent) sans toucher au reste
    await admin.auth.admin.updateUserById(user.id, { password });
  }
  // S'assurer que le profil a le bon rôle (trigger peut avoir mis 'client' par défaut)
  const { error: upErr } = await admin.from('profiles')
    .update({ role, full_name: `QA-${role}`, is_active: true })
    .eq('id', user.id);
  if (upErr) console.error(`ERREUR profil ${email}:`, upErr.message);
  out.push({ role, email, id: user.id });
}
console.log(JSON.stringify(out, null, 2));
