import { handleBriefTestRoute } from '@/lib/reports/brief-test-route';
import { buildProjetsBrief } from '@/lib/reports/brief-projets';

/**
 * Test one-shot brief PROJETS. CEO-only.
 *   - sans paramètre : envoie le mail à othmane@stoniz.co
 *   - `?preview=1`   : affiche le mail dans le navigateur, sans rien envoyer
 */
export async function GET(request: Request) {
  return handleBriefTestRoute(request, {
    build: buildProjetsBrief,
    template_id: 'weekly_brief_projets',
    slug: 'projets',
  });
}
