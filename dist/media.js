import { resolveMediaUrl } from './content.js';
/**
 * Download a media file from HxA Link.
 *
 * Handles relative `/files/...` paths by resolving them against the provided
 * base URL. Supports bearer-token auth for accessing protected media endpoints.
 *
 * @returns The downloaded file as a Buffer.
 */
export async function downloadMedia(options) {
    const { url, baseUrl, authToken, timeout = 30_000 } = options;
    const fullUrl = baseUrl ? resolveMediaUrl(url, baseUrl) : url;
    const headers = {};
    if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
    }
    const resp = await fetch(fullUrl, {
        headers,
        signal: AbortSignal.timeout(timeout),
    });
    if (!resp.ok) {
        throw new Error(`Media download failed: HTTP ${resp.status} ${resp.statusText} (${fullUrl})`);
    }
    return Buffer.from(await resp.arrayBuffer());
}
//# sourceMappingURL=media.js.map