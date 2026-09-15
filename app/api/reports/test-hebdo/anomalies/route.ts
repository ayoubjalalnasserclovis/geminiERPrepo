import { handleBriefTestRoute } from '@/lib/reports/brief-test-route';
import { buildAnomaliesBrief } from '@/lib/reports/brief-anomalies';

/**
 * Test one-shot brief ANOMALIES. CEO-only.
 *   - sans paramètre : envoie le mail à othmane@stoniz.co
 *   - `?preview=1`   : affiche le mail dans le navigateur, sans rien envoyer
 */
export async function GET(request: Request) {
  return handleBriefTestRoute(request, {
    build: buildAnomaliesBrief,
    template_id: 'weekly_brief_anomalies',
    slug: 'anomalies',
  });
}
