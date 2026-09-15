import { handleBriefTestRoute } from '@/lib/reports/brief-test-route';
import { buildAchatsBrief } from '@/lib/reports/brief-achats';

/**
 * Test one-shot brief ACHATS. CEO-only.
 *   - sans paramètre : envoie le mail à othmane@stoniz.co
 *   - `?preview=1`   : affiche le mail dans le navigateur, sans rien envoyer
 */
export async function GET(request: Request) {
  return handleBriefTestRoute(request, {
    build: buildAchatsBrief,
    template_id: 'weekly_brief_achats',
    slug: 'achats',
  });
}
