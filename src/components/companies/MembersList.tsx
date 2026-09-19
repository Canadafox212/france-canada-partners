import { getTranslations } from "next-intl/server";

type Member = {
  id: string;
  role: string;
  status: string;
  profiles:
    { full_name: string | null } | { full_name: string | null }[] | null;
};

export async function MembersList({ members }: { members: Member[] }) {
  const t = await getTranslations("Company");
  const tAccount = await getTranslations("Account");

  const roleLabel: Record<string, string> = {
    owner: tAccount("roleOwner"),
    admin: tAccount("roleAdmin"),
    member: tAccount("roleMember"),
    viewer: tAccount("roleViewer"),
  };
  const statusLabel: Record<string, string> = {
    invited: t("statusInvited"),
    active: t("statusActive"),
    removed: t("statusRemoved"),
  };

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
        {t("membersTitle")}
      </h2>
      <ul className="flex flex-col gap-2">
        {members.map((member) => {
          const profile = Array.isArray(member.profiles)
            ? member.profiles[0]
            : member.profiles;
          return (
            <li
              key={member.id}
              className="flex items-center justify-between rounded-md border border-slate-200 px-4 py-2 dark:border-slate-800"
            >
              <span className="text-slate-900 dark:text-white">
                {profile?.full_name || "—"}
              </span>
              <span className="text-sm text-slate-500 dark:text-slate-400">
                {roleLabel[member.role] ?? member.role} ·{" "}
                {statusLabel[member.status] ?? member.status}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
