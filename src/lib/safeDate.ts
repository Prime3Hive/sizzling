import { format } from "date-fns";

/**
 * Safely format a date value. Returns `fallback` instead of throwing a
 * RangeError ("Invalid time value") when the input is null, undefined,
 * empty, or otherwise unparseable.
 */
export function safeFormat(
  value: string | number | Date | null | undefined,
  fmt: string,
  fallback = "—",
): string {
  if (value === null || value === undefined || value === "") return fallback;
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return fallback;
  return format(d, fmt);
}
