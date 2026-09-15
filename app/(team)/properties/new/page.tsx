import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { PropertyForm } from '@/components/properties/property-form';
import { requireRole } from '@/lib/auth/require';

export default async function NewPropertyPage() {
  await requireRole(['ceo','chef_projet','sourcing']);
  const supabase = createClient();
  const [partnersRes, chasseursRes] = await Promise.all([
    supabase.from('partners').select('id, agency_name')
      .eq('status', 'actif').is('deleted_at', null)
      .order('agency_name'),
    // Chasseurs Stoniz = profiles avec rôle sourcing ou commercial actifs
    supabase.from('profiles').select('id, full_name')
      .in('role', ['sourcing', 'commercial', 'ceo', 'chef_projet'])
      .eq('is_active', true)
      .order('full_name'),
  ]);

  return (
    <div className="max-w-3xl">
      <PageHeader title="Nouveau bien" />
      <PropertyForm
        partners={partnersRes.data ?? []}
        chasseurs={chasseursRes.data ?? []}
      />
    </div>
  );
}
