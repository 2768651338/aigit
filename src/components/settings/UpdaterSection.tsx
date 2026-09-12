import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { updaterService, type AvailableUpdate } from "@/services/updater";
import { SpinnerIcon } from "@/components/common/Icons";
import { useToastStore } from "@/stores/toastStore";

/**
 * "Updates" settings section. Fully self-contained: it owns the updater
 * availability state, check/download flow and progress display.
 */
export function UpdaterSection() {
  const { t } = useTranslation();
  const toast = useToastStore();
  const [updaterEnabled, setUpdaterEnabled] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null);
  const [updateProgress, setUpdateProgress] = useState<{ downloaded: number; total?: number } | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    void updaterService.availability()
      .then(({ enabled }) => setUpdaterEnabled(enabled))
      .catch(() => setUpdaterEnabled(false));
  }, []);

  const handleCheckUpdate = async () => {
    if (!updaterEnabled || updateBusy) return;
    setUpdateBusy(true);
    setUpdateError(null);
    setAvailableUpdate(null);
    try {
      const result = await updaterService.check();
      setAvailableUpdate(result);
      if (!result) toast.success(t("settings.updateCurrent"));
    } catch (e) {
      setUpdateError(String(e));
    } finally {
      setUpdateBusy(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!availableUpdate || updateBusy) return;
    setUpdateBusy(true);
    setUpdateError(null);
    setUpdateProgress({ downloaded: 0 });
    try {
      await updaterService.downloadAndInstall((downloaded, total) =>
        setUpdateProgress((current) => ({ downloaded, total: total ?? current?.total })),
      );
    } catch (e) {
      setUpdateError(String(e));
      setUpdateBusy(false);
    }
  };

  return (
    <section>
      <h3 className="text-base font-semibold text-text-primary mb-2">{t("settings.updates")}</h3>
      <p className="text-xs text-text-muted mb-4">
        {updaterEnabled ? t("settings.updateEnabledHint") : t("settings.updateDisabledHint")}
      </p>
      {updateError && <p className="text-xs text-danger mb-3 break-words">{updateError}</p>}
      {availableUpdate && (
        <p className="text-sm text-text-secondary mb-3">
          {t("settings.updateAvailable", { version: availableUpdate.version })}
        </p>
      )}
      {updateProgress && (
        <div className="mb-3">
          <progress
            className="w-full"
            value={updateProgress.downloaded}
            max={updateProgress.total ?? Math.max(updateProgress.downloaded, 1)}
          />
          <p className="text-xs text-text-muted mt-1">
            {updateProgress.total
              ? `${Math.min(100, Math.round(updateProgress.downloaded * 100 / updateProgress.total))}%`
              : t("settings.updateDownloading")}
          </p>
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" className="btn-secondary" disabled={!updaterEnabled || updateBusy} onClick={() => void handleCheckUpdate()}>
          {updateBusy && !updateProgress ? <SpinnerIcon size={14} /> : null}
          {t("settings.checkUpdate")}
        </button>
        {availableUpdate && (
          <button type="button" className="btn-primary" disabled={updateBusy} onClick={() => void handleInstallUpdate()}>
            {updateBusy ? <SpinnerIcon size={14} /> : null}
            {t("settings.installUpdate")}
          </button>
        )}
      </div>
    </section>
  );
}
