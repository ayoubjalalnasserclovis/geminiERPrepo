import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { ProjectForm } from '@/components/projects/project-form';
import { requireRole } from '@/lib/auth/require';

export default async function NewProjectPage({ searchParams }: { searchParams: { client_id?: string } }) {
  await requireRole(['ceo','chef_projet','commercial']);
  const supabase = createClient();
  const [clientsRes, profilesRes] = await Promise.all([
    supabase.from('clients').select('id, full_name').is('deleted_at', null).order('full_name'),
    supabase.from('profiles').select('id, full_name').eq('role','chef_projet').eq('is_active', true),
  ]);

  return (
    <div className="max-w-2xl">
      <PageHeader title="Nouveau projet" description="L'acompte 5 000 € + les tâches d'onboarding seront créés automatiquement." />
      <ProjectForm
        clients={clientsRes.data ?? []}
        chefs={profilesRes.data ?? []}
        defaultClientId={searchParams.client_id}
      />
    </div>
  );
}
