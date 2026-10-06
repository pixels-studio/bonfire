const LOCAL_HOST =
  /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:[/?#]|$)/i;
const HOST_WITH_PORT = /^[a-z0-9.-]+:\d+(?:[/?#]|$)/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Turns what was typed in the URL bar into a page to load: web URLs as they are,
 * local servers (`localhost:3000`) over http, other hosts over https, and anything
 * else as a search. Other schemes, such as `file:` or `javascript:`, give undefined.
 */
export function toBrowserUrl(typed: string): string | undefined {
  const value = typed.trim();
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return parse(value);
  if (LOCAL_HOST.test(value)) return parse(`http://${value}`);
  if (HOST_WITH_PORT.test(value)) return parse(`http://${value}`);
  if (SCHEME.test(value)) return undefined;
  if (!/\s/.test(value) && /^[^/?#]+\.[a-z]{2,}(?:[/?#:]|$)/i.test(value))
    return parse(`https://${value}`);
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

function parse(value: string) {
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}
