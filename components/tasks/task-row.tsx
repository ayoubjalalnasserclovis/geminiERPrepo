'use client';

import { useTransition } from 'react';
import { CheckCircle2, Circle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { setTaskStatusAction } from '@/app/(team)/tasks/actions';

export function TaskRow({ task }: { task: any }) {
  const [pending, start] = useTransition();
  const isDone = task.status === 'done';

  return (
    <li className="flex items-center justify-between gap-3 py-2 border-b last:border-0">
      <button
        disabled={pending}
        onClick={() => start(async () => {
          await setTaskStatusAction(task.id, isDone ? 'todo' : 'done');
        })}
        className="flex items-center gap-2 text-left flex-1 min-w-0"
      >
        {isDone
          ? <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
          : <Circle className="w-4 h-4 text-stoniz-gray-400 flex-shrink-0" />}
        <span className={isDone ? 'line-through text-stoniz-gray-500 truncate' : 'truncate'}>
          {task.title}
        </span>
        {task.is_blocking && !isDone && <Badge variant="warning">bloquant</Badge>}
      </button>
      <div className="flex items-center gap-3 text-xs text-stoniz-gray-500">
        {task.assignee && <span>{task.assignee.full_name}</span>}
        {task.due_date && <span>{new Date(task.due_date).toLocaleDateString('fr-FR')}</span>}
        <Badge>{task.priority}</Badge>
      </div>
    </li>
  );
}
