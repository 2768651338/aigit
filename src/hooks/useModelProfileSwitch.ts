import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSettingsStore } from "@/stores/aiStore";
import { useToastStore } from "@/stores/toastStore";
import { confirmDialog } from "@/utils/dialog";
import { formatError } from "@/utils/error";

/**
 * One-click model-profile switch shared by the settings page and the sidebar.
 * Switching replaces the AI section of the settings form, so when that form
 * has unsaved edits the user is asked to confirm the discard first.
 */
export function useModelProfileSwitch() {
  const { t } = useTranslation();

  return useCallback(
    async (profileId: string) => {
      const { config, modelDirty, switchModelProfile } = useSettingsStore.getState();
      if (!config) return;
      const target = config.profiles.find((profile) => profile.id === profileId);
      if (!target || target.id === config.ai.active_profile_id) return;

      if (modelDirty) {
        const confirmed = await confirmDialog(
          t("settings.profileSwitchTitle"),
          t("settings.profileSwitchConfirm")
        );
        if (!confirmed) return;
      }
      try {
        await switchModelProfile(profileId);
        useToastStore.getState().success(
          t("settings.profileSwitched", { name: target.name }),
          t("settings.profilesTitle")
        );
      } catch (e) {
        useToastStore.getState().error(formatError(e), t("settings.profileSwitchFailed"));
      }
    },
    [t]
  );
}
