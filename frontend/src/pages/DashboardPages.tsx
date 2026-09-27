import { useNavigate } from "react-router-dom";
import { EmailsPanel } from "../components/EmailsPanel";
import { ComposeForm } from "../components/ComposeForm";

function PageTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-lg font-bold text-slate-900">{title}</h2>
      <p className="text-sm text-slate-500">{subtitle}</p>
    </div>
  );
}

export function ScheduledPage() {
  return (
    <section>
      <PageTitle title="Scheduled Emails" subtitle="Waiting in the queue — searchable via Elasticsearch." />
      <EmailsPanel kind="scheduled" searchPlaceholder="Search recipient, subject, sender…" />
    </section>
  );
}

export function SentPage() {
  return (
    <section>
      <PageTitle title="Sent Emails" subtitle="Delivered and failed emails, updated in real time." />
      <EmailsPanel kind="sent" searchPlaceholder="Search recipient, subject, message id…" />
    </section>
  );
}

export function ComposePage() {
  const navigate = useNavigate();
  return (
    <section>
      <PageTitle title="Compose New Email" subtitle="Upload your leads and schedule a campaign." />
      <ComposeForm onScheduled={() => navigate("/dashboard")} />
    </section>
  );
}
