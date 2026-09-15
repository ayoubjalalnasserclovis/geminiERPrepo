import { cn } from '@/lib/utils/cn';

export function Table({ className, ...props }: React.HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-xl border bg-white">
      <table className={cn('w-full text-sm', className)} {...props} />
    </div>
  );
}

export function THead(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className="bg-stoniz-gray-50 border-b" {...props} />;
}

export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className="divide-y" {...props} />;
}

export function TR(props: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className="hover:bg-stoniz-gray-50/50" {...props} />;
}

export function TH(props: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className="px-4 py-3 text-left font-medium text-stoniz-gray-600 text-xs uppercase tracking-wide" {...props} />;
}

export function TD(props: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className="px-4 py-3" {...props} />;
}
