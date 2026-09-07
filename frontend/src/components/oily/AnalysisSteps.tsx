import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Panel } from "./primitives";

/**
 * Professional "analysis in progress" stepper — shows the real stages of a
 * computation as they run (each step maps to an actual async operation, not a
 * fake timer). Steps before `activeStep` render done, `activeStep` renders as
 * running, later steps render pending. Used by the Impact and Drift tabs so a
 * judge sees the calculation happening rather than a blank spinner.
 */
export function AnalysisSteps({
  steps,
  activeStep,
  title,
}: {
  steps: string[];
  activeStep: number;
  title: string;
}) {
  return (
    <Panel title={title} dense>
      <ol className="space-y-2.5">
        {steps.map((step, i) => {
          const done = i < activeStep;
          const running = i === activeStep;
          return (
            <li key={step} className="flex items-center gap-2.5 text-[13px]">
              <span
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-full border",
                  done
                    ? "border-safe/40 bg-safe-soft text-safe"
                    : running
                      ? "border-primary/40 bg-info-soft text-primary"
                      : "border-border bg-muted text-muted-foreground",
                )}
              >
                {done ? (
                  <Check className="size-3" />
                ) : running ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <span className="num text-[10px]">{i + 1}</span>
                )}
              </span>
              <span
                className={cn(
                  running ? "font-medium text-foreground" : done ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {step}
              </span>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}
