import type { Role } from '../../shared/contracts.js';

export interface UserRow {
  id: number;
  google_id: string | null;
  email: string;
  name: string;
  avatar_url: string | null;
  role: Role;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface FundRow {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  net_asset_account_id: number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface AccountRow {
  id: number;
  code: string;
  name: string;
  type: 'EQUITY' | string;
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}
