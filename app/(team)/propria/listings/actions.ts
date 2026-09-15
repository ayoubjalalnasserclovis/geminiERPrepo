'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { normalizeFormData as clean } from '@/lib/validators/zod-helpers';

const schema = z.object({
  propria_unit_id: z.string().uuid(),
  platform: z.enum(['airbnb','booking','vrbo','direct']),
  measured_at: z.string(),
  rating: z.coerce.number().min(0).max(5).optional().nullable(),
  nb_reviews: z.coerce.number().int().min(0).optional().nullable(),
  occupancy_rate: z.coerce.number().min(0).max(100).optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function createListingMetricAction(formData: FormData) {
  await assertRole(['ceo','propria','assistante']);
  const data = schema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();
  const { error } = await supabase
    .from('propria_listing_metrics')
    .upsert({ ...data, property_id: null } as any, { onConflict: 'propria_unit_id,platform,measured_at' });
  if (error) throw new Error(error.message);
  revalidatePath('/propria/listings');
}
