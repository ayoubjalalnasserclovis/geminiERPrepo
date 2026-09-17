import { describe, it, expect } from 'vitest';
import {
  parseChaabiCSV,
  computeDedupHash,
  extractRefFromLabel,
} from '@/lib/finance/bank-chaabi-parser';

describe('Bank Chaabi Parser Suite', () => {
  describe('BUG-019: Column reordering & dynamic header tolerance in parseMatrix', () => {
    it('successfully parses when columns are in standard order', () => {
      const csv = [
        "Date d'opération;Date Valeur;LIBELLE;DEBIT;CREDIT;Référence",
        '02-06-2026;03-06-2026;VIR RECU DE CLIENT A REF 90100114013951; ;1299,00;13951',
      ].join('\n');

      const res = parseChaabiCSV(csv);
      expect(res.errors).toHaveLength(0);
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].operation_date).toBe('2026-06-02');
      expect(res.rows[0].credit_mad).toBe(1299);
      expect(res.rows[0].reference).toBe('90100114013951');
    });

    it('successfully parses when columns are reordered (LIBELLE before Date Valeur, DEBIT before LIBELLE)', () => {
      const csv = [
        "Date d'opération;DEBIT;LIBELLE;Date Valeur;CREDIT;Référence",
        '02-06-2026;245,00;ACHAT PAR CARTE SUPERMARCHE;03-06-2026; ;REF999',
      ].join('\n');

      const res = parseChaabiCSV(csv);
      expect(res.errors).toHaveLength(0);
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].operation_date).toBe('2026-06-02');
      expect(res.rows[0].debit_mad).toBe(245);
      expect(res.rows[0].label).toBe('ACHAT PAR CARTE SUPERMARCHE');
      expect(res.rows[0].value_date).toBe('2026-06-03');
    });

    it('successfully parses when there is an extra leading column (e.g. Numéro de compte)', () => {
      const csv = [
        "Compte;Date d'opération;Date Valeur;LIBELLE;DEBIT;CREDIT;Référence",
        '007780001;05-06-2026;06-06-2026;VIR. EMIS VERS FOURNISSEUR;5000,00; ;REF777',
      ].join('\n');

      const res = parseChaabiCSV(csv);
      expect(res.errors).toHaveLength(0);
      expect(res.rows).toHaveLength(1);
      expect(res.rows[0].operation_date).toBe('2026-06-05');
      expect(res.rows[0].debit_mad).toBe(5000);
      expect(res.rows[0].label).toBe('VIR. EMIS VERS FOURNISSEUR');
    });
  });

  describe('BUG-020: parseAmount currency suffixes & separators', () => {
    it('parses amounts with MAD or DH currency suffixes', () => {
      const csv = [
        "Date d'opération;Date Valeur;LIBELLE;DEBIT;CREDIT;Référence",
        '02-06-2026;03-06-2026;VIR RECU 1; ;1 299,00 MAD;REF1',
        '03-06-2026;04-06-2026;ACHAT FOURNITURES;245,50 DH; ;REF2',
      ].join('\n');

      const res = parseChaabiCSV(csv);
      expect(res.errors).toHaveLength(0);
      expect(res.rows[0].credit_mad).toBe(1299);
      expect(res.rows[1].debit_mad).toBe(245.5);
    });

    it('parses amounts formatted with dot thousand separator (1.299,00) or comma thousand separator (1,299.00)', () => {
      const csv = [
        "Date d'opération;Date Valeur;LIBELLE;DEBIT;CREDIT;Référence",
        '02-06-2026;03-06-2026;VIREMENT A; ;12.500,50;REF1',
        '03-06-2026;04-06-2026;VIREMENT B; ;12,500.50;REF2',
      ].join('\n');

      const res = parseChaabiCSV(csv);
      expect(res.errors).toHaveLength(0);
      expect(res.rows[0].credit_mad).toBe(12500.5);
      expect(res.rows[1].credit_mad).toBe(12500.5);
    });

    it('parses accounting negative parentheses notation e.g. (245,00)', () => {
      const csv = [
        "Date d'opération;Date Valeur;LIBELLE;DEBIT;CREDIT;Référence",
        '02-06-2026;03-06-2026;FRAIS BANCAIRES;(245,00); ;REF1',
      ].join('\n');

      const res = parseChaabiCSV(csv);
      expect(res.errors).toHaveLength(0);
      expect(res.rows[0].debit_mad).toBe(-245);
    });
  });

  describe('BUG-021: parseDate with slash format (DD/MM/YYYY)', () => {
    it('correctly parses dates formatted with slashes', () => {
      const csv = [
        "Date d'opération;Date Valeur;LIBELLE;DEBIT;CREDIT;Référence",
        '14/07/2026;15/07/2026;VIR RECU CLIENT; ;8500,00;REF1',
      ].join('\n');

      const res = parseChaabiCSV(csv);
      expect(res.errors).toHaveLength(0);
      expect(res.rows[0].operation_date).toBe('2026-07-14');
      expect(res.rows[0].value_date).toBe('2026-07-15');
    });
  });

  describe('BUG-022: computeDedupHash consistency between pending and validated card debits', () => {
    it('produces identical dedup hash for pending authorization (-245 MAD) and validated purchase (245 MAD)', () => {
      const accountId = 'acc-123';
      const pendingHash = computeDedupHash({
        account_id: accountId,
        operation_date: '2026-06-02',
        reference: null,
        amount: -245.0, // pending authorization has negative debit
        is_debit: true,
        label: 'ACHAT PAR CARTE LES EAUX MINERALES D OUL (*) >RABAT MA',
      });

      const validatedHash = computeDedupHash({
        account_id: accountId,
        operation_date: '2026-06-04', // date may be slightly shifted within same month
        reference: null,
        amount: 245.0, // confirmed debit is positive
        is_debit: true,
        label: 'ACHAT PAR CARTE DE PAIEMENT CHEZ LES EAUX MINERALES D O',
      });

      expect(pendingHash).toBe(validatedHash);
    });
  });

  describe('BUG-023: parseChaabiCSV RFC 4180 escaped quotes', () => {
    it('preserves double-double quotes inside quoted cells', () => {
      const csv = [
        "Date d'opération;Date Valeur;LIBELLE;DEBIT;CREDIT;Référence",
        '02-06-2026;03-06-2026;"VIR ""SPECIAL"" RECU"; ;1000,00;REF1',
      ].join('\n');

      const res = parseChaabiCSV(csv);
      expect(res.errors).toHaveLength(0);
      expect(res.rows[0].label).toBe('VIR "SPECIAL" RECU');
    });
  });

  describe('extractRefFromLabel edge cases', () => {
    it('extracts reference with colon or dot delimiters', () => {
      expect(extractRefFromLabel('VIR RECU REF: 90100114013951 DE BMCE')).toBe('90100114013951');
      expect(extractRefFromLabel('VIR EMIS REF. 883719001')).toBe('883719001');
      expect(extractRefFromLabel('CHEQUE N: 0835836 TIRE SUR BMCI')).toBe('0835836');
      expect(extractRefFromLabel('CHEQUE N° 0835836')).toBe('0835836');
    });
  });
});
