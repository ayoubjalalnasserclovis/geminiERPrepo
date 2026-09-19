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
}));

import { completeOnboardingAction } from '@/app/(client)/client/onboarding/actions';

function createDummyFile(name: string, type = 'application/pdf', size = 1024): File {
  const blob = new Blob(['dummy content'.repeat(Math.ceil(size / 13))], { type });
  return new File([blob], name, { type });
}

describe('Multi-Step Workflow: Client Portal Onboarding, KYC Documents & Compliance', () => {
  const CLIENT_PROFILE_ID = '11111111-2222-3333-4444-555555555555';
  const CLIENT_ROW_ID = '22222222-3333-4444-5555-666666666666';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockSupabase.db.clients = [
      {
        id: CLIENT_ROW_ID,
        profile_id: CLIENT_PROFILE_ID,
        email: 'investor@example.com',
        full_name: 'Mehdi Alami',
        onboarding_completed_at: null,
      },
    ];
    mockSupabase.db.documents = [];
    mockSupabase.db.client_co_investors = [];
  });

  it('Step 1: Nom propre investment KYC with valid piece_identite completes successfully', async () => {
    setMockUser('client', CLIENT_PROFILE_ID);

    const fd = new FormData();
    fd.append('first_name', 'Mehdi');
    fd.append('last_name', 'Alami');
    fd.append('email', 'investor@example.com');
    fd.append('phone', '+212 661 123456');
    fd.append('nationality', 'Marocaine');
    fd.append('credit_type', 'islamic');
    fd.append('available_savings', '500000');
    fd.append('budget_max', '1500000');
    fd.append('expected_rent', '12000');
    fd.append('expected_gross_yield_pct', '9.5');
    fd.append('expected_net_yield_pct', '7.2');
    fd.append('quartiers', 'Gauthier');
    fd.append('quartiers', 'Racine');
    fd.append('investment_holding', 'nom_propre');
    fd.append('investment_party_count', '1');
    fd.append('billing_address_line', '45 Boulevard d’Anfa');
    fd.append('billing_city', 'Casablanca');
    fd.append('billing_postal_code', '20000');
    fd.append('billing_country', 'Maroc');
    fd.append('needs_bank_account_opening', 'no');

    fd.append('piece_identite', createDummyFile('cin.pdf'));

    await completeOnboardingAction(fd);

    const client = mockSupabase.db.clients.find((c: any) => c.id === CLIENT_ROW_ID);
    expect(client.onboarding_completed_at).toBeDefined();
    expect(client.investment_holding).toBe('nom_propre');
    expect(client.budget_max).toBe(1500000);

    expect(mockSupabase.db.documents.length).toBe(1);
  });

  it('Step 2: Corporate entity holding (société) requires company name & registration number', async () => {
    setMockUser('client', CLIENT_PROFILE_ID);

    const fd = new FormData();
    fd.append('first_name', 'Mehdi');
    fd.append('last_name', 'Alami');
    fd.append('email', 'investor@example.com');
    fd.append('phone', '+212 661 123456');
    fd.append('nationality', 'Marocaine');
    fd.append('credit_type', 'no');
    fd.append('available_savings', '2000000');
    fd.append('budget_max', '3000000');
    fd.append('expected_rent', '25000');
    fd.append('expected_gross_yield_pct', '10');
    fd.append('expected_net_yield_pct', '8');
    fd.append('quartiers', 'Hivernage');
    fd.append('investment_holding', 'societe');
    // Missing company name and registration
    fd.append('investment_party_count', '1');
    fd.append('billing_address_line', 'Avenue Mohammed VI');
    fd.append('billing_city', 'Marrakech');
    fd.append('billing_postal_code', '40000');
    fd.append('billing_country', 'Maroc');
    fd.append('needs_bank_account_opening', 'yes');

    fd.append('piece_identite', createDummyFile('passport.pdf'));

    const res = await completeOnboardingAction(fd);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Raison sociale requise');
  });

  it('Step 3: Société holding with valid company info completes successfully', async () => {
    setMockUser('client', CLIENT_PROFILE_ID);

    const fd = new FormData();
    fd.append('first_name', 'Mehdi');
    fd.append('last_name', 'Alami');
    fd.append('email', 'investor@example.com');
    fd.append('phone', '+212 661 123456');
    fd.append('nationality', 'Marocaine');
    fd.append('credit_type', 'yes');
    fd.append('available_savings', '1000000');
    fd.append('budget_max', '2500000');
    fd.append('expected_rent', '20000');
    fd.append('expected_gross_yield_pct', '9.0');
    fd.append('expected_net_yield_pct', '7.0');
    fd.append('quartiers', 'Guéliz');
    fd.append('investment_holding', 'societe');
    fd.append('company_name', 'Atlas Horizon SARL');
    fd.append('company_registration_number', 'RC-998877-CAS');
    fd.append('investment_party_count', '1');
    fd.append('billing_address_line', 'Zone Industrielle Sidi Ghanem');
    fd.append('billing_city', 'Marrakech');
    fd.append('billing_postal_code', '40000');
    fd.append('billing_country', 'Maroc');
    fd.append('needs_bank_account_opening', 'yes');
    fd.append('bank_account_notes', 'Besoin d’ouverture compte devises convertible');

    fd.append('piece_identite', createDummyFile('cin.pdf'));

    await completeOnboardingAction(fd);

    const client = mockSupabase.db.clients.find((c: any) => c.id === CLIENT_ROW_ID);
    expect(client.company_name).toBe('Atlas Horizon SARL');
    expect(client.company_registration_number).toBe('RC-998877-CAS');
    expect(client.onboarding_completed_at).toBeDefined();
  });

  it('Step 4: Rejection of unsupported file format (e.g. .exe or .zip)', async () => {
    setMockUser('client', CLIENT_PROFILE_ID);

    const fd = new FormData();
    fd.append('first_name', 'Mehdi');
    fd.append('last_name', 'Alami');
    fd.append('email', 'investor@example.com');
    fd.append('phone', '+212 661 123456');
    fd.append('nationality', 'Marocaine');
    fd.append('credit_type', 'no');
    fd.append('available_savings', '500000');
    fd.append('budget_max', '1000000');
    fd.append('expected_rent', '10000');
    fd.append('expected_gross_yield_pct', '8');
    fd.append('expected_net_yield_pct', '6');
    fd.append('quartiers', 'Agdal');
    fd.append('investment_holding', 'nom_propre');
    fd.append('investment_party_count', '1');
    fd.append('billing_address_line', 'Avenue des Nations Unies');
    fd.append('billing_city', 'Rabat');
    fd.append('billing_postal_code', '10000');
    fd.append('billing_country', 'Maroc');
    fd.append('needs_bank_account_opening', 'no');

    // Invalid format
    fd.append('piece_identite', createDummyFile('malware.exe', 'application/x-msdownload'));

    const res = await completeOnboardingAction(fd);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('format non supporté');
  });

  it('Step 5: File size limit enforcement (> 25MB rejected)', async () => {
    setMockUser('client', CLIENT_PROFILE_ID);

    const fd = new FormData();
    fd.append('first_name', 'Mehdi');
    fd.append('last_name', 'Alami');
    fd.append('email', 'investor@example.com');
    fd.append('phone', '+212 661 123456');
    fd.append('nationality', 'Marocaine');
    fd.append('credit_type', 'no');
    fd.append('available_savings', '500000');
    fd.append('budget_max', '1000000');
    fd.append('expected_rent', '10000');
    fd.append('expected_gross_yield_pct', '8');
    fd.append('expected_net_yield_pct', '6');
    fd.append('quartiers', 'Agdal');
    fd.append('investment_holding', 'nom_propre');
    fd.append('investment_party_count', '1');
    fd.append('billing_address_line', 'Rue Al Ryad');
    fd.append('billing_city', 'Rabat');
    fd.append('billing_postal_code', '10000');
    fd.append('billing_country', 'Maroc');
    fd.append('needs_bank_account_opening', 'no');

    // Oversized 26MB file
    const oversizedFile = createDummyFile('huge.pdf', 'application/pdf', 26 * 1024 * 1024);
    fd.append('piece_identite', oversizedFile);

    const res = await completeOnboardingAction(fd);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('trop volumineuse (max 25 MB)');
  });

  it('Step 6: Phone number international format validation regex', async () => {
    setMockUser('client', CLIENT_PROFILE_ID);

    const fd = new FormData();
    fd.append('first_name', 'Mehdi');
    fd.append('last_name', 'Alami');
    fd.append('email', 'investor@example.com');
    // Local format without country code '+'
    fd.append('phone', '0661123456');
    fd.append('nationality', 'Marocaine');
    fd.append('credit_type', 'no');
    fd.append('available_savings', '500000');
    fd.append('budget_max', '1000000');
    fd.append('expected_rent', '10000');
    fd.append('expected_gross_yield_pct', '8');
    fd.append('expected_net_yield_pct', '6');
    fd.append('quartiers', 'Agdal');
    fd.append('investment_holding', 'nom_propre');
    fd.append('investment_party_count', '1');
    fd.append('billing_address_line', 'Rue Al Ryad');
    fd.append('billing_city', 'Rabat');
    fd.append('billing_postal_code', '10000');
    fd.append('billing_country', 'Maroc');
    fd.append('needs_bank_account_opening', 'no');

    fd.append('piece_identite', createDummyFile('cin.pdf'));

    const res = await completeOnboardingAction(fd);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('format international');
  });

  it('Step 7: Role protection: team roles cannot complete client onboarding', async () => {
    setMockUser('chef_projet', '99999999-1111-2222-3333-444444444444');

    const fd = new FormData();
    await expect(completeOnboardingAction(fd)).rejects.toThrow('Permission refusée');
  });

  it('Step 8: Missing piece_identite file is detected and rejected', async () => {
    setMockUser('client', CLIENT_PROFILE_ID);

    const fd = new FormData();
    fd.append('first_name', 'Mehdi');
    fd.append('last_name', 'Alami');
    fd.append('email', 'investor@example.com');
    fd.append('phone', '+212 661 123456');
    fd.append('nationality', 'Marocaine');
    fd.append('credit_type', 'no');
    fd.append('available_savings', '500000');
    fd.append('budget_max', '1000000');
    fd.append('expected_rent', '10000');
    fd.append('expected_gross_yield_pct', '8');
    fd.append('expected_net_yield_pct', '6');
    fd.append('quartiers', 'Agdal');
    fd.append('investment_holding', 'nom_propre');
    fd.append('investment_party_count', '1');
    fd.append('billing_address_line', 'Rue Al Ryad');
    fd.append('billing_city', 'Rabat');
    fd.append('billing_postal_code', '10000');
    fd.append('billing_country', 'Maroc');
    fd.append('needs_bank_account_opening', 'no');
    // piece_identite omitted!

    const res = await completeOnboardingAction(fd);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Votre pièce d\'identité requise');
  });

  it('Step 9: Yield bounds enforcement (> 100% yield is rejected)', async () => {
    setMockUser('client', CLIENT_PROFILE_ID);

    const fd = new FormData();
    fd.append('first_name', 'Mehdi');
    fd.append('last_name', 'Alami');
    fd.append('email', 'investor@example.com');
    fd.append('phone', '+212 661 123456');
    fd.append('nationality', 'Marocaine');
    fd.append('credit_type', 'no');
    fd.append('available_savings', '500000');
    fd.append('budget_max', '1000000');
    fd.append('expected_rent', '10000');
    fd.append('expected_gross_yield_pct', '150'); // absurd yield
    fd.append('expected_net_yield_pct', '6');
    fd.append('quartiers', 'Agdal');
    fd.append('investment_holding', 'nom_propre');
    fd.append('investment_party_count', '1');
    fd.append('billing_address_line', 'Rue Al Ryad');
    fd.append('billing_city', 'Rabat');
    fd.append('billing_postal_code', '10000');
    fd.append('billing_country', 'Maroc');
    fd.append('needs_bank_account_opening', 'no');

    fd.append('piece_identite', createDummyFile('cin.pdf'));

    const res = await completeOnboardingAction(fd);
    expect(res.ok).toBe(false);
  });

  it('Step 10: Guard enforcement: Resubmission rejected once onboarding is completed', async () => {
    setMockUser('client', CLIENT_PROFILE_ID);

    // Mark client as already completed
    mockSupabase.db.clients[0].onboarding_completed_at = new Date().toISOString();

    const fd = new FormData();
    fd.append('first_name', 'Mehdi');
    fd.append('last_name', 'Alami');
    fd.append('email', 'investor@example.com');
    fd.append('phone', '+212 661 123456');
    fd.append('nationality', 'Marocaine');
    fd.append('credit_type', 'islamic');
    fd.append('available_savings', '800000');
    fd.append('budget_max', '2000000');
    fd.append('expected_rent', '15000');
    fd.append('expected_gross_yield_pct', '10.0');
    fd.append('expected_net_yield_pct', '8.0');
    fd.append('quartiers', 'Palmier');
    fd.append('investment_holding', 'nom_propre');
    fd.append('investment_party_count', '1');
    fd.append('billing_address_line', 'Boulevard Roudani');
    fd.append('billing_city', 'Casablanca');
    fd.append('billing_postal_code', '20000');
    fd.append('billing_country', 'Maroc');
    fd.append('needs_bank_account_opening', 'no');

    fd.append('piece_identite', createDummyFile('cin_updated.pdf'));

    const res = await completeOnboardingAction(fd);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Onboarding déjà complété');
  });
});
