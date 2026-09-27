import type { ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { SlackButton } from "../components/SlackButton";

const NAV = [
  { to: "/dashboard", label: "Scheduled Emails", icon: "🗓️" },
  { to: "/dashboard/sent", label: "Sent Emails", icon: "📤" },
  { to: "/dashboard/compose", label: "Compose New Email", icon: "✏️" },
];

/** App shell: sidebar navigation + header with user info, Slack connect and logout. */
export function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="hidden w-64 flex-col border-r border-slate-200 bg-white p-4 md:flex">
        <div className="mb-8 flex items-center gap-2 px-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-lg text-white">✉️</span>
          <div>
            <p className="text-sm font-bold text-slate-900">Outbox</p>
            <p className="text-xs text-slate-400">Email Scheduler</p>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <span>{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex flex-col gap-3">
          <SlackButton />
          <a
            href="/admin/queues"
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-slate-200 px-3 py-2 text-center text-xs text-slate-500 hover:bg-slate-50"
          >
            Queue monitor (Bull Board) ↗
          </a>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <div className="flex gap-2 md:hidden">
            {NAV.map((n) => (
              <Link key={n.to} to={n.to} className="rounded-lg px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">
                {n.label}
              </Link>
            ))}
          </div>
          <p className="hidden text-sm font-medium text-slate-400 md:block">ReachInbox · Email Job Scheduler</p>
          {user && (
            <div className="flex items-center gap-3">
              <img src={user.avatarUrl ?? undefined} alt={user.name} className="h-9 w-9 rounded-full bg-slate-200 object-cover" referrerPolicy="no-referrer" />
              <div className="hidden text-right sm:block">
                <p className="text-sm font-semibold text-slate-800">{user.name}</p>
                <p className="text-xs text-slate-500">{user.email}</p>
              </div>
              <button onClick={() => void logout()} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
                Log out
              </button>
            </div>
          )}
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
