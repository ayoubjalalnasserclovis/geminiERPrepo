export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border bg-white p-12 text-center">
      <h3 className="font-display text-lg mb-2">{title}</h3>
      {description && <p className="text-sm text-stoniz-gray-500 mb-4">{description}</p>}
      {action}
    </div>
  );
}
