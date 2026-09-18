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
  createWalletAction,
  closeWalletAction,
  createDotationAction,
  createExpenseAction,
  validateExpenseAction,
  validateAllExpensesForWalletAction,
} from '@/app/(team)/propria/caisse/actions';

describe('Multi-Step Workflow: Propria Caisse -> Wallet Lifecycle -> Dotation -> Clôture Locks (BUG-037)', () => {
  const PROPRIA_USER_ID = '99999999-1111-2222-3333-444444444444';
  const CEO_USER_ID = '88888888-1111-2222-3333-444444444444';
  const UNIT_ID = '77777777-1111-2222-3333-444444444444';

  beforeEach(() => {
    mockSupabase = createMockSupabase({
      propria_units: [{ id: UNIT_ID, name: 'Villa 10' }],
      propria_wallets: [],
      propria_wallet_dotations: [],
      propria_wallet_expenses: [],
      propria_audit_log: [],
    });
    setMockUser('ceo', CEO_USER_ID);
  });

  it('manages petty cash wallet lifecycle and blocks operations once closed', async () => {
    // 1. CEO opens a petty cash wallet for a field technician
    const walletForm = new FormData();
    walletForm.append('profile_id', PROPRIA_USER_ID);
    walletForm.append('label', 'Caisse Terrain Marrakech Ouest');
    walletForm.append('notes', 'Dotation mensuelle entretien');

    await createWalletAction(walletForm);

    const wallets = mockSupabase.db.propria_wallets;
    expect(wallets).toHaveLength(1);
    const wallet = wallets[0];
    expect(wallet.label).toBe('Caisse Terrain Marrakech Ouest');
    expect(wallet.is_active).toBe(true);

    // 2. CEO supplies dotation of 2000 MAD
    const dotationForm = new FormData();
    dotationForm.append('wallet_id', wallet.id);
    dotationForm.append('given_at', '2026-09-01');
    dotationForm.append('amount_mad', '2000');
    dotationForm.append('type', 'dotation');
    dotationForm.append('note', 'Initialisation caisse');

    const dotRes = await createDotationAction(dotationForm);
    expect(dotRes.ok).toBe(true);
    expect(mockSupabase.db.propria_wallet_dotations).toHaveLength(1);

    // 3. Field technician logs an expense with receipt
    setMockUser('propria', PROPRIA_USER_ID);
    const expenseForm = new FormData();
    expenseForm.append('wallet_id', wallet.id);
    expenseForm.append('spent_at', '2026-09-03');
    expenseForm.append('description', 'Ampoules LED et quincaillerie');
    expenseForm.append('amount_mad', '350');
    expenseForm.append('propria_unit_id', UNIT_ID);
    expenseForm.append('charge_to', 'propria');
    expenseForm.append('receipt_path', 'propria/wallets/receipts/ampoules.jpg');

    const expRes = await createExpenseAction(expenseForm);
    expect(expRes.ok).toBe(true);
    expect(mockSupabase.db.propria_wallet_expenses).toHaveLength(1);
    const exp = mockSupabase.db.propria_wallet_expenses[0];
    expect(exp.amount_mad).toBe(350);
    expect(exp.is_validated).toBeFalsy();

    // 4. CEO validates the expense
    setMockUser('ceo', CEO_USER_ID);
    const valRes = await validateExpenseAction(exp.id, wallet.id);
    expect(valRes.ok).toBe(true);

    const afterVal = mockSupabase.db.propria_wallet_expenses.find((e: any) => e.id === exp.id);
    expect(afterVal.is_validated).toBe(true);

    // 5. CEO closes the wallet at month end
    const closeRes = await closeWalletAction(wallet.id);
    expect(closeRes.ok).toBe(true);

    const closedWallet = mockSupabase.db.propria_wallets.find((w: any) => w.id === wallet.id);
    expect(closedWallet.is_active).toBe(false);
    expect(closedWallet.closed_at).toBeDefined();

    // 6. Attempt to create dotation on closed wallet -> MUST FAIL (BUG-037)
    const dotationClosedForm = new FormData();
    dotationClosedForm.append('wallet_id', wallet.id);
    dotationClosedForm.append('given_at', '2026-09-05');
    dotationClosedForm.append('amount_mad', '1000');
    dotationClosedForm.append('type', 'rechargement');

    const dotClosedRes = await createDotationAction(dotationClosedForm);
    expect(dotClosedRes.ok).toBe(false);
    expect((dotClosedRes as any).error).toBe('Cette caisse est clôturée et ne peut plus enregistrer d\'opérations.');

    // 7. Attempt to create expense on closed wallet -> MUST FAIL (BUG-037)
    setMockUser('propria', PROPRIA_USER_ID);
    const expenseClosedForm = new FormData();
    expenseClosedForm.append('wallet_id', wallet.id);
    expenseClosedForm.append('spent_at', '2026-09-06');
    expenseClosedForm.append('description', 'Produits entretien');
    expenseClosedForm.append('amount_mad', '150');

    const expClosedRes = await createExpenseAction(expenseClosedForm);
    expect(expClosedRes.ok).toBe(false);
    expect((expClosedRes as any).error).toBe('Cette caisse est clôturée et ne peut plus enregistrer d\'opérations.');
  });
});
