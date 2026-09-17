import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import type { Role } from '@/lib/auth/require';

let mockSupabase = createMockSupabase();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockSupabase,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockSupabase,
}));

vi.mock('@/lib/auth/require', () => ({
  assertRole: vi.fn().mockImplementation(async (allowed: Role[]) => {
    const user = getMockUser();
    if (!allowed.includes(user.role)) throw new Error('Permission refusée');
    return user;
  }),
  requireRole: vi.fn().mockImplementation(async (allowed: Role[]) => {
    const user = getMockUser();
    if (!allowed.includes(user.role)) throw new Error('Permission refusée');
    return user;
  }),
  getSessionUser: vi.fn().mockImplementation(async () => getMockUser()),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: vi.fn(),
  usePathname: vi.fn(),
}));

import {
  createStonizWalletAction,
  closeStonizWalletAction,
  reopenStonizWalletAction,
  createStonizDotationAction,
  createStonizExpenseAction,
  updateStonizExpenseAction,
  softDeleteStonizExpenseAction,
  restoreStonizExpenseAction,
  validateStonizExpenseAction,
  validateAllStonizExpensesForWalletAction,
} from '@/app/(team)/caisse-stoniz/actions';

describe('Multi-Step Workflow: Caisse Stoniz -> Wallet Lifecycle -> Dotation -> Validation Locks -> Clôture', () => {
  const SOURCING_USER_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
  const CEO_USER_ID = 'bbbbbbbb-1111-2222-3333-444444444444';
  const PROJECT_ID = 'cccccccc-1111-2222-3333-444444444444';

  beforeEach(() => {
    mockSupabase = createMockSupabase({
      projects: [
        {
          id: PROJECT_ID,
          reference: 'PRJ-2026-MARRAKECH',
          status: 'actif',
        },
      ],
      profiles: [
        { id: CEO_USER_ID, email: 'ceo@stoniz.co', full_name: 'Ayoub CEO', role: 'ceo', is_active: true },
        { id: SOURCING_USER_ID, email: 'sourcing@stoniz.co', full_name: 'Zineb Sourcing', role: 'sourcing', is_active: true },
      ],
      stoniz_wallets: [],
      stoniz_wallet_dotations: [],
      stoniz_wallet_expenses: [],
      finance_audit_log: [],
    });
    setMockUser('sourcing', SOURCING_USER_ID);
  });

  it('executes full caisse lifecycle and enforces CEO validation tamper-proofing', async () => {
    // Step 1: Open cash wallet for sourcing agent
    const fdWallet = new FormData();
    fdWallet.set('profile_id', SOURCING_USER_ID);
    fdWallet.set('label', 'Caisse Terrain Marrakech — Zineb');
    fdWallet.set('notes', 'Achats quincaillerie et petits chantiers');

    await createStonizWalletAction(fdWallet);

    const wallets = mockSupabase.db.stoniz_wallets;
    expect(wallets).toHaveLength(1);
    const walletId = wallets[0].id;
    expect(wallets[0].label).toBe('Caisse Terrain Marrakech — Zineb');
    expect(wallets[0].is_active).not.toBe(false);

    // Step 2: CEO allocates cash dotation (20,000 MAD)
    setMockUser('ceo', CEO_USER_ID);
    const fdDotation = new FormData();
    fdDotation.set('wallet_id', walletId);
    fdDotation.set('given_at', '2026-09-17');
    fdDotation.set('amount_mad', '20000');
    fdDotation.set('type', 'dotation');
    fdDotation.set('note', 'Dotation initiale rentrée Marrakech');
    await createStonizDotationAction(fdDotation);

    const dotations = mockSupabase.db.stoniz_wallet_dotations;
    expect(dotations).toHaveLength(1);
    expect(dotations[0].amount_mad).toBe(20000);
    expect(dotations[0].given_by).toBe(CEO_USER_ID);

    // Step 3: Sourcing agent logs an on-site purchase expense with receipt
    setMockUser('sourcing', SOURCING_USER_ID);
    const dummyReceipt = new File(['ticket de caisse Leroy Merlin'], 'receipt_quincaillerie.jpg', {
      type: 'image/jpeg',
    });

    const fdExpense = new FormData();
    fdExpense.set('wallet_id', walletId);
    fdExpense.set('spent_at', '2026-09-17');
    fdExpense.set('project_id', PROJECT_ID);
    fdExpense.set('expense_type', 'achat');
    fdExpense.set('category', 'quincaillerie');
    fdExpense.set('description', 'Vis, chevilles et serrures portes');
    fdExpense.set('amount_mad', '1250.50');
    fdExpense.set('receipt_file', dummyReceipt);

    await createStonizExpenseAction(fdExpense);

    const expenses = mockSupabase.db.stoniz_wallet_expenses;
    expect(expenses).toHaveLength(1);
    const expenseId = expenses[0].id;
    expect(expenses[0].amount_mad).toBe(1250.5);
    expect(expenses[0].created_by).toBe(SOURCING_USER_ID);
    expect(expenses[0].receipt_path).toBeTruthy();
    expect(expenses[0].is_validated).toBeFalsy();

    // Step 4: Sourcing agent updates details while still unvalidated
    const editRes = await updateStonizExpenseAction(expenseId, {
      description: 'Vis, chevilles, serrures et poignées laiton',
      amount_mad: 1350.0,
    });
    expect(editRes.ok).toBe(true);
    expect(expenses[0].amount_mad).toBe(1350.0);
    expect(expenses[0].description).toContain('poignées laiton');

    // Step 5: CEO validates the expense
    setMockUser('ceo', CEO_USER_ID);
    await validateStonizExpenseAction(expenseId, walletId);
    expect(expenses[0].is_validated).toBe(true);
    expect(expenses[0].validated_at).toBeTruthy();
    expect(expenses[0].validated_by).toBe(CEO_USER_ID);

    // Step 6: Test BUG-031 fix: Sourcing agent attempts to edit validated expense -> BLOCKED
    setMockUser('sourcing', SOURCING_USER_ID);
    const blockedEdit = await updateStonizExpenseAction(expenseId, {
      amount_mad: 5000.0, // Fraudulent increase after approval
    });
    expect(blockedEdit.ok).toBe(false);
    expect((blockedEdit as any).error).toContain('Cette dépense a été validée par le CEO. Seul le CEO peut la modifier.');
    expect(expenses[0].amount_mad).toBe(1350.0);

    // Step 7: Test BUG-031 fix: Sourcing agent attempts to delete validated expense -> BLOCKED
    const blockedDelete = await softDeleteStonizExpenseAction(expenseId);
    expect(blockedDelete.ok).toBe(false);
    expect((blockedDelete as any).error).toContain('Cette dépense a été validée par le CEO. Seul le CEO peut la supprimer.');
    expect(expenses[0].deleted_at).toBeFalsy();

    // Step 8: CEO is authorized to delete and restore
    setMockUser('ceo', CEO_USER_ID);
    const ceoDelete = await softDeleteStonizExpenseAction(expenseId);
    expect(ceoDelete.ok).toBe(true);
    expect(expenses[0].deleted_at).toBeTruthy();

    const ceoRestore = await restoreStonizExpenseAction(expenseId);
    expect(ceoRestore.ok).toBe(true);
    expect(expenses[0].deleted_at).toBeNull();

    // Step 9: Wallet closure and reopening
    await closeStonizWalletAction(walletId);
    expect(wallets[0].is_active).toBe(false);
    expect(wallets[0].closed_at).toBeTruthy();

    await reopenStonizWalletAction(walletId);
    expect(wallets[0].is_active).toBe(true);
    expect(wallets[0].closed_at).toBeNull();
  });
});
