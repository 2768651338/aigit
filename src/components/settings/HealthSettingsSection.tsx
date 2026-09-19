import { useTranslation } from "react-i18next";
import type { AppConfig } from "@/types";
import { Field } from "@/components/settings/Field";

interface HealthSettingsSectionProps {
  local: AppConfig;
  /** Replace the whole local draft config (same contract as the parent's setLocal). */
  onLocal: (next: AppConfig) => void;
}

/**
 * "Repo health check" display thresholds. Edits feed the parent's single
 * save flow via `onLocal`; the backend validates the ranges again on save.
 * `max_scan_entries` is deliberately not exposed here — it is a safety valve
 * only editable in config.toml.
 */
export function HealthSettingsSection({ local, onLocal }: HealthSettingsSectionProps) {
  const { t } = useTranslation();
  const update = (patch: Partial<AppConfig["health"]>) =>
    onLocal({ ...local, health: { ...local.health, ...patch } });

  const parseIntOrKeep = (value: string, fallback: number) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  };

  return (
    <section>
      <h3 className="text-base font-semibold text-text-primary mb-2">{t("settings.healthTitle")}</h3>
      <p className="text-xs text-text-muted mb-4">{t("settings.healthHint")}</p>
      <div className="space-y-4">
        <Field label={t("settings.healthStaleDays")}>
          <input
            type="number"
            min={1}
            max={3650}
            value={local.health.stale_days}
            onChange={(e) => update({ stale_days: parseIntOrKeep(e.target.value, local.health.stale_days) })}
            onBlur={(e) => update({ stale_days: Math.min(3650, Math.max(1, parseIntOrKeep(e.target.value, local.health.stale_days))) })}
            className="input w-32"
          />
        </Field>
        <Field label={t("settings.healthLargeFileMb")}>
          <input
            type="number"
            min={1}
            max={10240}
            value={local.health.large_file_min_mb}
            onChange={(e) => update({ large_file_min_mb: parseIntOrKeep(e.target.value, local.health.large_file_min_mb) })}
            onBlur={(e) => update({ large_file_min_mb: Math.min(10240, Math.max(1, parseIntOrKeep(e.target.value, local.health.large_file_min_mb))) })}
            className="input w-32"
          />
        </Field>
        <Field label={t("settings.healthLargeFileTopN")}>
          <input
            type="number"
            min={1}
            max={200}
            value={local.health.large_file_top_n}
            onChange={(e) => update({ large_file_top_n: parseIntOrKeep(e.target.value, local.health.large_file_top_n) })}
            onBlur={(e) => update({ large_file_top_n: Math.min(200, Math.max(1, parseIntOrKeep(e.target.value, local.health.large_file_top_n))) })}
            className="input w-32"
          />
        </Field>
      </div>
    </section>
  );
}
