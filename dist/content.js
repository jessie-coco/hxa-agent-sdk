/**
 * Parse an incoming message's raw content into a typed discriminated union.
 *
 * The platform stores content as jsonb but agents may receive it as either
 * a JSON string or an already-parsed object. This function normalizes both
 * forms into a strongly-typed {@link ParsedContent}.
 */
export function parseMessageContent(message) {
    const raw = typeof message.content === 'string'
        ? tryParseJson(message.content)
        : message.content;
    const type = message.type || 'text';
    switch (type) {
        case 'text':
            return parseText(raw);
        case 'image':
            return parseImage(raw);
        case 'file':
            return parseFile(raw);
        case 'voice':
            return parseVoice(raw);
        case 'video':
            return parseVideo(raw);
        case 'card':
            return parseCard(raw);
        case 'location':
            return parseLocation(raw);
        case 'emoji_big':
            return parseEmojiBig(raw);
        case 'poll':
            return parsePoll(raw);
        case 'burn_after_reading':
            return parseBurnAfterReading(raw);
        default:
            return { type: 'text', text: typeof raw === 'string' ? raw : JSON.stringify(raw) };
    }
}
/**
 * Resolve a relative file path (e.g. `/files/2026-05-19/abc.png`) to an
 * absolute URL using the given base URL.
 */
export function resolveMediaUrl(urlOrPath, baseUrl) {
    if (!urlOrPath)
        return urlOrPath;
    if (urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://'))
        return urlOrPath;
    return `${baseUrl.replace(/\/+$/, '')}${urlOrPath.startsWith('/') ? '' : '/'}${urlOrPath}`;
}
/**
 * Format a file size in bytes into a human-readable string.
 */
export function formatFileSize(bytes) {
    if (!bytes || bytes <= 0)
        return '';
    if (bytes < 1024)
        return `${bytes}B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
// ── Internal helpers ────────────────────────────────────────────────────────
function tryParseJson(str) {
    if (!str.startsWith('{') && !str.startsWith('['))
        return str;
    try {
        return JSON.parse(str);
    }
    catch {
        return str;
    }
}
function str(val) {
    if (typeof val === 'string')
        return val;
    if (val == null)
        return '';
    return String(val);
}
function num(val) {
    if (typeof val === 'number')
        return val;
    if (typeof val === 'string') {
        const n = Number(val);
        return isNaN(n) ? undefined : n;
    }
    return undefined;
}
function obj(raw) {
    if (raw && typeof raw === 'object' && !Array.isArray(raw))
        return raw;
    return {};
}
function parseText(raw) {
    if (typeof raw === 'string')
        return { type: 'text', text: raw };
    const o = obj(raw);
    return { type: 'text', text: str(o.text ?? o.content ?? '') };
}
function parseImage(raw) {
    if (typeof raw === 'string')
        return { type: 'image', url: raw };
    const o = obj(raw);
    return {
        type: 'image',
        url: str(o.url),
        fileName: o.fileName ? str(o.fileName) : o.filename ? str(o.filename) : undefined,
        caption: o.caption ? str(o.caption) : o.text ? str(o.text) : undefined,
        size: num(o.size),
        width: num(o.width),
        height: num(o.height),
    };
}
function parseFile(raw) {
    if (typeof raw === 'string')
        return { type: 'file', url: raw, fileName: 'file' };
    const o = obj(raw);
    return {
        type: 'file',
        url: str(o.url),
        fileName: str(o.fileName ?? o.filename ?? 'file'),
        size: num(o.size),
        mimeType: o.mimeType ? str(o.mimeType) : o.mime_type ? str(o.mime_type) : undefined,
    };
}
function parseVoice(raw) {
    if (typeof raw === 'string')
        return { type: 'voice', url: raw };
    const o = obj(raw);
    return { type: 'voice', url: str(o.url), duration: num(o.duration) };
}
function parseVideo(raw) {
    if (typeof raw === 'string')
        return { type: 'video', url: raw };
    const o = obj(raw);
    return {
        type: 'video',
        url: str(o.url),
        fileName: o.fileName ? str(o.fileName) : o.filename ? str(o.filename) : undefined,
        duration: num(o.duration),
        size: num(o.size),
        width: num(o.width),
        height: num(o.height),
    };
}
function parseCard(raw) {
    const o = obj(raw);
    return {
        type: 'card',
        title: str(o.title ?? 'Untitled'),
        subtitle: o.subtitle ? str(o.subtitle) : undefined,
        fields: Array.isArray(o.fields) ? o.fields.map((f) => {
            const fo = obj(f);
            return { label: str(fo.label), value: str(fo.value) };
        }) : undefined,
        actions: Array.isArray(o.actions) ? o.actions.map((a) => {
            const ao = obj(a);
            return { label: str(ao.label), url: str(ao.url) };
        }) : undefined,
    };
}
function parseLocation(raw) {
    const o = obj(raw);
    return {
        type: 'location',
        latitude: num(o.latitude ?? o.lat) ?? 0,
        longitude: num(o.longitude ?? o.lng ?? o.lon) ?? 0,
        name: o.name ? str(o.name) : undefined,
        address: o.address ? str(o.address) : undefined,
    };
}
function parseEmojiBig(raw) {
    if (typeof raw === 'string')
        return { type: 'emoji_big', emoji: raw };
    const o = obj(raw);
    return { type: 'emoji_big', emoji: str(o.emoji ?? o.text ?? o.content ?? '') };
}
function parsePoll(raw) {
    const o = obj(raw);
    return {
        type: 'poll',
        question: str(o.question ?? o.title ?? 'Poll'),
        options: Array.isArray(o.options) ? o.options.map((opt) => {
            if (typeof opt === 'string')
                return { text: opt };
            const oo = obj(opt);
            return { text: str(oo.text ?? oo.label ?? ''), votes: num(oo.votes) };
        }) : [],
    };
}
function parseBurnAfterReading(raw) {
    if (typeof raw === 'string')
        return { type: 'burn_after_reading', text: raw };
    const o = obj(raw);
    return { type: 'burn_after_reading', text: str(o.text ?? o.content ?? '') };
}
//# sourceMappingURL=content.js.map