/**
 * Interval Parser Utility
 *
 * Parses custom interval formats into milliseconds for AutoPay scheduling
 * Supports: "3600s", "1h", "30m", "1d", "5w", or raw milliseconds
 */

export function parseIntervalFormat(input: string): number {
  const trimmed = input.trim();

  // Direct milliseconds (all digits)
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10);
  }

  // Parse with unit suffix
  const match = trimmed.match(/^(\d+\.?\d*)\s*([a-zA-Z]+)$/);
  if (!match) throw new Error(`Invalid interval format: ${input}`);

  const [, numStr, unit] = match;
  const num = parseFloat(numStr);

  const unitMap: Record<string, number> = {
    // Milliseconds
    ms: 1,
    // Seconds
    s: 1000,
    sec: 1000,
    second: 1000,
    seconds: 1000,
    // Minutes
    m: 60 * 1000,
    min: 60 * 1000,
    minute: 60 * 1000,
    minutes: 60 * 1000,
    // Hours
    h: 60 * 60 * 1000,
    hr: 60 * 60 * 1000,
    hour: 60 * 60 * 1000,
    hours: 60 * 60 * 1000,
    // Days
    d: 24 * 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
    // Weeks
    w: 7 * 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    weeks: 7 * 24 * 60 * 60 * 1000,
  };

  const multiplier = unitMap[unit.toLowerCase()];
  if (!multiplier) throw new Error(`Unknown time unit: ${unit}`);

  return Math.floor(num * multiplier);
}

/**
 * Format milliseconds into human-readable duration string
 *
 * @param ms Milliseconds to format
 * @returns Formatted string (e.g., "1h", "30m", "5000s")
 */
export function formatIntervalForDisplay(ms: number): string {
  // Less than a minute - show seconds
  if (ms < 60000) {
    return `${Math.round(ms / 1000)}s`;
  }

  // Less than an hour - show minutes
  if (ms < 3600000) {
    return `${Math.round(ms / 60000)}m`;
  }

  // Less than a day - show hours
  if (ms < 86400000) {
    return `${Math.round(ms / 3600000)}h`;
  }

  // Less than a week - show days
  if (ms < 604800000) {
    return `${Math.round(ms / 86400000)}d`;
  }

  // Show weeks
  return `${Math.round(ms / 604800000)}w`;
}

/**
 * Validate interval format
 *
 * @param input Interval string to validate
 * @returns true if valid, throws error if invalid
 */
export function isValidIntervalFormat(input: string): boolean {
  try {
    parseIntervalFormat(input);
    return true;
  } catch {
    return false;
  }
}
