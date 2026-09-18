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

import {
  planVisitAction,
  saveChecklistAction,
  completeVisitAction,
  generateQuarterlyVisitsAction,
} from '@/app/(team)/propria/maintenance/actions';
import type { ChecklistSection } from '@/lib/propria/maintenance-checklist';

describe('Multi-Step Workflow: Propria Maintenance Visits & Completion Locks (BUG-041)', () => {
  const CEO_USER_ID = '11111111-1111-2222-3333-444444444444';
  const TECH_USER_ID = '22222222-1111-2222-3333-444444444444';
  const UNIT_ID = '33333333-1111-2222-3333-444444444444';
  const VISIT_ID = '44444444-1111-2222-3333-444444444444';

  beforeEach(() => {
    mockSupabase = createMockSupabase({
      propria_units: [{ id: UNIT_ID, name: 'Villa Palmeraie' }],
      propria_maintenance_visits: [
        {
          id: VISIT_ID,
          propria_unit_id: UNIT_ID,
          status: 'a_planifier',
          quarter: '2026-Q3',
          scheduled_at: null,
          checklist: null,
          responsable_id: null,
        },
      ],
      profiles: [
        { id: CEO_USER_ID, role: 'ceo', full_name: 'CEO Stoniz' },
        { id: TECH_USER_ID, role: 'propria', full_name: 'Tech Maintenance' },
      ],
    });
    setMockUser('propria', TECH_USER_ID);
  });

  it('Step 1 -> 4: Plan visit -> Fill checklist -> Complete visit -> Verify completed status', async () => {
    // 1. Plan visit date and assign tech
    await planVisitAction(VISIT_ID, '2026-09-25T10:00:00Z', TECH_USER_ID);

    let visit = mockSupabase.db.propria_maintenance_visits.find((v: any) => v.id === VISIT_ID);
    expect(visit.status).toBe('planifie');
    expect(visit.scheduled_at).toBe('2026-09-25T10:00:00Z');
    expect(visit.responsable_id).toBe(TECH_USER_ID);
    expect(visit.checklist).toBeDefined();

    // 2. Perform inspection and save updated checklist notes
    const customChecklist: ChecklistSection[] = [
      {
        key: 'climatisation',
        title: 'Climatisation',
        icon: '❄️',
        items: [
          { key: 'filtres', label: 'Nettoyage des filtres', done: true },
          { key: 'gaz', label: 'Contrôle pression gaz R410A', done: true },
        ],
      },
    ];

    await saveChecklistAction(VISIT_ID, customChecklist, 'Filtres nettoyés, climatiseur chambre 1 fonctionne parfaitement');
    visit = mockSupabase.db.propria_maintenance_visits.find((v: any) => v.id === VISIT_ID);
    expect(visit.notes).toContain('Filtres nettoyés');
    expect(visit.checklist[0].items[0].done).toBe(true);

    // 3. Complete visit
    await completeVisitAction(VISIT_ID);
    visit = mockSupabase.db.propria_maintenance_visits.find((v: any) => v.id === VISIT_ID);
    expect(visit.status).toBe('realise');
    expect(visit.completed_at).toBeDefined();
  });

  it('Guard enforcement: Modification attempts on completed visits must throw (BUG-041)', async () => {
    // Mark visit as completed
    const visit = mockSupabase.db.propria_maintenance_visits.find((v: any) => v.id === VISIT_ID);
    visit.status = 'realise';
    visit.completed_at = new Date().toISOString();

    // 1. Attempt to reschedule completed visit -> MUST FAIL
    await expect(
      planVisitAction(VISIT_ID, '2026-10-01T09:00:00Z', TECH_USER_ID),
    ).rejects.toThrow('Impossible de replanifier une visite déjà réalisée.');

    // 2. Attempt to modify checklist on completed visit -> MUST FAIL
    await expect(
      saveChecklistAction(VISIT_ID, [], 'Changement illégitime'),
    ).rejects.toThrow('Impossible de modifier la checklist d\'une visite déjà réalisée.');

    // 3. Attempt to complete already completed visit -> MUST FAIL
    await expect(
      completeVisitAction(VISIT_ID),
    ).rejects.toThrow('Cette visite est déjà réalisée.');
  });

  it('Quarterly visits automated generation workflow', async () => {
    setMockUser('ceo', CEO_USER_ID);
    const result = await generateQuarterlyVisitsAction();
    expect(result.inserted).toBe(4);
  });
});
