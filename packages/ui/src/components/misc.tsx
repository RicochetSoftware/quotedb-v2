import type * as React from 'react'
import { cn } from '../lib/utils'

export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('animate-pulse rounded-md bg-accent', className)} {...props} />
}

export function Alert({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & { variant?: 'default' | 'warning' | 'destructive' }) {
  return (
    <div
      role="alert"
      className={cn(
        'relative w-full rounded-lg border px-4 py-3 text-sm',
        variant === 'warning' && 'border-warning-foreground/30 bg-warning text-warning-foreground',
        variant === 'destructive' && 'border-destructive/40 text-destructive',
        className,
      )}
      {...props}
    />
  )
}

export function EmptyState({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('py-12 text-center text-sm text-muted-foreground', className)} {...props} />
  )
}
