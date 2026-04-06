export type Role = 'admin' | 'editor' | 'viewer';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  avatar_url: string | null;
  role: Role;
  is_active?: boolean;
}

export interface GoogleAuthRequest {
  credential: string;
}

export interface GoogleAuthResponse {
  token: string;
  user: AuthUser;
}

export interface AuthMeResponse {
  user: AuthUser;
}

export interface UserSummary {
  id: number;
  name: string;
  email: string;
  avatar_url: string | null;
  role: Role;
  is_active: boolean;
  created_at?: string;
}

export interface CreateUserInput {
  email: string;
  role: Role;
}

export interface UpdateUserRoleInput {
  role: Role;
}

export interface UpdateUserActiveInput {
  is_active: boolean;
}

export interface FundSummary {
  id: number;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  net_asset_account_id: number | null;
  net_asset_code: string | null;
  net_asset_name: string | null;
}

export interface CreateFundInput {
  name: string;
  description?: string;
  code: string;
}

export interface UpdateFundInput {
  name?: string;
  description?: string;
  is_active?: boolean;
  code?: string;
}

export interface NetAssetAccountSummary {
  id: number;
  code: string;
  name: string;
  type: 'EQUITY';
  is_active: boolean;
}
