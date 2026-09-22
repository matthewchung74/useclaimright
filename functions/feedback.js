// In-app feedback (the floating bubble). Validation is pure so node:test can
// cover it; the callable in index.js does auth + rate limiting + the write.
// Contract mirrors askmyfit's feedback lib: message + category + light context.

// "question" is the one a stuck person sends — "what is an EOB", "where do I
// find it" — asked from the step they are stuck on, and answered by a person.
export const FEEDBACK_CATEGORIES = ["question", "bug", "idea", "other"];
export const FEEDBACK_MESSAGE_MAX_LENGTH = 1000;

export function validateFeedback(input) {
  const errors = [];
  const message = typeof input?.message === "string" ? input.message.trim() : "";
  if (!message) errors.push("message is required");
  if (message.length > FEEDBACK_MESSAGE_MAX_LENGTH) errors.push(`message exceeds ${FEEDBACK_MESSAGE_MAX_LENGTH} characters`);
  if (!FEEDBACK_CATEGORIES.includes(input?.category)) errors.push("category must be question, bug, idea, or other");
  if (input?.screen != null && (typeof input.screen !== "string" || input.screen.length > 120)) errors.push("bad screen");
  if (input?.auditId != null && (typeof input.auditId !== "string" || input.auditId.length > 200)) errors.push("bad auditId");
  return {
    ok: errors.length === 0,
    errors,
    value: {
      message,
      category: input?.category ?? null,
      screen: typeof input?.screen === "string" ? input.screen : null,
      auditId: typeof input?.auditId === "string" ? input.auditId : null,
    },
  };
}
