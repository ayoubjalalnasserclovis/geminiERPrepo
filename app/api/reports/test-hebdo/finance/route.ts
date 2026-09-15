import { handleBriefTestRoute } from '@/lib/reports/brief-test-route';
import { buildFinanceBrief } from '@/lib/reports/brief-finance';

/**
 * Test one-shot brief FINANCE. CEO-only.
 *   - sans paramètre : envoie le mail à othmane@stoniz.co
 *   - `?preview=1`   : affiche le mail dans le navigateur, sans rien envoyer
 */
export async function GET(request: Request) {
  return handleBriefTestRoute(request, {
    build: buildFinanceBrief,
    template_id: 'weekly_brief_finance',
    slug: 'finance',
  });
}
