import type { DataCategory } from "@booth/shared";

export interface PiiFinding {
  detector: string;
  category: DataCategory;
}

/**
 * Layer 3 — PII flagging. Detection is best-effort and never claimed to be
 * exhaustive; policy decides what happens to flagged content.
 */
export function scanTextForPii(text: string): PiiFinding[] {
  const findings: PiiFinding[] = [];

  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)) {
    findings.push({ detector: "email_address", category: "pii" });
  }
  // US-style phone numbers (with separators, to avoid matching plain ids)
  if (/(\+?1[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/.test(text)) {
    findings.push({ detector: "phone_number", category: "pii" });
  }
  // US SSN
  if (/\b\d{3}-\d{2}-\d{4}\b/.test(text)) {
    findings.push({ detector: "ssn", category: "pii" });
  }
  // Payment cards: 13-19 digits (allowing separators) passing Luhn
  const cardMatches = text.match(/\b(?:\d[ -]?){13,19}\b/g) ?? [];
  for (const raw of cardMatches) {
    const digits = raw.replace(/[^\d]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhnValid(digits)) {
      findings.push({ detector: "payment_card", category: "financial" });
      break;
    }
  }
  return findings;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}
