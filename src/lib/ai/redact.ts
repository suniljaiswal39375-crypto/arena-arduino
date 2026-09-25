/**
 * PII redaction for anything that leaves the browser on an AI request.
 *
 * The privacy rule this module serves (spec §19): *no PII in AI prompts* —
 * redact names, emails, phone numbers and handles before egress, and log
 * nothing. Redaction is deliberately conservative: it replaces only patterns
 * that are personal data, never circuit or sketch content.
 */

export const REDACTIONS = {
  email: '[email]',
  phone: '[phone]',
  handle: '[handle]',
  name: '[name]',
  url: '[url]',
} as const;

/**
 * Redact personal data from free text a student typed.
 *
 * Handled: email addresses, international/local phone numbers, @handles,
 * "my name is …" / "mera naam … hai" self-introductions, and URLs that carry
 * credentials or query strings. Everything else is passed through untouched —
 * over-redaction would strip the technical content the mentor needs.
 */
export function redactPII(text: string): string {
  let out = text;
  // URLs first: a URL can contain an email-looking userinfo, and any URL with
  // credentials or a query string is gone entirely.
  out = out.replace(/\bhttps?:\/\/\S+/g, (m) => (/@|\?/.test(m) ? REDACTIONS.url : m));
  // Emails.
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, REDACTIONS.email);
  // @handles (but not electrical units or pin names — require a letter start
  // and a word boundary, so "R1 @ 5V" survives).
  out = out.replace(/(^|[\s(])@([A-Za-z][A-Za-z0-9_]{2,})/g, `$1${REDACTIONS.handle}`);
  // Phone numbers: +CC xxxx or 10-digit runs that are not pin numbers.
  // Pin numbers in student text are 1-2 digits, so a 10+ digit run is a phone.
  out = out.replace(/(^|[\s(])\+?\d[\d\s-]{8,}\d(?=$|[\s.,!?)])/g, `$1${REDACTIONS.phone}`);
  // Self-introductions in English and Hindi.
  out = out.replace(/\bmy name is\s+([A-Z][A-Za-z' -]{1,30})/gi, `my name is ${REDACTIONS.name}`);
  out = out.replace(/\bI am\s+([A-Z][A-Za-z' -]{1,30})\s*(?:from|,)/gi, `I am ${REDACTIONS.name},`);
  out = out.replace(/मेरा नाम\s+([\u0900-\u097F][\u0900-\u097F\s]{1,30}?)\s*है/g, `मेरा नाम ${REDACTIONS.name} है`);
  return out;
}

/** True when the text still contains a pattern redactPII would replace. */
export function containsPII(text: string): boolean {
  return redactPII(text) !== text;
}
