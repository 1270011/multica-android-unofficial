/**
 * Image sources that carry the Cloudflare Access service token.
 *
 * `<Image source={{ uri }}>` issues its own HTTP request outside
 * `ApiClient`, so avatars, attachment previews and markdown images would
 * otherwise hit Access without the token and render the login page bytes
 * (i.e. nothing). RN's `Image`, expo-image and react-native-image-viewing
 * all accept `{ uri, headers }`, so one helper covers every call site.
 *
 * The token is only attached for URLs on the configured server origin —
 * `headersForUrl` drops it for CDN / external images.
 */
import { getServerConfig } from "@/data/server-config-store";
import { headersForUrl } from "@/lib/server-config";

export interface AuthImageSource {
  uri: string;
  headers?: Record<string, string>;
}

export function authHeadersFor(uri: string): Record<string, string> | undefined {
  const headers = headersForUrl(uri, getServerConfig());
  return Object.keys(headers).length > 0 ? headers : undefined;
}

export function authImageSource(uri: string): AuthImageSource {
  const headers = authHeadersFor(uri);
  return headers ? { uri, headers } : { uri };
}
