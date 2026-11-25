export function getSafeRedirectPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/";
  }

  const destination = new URL(value, "https://faams.invalid");
  if (destination.origin !== "https://faams.invalid") {
    return "/";
  }
  return `${destination.pathname}${destination.search}${destination.hash}`;
}
