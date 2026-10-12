// API errors are Effect tagged errors whose .message is often empty;
// turn the tag into something a person can read.
const MESSAGES: Record<string, string> = {
  DeviceMismatch: "Rejected: this isn't the device enrolled for your account (proxy attempt blocked).",
  OutOfRange: "Rejected: you're outside the classroom geofence, or location was not shared.",
  QrExpired: "Rejected: this QR code has expired. Scan the one currently on screen.",
  QrReplay: "Rejected: attendance is already marked for this session.",
  SignatureInvalid: "Rejected: the QR code or signature failed verification.",
  SessionEnded: "This session has already ended.",
  Unauthorized: "You're not authorized to do that.",
  NotFound: "Not found.",
};

export function errorText(err: any): string | undefined {
  const tag = err?._tag as string | undefined;
  if (tag && MESSAGES[tag]) return MESSAGES[tag];
  const msg = typeof err?.message === "string" ? err.message.trim() : "";
  return msg && msg !== "{ }" && msg !== "{}" ? msg : undefined;
}
