import { describe, it, expect } from 'vitest';
import { evaluateCronAuth } from './auth';

/**
 * Le point critique : fail-closed. Sans CRON_SECRET, la route doit REFUSER
 * (503), jamais devenir publique et jamais accepter un secret de secours.
 */
describe('evaluateCronAuth', () => {
  it('refuse en 503 quand CRON_SECRET est absente', () => {
    expect(evaluateCronAuth('Bearer whatever', undefined)).toEqual({
      ok: false, status: 503, reason: 'cron_misconfigured',
    });
  });

  it('refuse en 503 quand CRON_SECRET est vide ou blanche', () => {
    expect(evaluateCronAuth('Bearer x', '')).toMatchObject({ status: 503 });
    expect(evaluateCronAuth('Bearer x', '   ')).toMatchObject({ status: 503 });
  });

  it('refuse en 503 même sans en-tête Authorization (pas de route publique)', () => {
    expect(evaluateCronAuth(null, undefined)).toMatchObject({ status: 503 });
  });

  it("n'accepte plus l'ancien mot de passe de secours 'dev-secret'", () => {
    expect(evaluateCronAuth('Bearer dev-secret', undefined)).toMatchObject({ ok: false });
    expect(evaluateCronAuth('Bearer dev-secret', 'vrai-secret')).toMatchObject({
      ok: false, status: 401,
    });
  });

  it('accepte le Bearer exact quand CRON_SECRET est définie', () => {
    expect(evaluateCronAuth('Bearer vrai-secret', 'vrai-secret')).toEqual({ ok: true });
  });

  it('refuse en 401 un en-tête absent, vide, mal formé ou erroné', () => {
    expect(evaluateCronAuth(null, 'vrai-secret')).toMatchObject({ status: 401 });
    expect(evaluateCronAuth('', 'vrai-secret')).toMatchObject({ status: 401 });
    expect(evaluateCronAuth('vrai-secret', 'vrai-secret')).toMatchObject({ status: 401 });
    expect(evaluateCronAuth('Bearer  vrai-secret', 'vrai-secret')).toMatchObject({ status: 401 });
    expect(evaluateCronAuth('Bearer vrai-secretX', 'vrai-secret')).toMatchObject({ status: 401 });
  });
});
