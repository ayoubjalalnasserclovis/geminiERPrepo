import 'server-only';
import { createClient as createSupabase } from '@supabase/supabase-js';

/**
 * Client Supabase avec service_role — bypasse le RLS.
 * NE JAMAIS importer dans un Server/Client Component normal.
 * Usage : webhooks Resend, invitations admin, jobs cron.
 */
export function createAdminClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }

  return createSupabase(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}
