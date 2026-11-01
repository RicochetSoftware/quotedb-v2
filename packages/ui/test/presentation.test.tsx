// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Badge } from '../src/components/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../src/components/card'
import { Alert, EmptyState, Skeleton } from '../src/components/misc'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../src/components/table'
import { Toaster, toast } from '../src/components/toaster'

afterEach(() => {
  toast.dismiss()
  cleanup()
  vi.unstubAllGlobals()
})

it('renders a navigable summary with semantic headings and table cells', () => {
  render(
    <Card aria-label="Collections">
      <CardHeader>
        <CardTitle>Collections</CardTitle>
        <CardDescription>Collections you can access</CardDescription>
      </CardHeader>
      <CardContent>
        <Table aria-label="Your collections">
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Name</TableHead>
              <TableHead scope="col">Access</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>Team</TableCell>
              <TableCell>
                <Badge variant="secondary">Viewer</Badge>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
      <CardFooter>1 collection</CardFooter>
    </Card>,
  )
  expect(screen.getByRole('heading', { name: 'Collections', level: 2 })).toBeTruthy()
  const table = screen.getByRole('table', { name: 'Your collections' })
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((e) => e.textContent),
  ).toEqual(['Name', 'Access'])
  expect(
    within(table)
      .getAllByRole('cell')
      .map((e) => e.textContent),
  ).toEqual(['Team', 'Viewer'])
  expect(screen.getByText('1 collection')).toBeTruthy()
})

it('announces errors and permits loading and empty states to be labelled', () => {
  const { rerender } = render(<Skeleton role="status" aria-label="Loading quotes" />)
  expect(screen.getByRole('status', { name: 'Loading quotes' })).toBeTruthy()
  rerender(<EmptyState role="status">No quotes yet</EmptyState>)
  expect(screen.getByRole('status').textContent).toBe('No quotes yet')
  for (const variant of ['default', 'warning', 'destructive'] as const) {
    rerender(<Alert variant={variant}>Could not load quotes</Alert>)
    expect(screen.getByRole('alert').textContent).toBe('Could not load quotes')
  }
})

it('displays a toast from the public notification API', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi
      .fn()
      .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  )
  render(<Toaster duration={Infinity} />)
  toast.success('Quote saved', { description: 'Your collection has been updated.' })
  expect(await screen.findByText('Quote saved')).toBeTruthy()
  expect(screen.getByText('Your collection has been updated.')).toBeTruthy()
})
