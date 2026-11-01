import type * as React from 'react'
import { cn } from '../lib/utils'
import { Label } from './label'

/** Label + control + error/help text, wired up with ids for accessibility. */
export function Field({
  id,
  label,
  error,
  hint,
  className,
  children,
}: {
  id: string
  label: React.ReactNode
  error?: string | undefined
  hint?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('grid gap-2', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}
