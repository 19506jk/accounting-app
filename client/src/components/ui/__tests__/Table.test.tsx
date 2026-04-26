import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { userEvent } from 'vitest/browser';

import Table from '../Table';
import type { TableColumn } from '../types';

interface SampleRow {
  id: number;
  name: string;
  amount: string;
}

const columns: TableColumn<SampleRow>[] = [
  { key: 'name', label: 'Name' },
  { key: 'amount', label: 'Amount', align: 'right' },
];

describe('Table', () => {
  it('renders headers and empty state', async () => {
    const screen = await render(<Table columns={columns} rows={[]} emptyText='No transactions' />);

    await expect.element(screen.getByText('Name')).toBeVisible();
    await expect.element(screen.getByText('Amount')).toBeVisible();
    await expect.element(screen.getByText('No transactions')).toBeVisible();
  });

  it('calls row click handler', async () => {
    const onRowClick = vi.fn();
    const rows: SampleRow[] = [{ id: 1, name: 'Cash donation', amount: '$50.00' }];

    const screen = await render(
      <Table
        columns={columns}
        rows={rows}
        onRowClick={onRowClick}
      />
    );

    await userEvent.click(screen.getByRole('cell', { name: 'Cash donation' }));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });
});
