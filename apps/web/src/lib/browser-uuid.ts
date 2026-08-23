interface RandomSource {
  getRandomValues: Crypto["getRandomValues"];
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Generate a UUID v4 where randomUUID is unavailable, such as an HTTP LAN origin. */
export function createBrowserUuid(
  randomSource: RandomSource | undefined = globalThis.crypto,
): string {
  if (typeof randomSource?.getRandomValues !== "function") {
    throw new Error("Secure randomness is unavailable: crypto.getRandomValues is required.");
  }
  const bytes = new Uint8Array(16);
  randomSource.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(bytes);
}
