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

vi.mock('@/lib/email/templates', () => ({
  sendPaymentApprovalRequested: vi.fn().mockResolvedValue(true),
  sendPaymentApprovalDecision: vi.fn().mockResolvedValue(true),
  sendPaymentMarkedPaid: vi.fn().mockResolvedValue(true),
  sendPaymentReceivedToClient: vi.fn().mockResolvedValue(true),
}));

import { createArtisanAction } from '@/app/(team)/artisans/actions';
import {
  createLotAction,
  updateLotAction,
  bulkChangeTravauxStatusAction,
  saveAcompteAction,
} from '@/app/(team)/projects/[id]/travaux/actions';
import {
  requestApprovalAction,
  financeReviewAction,
  ceoApproveAction,
  markApprovalAsPaidAction,
} from '@/app/(team)/validations/actions';

describe('Multi-Step Workflow: Artisan Compliance -> Lot Invoice Gate -> Approval -> Payout', () => {
  const PROJECT_ID = 'aaaaaaaa-2222-3333-4444-555555555555';
  const ARTISAN_ID = 'bbbbbbbb-2222-3333-4444-555555555555';

  beforeEach(() => {
    mockSupabase = createMockSupabase({
      projects: [
        {
          id: PROJECT_ID,
          reference: 'PRJ-2026-RABAT',
          status: 'actif',
        },
      ],
      profiles: [
        { id: 'usr-ceo-1', email: 'ceo@stoniz.co', full_name: 'Ayoub CEO', role: 'ceo', is_active: true },
        { id: 'usr-finance-1', email: 'finance@stoniz.co', full_name: 'Hamza Finance', role: 'finance', is_active: true },
        { id: 'usr-chef-1', email: 'chef@stoniz.co', full_name: 'Youssef Chef', role: 'chef_projet', is_active: true },
      ],
      artisans: [
        {
          id: ARTISAN_ID,
          name: 'Atlas Electricité SARL',
          legal_form: 'sarl',
          type: 'artisan_local',
          business_scope: 'travaux',
          speciality: 'electricite',
          // Missing bank_name and RIB initially
          bank_name: null,
          rib: null,
          status: 'actif',
        },
      ],
      travaux_lots: [],
      travaux_payments: [],
      documents: [],
      payment_approvals: [],
      finance_audit_log: [],
    });
    setMockUser('chef_projet', 'usr-chef-1');
  });

  it('enforces compliance, single and bulk invoice gates, and multi-tier approval payment workflow', async () => {
    // Step 1: Create travaux lot for the project
    const createLotRes = await createLotAction({
      project_id: PROJECT_ID,
      category: 'Electricité',
      artisan_name: 'Atlas Electricité SARL',
      artisan_id: ARTISAN_ID,
      devis_artisan_mad: 35000,
      status: 'a_planifier',
    });
    expect(createLotRes.ok).toBe(true);

    const lots = mockSupabase.db.travaux_lots;
    expect(lots).toHaveLength(1);
    const lotId = lots[0].id;
    expect(lots[0].status).toBe('a_planifier');

    // Step 2: Invoice Gate check (Single lot update)
    // Attempting to move lot to 'en_cours' without uploading a facture_artisan must be BLOCKED
    const blockedSingleUpdate = await updateLotAction(lotId, {
      status: 'en_cours',
    });
    expect(blockedSingleUpdate.ok).toBe(false);
    expect(blockedSingleUpdate.error).toContain('aucune facture artisan');

    // Step 3: Test BUG-030 fix: Bulk status update must ALSO enforce invoice gate
    const blockedBulkUpdate = await bulkChangeTravauxStatusAction({
      lot_ids: [lotId],
      status: 'demarre',
    });
    expect(blockedBulkUpdate.ok).toBe(false);
    expect((blockedBulkUpdate as any).error).toContain('aucune facture artisan');
    expect(lots[0].status).toBe('a_planifier');

    // Step 4: Upload artisan invoice document
    mockSupabase.db.documents.push({
      id: 'doc-inv-1',
      lot_id: lotId,
      project_id: PROJECT_ID,
      type: 'facture_artisan',
      name: 'Facture_Atlas_Electricite_Acompte1.pdf',
      deleted_at: null,
    });

    // Step 5: Now transition to active succeeds
    const successUpdate = await updateLotAction(lotId, {
      status: 'en_cours',
    });
    expect(successUpdate.ok).toBe(true);
    expect(lots[0].status).toBe('en_cours');

    // Step 6: Plan acompte (acompte #1: 15,000 MAD)
    const saveAcompteRes = await saveAcompteAction({
      lot_id: lotId,
      acompte_number: 1,
      amount_total: 15000,
      scheduled_date: '2026-09-30',
      notes: 'Premier acompte début des saignées',
    });
    expect(saveAcompteRes.ok).toBe(true);

    const payments = mockSupabase.db.travaux_payments;
    expect(payments).toHaveLength(1);
    const paymentId = payments[0].id;
    expect(payments[0].amount_total).toBe(15000);
    expect(payments[0].status).toBe('pending');

    // Step 7: Request payment validation without complete artisan compliance (missing RIB / tax attestation)
    const blockedApproval = await requestApprovalAction({
      source: 'travaux_payment',
      source_id: paymentId,
      project_id: PROJECT_ID,
      amount: 15000,
      currency: 'MAD',
      beneficiary_name: 'Atlas Electricité SARL',
      payer_account: 'stz_oj',
    });
    expect(blockedApproval.ok).toBe(false);
    expect((blockedApproval as any).error).toContain('Fiche artisan incomplète pour paiement');

    // Step 8: Complete artisan compliance records
    const artisan = mockSupabase.db.artisans.find((a: any) => a.id === ARTISAN_ID);
    artisan.bank_name = 'Attijariwafa Bank';
    artisan.rib = '007780000123456789012345';

    // Add administrative documents for SARL (RIB certificate + Tax compliance certificate)
    mockSupabase.db.documents.push(
      {
        id: 'doc-rib-1',
        artisan_id: ARTISAN_ID,
        type: 'attestation_rib',
        name: 'Attestation_RIB_Attijari.pdf',
        deleted_at: null,
      },
      {
        id: 'doc-fiscale-1',
        artisan_id: ARTISAN_ID,
        type: 'attestation_regularite_fiscale',
        name: 'Attestation_Fiscale_2026.pdf',
        deleted_at: null,
      }
    );

    // Step 9: Submit approval request with compliance satisfied
    const successApproval = await requestApprovalAction({
      source: 'travaux_payment',
      source_id: paymentId,
      project_id: PROJECT_ID,
      amount: 15000,
      currency: 'MAD',
      beneficiary_name: 'Atlas Electricité SARL',
      payer_account: 'stz_oj',
    });
    expect(successApproval.ok).toBe(true);
    const approvalId = (successApproval as any).id;

    const approvals = mockSupabase.db.payment_approvals;
    expect(approvals).toHaveLength(1);
    expect(approvals[0].amount).toBe(15000);
    expect(approvals[0].payer_account).toBe('stz_oj');

    // Step 10: Multi-tier review: Finance reviews & approves
    setMockUser('finance', 'usr-finance-1');
    const financeRes = await financeReviewAction(approvalId, 'approved', 'RIB et facture vérifiés');
    expect(financeRes.ok).toBe(true);
    expect(approvals[0].finance_status).toBe('approved');

    // Step 11: CEO gives final approval
    setMockUser('ceo', 'usr-ceo-1');
    const ceoRes = await ceoApproveAction(approvalId, 'approved', 'Accord pour virement 15k');
    expect(ceoRes.ok).toBe(true);
    expect(approvals[0].ceo_status).toBe('approved');
    expect(approvals[0].final_status).toBe('approved');

    // Step 12: CEO marks paid with wire transfer reference
    const fdPaid = new FormData();
    fdPaid.set('payment_method', 'virement');
    fdPaid.set('payment_reference', 'VIR-ATTIJARI-987654');
    const paidRes = await markApprovalAsPaidAction(approvalId, fdPaid);
    expect(paidRes.ok).toBe(true);

    expect(approvals[0].paid_at).toBeTruthy();
    expect(approvals[0].payment_reference).toBe('VIR-ATTIJARI-987654');

    // Target payment record is synchronized
    expect(payments[0].status).toBe('paid');
    expect(payments[0].amount_paid).toBe(15000);
    expect(payments[0].paid_at).toBeTruthy();

    // Verify audit trail entries
    const auditLogs = mockSupabase.db.finance_audit_log;
    expect(auditLogs.length).toBeGreaterThan(0);
    expect(auditLogs.some((l: any) => l.action === 'validate' || l.action === 'status_change')).toBe(true);
  });
});
