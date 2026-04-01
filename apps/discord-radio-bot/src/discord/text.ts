const TRUNCATION_MARKER = '\u2026';

export function clampDiscordComponentText(
  value: string,
  limit: number,
): string {
  if (value.length <= limit) {
    return value;
  }

  if (limit <= TRUNCATION_MARKER.length) {
    return TRUNCATION_MARKER.slice(0, limit);
  }

  return `${value.slice(0, limit - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}
