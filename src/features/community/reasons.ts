import type { ReportReason } from "../../api/community";
import { strings } from "../../strings";

/** Each reason in words, the same in the report sheet and in the moderators' queue. */
export const REASON_TEXT: Record<ReportReason, string> = {
  sexual: strings.report.reasonSexual,
  violence: strings.report.reasonViolence,
  hate: strings.report.reasonHate,
  spam: strings.report.reasonSpam,
  other: strings.report.reasonOther,
  wrong_category: strings.report.reasonWrongPlace,
};
