export function artworkRetryUrl(
  url: string,
  retryToken: string | number = Date.now(),
) {
  const hashIndex = url.indexOf("#");
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : "";
  const separator = base.includes("?") ? "&" : "?";
  return `${base}${separator}texture-retry=${encodeURIComponent(
    String(retryToken),
  )}${hash}`;
}
