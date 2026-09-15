'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';

export async function toggleBookmarkAction(projectId: string) {
  const me = await assertRole(['ceo','chef_projet','commercial','finance','marketing','assistante','achats']);
  const supabase = createClient();

  const { data: existing } = await supabase
    .from('project_bookmarks')
    .select('id')
    .eq('user_id', me.id)
    .eq('project_id', projectId)
    .maybeSingle();

  if (existing) {
    await supabase.from('project_bookmarks').delete().eq('id', existing.id);
  } else {
    await supabase.from('project_bookmarks').insert({ user_id: me.id, project_id: projectId });
  }

  revalidatePath('/projects');
  revalidatePath(`/projects/${projectId}`);
  return { ok: true, bookmarked: !existing };
}
