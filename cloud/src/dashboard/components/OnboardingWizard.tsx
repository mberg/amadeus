// ABOUTME: Onboarding wizard with step progress indicator.
// ABOUTME: Orchestrates the 4-step setup flow for new organizations.

import { useState, useCallback } from "react";
import { ConnectLinear } from "./steps/ConnectLinear";
import { ConfigureProjects } from "./steps/ConfigureProjects";
import { RegisterMachine } from "./steps/RegisterMachine";
import { VerifyWebhook } from "./steps/VerifyWebhook";
import { Check } from "lucide-react";

export interface OnboardingStatus {
  currentStep: string;
  completed: boolean;
  linearConnected?: boolean;
  machineRegistered?: boolean;
  webhookVerified?: boolean;
}

const STEPS = [
  { id: "connect_linear", label: "Connect Linear" },
  { id: "configure_projects", label: "Configure Projects" },
  { id: "register_machine", label: "Register Machine" },
  { id: "verify_webhook", label: "Verify Webhook" },
] as const;

type StepId = (typeof STEPS)[number]["id"];

function getStepIndex(stepId: string): number {
  const idx = STEPS.findIndex((s) => s.id === stepId);
  return idx >= 0 ? idx : 0;
}

interface OnboardingWizardProps {
  initialStatus: OnboardingStatus;
  onComplete: () => void;
}

export function OnboardingWizard({ initialStatus, onComplete }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState<StepId>(
    initialStatus.currentStep as StepId
  );
  const currentIndex = getStepIndex(currentStep);

  const advanceToStep = useCallback((nextStep: StepId) => {
    setCurrentStep(nextStep);
  }, []);

  const handleLinearComplete = useCallback(() => {
    advanceToStep("configure_projects");
  }, [advanceToStep]);

  const handleProjectsComplete = useCallback(() => {
    advanceToStep("register_machine");
  }, [advanceToStep]);

  const handleMachineComplete = useCallback(() => {
    advanceToStep("verify_webhook");
  }, [advanceToStep]);

  const handleWebhookComplete = useCallback(() => {
    onComplete();
  }, [onComplete]);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Sidebar progress */}
      <aside className="w-64 border-r border-border p-6 space-y-1">
        <h2 className="text-lg font-semibold mb-6">Setup</h2>
        {STEPS.map((step, idx) => {
          const isComplete = idx < currentIndex;
          const isCurrent = idx === currentIndex;
          const canNavigate = isComplete;

          return (
            <button
              key={step.id}
              type="button"
              disabled={!canNavigate}
              onClick={() => canNavigate && setCurrentStep(step.id)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm w-full text-left ${
                isCurrent
                  ? "bg-muted/50 text-foreground font-medium"
                  : isComplete
                    ? "text-muted-foreground hover:bg-muted/30 cursor-pointer"
                    : "text-muted-foreground/50 cursor-default"
              }`}
            >
              <div
                className={`flex items-center justify-center w-6 h-6 rounded-full text-xs shrink-0 ${
                  isComplete
                    ? "bg-foreground text-background"
                    : isCurrent
                      ? "border-2 border-foreground text-foreground"
                      : "border border-border text-muted-foreground/50"
                }`}
              >
                {isComplete ? <Check className="w-3.5 h-3.5" /> : idx + 1}
              </div>
              {step.label}
            </button>
          );
        })}
      </aside>

      {/* Step content */}
      <main className="flex-1 p-8 max-w-2xl">
        {currentStep === "connect_linear" && (
          <ConnectLinear onComplete={handleLinearComplete} />
        )}
        {currentStep === "configure_projects" && (
          <ConfigureProjects onComplete={handleProjectsComplete} />
        )}
        {currentStep === "register_machine" && (
          <RegisterMachine onComplete={handleMachineComplete} />
        )}
        {currentStep === "verify_webhook" && (
          <VerifyWebhook onComplete={handleWebhookComplete} />
        )}
      </main>
    </div>
  );
}
