// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from '../src/components/button'
import { Checkbox } from '../src/components/checkbox'
import {
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../src/components/dialog'
import { Field } from '../src/components/field'
import { Input, NativeSelect, Textarea } from '../src/components/input'

function ConfirmationExample({
  destructive,
  onConfirm,
}: {
  destructive: boolean
  onConfirm: () => void
}) {
  const [open, setOpen] = useState(true)
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title="Revoke token?"
      description="Clients using this token will lose access."
      destructive={destructive}
      confirmLabel="Revoke"
      onConfirm={onConfirm}
    />
  )
}

afterEach(cleanup)

describe('form controls', () => {
  it('associates field labels with editable controls and prefers errors over hints', async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <Field id="email" label="Email" hint="Use your work email">
        <Input id="email" type="email" />
      </Field>,
    )
    await user.type(screen.getByLabelText('Email'), 'ada@example.test')
    expect((screen.getByLabelText('Email') as HTMLInputElement).value).toBe('ada@example.test')
    expect(screen.getByText('Use your work email')).toBeTruthy()
    rerender(
      <Field
        id="email"
        label="Email"
        hint="Use your work email"
        error="Email is already registered"
      >
        <Input id="email" type="email" aria-invalid="true" aria-describedby="email-error" />
      </Field>,
    )
    expect(screen.getByRole('alert').textContent).toBe('Email is already registered')
    expect(screen.queryByText('Use your work email')).toBeNull()
    expect(screen.getByLabelText('Email').getAttribute('aria-describedby')).toBe(
      screen.getByRole('alert').id,
    )
  })

  it('preserves native form names, textarea contents, and selected values', async () => {
    const user = userEvent.setup()
    render(
      <form aria-label="Quote editor">
        <Field id="quote" label="Quote">
          <Textarea id="quote" name="quote" />
        </Field>
        <Field id="visibility" label="Visibility">
          <NativeSelect id="visibility" name="visibility" defaultValue="private">
            <option value="private">Private</option>
            <option value="shared">Shared</option>
          </NativeSelect>
        </Field>
      </form>,
    )
    await user.type(screen.getByLabelText('Quote'), 'First line{enter}Second line')
    await user.selectOptions(screen.getByLabelText('Visibility'), 'shared')
    const data = new FormData(screen.getByRole('form') as HTMLFormElement)
    expect(Object.fromEntries(data)).toEqual({
      quote: 'First line\nSecond line',
      visibility: 'shared',
    })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not activate disabled buttons and preserves anchor semantics with asChild', async () => {
    const click = vi.fn()
    const user = userEvent.setup()
    const { rerender } = render(
      <Button disabled onClick={click}>
        Save
      </Button>,
    )
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(click).not.toHaveBeenCalled()
    rerender(<Button onClick={click}>Save</Button>)
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(click).toHaveBeenCalledOnce()
    rerender(
      <Button asChild variant="link">
        <a href="/quotes">Browse quotes</a>
      </Button>,
    )
    expect(screen.getByRole('link', { name: 'Browse quotes' }).getAttribute('href')).toBe('/quotes')
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('supports keyboard checkbox changes and respects disabled state', async () => {
    const user = userEvent.setup()
    const changed = vi.fn()
    const { rerender } = render(<Checkbox aria-label="Select quote" onCheckedChange={changed} />)
    await user.tab()
    await user.keyboard(' ')
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true')
    expect(changed).toHaveBeenLastCalledWith(true)
    await user.keyboard(' ')
    expect(changed).toHaveBeenLastCalledWith(false)
    rerender(<Checkbox aria-label="Select quote" disabled onCheckedChange={changed} />)
    changed.mockClear()
    await user.click(screen.getByRole('checkbox'))
    expect(changed).not.toHaveBeenCalled()
  })
})

describe('dialogs', () => {
  it.each([false, true])(
    'requires explicit confirmation for destructive=%s',
    async (destructive) => {
      const user = userEvent.setup()
      const confirm = vi.fn()
      const { unmount } = render(
        <ConfirmationExample destructive={destructive} onConfirm={confirm} />,
      )
      const dialog = screen.getByRole('alertdialog', { name: 'Revoke token?' })
      expect(within(dialog).getByText('Clients using this token will lose access.')).toBeTruthy()
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }))
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      expect(confirm).not.toHaveBeenCalled()
      expect(screen.queryByRole('alertdialog')).toBeNull()
      unmount()
      render(<ConfirmationExample destructive={destructive} onConfirm={confirm} />)
      await user.click(screen.getByRole('button', { name: 'Revoke' }))
      expect(confirm).toHaveBeenCalledOnce()
      expect(screen.queryByRole('alertdialog')).toBeNull()
    },
  )

  it('closes an ordinary dialog and returns focus to its trigger', async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger asChild>
          <Button>Edit quote</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit quote</DialogTitle>
            <DialogDescription>Update the author.</DialogDescription>
          </DialogHeader>
          <Input aria-label="Author" />
          <DialogFooter>Changes are saved separately.</DialogFooter>
        </DialogContent>
      </Dialog>,
    )
    const trigger = screen.getByRole('button', { name: 'Edit quote' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'Edit quote' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('can hide the close button while retaining Escape dismissal', async () => {
    const user = userEvent.setup()
    render(
      <Dialog defaultOpen>
        <DialogContent showClose={false}>
          <DialogTitle>Details</DialogTitle>
          <DialogDescription>Quote details</DialogDescription>
        </DialogContent>
      </Dialog>,
    )
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
