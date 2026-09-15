import { redirect } from 'next/navigation';

/**
 * CEO 2026-06-10 : la page Réservations a été déplacée vers /propria/reservations
 * pour être accessible directement depuis la sidebar Propria.
 * On garde cette route en redirection pour préserver les éventuels liens existants.
 */
export default function HostawayReservationsRedirect({
  searchParams,
}: { searchParams: { filter?: string; channel?: string } }) {
  const params = new URLSearchParams();
  if (searchParams.filter) params.set('filter', searchParams.filter);
  if (searchParams.channel) params.set('channel', searchParams.channel);
  const qs = params.toString();
  redirect(`/propria/reservations${qs ? `?${qs}` : ''}`);
}
