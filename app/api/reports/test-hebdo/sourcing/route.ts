import { handleBriefTestRoute } from '@/lib/reports/brief-test-route';
import { buildSourcingBrief } from '@/lib/reports/brief-sourcing';

/**
 * Test one-shot brief SOURCING. CEO-only.
 *   - sans paramètre : envoie le mail à othmane@stoniz.co
 *   - `?preview=1`   : affiche le mail dans le navigateur, sans rien envoyer
 */
export async function GET(request: Request) {
  return handleBriefTestRoute(request, {
    build: buildSourcingBrief,
    template_id: 'weekly_brief_sourcing',
    slug: 'sourcing',
  });
}
