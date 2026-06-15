/**
 * Format a duration in minutes as a relative-time label using i18n keys.
 * Returns the full translated string ready to display.
 */
export function formatRelativeMinutes(
  minutes: number,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (minutes < 60) {
    return t("admin.relativeTime.minutesAgo", { n: minutes });
  }
  const hours = Math.floor(minutes / 60);
  return t("admin.relativeTime.hoursAgo", { n: hours });
}
