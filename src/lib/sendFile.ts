import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

const TYPES: Record<string, string> = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".mp4": "video/mp4",
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".wav": "audio/wav",
};

/** Sends a local file, with byte ranges so videos and music can be scrubbed in the browser. Server-only. */
export function sendFile(req: Request, full: string): NextResponse {
  let size: number;
  try { size = fs.statSync(full).size; } catch { return new NextResponse("Not found", { status: 404 }); }
  const type = TYPES[path.extname(full).toLowerCase()] ?? "application/octet-stream";
  const headers = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-store" };
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
    if (start > end || start >= size) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const buf = Buffer.alloc(end - start + 1);
    const fd = fs.openSync(full, "r");
    try { fs.readSync(fd, buf, 0, buf.length, start); } finally { fs.closeSync(fd); }
    return new NextResponse(new Uint8Array(buf), { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(buf.length) } });
  }
  return new NextResponse(new Uint8Array(fs.readFileSync(full)), { headers: { ...headers, "Content-Length": String(size) } });
}
