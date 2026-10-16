import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from './supabase/database.types';

export type CustomerKind = 'individual' | 'sole_proprietor' | 'corporation';
export const customerKinds: Record<CustomerKind, string> = {
  individual: '개인',
  sole_proprietor: '개인사업자',
  corporation: '법인사업자',
};
export type ServiceContent = {
  operator_name: string;
  contact_email: string;
  privacy_contact: string;
  terms: string;
  privacy: string;
};
export const emptyServiceContent: ServiceContent = {
  operator_name: '',
  contact_email: '',
  privacy_contact: '',
  terms: '',
  privacy: '',
};
/** Required-field check only, not an assessment of legal sufficiency. */
export function serviceContentReady(content: ServiceContent) {
  return (
    content.operator_name.trim().length >= 2 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(content.contact_email.trim()) &&
    content.privacy_contact.trim().length >= 3 &&
    content.terms.trim().length >= 40 &&
    content.privacy.trim().length >= 40
  );
}
export type PublishedPolicy = {
  id: string;
  version: number;
  content: ServiceContent;
  published_at: string;
};
export type AccountDetails = {
  name: string;
  phone: string;
  kind?: CustomerKind;
  business_name?: string;
  business_number?: string;
  representative?: string;
};
export type Onboarding = {
  profile: AccountDetails;
  policy: PublishedPolicy | null;
  ready: boolean;
  has_profile: boolean;
  role: string;
  consents: Array<{
    version: number;
    accepted_at: string;
    content: ServiceContent;
  }>;
  customers: Array<{ name: string; kind: CustomerKind }>;
};
export function businessNumberValid(input: string) {
  const n = input.replace(/\D/g, '');
  if (!/^\d{10}$/.test(n)) return false;
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  const total =
    weights.reduce((sum, w, i) => sum + Number(n[i]) * w, 0) +
    Math.floor((Number(n[8]) * 5) / 10);
  return (10 - (total % 10)) % 10 === Number(n[9]);
}
export function validateAccountDetails(d: AccountDetails, client: boolean) {
  if (!d.name.trim() || d.name.trim().length > 80)
    return '이름을 80자 이내로 입력해 주세요.';
  if (!/^0\d{8,10}$/.test(d.phone.replace(/\D/g, '')))
    return '연락처를 확인해 주세요.';
  if (client && !Object.hasOwn(customerKinds, d.kind || ''))
    return '고객 구분을 선택해 주세요.';
  if (client && d.kind !== 'individual') {
    if (!d.business_name?.trim() || d.business_name.trim().length > 160)
      return '상호를 160자 이내로 입력해 주세요.';
    if ((d.representative?.trim().length ?? 0) > 80)
      return '대표자 이름은 80자 이내로 입력해 주세요.';
    if (!businessNumberValid(d.business_number || ''))
      return '사업자등록번호를 확인해 주세요.';
  }
  return null;
}
export async function serviceRpc<T>(
  client: SupabaseClient<Database>,
  name:
    | 'get_service_onboarding'
    | 'service_admin_action'
    | 'complete_service_profile'
    | 'get_public_service_policy',
  args: Record<string, Json> = {},
  signal?: AbortSignal,
): Promise<T> {
  const request = client.rpc(name, args as never);
  const result = await (signal ? request.abortSignal(signal) : request);
  if (result.error)
    throw new Error(
      result.error.code === '23505'
        ? '이미 등록된 사업자 또는 연결입니다. 기존 고객을 확인해 주세요.'
        : result.error.message,
    );
  return result.data as T;
}
export function problem(error: unknown) {
  return error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
    ? error.message
    : '처리하지 못했습니다. 다시 시도해 주세요.';
}
