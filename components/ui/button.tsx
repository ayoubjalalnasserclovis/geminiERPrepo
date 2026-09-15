import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

/**
 * Boutons Stoniz — 3 variantes principales selon les brand guidelines :
 *   - primary  : fond noir, texte crème (action standard)
 *   - secondary: bordure noire, fond transparent (action secondaire)
 *   - accent   : fond jaune signature, texte noir (CTA finaux à forte valeur)
 */
const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stoniz-black/30 focus-visible:ring-offset-2 focus-visible:ring-offset-cream disabled:pointer-events-none disabled:opacity-50 text-sm',
  {
    variants: {
      variant: {
        primary: 'bg-stoniz-black text-cream hover:bg-stoniz-gray-800 active:scale-[0.98]',
        secondary: 'bg-transparent border-[1.5px] border-stoniz-black text-stoniz-black hover:bg-stoniz-black/5 active:scale-[0.98]',
        accent: 'bg-yellow text-stoniz-black border-[1.5px] border-stoniz-black hover:brightness-95 active:scale-[0.98]',
        ghost: 'text-stoniz-black hover:bg-stoniz-black/5',
        destructive: 'bg-red-600 text-white hover:bg-red-700',
        link: 'underline text-stoniz-black p-0 h-auto',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-10 px-[18px] py-[10px]',
        lg: 'h-12 px-7 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
);
Button.displayName = 'Button';
