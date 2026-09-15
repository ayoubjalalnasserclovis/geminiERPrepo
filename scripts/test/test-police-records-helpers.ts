/* eslint-disable no-console */
/**
 * Smoke test pour les helpers PURS de lib/propria/police-records.ts.
 *
 * Couvert : computeMissingFields, splitGuestName, normalizeAccompanyingPersons,
 * computeNextStatus. Pas de Supabase ici.
 *
 * Lancement : `npx tsx scripts/test/test-police-records-helpers.ts`
 *
 * Note : police-records.ts est marqué `server-only`. On contourne en stubbant
 * le module avant require — comme on n'appelle aucun helper Supabase, ça suffit.
 */

// Stub `server-only` (sinon le require explose en script Node).
// On utilise un Module-level override via Module._resolveFilename.
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...rest: any[]) {
  if (request === 'server-only') {
    // Pointe vers un module vide
    return require.resolve('node:path'); // tout module qui charge sans throw
  }
  return origResolve.call(this, request, ...rest);
};

import {
  computeMissingFields,
  splitGuestName,
  normalizeAccompanyingPersons,
  computeNextStatus,
  REQUIRED_FIELDS_FOR_COMPLETE,
} from '../../lib/propria/police-records';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    pass++;
    console.log(`OK   ${name}`);
  } else {
    fail++;
    console.error(`FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// ─── 1. computeMissingFields({}) doit retourner TOUS les requis ───
{
  const missing = computeMissingFields({});
  check(
    '1. computeMissingFields({}) retourne tous les champs requis',
    missing.length === REQUIRED_FIELDS_FOR_COMPLETE.length,
    `attendu ${REQUIRED_FIELDS_FOR_COMPLETE.length}, reçu ${missing.length}`,
  );
  console.log(`     -> ${missing.length} champs requis : ${missing.join(', ')}`);
}

// ─── 2. computeMissingFields avec tous les requis renseignés ───
{
  const allFilled: Record<string, any> = {};
  for (const f of REQUIRED_FIELDS_FOR_COMPLETE) allFilled[f] = 'xxx';
  const missing = computeMissingFields(allFilled as any);
  check(
    '2. computeMissingFields(tous remplis) retourne []',
    missing.length === 0,
    `manquants restants : ${missing.join(', ')}`,
  );
}

// ─── 3. splitGuestName("Marie Dupont") ───
{
  const r = splitGuestName('Marie Dupont');
  check(
    '3. splitGuestName("Marie Dupont")',
    r.first_name === 'Marie' && r.last_name === 'Dupont',
    JSON.stringify(r),
  );
}

// ─── 4. splitGuestName long nom — last = dernier token ───
{
  const r = splitGuestName('John Maximilien De La Rochefoucauld');
  check(
    '4. splitGuestName long — dernier token = last_name',
    r.last_name === 'Rochefoucauld' && r.first_name === 'John Maximilien De La',
    JSON.stringify(r),
  );
}

// ─── 5. splitGuestName cas dégradés ───
{
  const r1 = splitGuestName('');
  const r2 = splitGuestName(null);
  const r3 = splitGuestName('Madonna');
  const r4 = splitGuestName('  Marie    Dupont  ');
  check(
    '5a. splitGuestName("") vide',
    r1.first_name === '' && r1.last_name === '',
    JSON.stringify(r1),
  );
  check(
    '5b. splitGuestName(null) vide',
    r2.first_name === '' && r2.last_name === '',
    JSON.stringify(r2),
  );
  check(
    '5c. splitGuestName("Madonna") → last seul',
    r3.first_name === '' && r3.last_name === 'Madonna',
    JSON.stringify(r3),
  );
  check(
    '5d. splitGuestName collapse espaces',
    r4.first_name === 'Marie' && r4.last_name === 'Dupont',
    JSON.stringify(r4),
  );
}

// ─── 6. computeNextStatus / draft / complete / submitted figé ───
{
  const empty = computeNextStatus({});
  const full: Record<string, any> = {};
  for (const f of REQUIRED_FIELDS_FOR_COMPLETE) full[f] = 'x';
  const ok = computeNextStatus(full as any);
  const locked = computeNextStatus(full as any, 'submitted');
  const archived = computeNextStatus({} as any, 'archived');
  check('6a. computeNextStatus({}) = draft', empty === 'draft');
  check('6b. computeNextStatus(plein) = complete', ok === 'complete');
  check('6c. computeNextStatus(plein, submitted) reste submitted', locked === 'submitted');
  check('6d. computeNextStatus({}, archived) reste archived', archived === 'archived');
}

// ─── 7. normalizeAccompanyingPersons ───
{
  const raw = [
    { last_name: '  Dupont  ', first_name: 'Paul', id_type: 'cin', id_number: ' AB123 ' },
    { last_name: '', first_name: '' }, // ligne vide → ignorée
    { last_name: 'Smith', first_name: 'Mary', id_type: 'invalid_type' as any },
    'not-an-object' as any,
    null,
  ];
  const out = normalizeAccompanyingPersons(raw);
  check(
    '7a. normalizeAccompanyingPersons filtre les lignes vides + invalides',
    out.length === 2,
    `length=${out.length}`,
  );
  check(
    '7b. trim sur last_name + id_number',
    out[0]?.last_name === 'Dupont' && out[0]?.id_number === 'AB123',
    JSON.stringify(out[0]),
  );
  check(
    '7c. id_type invalide → null',
    out[1]?.id_type === null,
    JSON.stringify(out[1]),
  );
}

console.log('');
console.log(`Résumé : ${pass} OK / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
