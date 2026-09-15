'use client';

import { useState, useTransition } from 'react';
import { Star } from 'lucide-react';
import { toggleBookmarkAction } from '@/app/(team)/projects/bookmark-actions';

export function BookmarkButton({
  projectId, isBookmarked, size = 18,
}: {
  projectId: string;
  isBookmarked: boolean;
  size?: number;
}) {
  const [optimistic, setOptimistic] = useState(isBookmarked);
  const [pending, start] = useTransition();

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOptimistic(o => !o);
    start(async () => {
      const r = await toggleBookmarkAction(projectId);
      if (r.ok) setOptimistic(r.bookmarked);
    });
  }

  return (
    <button onClick={toggle} disabled={pending}
      className="inline-flex items-center justify-center hover:scale-110 transition-transform"
      title={optimistic ? 'Retirer des favoris' : 'Ajouter aux favoris'}>
      <Star className={optimistic
        ? 'fill-yellow-400 text-yellow-500'
        : 'text-stoniz-gray-300 hover:text-yellow-500'}
        style={{ width: size, height: size }} />
    </button>
  );
}
