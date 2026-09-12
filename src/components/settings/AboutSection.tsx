import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { openExternalUrl } from "@/utils/externalUrl";
import { CheckIcon, CopyIcon, GithubIcon, MailIcon } from "@/components/common/Icons";

const AUTHOR = "田小橙";
const QQ = "2768651338";
const EMAIL = "2768651338@qq.com";
const GITHUB_REPO = "https://github.com/2768651338/aigit";

/** "About / Copyright" settings section. Fully self-contained. */
export function AboutSection() {
  const { t } = useTranslation();
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // 复位定时器挂在 effect 上，组件卸载时自动清理。
  useEffect(() => {
    if (!copiedField) return;
    const timer = window.setTimeout(() => setCopiedField(null), 1500);
    return () => window.clearTimeout(timer);
  }, [copiedField]);

  const handleCopy = async (text: string, field: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
    } catch (e) {
      console.warn("[aigit] Copy to clipboard failed:", e);
    }
  };

  const handleOpenUrl = async (url: string) => {
    try {
      if (!(await openExternalUrl(url))) throw new Error("Unsupported external URL");
    } catch (e) {
      console.warn("[aigit] external URL open failed:", e);
    }
  };

  return (
    <section className="mt-2 pt-8 border-t border-border">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">
          {t("settings.about")}
        </h3>
        <span className="text-xs text-text-muted">
          {t("settings.version")} <span className="font-mono">v{__APP_VERSION__}</span>
        </span>
      </div>
      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted uppercase tracking-wider min-w-[72px]">
            {t("settings.author")}
          </span>
          <span className="text-text-primary font-medium">{AUTHOR}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted uppercase tracking-wider min-w-[72px]">
            {t("settings.contact")}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-text-secondary">QQ</span>
            <span className="text-text-primary font-mono">{QQ}</span>
            <button
              onClick={() => handleCopy(QQ, "qq")}
              className="text-text-muted hover:text-accent transition-colors"
              title={t("settings.copy")}
              aria-label={t("settings.copy")}
            >
              {copiedField === "qq" ? (
                <CheckIcon size={14} className="text-success" />
              ) : (
                <CopyIcon size={14} />
              )}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted uppercase tracking-wider min-w-[72px]">
            Email
          </span>
          <div className="flex items-center gap-2">
            <MailIcon size={14} className="text-text-muted" />
            <a
              href={`mailto:${EMAIL}`}
              onClick={(event) => {
                event.preventDefault();
                void handleOpenUrl(`mailto:${EMAIL}`);
              }}
              className="text-accent hover:underline font-mono"
            >
              {EMAIL}
            </a>
            <button
              onClick={() => handleCopy(EMAIL, "email")}
              className="text-text-muted hover:text-accent transition-colors"
              title={t("settings.copy")}
              aria-label={t("settings.copy")}
            >
              {copiedField === "email" ? (
                <CheckIcon size={14} className="text-success" />
              ) : (
                <CopyIcon size={12} />
              )}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-text-muted uppercase tracking-wider min-w-[72px]">
            {t("settings.openSource")}
          </span>
          <div className="flex items-center gap-2">
            <GithubIcon size={14} className="text-text-muted" />
            <a
              href={GITHUB_REPO}
              onClick={(e) => {
                e.preventDefault();
                handleOpenUrl(GITHUB_REPO);
              }}
              className="text-accent hover:underline font-mono"
            >
              {GITHUB_REPO}
            </a>
          </div>
        </div>
      </div>
      <p className="mt-5 text-xs text-text-muted">
        © {new Date().getFullYear()} {AUTHOR}. {t("settings.copyright")}.
      </p>
    </section>
  );
}
