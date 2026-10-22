// 前后端共享的核心领域模型与 DTO 类型定义

export type ProductStatus = 'active' | 'maintenance' | 'disabled';
export type CodeStatus = 'unused' | 'active' | 'revoked';

export interface Product {
  id: number;
  slug: string;
  name: string;
  status: ProductStatus;
  version: string;
  min_version: string;
  announcement: string;
  custom_data: string; // JSON string or text, sent only after activation/verification
  code_prefix: string;
  max_devices: number;
  heartbeat_interval: number;
  allow_unbind: number; // 0 | 1
  unbind_cooldown_sec: number;
  unbind_penalty_sec: number;
  max_unbind_count: number; // 0 = unlimited
  trial_enabled: number; // 0 | 1
  trial_duration_sec: number;
  created_at: number;
  // Computed fields in admin list
  code_count?: number;
  active_count?: number;
  online_count?: number;
}

export interface CodeBinding {
  id: number;
  code_id: number;
  machine_id: string;
  device_name: string;
  kick: number;
  ip: string | null;
  bound_at: number;
  last_seen_at: number;
  online?: boolean;
}

export interface LicenseCode {
  id: number;
  product_id: number;
  product_name?: string;
  product_slug?: string;
  code: string;
  batch_no: string;
  status: CodeStatus;
  is_trial: number; // 0 | 1
  duration_sec: number; // 0 = permanent
  max_devices: number | null; // null = inherit from product
  unbind_count: number;
  last_unbind_at: number | null;
  created_at: number;
  activated_at: number | null;
  expires_at: number | null; // null = permanent (if active) or not yet calculated (if unused)
  note: string;
  // Legacy & aggregated fields
  machine_id?: string | null;
  last_seen_at?: number | null;
  online?: boolean;
  bound_devices?: number;
  effective_max_devices?: number;
  bindings?: CodeBinding[];
}

export interface BlacklistEntry {
  id: number;
  product_id: number | null;
  product_name?: string | null;
  product_slug?: string | null;
  machine_id: string;
  reason: string;
  created_at: number;
}

export interface AuditLog {
  id: number;
  product_id: number | null;
  product_slug?: string | null;
  code: string | null;
  machine_id: string | null;
  action: string;
  detail: string;
  ip: string | null;
  created_at: number;
}

export interface DashboardStats {
  total: number;
  unused: number;
  active: number;
  revoked: number;
  expired: number;
  trial_count: number;
  online_devices: number;
  blacklisted: number;
}

export interface TokenPayload {
  p: string;   // product slug
  c: string;   // license code
  m: string;   // machine_id
  exp: number; // expiration unix timestamp in seconds (0 = permanent)
  iat: number; // issued at unix timestamp in seconds
}
