'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';

export async function setTaskStatusAction(taskId: string, status: 'todo'|'in_progress'|'done'|'blocked') {
  await assertRole(['ceo','chef_projet','sourcing','commercial','finance','assistante']);
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const update: any = { status };
  if (status === 'done') {
    update.completed_at = new Date().toISOString();
    update.completed_by = user?.id;
  } else {
    update.completed_at = null;
    update.completed_by = null;
  }

  const { error, data } = await supabase.from('tasks').update(update)
    .eq('id', taskId).select('project_id, partner_id').single();
  if (error) return { ok: false, error: error.message };

  if (data?.project_id) revalidatePath(`/projects/${data.project_id}`);
  revalidatePath('/tasks');
  return { ok: true };
}
