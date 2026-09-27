import type { ReviewSeverity } from "@/types";

/** 审查严重程度徽章配色，ReviewView 与 PrReviewCard 共用。 */
export const severityClasses: Record<ReviewSeverity, string> = {
  critical: "bg-danger/20 text-danger",
  high: "bg-danger/15 text-danger",
  medium: "bg-warning/20 text-warning",
  low: "bg-accent/15 text-accent",
  info: "bg-bg-hover text-text-secondary",
};
