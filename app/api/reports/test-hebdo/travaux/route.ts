import { handleBriefTestRoute } from '@/lib/reports/brief-test-route';
import { buildTravauxBrief } from '@/lib/reports/brief-travaux';

/**
 * Test one-shot brief TRAVAUX. CEO-only.
 *   - sans paramètre : envoie le mail à othmane@stoniz.co
 *   - `?preview=1`   : affiche le mail dans le navigateur, sans rien envoyer
 */
export async function GET(request: Request) {
  return handleBriefTestRoute(request, {
    build: buildTravauxBrief,
    template_id: 'weekly_brief_travaux',
    slug: 'travaux',
  });
}
