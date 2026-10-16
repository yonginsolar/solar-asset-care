export const memberRoleTabs = [
  { role: 'owner', label: '관리자' },
  { role: 'expert', label: '전문가' },
  { role: 'client', label: '의뢰인' },
] as const;
export type MemberRoleTab = (typeof memberRoleTabs)[number]['role'];
type DirectoryMember = { user_id: string; role: string; status: string };
type DirectoryProfile = { display_name: string | null; email: string | null };
const normalize = (text: string) =>
  text.normalize('NFKC').toLocaleLowerCase('ko-KR').trim();
export function directoryMembers<T extends DirectoryMember>(
  members: readonly T[],
  profiles: Record<string, DirectoryProfile>,
  role: MemberRoleTab,
  query: string,
) {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return members.filter((member) => {
    if (member.status === 'removed' || member.role !== role) return false;
    const profile = profiles[member.user_id];
    const text = normalize(
      `${profile?.display_name || ''} ${profile?.email || ''}`,
    );
    return words.every((word) => text.includes(word));
  });
}
export function directoryRoleCounts(members: readonly DirectoryMember[]) {
  return Object.fromEntries(
    memberRoleTabs.map(({ role }) => [
      role,
      members.filter(
        (member) => member.role === role && member.status !== 'removed',
      ).length,
    ]),
  ) as Record<MemberRoleTab, number>;
}
