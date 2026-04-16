import Badge from '../../components/ui/Badge';
import Button from '../../components/ui/Button';
import Table from '../../components/ui/Table';
import { formatDateOnlyForDisplay, getChurchToday, isDateOnlyBefore } from '../../utils/date';
import {
  fmt,
  getBillDisplayStatus,
  getBillOutstanding,
  getBillStatusBadgeVariant,
  isBillVoided,
} from './billHelpers';
import type { BillSummary } from '@shared/contracts';
import type { TableColumn } from '../../components/ui/types';

interface BillsTableProps {
  bills: BillSummary[];
  isLoading: boolean;
  canEdit: boolean;
  onPay: (bill: BillSummary) => void;
  onRowClick: (bill: BillSummary) => void;
}

export default function BillsTable({ bills, isLoading, canEdit, onPay, onRowClick }: BillsTableProps) {
  const columns: TableColumn<BillSummary>[] = [
    {
      key: 'date',
      label: 'Date',
      render: (bill) => formatDateOnlyForDisplay(bill.date),
    },
    {
      key: 'vendor_name',
      label: 'Vendor',
      render: (bill) => (
        <div>
          <div style={{ fontWeight: 500, color: '#1e293b' }}>{bill.vendor_name}</div>
          {bill.bill_number && <div style={{ fontSize: '0.75rem', color: '#6b7280' }}>#{bill.bill_number}</div>}
        </div>
      ),
    },
    {
      key: 'description',
      label: 'Description',
      wrap: true,
      render: (bill) => <div style={{ maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bill.description}</div>,
    },
    {
      key: 'due_date',
      label: 'Due Date',
      render: (bill) => {
        if (!bill.due_date) return <span style={{ color: '#6b7280' }}>—</span>;
        const isOverdue = bill.status === 'UNPAID' && isDateOnlyBefore(bill.due_date, getChurchToday());
        return (
          <span style={{ color: isOverdue ? '#dc2626' : 'inherit', fontWeight: isOverdue ? 600 : 400 }}>
            {formatDateOnlyForDisplay(bill.due_date)}
          </span>
        );
      },
    },
    {
      key: 'amount',
      label: 'Amount',
      align: 'right',
      render: (bill) => fmt(bill.amount),
    },
    {
      key: 'items',
      label: 'Items',
      render: (bill) => {
        const itemCount = bill.line_items?.length || 0;
        return <Badge label={`${itemCount} items`} variant="secondary" />;
      },
    },
    {
      key: 'balance',
      label: 'Balance',
      align: 'right',
      render: (bill) => {
        const balance = getBillOutstanding(bill);
        if (balance < 0) {
          return (
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontWeight: 500, color: '#1d4ed8' }}>{fmt(balance)}</span>
              <Badge label="Vendor Credit" variant="secondary" />
            </div>
          );
        }
        return <span style={{ fontWeight: 500, color: balance > 0 ? '#dc2626' : '#15803d' }}>{fmt(balance)}</span>;
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (bill) => {
        const displayStatus = getBillDisplayStatus(bill);
        return (
          <Badge
            label={displayStatus}
            variant={getBillStatusBadgeVariant(displayStatus)}
          />
        );
      },
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (bill) => (
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          {!isBillVoided(bill) && bill.status === 'UNPAID' && canEdit && getBillOutstanding(bill) > 0 && (
            <Button
              variant="secondary"
              size="sm"
              onClick={(event) => {
                event.stopPropagation();
                onPay(bill);
              }}
            >
              Pay
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Table
      columns={columns}
      rows={bills}
      isLoading={isLoading}
      emptyText="No bills found."
      onRowClick={onRowClick}
      rowStyle={(bill) => bill.is_voided ? {
        opacity: 0.6,
        textDecoration: 'line-through',
      } : {}}
    />
  );
}
