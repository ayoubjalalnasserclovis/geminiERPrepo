import { redirect } from 'next/navigation';

// Landing /achats redirige vers le dashboard consolide.
// (les saisies se font par projet sur /projects/[id]/achats)
export default function AchatsLandingPage() {
  redirect('/dashboard/achats');
}
