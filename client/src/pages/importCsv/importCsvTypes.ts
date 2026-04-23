import type { ImportTransactionRow, TransactionSplit } from '@shared/contracts';
import type { OptionValue } from '../../components/ui/types';

export type ImportPhase = 'setup' | 'preview';
export type TransactionRowType = ImportTransactionRow['type'];

export interface StatementRowMetadata {
  description_1?: string;
  description_2?: string;
  payment_method?: string;
  sender?: string;
  from?: string;
}

export interface ParsedImportRow extends Omit<ImportTransactionRow, 'offset_account_id' | 'payee_id' | 'contact_id' | 'bill_id' | 'splits'> {
  offset_account_id?: number;
  payee_id?: number;
  contact_id?: number;
  bill_id?: number;
  splits?: TransactionSplit[];
}

export interface DepositSplitModalLine {
  type: 'deposit';
  amount: string;
  offset_account_id: OptionValue | '';
  fund_id: OptionValue | '';
  contact_id: OptionValue | '';
  memo: string;
}

export interface WithdrawalSplitModalLine {
  type: 'withdrawal';
  amount: string;
  expense_account_id: OptionValue | '';
  tax_rate_id: string;
  pre_tax_amount: string;
  rounding_adjustment: string;
  description: string;
  fund_id: OptionValue | '';
  is_legacy_mapped: boolean;
}

export type SplitModalLine = DepositSplitModalLine | WithdrawalSplitModalLine;

export interface WithdrawalSplitSavePayload {
  payee_id: number;
  splits: TransactionSplit[];
}

export type SplitSavePayload = TransactionSplit[] | WithdrawalSplitSavePayload;
