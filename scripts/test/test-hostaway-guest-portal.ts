/* eslint-disable no-console */
/**
 * Script d'exploration LIVE de l'API Hostaway pour l'audit guest portal.
 *
 * Lancement : npx tsx scripts/test/test-hostaway-guest-portal.ts <hostaway_reservation_id>
 *
 * Nécessite HOSTAWAY_ACCOUNT_ID et HOSTAWAY_API_KEY dans l'env (.env.local).
 *
 * Tente plusieurs endpoints potentiels pour récupérer les infos détaillées
 * du guest portal (passeport, photo pièce, nationalité, etc.) et logue la
 * réponse JSON brute (anonymisée pour les noms) pour comparaison.
 *
 * Endpoints testés :
 *   1. GET /v1/reservations/{id}                          (baseline)
 *   2. GET /v1/reservations/{id}?includeResources=1
 *   3. GET /v1/reservations/{id}/customFieldValues
 *   4. GET /v1/customFields                               (liste config compte)
 *   5. GET /v1/customFieldValues?reservationId={id}
 *   6. GET /v1/reservations/{id}/guestPortalInformation   (probe)
 *   7. GET /v1/reservations/{id}/personalInformation      (probe)
 *   8. GET /v1/reservations/{id}/attachments              (probe)
 *
 * Toute 404/400 est tolérée et notée — c'est le but du probe.
 */

// Stub `server-only`
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...rest: any[]) {
  if (request === 'server-only') {
    return require.resolve('node:path');
  }
  return origResolve.call(this, request, ...rest);
};

// Charge .env.local
import { config as dotenvConfig } from 'dotenv';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

for (const p of ['.env.local', '.env']) {
  if (existsSync(p)) {
    dotenvConfig({ path: p });
    console.log(`[env] loaded ${p}`);
  }
}

import { hostawayFetch } from '../../lib/hostaway/client';

function anonymize(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') {
    // Champs sensibles : remplacer par ***
    return obj;
  }
  if (Array.isArray(obj)) return obj.map(anonymize);
  if (typeof obj === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      const lower = k.toLowerCase();
      if (
        /(firstname|lastname|name|email|phone|address|number|ccnumber|cvc|guestpicture|authhash|passport|nationality|birth|zip)/i.test(
          lower,
        ) &&
        typeof v === 'string'
      ) {
        out[k] = v.length > 0 ? '***' : '';
      } else {
        out[k] = anonymize(v);
      }
    }
    return out;
  }
  return obj;
}

async function probe(label: string, endpoint: string, query?: Record<string, any>) {
  console.log(`\n=== ${label} ===`);
  console.log(`GET ${endpoint}${query ? '?' + new URLSearchParams(query).toString() : ''}`);
  try {
    const data = await hostawayFetch<any>(endpoint, { query });
    const result = data?.result ?? data;
    const keys = Array.isArray(result)
      ? `array(${result.length})`
      : result && typeof result === 'object'
        ? Object.keys(result).slice(0, 40).join(',')
        : typeof result;
    console.log(`OK status=${data?.status ?? 'n/a'} keys=${keys}`);
    return { label, endpoint, query, ok: true, data };
  } catch (e: any) {
    console.error(`ERR ${e?.message?.slice(0, 200) ?? e}`);
    return { label, endpoint, query, ok: false, error: String(e?.message ?? e) };
  }
}

async function main() {
  const id = process.argv[2];
  if (!id) {
    console.error('Usage: tsx scripts/test/test-hostaway-guest-portal.ts <hostaway_reservation_id>');
    process.exit(1);
  }

  const results: any[] = [];

  results.push(await probe('Baseline reservation', `/reservations/${id}`));
  results.push(
    await probe('Reservation + includeResources', `/reservations/${id}`, {
      includeResources: 1,
    }),
  );
  results.push(
    await probe('Custom field values (subpath)', `/reservations/${id}/customFieldValues`),
  );
  results.push(
    await probe('Custom field values (query)', `/customFieldValues`, { reservationId: id }),
  );
  results.push(await probe('Custom fields config', `/customFields`));
  results.push(
    await probe('Guest portal information', `/reservations/${id}/guestPortalInformation`),
  );
  results.push(
    await probe('Personal information', `/reservations/${id}/personalInformation`),
  );
  results.push(await probe('Reservation attachments', `/reservations/${id}/attachments`));
  results.push(await probe('Guest forms', `/reservations/${id}/guestForms`));
  results.push(await probe('Guest identity verification', `/reservations/${id}/guestIdentityVerification`));

  // Dump complet anonymisé du baseline + includeResources
  const outDir = 'docs/propria';
  mkdirSync(outDir, { recursive: true });
  const samplePath = join(outDir, 'hostaway-guest-portal-sample.json');
  const sample = {
    generated_at: new Date().toISOString(),
    reservation_id: id,
    probes: results.map((r) => ({
      label: r.label,
      endpoint: r.endpoint,
      query: r.query ?? null,
      ok: r.ok,
      ...(r.ok
        ? { status: r.data?.status, result: anonymize(r.data?.result ?? r.data) }
        : { error: r.error }),
    })),
  };
  writeFileSync(samplePath, JSON.stringify(sample, null, 2));
  console.log(`\nSample anonymisé écrit : ${samplePath}`);

  console.log('\n=== Récap probes ===');
  for (const r of results) {
    console.log(`${r.ok ? 'OK ' : 'ERR'} ${r.label.padEnd(40)} ${r.endpoint}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
