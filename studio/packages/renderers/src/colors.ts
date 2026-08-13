export function normalizeHex(value: string): string {
  const stripped = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(stripped)) {
    return stripped
      .split("")
      .map((character) => character + character)
      .join("")
      .toUpperCase();
  }
  return /^[0-9a-f]{6}$/i.test(stripped) ? stripped.toUpperCase() : "000000";
}

export function resolveColor(value: string | undefined, tokens: Record<string, string>, fallback: string): string {
  if (!value) return normalizeHex(fallback);
  return normalizeHex(tokens[value] ?? value);
}
