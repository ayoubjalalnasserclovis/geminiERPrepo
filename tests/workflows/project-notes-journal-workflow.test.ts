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
  addProjectNoteAction,
  updateProjectNoteAction,
  deleteProjectNoteAction,
} from '@/app/(team)/projects/[id]/notes/actions';

describe('Multi-Step Workflow: Project Site Journal, Note Permissions & CEO Overrides', () => {
  const PROJECT_ID = '11111111-2222-3333-4444-555555555555';
  const CHEF_1_ID = '22222222-1111-2222-3333-444444444444';
  const CHEF_2_ID = '33333333-1111-2222-3333-444444444444';
  const CEO_ID = '44444444-1111-2222-3333-444444444444';
  const CLIENT_ID = '55555555-1111-2222-3333-444444444444';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockSupabase.db.project_notes = [];
    mockSupabase.db.projects = [
      { id: PROJECT_ID, title: 'Appartement Racine', deleted_at: null },
    ];
  });

  it('Step 1: Chef de projet 1 creates a site observation note', async () => {
    setMockUser('chef_projet', CHEF_1_ID);

    const res = await addProjectNoteAction({
      project_id: PROJECT_ID,
      body: 'Passage sur chantier ce matin : plomberie terminée dans la salle de bain principale.',
      category: 'suivi_chantier',
      pinned: false,
    });
    expect(res.ok).toBe(true);

    const notes = mockSupabase.db.project_notes;
    expect(notes.length).toBe(1);
    expect(notes[0].author_id).toBe(CHEF_1_ID);
    expect(notes[0].category).toBe('suivi_chantier');
    expect(notes[0].pinned).toBe(false);
  });

  it('Step 2: Chef de projet 1 successfully edits their own note', async () => {
    mockSupabase.db.project_notes.push({
      id: 'note-1',
      project_id: PROJECT_ID,
      author_id: CHEF_1_ID,
      body: 'Texte initial',
      category: 'note',
      pinned: false,
    });

    setMockUser('chef_projet', CHEF_1_ID);
    const res = await updateProjectNoteAction('note-1', {
      body: 'Texte initial corrigé avec précisions sur le lot électricité',
      category: 'suivi_chantier',
    });
    expect(res.ok).toBe(true);

    const note = mockSupabase.db.project_notes.find((n: any) => n.id === 'note-1');
    expect(note.body).toContain('corrigé');
    expect(note.category).toBe('suivi_chantier');
  });

  it('Step 3: Chef de projet 2 attempts to edit Chef 1 note -> BLOCKED by author check', async () => {
    mockSupabase.db.project_notes.push({
      id: 'note-1',
      project_id: PROJECT_ID,
      author_id: CHEF_1_ID,
      body: 'Rapport officiel Chef 1',
      category: 'suivi_chantier',
    });

    setMockUser('chef_projet', CHEF_2_ID);
    const res = await updateProjectNoteAction('note-1', {
      body: 'Altération non autorisée par un collègue',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Seul l\'auteur ou le CEO peut modifier cette note');

    const note = mockSupabase.db.project_notes.find((n: any) => n.id === 'note-1');
    expect(note.body).toBe('Rapport officiel Chef 1');
  });

  it('Step 4: CEO can override and edit any author note', async () => {
    mockSupabase.db.project_notes.push({
      id: 'note-1',
      project_id: PROJECT_ID,
      author_id: CHEF_1_ID,
      body: 'Rapport Chef 1',
      category: 'suivi_chantier',
    });

    setMockUser('ceo', CEO_ID);
    const res = await updateProjectNoteAction('note-1', {
      body: 'Annotation CEO : budget validé après vérification avec le fournisseur.',
    });
    expect(res.ok).toBe(true);

    const note = mockSupabase.db.project_notes.find((n: any) => n.id === 'note-1');
    expect(note.body).toContain('Annotation CEO');
  });

  it('Step 5: Pinning and unpinning critical alert notes', async () => {
    mockSupabase.db.project_notes.push({
      id: 'note-1',
      project_id: PROJECT_ID,
      author_id: CHEF_1_ID,
      body: 'Attention : coupure d’eau annoncée mardi par la Lydec',
      category: 'alerte',
      pinned: false,
    });

    setMockUser('chef_projet', CHEF_1_ID);

    // Pin note
    const pinRes = await updateProjectNoteAction('note-1', { pinned: true });
    expect(pinRes.ok).toBe(true);
    let note = mockSupabase.db.project_notes.find((n: any) => n.id === 'note-1');
    expect(note.pinned).toBe(true);

    // Unpin note
    const unpinRes = await updateProjectNoteAction('note-1', { pinned: false });
    expect(unpinRes.ok).toBe(true);
    note = mockSupabase.db.project_notes.find((n: any) => n.id === 'note-1');
    expect(note.pinned).toBe(false);
  });

  it('Step 6: Chef de projet 2 attempts to delete Chef 1 note -> BLOCKED', async () => {
    mockSupabase.db.project_notes.push({
      id: 'note-1',
      project_id: PROJECT_ID,
      author_id: CHEF_1_ID,
      body: 'Rapport confidentiel',
    });

    setMockUser('chef_projet', CHEF_2_ID);
    const res = await deleteProjectNoteAction('note-1');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Seul l\'auteur ou le CEO peut supprimer cette note');

    const note = mockSupabase.db.project_notes.find((n: any) => n.id === 'note-1');
    expect(note.deleted_at).toBeUndefined();
  });

  it('Step 7: Author or CEO can delete note cleanly (soft-delete)', async () => {
    mockSupabase.db.project_notes.push({
      id: 'note-1',
      project_id: PROJECT_ID,
      author_id: CHEF_1_ID,
      body: 'Note temporaire',
    });

    setMockUser('chef_projet', CHEF_1_ID);
    const delRes = await deleteProjectNoteAction('note-1');
    expect(delRes.ok).toBe(true);

    const note = mockSupabase.db.project_notes.find((n: any) => n.id === 'note-1');
    expect(note.deleted_at).toBeDefined();
  });

  it('Step 8: Empty note body is rejected by schema validator', async () => {
    setMockUser('chef_projet', CHEF_1_ID);

    const res = await addProjectNoteAction({
      project_id: PROJECT_ID,
      body: '',
      category: 'note',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Note vide');
  });

  it('Step 9: Note exceeding 5000 characters is rejected by length guard', async () => {
    setMockUser('chef_projet', CHEF_1_ID);

    const hugeBody = 'A'.repeat(5001);
    const res = await addProjectNoteAction({
      project_id: PROJECT_ID,
      body: hugeBody,
      category: 'note',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Note trop longue');
  });

  it('Step 10: Client role is unauthorized to create or manage project internal notes', async () => {
    setMockUser('client', CLIENT_ID);

    await expect(
      addProjectNoteAction({
        project_id: PROJECT_ID,
        body: 'Tentative d’écriture de note interne par client',
        category: 'interne',
      }),
    ).rejects.toThrow('Permission refusée');
  });
});
