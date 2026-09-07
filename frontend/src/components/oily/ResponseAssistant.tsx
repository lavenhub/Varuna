import { useEffect, useMemo, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { Bot, ChevronDown, Send, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { oilyStore, useOily } from "@/lib/oily/store";
import { SUGGESTED_QUESTIONS } from "@/lib/oily/engine";
import { oily } from "@/api";
import { DISCLAIMERS } from "@/lib/oily/data";
import type { ChatMessage } from "@/lib/oily/types";

const HIDDEN_PATHS = ["/", "/login", "/register", "/onboarding/role"];

export function ResponseAssistant() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { incidents, chats, session } = useOily();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const incident = useMemo(() => {
    const match = pathname.match(/VARUNA-\d+/);
    if (match) {
      const found = incidents.find((i) => i.id === match[0]);
      if (found) return found;
    }
    return incidents.find((i) => i.status !== "CLOSED") ?? incidents[0];
  }, [pathname, incidents]);

  const messages: ChatMessage[] = incident ? (chats[incident.id] ?? []) : [];

  useEffect(() => {
    if (!incident || messages.length > 0) return;
    let cancelled = false;
    // Intro pulled from the real, backend-generated response plan (not a client
    // heuristic) so the assistant is grounded from the first message.
    oily.response
      .generate(incident.id)
      .then((plan) => {
        if (cancelled) return;
        oilyStore.addChatMessage(incident.id, {
          id: `${incident.id}-intro`,
          role: "assistant",
          text: plan.summary,
          metrics: plan.situation.slice(0, 5).map((s) => ({ label: s.label, value: s.value })),
        });
      })
      .catch(() => {
        /* backend unreachable — assistant stays quiet until asked */
      });
    return () => {
      cancelled = true;
    };
  }, [incident, messages.length]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, open]);

  if (HIDDEN_PATHS.includes(pathname) || !incident || !session) return null;

  async function ask(question: string) {
    if (!incident || !question.trim() || pending) return;
    setInput("");
    oilyStore.addChatMessage(incident.id, {
      id: `${Date.now()}-u`,
      role: "user",
      text: question,
    });
    setPending(true);
    try {
      const answer = await oily.response.chat(incident.id, question);
      oilyStore.addChatMessage(incident.id, {
        id: `${Date.now()}-a`,
        role: "assistant",
        text: answer.text,
        metrics: answer.metrics,
        table: answer.table,
        chain: answer.chain,
      });
    } catch (e: unknown) {
      oilyStore.addChatMessage(incident.id, {
        id: `${Date.now()}-e`,
        role: "assistant",
        text: `I couldn't reach the reasoning backend (${e instanceof Error ? e.message : String(e)}).`,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 print:hidden">
      {open ? (
        <div className="flex h-[min(620px,80vh)] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-md border border-border bg-card shadow-[var(--shadow-raised)]">
          <header className="flex items-center gap-2 border-b border-border bg-navy px-3 py-2.5 text-navy-foreground">
            <Bot className="size-4 text-cyan" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold">Varuna Response Assistant</p>
              <p className="num truncate text-[10px] text-navy-muted">
                Context: {incident.id} — {incident.name}
              </p>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Minimise assistant">
              <ChevronDown className="size-4" />
            </button>
          </header>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "rounded-md border px-3 py-2 text-[13px] leading-relaxed",
                  m.role === "user"
                    ? "ml-8 border-primary/25 bg-info-soft"
                    : "border-border bg-surface",
                )}
              >
                <p>{m.text}</p>
                {m.chain?.length ? (
                  <ul className="mt-2 space-y-0.5 border-l-2 border-critical/40 pl-2 text-[11px] text-muted-foreground">
                    {m.chain.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                ) : null}
                {m.metrics?.length ? (
                  <div className="mt-2 rounded-sm border border-border bg-card p-2">
                    <p className="label-caps mb-1">Supporting metrics</p>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                      {m.metrics.map((x) => (
                        <div key={x.label} className="flex justify-between gap-2">
                          <dt className="text-muted-foreground">{x.label}</dt>
                          <dd className="num font-medium">{x.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ) : null}
                {m.table?.length ? (
                  <table className="mt-2 w-full text-[11px]">
                    <tbody>
                      {m.table.map((row) => (
                        <tr key={row.label} className="border-b border-border/60 last:border-0">
                          <td className="py-1 pr-2 text-muted-foreground">{row.label}</td>
                          <td className="num py-1 text-right font-medium">{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </div>
            ))}
            {pending ? (
              <p className="text-[12px] italic text-muted-foreground">Assistant is reasoning…</p>
            ) : null}
          </div>

          <div className="border-t border-border p-2">
            <div className="mb-2 flex max-h-20 flex-wrap gap-1 overflow-y-auto">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => ask(q)}
                  className="rounded-sm border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {q}
                </button>
              ))}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                ask(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about this incident…"
                className="min-w-0 flex-1 rounded-sm border border-input bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-primary"
              />
              <button
                type="submit"
                className="flex size-8 items-center justify-center rounded-sm bg-primary text-primary-foreground disabled:opacity-50"
                disabled={pending}
                aria-label="Send"
              >
                <Send className="size-3.5" />
              </button>
            </form>
            <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
              {DISCLAIMERS.general}
            </p>
          </div>
        </div>
      ) : null}

      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full bg-navy px-4 py-2.5 text-[13px] font-semibold text-navy-foreground shadow-[var(--shadow-raised)]"
      >
        {open ? <X className="size-4" /> : <Bot className="size-4 text-cyan" />}
        {open ? "Close assistant" : "Response Assistant"}
      </button>
    </div>
  );
}
