export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
      <div>
        <h1 className="font-display text-3xl">{title}</h1>
        {description && <p className="text-stoniz-gray-500 mt-1">{description}</p>}
      </div>
      {action}
    </div>
  );
}
