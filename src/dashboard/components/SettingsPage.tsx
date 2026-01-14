// ABOUTME: Settings page with config editing capabilities.
// ABOUTME: Provides YAML editor for admins, read-only view for others.

import { useState, useEffect, useCallback } from "react";
import { Save, RotateCcw, AlertCircle, Check } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { SetupPanel } from "./SetupPanel";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import type { SetupData } from "../types";

interface SettingsPageProps {
  setup: SetupData | null | undefined;
}

type Tab = "overview" | "yaml";
type SaveStatus = "idle" | "saving" | "success" | "error";

export function SettingsPage({ setup }: SettingsPageProps) {
  const { canEditConfig, mode } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [yamlContent, setYamlContent] = useState("");
  const [originalYaml, setOriginalYaml] = useState("");
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchYaml() {
      try {
        const res = await fetch("/config/yaml");
        if (res.ok) {
          const yaml = await res.text();
          setYamlContent(yaml);
          setOriginalYaml(yaml);
        }
      } catch (error) {
        console.error("Failed to fetch config:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchYaml();
  }, []);

  const hasChanges = yamlContent !== originalYaml;

  const handleSave = useCallback(async () => {
    setSaveStatus("saving");
    setErrors([]);

    try {
      const res = await fetch("/config", {
        method: "POST",
        headers: { "Content-Type": "text/yaml" },
        body: yamlContent,
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setSaveStatus("success");
        setOriginalYaml(yamlContent);
        setTimeout(() => setSaveStatus("idle"), 2000);
      } else {
        setSaveStatus("error");
        setErrors(data.errors || ["Failed to save configuration"]);
      }
    } catch (error) {
      setSaveStatus("error");
      setErrors(["Network error: Failed to save configuration"]);
    }
  }, [yamlContent]);

  const handleReset = useCallback(() => {
    setYamlContent(originalYaml);
    setErrors([]);
    setSaveStatus("idle");
  }, [originalYaml]);

  const handleValidate = useCallback(async () => {
    setErrors([]);

    try {
      const res = await fetch("/config/validate", {
        method: "POST",
        headers: { "Content-Type": "text/yaml" },
        body: yamlContent,
      });

      const data = await res.json();

      if (!data.valid) {
        setErrors(data.errors || ["Invalid configuration"]);
      } else {
        setErrors([]);
      }
    } catch (error) {
      setErrors(["Network error: Failed to validate configuration"]);
    }
  }, [yamlContent]);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            {canEditConfig ? "Manage server configuration" : "View server configuration"}
          </p>
        </div>
        {mode === "simple" && (
          <Badge variant="outline">Simple Mode (Read-only)</Badge>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-border">
        <button
          onClick={() => setActiveTab("overview")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "overview"
              ? "border-b-2 border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab("yaml")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === "yaml"
              ? "border-b-2 border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          YAML Editor
          {hasChanges && (
            <span className="ml-2 inline-block h-2 w-2 rounded-full bg-amber-500" />
          )}
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === "overview" && <SetupPanel setup={setup} />}

      {activeTab === "yaml" && (
        <div className="space-y-4">
          {/* Editor Actions */}
          {canEditConfig && (
            <div className="flex items-center gap-2">
              <Button
                onClick={handleSave}
                disabled={!hasChanges || saveStatus === "saving"}
                size="sm"
              >
                {saveStatus === "saving" ? (
                  <>Saving...</>
                ) : saveStatus === "success" ? (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Saved
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save & Apply
                  </>
                )}
              </Button>
              <Button
                onClick={handleReset}
                disabled={!hasChanges}
                variant="outline"
                size="sm"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Reset
              </Button>
              <Button onClick={handleValidate} variant="outline" size="sm">
                Validate
              </Button>
            </div>
          )}

          {/* Errors */}
          {errors.length > 0 && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span className="font-medium">Configuration Errors</span>
              </div>
              <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-destructive">
                {errors.map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          {/* YAML Editor */}
          <div className="rounded-lg border border-border bg-card">
            {loading ? (
              <div className="p-8 text-center text-muted-foreground">
                Loading configuration...
              </div>
            ) : (
              <textarea
                value={yamlContent}
                onChange={(e) => setYamlContent(e.target.value)}
                readOnly={!canEditConfig}
                className={`h-[600px] w-full resize-none bg-transparent p-4 font-mono text-sm text-foreground focus:outline-none ${
                  !canEditConfig ? "cursor-default" : ""
                }`}
                spellCheck={false}
              />
            )}
          </div>

          {!canEditConfig && (
            <p className="text-sm text-muted-foreground">
              {mode === "simple"
                ? "Config editing is disabled in simple mode. Edit amadeus.config.yaml directly."
                : "You need admin privileges to edit the configuration."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
