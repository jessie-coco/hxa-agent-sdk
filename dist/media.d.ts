import type { DownloadMediaOptions } from './types.js';
/**
 * Download a media file from HxA Link.
 *
 * Handles relative `/files/...` paths by resolving them against the provided
 * base URL. Supports bearer-token auth for accessing protected media endpoints.
 *
 * @returns The downloaded file as a Buffer.
 */
export declare function downloadMedia(options: DownloadMediaOptions): Promise<Buffer>;
//# sourceMappingURL=media.d.ts.map