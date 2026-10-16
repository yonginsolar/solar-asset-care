import type { Json } from '@/lib/supabase/database.types';

export type AccountState = {
  needsInitialPassword: boolean;
  accessRemoved: boolean;
  superAdminUserId: string | null;
  organizationId: string | null;
};

export function parseAccountState(value: Json): AccountState {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof value.needs_initial_password !== 'boolean' ||
    typeof value.access_removed !== 'boolean' ||
    !(
      value.super_admin_user_id === null ||
      typeof value.super_admin_user_id === 'string'
    ) ||
    !(
      value.organization_id === null ||
      typeof value.organization_id === 'string'
    )
  ) {
    throw new Error('계정 권한을 확인하지 못했습니다. 다시 시도해 주세요.');
  }
  return {
    needsInitialPassword: value.needs_initial_password,
    accessRemoved: value.access_removed,
    superAdminUserId: value.super_admin_user_id,
    organizationId: value.organization_id,
  };
}
