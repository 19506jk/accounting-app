import type React from 'react';

export type OptionValue = string | number;

export interface SelectOption<TValue extends OptionValue = OptionValue> {
  value: TValue;
  label: string;
}

export interface TableColumn<Row extends object> {
  key: string;
  label: React.ReactNode;
  align?: 'left' | 'center' | 'right';
  wrap?: boolean;
  render?: (row: Row) => React.ReactNode;
}

export type TableRow = object & {
  id?: string | number;
};
