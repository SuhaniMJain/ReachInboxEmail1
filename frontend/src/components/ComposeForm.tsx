import { useRef, useState, type FormEvent } from "react";
import toast from "react-hot-toast";
import { api } from "../services/api";
import { useAuth } from "../hooks/useAuth";

interface Props {
  onScheduled: () => void;
}

/** Compose New Email — subject, body, leads file, start time, delay, hourly limit. */
export function ComposeForm({ onScheduled }: Props) {
  const { senders } = useAuth();
  const fileInput = useRef<HTMLInputElement>(null);

  const [senderId, setSenderId] = useState(senders.find((s) => s.isDefault)?.id ?? senders[0]?.id ?? "");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [startTime, setStartTime] = useState("");
  const [delaySeconds, setDelaySeconds] = useState("2");
  const [hourlyLimit, setHourlyLimit] = useState("100");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [scheduling, setScheduling] = useState(false);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await api.uploadRecipients(file);
      setRecipients(res.recipients);
      setFileName(file.name);
      toast.success(`${res.count} email address${res.count === 1 ? "" : "es"} detected`);
    } catch (err) {
      setRecipients([]);
      setFileName(null);
      toast.error((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!senderId) {
      toast.error("Create a sender first (a default one is created on login)");
      return;
    }
    if (recipients.length === 0) {
      toast.error("Upload a recipients file first");
      return;
    }
    if (!startTime || new Date(startTime).getTime() <= Date.now()) {
      toast.error("Start time must be in the future");
      return;
    }
    setScheduling(true);
    try {
      const res = await api.schedule({
        senderId,
        subject,
        body,
        startTime: new Date(startTime).toISOString(),
        delayMs: Math.max(0, Number(delaySeconds) || 0) * 1000,
        hourlyLimit: Math.max(1, Number(hourlyLimit) || 1),
        recipients,
      });
      toast.success(`Scheduled ${res.totalEmails} emails ✉️`);
      setSubject("");
      setBody("");
      setRecipients([]);
      setFileName(null);
      onScheduled();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setScheduling(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100";

  return (
    <form onSubmit={submit} className="mx-auto max-w-2xl space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Sender</label>
        <select className={inputCls} value={senderId} onChange={(e) => setSenderId(e.target.value)}>
          {senders.length === 0 && <option value="">No senders available</option>}
          {senders.map((s) => (
            <option key={s.id} value={s.id}>
              {s.fromName} &lt;{s.fromEmail}&gt;
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Subject</label>
        <input className={inputCls} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Weekly product update" required />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Body</label>
        <textarea className={`${inputCls} min-h-32`} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write your message…" required />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-slate-700">Recipient leads (CSV / text)</label>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="w-full rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm text-slate-600 hover:border-indigo-300 hover:bg-indigo-50/40"
        >
          {uploading ? "Parsing file…" : fileName ? `📄 ${fileName}` : "Click to upload a CSV or text file of email leads"}
        </button>
        <input ref={fileInput} type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
        {recipients.length > 0 && (
          <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
            {recipients.length} email addresses detected
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Start time</label>
          <input type="datetime-local" className={inputCls} value={startTime} onChange={(e) => setStartTime(e.target.value)} required />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Delay between emails (s)</label>
          <input type="number" min={0} className={inputCls} value={delaySeconds} onChange={(e) => setDelaySeconds(e.target.value)} required />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">Hourly limit</label>
          <input type="number" min={1} className={inputCls} value={hourlyLimit} onChange={(e) => setHourlyLimit(e.target.value)} required />
        </div>
      </div>

      <button
        type="submit"
        disabled={scheduling || uploading}
        className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
      >
        {scheduling ? "Scheduling…" : "Schedule emails"}
      </button>
      <p className="text-center text-xs text-slate-400">
        Emails are sent by background workers via Ethereal SMTP. Excess emails over the hourly limit are automatically delayed to the next hour.
      </p>
    </form>
  );
}
