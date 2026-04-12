import { cn } from "@/lib/utils";

interface ProgressStepsProps {
  steps: { label: string }[];
  currentStep: number;
}

export function ProgressSteps({ steps, currentStep }: ProgressStepsProps): React.ReactElement {
  return (
    <div className="flex items-center justify-center gap-3">
      {steps.map((step, index) => {
        const isCompleted = index < currentStep;
        const isCurrent = index === currentStep;
        const isActive = isCompleted || isCurrent;

        return (
          <div key={step.label} className="flex items-center gap-3">
            {index > 0 && (
              <div
                className={cn("h-px w-8", index <= currentStep ? "bg-foreground" : "bg-border")}
              />
            )}
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-medium",
                  isActive
                    ? "bg-foreground text-background"
                    : "border border-border text-muted-foreground",
                )}
              >
                {isCompleted ? (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                    aria-hidden="true"
                  >
                    <path
                      d="M2.5 6L5 8.5L9.5 3.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={cn(
                  "text-sm font-medium",
                  isActive ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
