import type { IncomingMessage, ParsedContent } from './types.js';
/**
 * Parse an incoming message's raw content into a typed discriminated union.
 *
 * The platform stores content as jsonb but agents may receive it as either
 * a JSON string or an already-parsed object. This function normalizes both
 * forms into a strongly-typed {@link ParsedContent}.
 */
export declare function parseMessageContent(message: IncomingMessage): ParsedContent;
/**
 * Resolve a relative file path (e.g. `/files/2026-05-19/abc.png`) to an
 * absolute URL using the given base URL.
 */
export declare function resolveMediaUrl(urlOrPath: string, baseUrl: string): string;
/**
 * Format a file size in bytes into a human-readable string.
 */
export declare function formatFileSize(bytes: number | undefined | null): string;
//# sourceMappingURL=content.d.ts.map