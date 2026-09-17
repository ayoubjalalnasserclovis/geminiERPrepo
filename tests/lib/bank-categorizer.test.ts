import { describe, it, expect } from 'vitest';
import { categorize } from '@/lib/finance/bank-categorizer';

describe('Bank Categorizer Suite (BUG-027)', () => {
  it('extracts beneficiary correctly for cheque_recu (REMIS PAR format)', () => {
    const res = categorize({
      label: 'CHEQUE N 0835836 REMIS PAR MOHAMED BENALI REF 9021',
    });
    expect(res.category_code).toBe('cheque_recu');
    expect(res.beneficiary).toBe('MOHAMED BENALI');
  });

  it('extracts beneficiary correctly for pending card authorization without CHEZ', () => {
    const res = categorize({
      label: 'ACHAT PAR CARTE LES EAUX MINERALES D OUL (*) >RABAT MA',
    });
    expect(res.category_code).toBe('achat_cb');
    expect(res.beneficiary).toBe('LES EAUX MINERALES D OUL');
  });

  it('extracts beneficiary correctly for validated card purchase with CHEZ', () => {
    const res = categorize({
      label: 'ACHAT PAR CARTE DE PAIEMENT CHEZ BRICOMA MARRAKECH >MARRAKECH MA',
    });
    expect(res.category_code).toBe('achat_cb');
    expect(res.beneficiary).toBe('BRICOMA MARRAKECH');
  });

  it('categorizes taxes (DGI) and charges sociales (CNSS)', () => {
    const dgi = categorize({ label: 'PRELEVEMENTS DES IMPOTS EN FAVEUR DE LA DGI' });
    expect(dgi.category_code).toBe('dgi');
    expect(dgi.allocation_type).toBe('cabinet_fiscal');

    const cnss = categorize({ label: 'COTISATIONS CNSS TELEPAIEMENT' });
    expect(cnss.category_code).toBe('cnss');
    expect(cnss.allocation_type).toBe('cabinet_social');
  });

  it('identifies intercompany transactions when entity is Stoniz affiliate', () => {
    const inter = categorize({
      label: 'VIR. EMIS VERS STZ OJ EN FAVEUR DE STZ OJ REF 12345',
    });
    expect(inter.allocation_type).toBe('intercompany');
  });
});
