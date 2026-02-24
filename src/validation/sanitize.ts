export function sanitizePath(p: string) {
    const cleaned = p.replace(/\\/g, "/").replace(/^\/+/, ""); // no leading slash
    if (!cleaned) throw new Error("Empty path");
    if (cleaned.includes("..")) throw new Error("Path traversal detected");
    return cleaned;
}