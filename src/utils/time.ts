import i18n from "@/i18n";

/**
 * 把 Unix 秒时间戳格式化为相对时间（刚刚 / n 分钟前 / n 小时前 / n 天前，
 * 超过 30 天回落到本地日期字符串）。
 */
export function formatRelativeTime(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "";
  const diffSeconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSeconds < 60) return i18n.t("time.justNow");
  if (diffSeconds < 3600) {
    return i18n.t("time.minutesAgo", { count: Math.floor(diffSeconds / 60) });
  }
  if (diffSeconds < 86400) {
    return i18n.t("time.hoursAgo", { count: Math.floor(diffSeconds / 3600) });
  }
  if (diffSeconds < 86400 * 30) {
    return i18n.t("time.daysAgo", { count: Math.floor(diffSeconds / 86400) });
  }
  return date.toLocaleDateString();
}
