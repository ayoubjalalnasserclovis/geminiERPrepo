import { cn } from '@/lib/utils/cn';

const variants = {
  default:  'bg-stoniz-gray-100 text-stoniz-black',
  success:  'bg-emerald-100 text-emerald-900',
  warning:  'bg-yellow text-stoniz-black',
  error:    'bg-red-100 text-red-900',
  info:     'bg-blue-100 text-blue-900',
  onboarding: 'bg-purple-100 text-purple-900',
  sourcing: 'bg-blue-100 text-blue-900',
  design: 'bg-yellow text-stoniz-black',
  travaux: 'bg-yellow text-stoniz-black',
  livraison: 'bg-emerald-100 text-emerald-900',
  mise_en_location: 'bg-stoniz-gray-200 text-stoniz-black',
  termine: 'bg-stoniz-black text-cream',
};

export function Badge({
  variant = 'default',
  className,
  children,
}: {
  variant?: keyof typeof variants;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium',
      variants[variant],
      className,
    )}>
      {children}
    </span>
  );
}
