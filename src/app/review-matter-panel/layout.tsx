import { panelUser } from "@/lib/admin";
import { PanelShell } from "@/components/panel";
import { configured, db } from "@/lib/db";
import "./panel.css";

export const metadata = { title: "Administration", robots: { index: false, follow: false } };

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const user = await panelUser("MODERATOR");
  const unread = configured() ? await db().notification.count({ where: { userId: user.id, readAt: null } }) : 0;
  return <PanelShell user={{ displayName: user.displayName, email: user.email, role: user.role }} unread={unread}>{children}</PanelShell>;
}
