/**
 * HTTP/1.1 over a TLS socket (`cloudflare:sockets`), for a site whose answers
 * the workerd `fetch()` rejects.
 *
 * competition.ffpb.net pads its Content-Length with trailing spaces
 * ("Content-Length: 157287              "). RFC 9110 tells parsers to strip
 * that whitespace, but the workerd HTTP client fails the whole request with
 * "invalid Content-Length header value". The site only omits the header when
 * it compresses the answer, and it compresses some answers and not others,
 * depending on the time. Reading the answer from a socket and parsing it here
 * works either way.
 *
 * Every request opens its own connection with `Connection: close`, so the
 * answer ends when the server closes it.
 */

type Connect = (typeof import("cloudflare:sockets"))["connect"];
type Bytes = Uint8Array<ArrayBuffer>;

let sockets: Promise<Connect | null> | undefined;

/**
 * `connect` of `cloudflare:sockets` under workerd, null where the module does
 * not exist (Bun, which runs the unit tests: they mock `fetch()` instead).
 */
export function socketConnect(): Promise<Connect | null> {
  sockets ??= import("cloudflare:sockets").then(
    (m) => m.connect,
    () => null
  );
  return sockets;
}

export interface SocketRequest {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
}

/** Send one request over a new TLS connection and read the whole answer. */
export async function socketFetch(connect: Connect, url: string, request: SocketRequest): Promise<Response> {
  const target = new URL(url);
  const encoder = new TextEncoder();
  const body = request.body === undefined ? undefined : encoder.encode(request.body);

  const lines = [`${request.method} ${target.pathname}${target.search} HTTP/1.1`, `Host: ${target.host}`];
  for (const [name, value] of Object.entries(request.headers)) lines.push(`${name}: ${value}`);
  if (body) lines.push(`Content-Length: ${body.byteLength}`);
  lines.push("Connection: close", "", "");

  const socket = connect(
    { hostname: target.hostname, port: Number(target.port || 443) },
    { secureTransport: "on", allowHalfOpen: false }
  );
  try {
    const writer = socket.writable.getWriter();
    await writer.write(encoder.encode(lines.join("\r\n")));
    if (body) await writer.write(body);
    writer.releaseLock();
    return await parseHttpResponse(await readAll(socket.readable));
  } finally {
    await socket.close().catch(() => {});
  }
}

/**
 * Everything the server sends until it closes the connection. A server that
 * closes without a TLS close_notify makes the last read fail ("Network
 * connection lost"): once bytes have arrived, that counts as the end, and
 * parseHttpResponse checks the body is whole.
 */
async function readAll(stream: ReadableStream<Uint8Array>): Promise<Bytes> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = stream.getReader();
  for (;;) {
    let next: Awaited<ReturnType<typeof reader.read>>;
    try {
      next = await reader.read();
    } catch (err) {
      if (size === 0) throw err;
      break;
    }
    if (next.done) break;
    chunks.push(next.value);
    size += next.value.byteLength;
  }
  return concat(chunks, size);
}

function concat(chunks: Uint8Array[], size: number): Bytes {
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** Index of the first CR LF at or after `from`, or -1. */
function crlf(bytes: Uint8Array, from: number): number {
  for (let i = from; i < bytes.length - 1; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10) return i;
  }
  return -1;
}

function dechunk(bytes: Bytes): Bytes {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let at = 0;
  for (;;) {
    const eol = crlf(bytes, at);
    if (eol === -1) throw new Error("Truncated chunked body");
    // "1a2b;extension" → 0x1a2b
    const length = Number.parseInt(new TextDecoder().decode(bytes.subarray(at, eol)).split(";")[0].trim(), 16);
    if (Number.isNaN(length)) throw new Error("Invalid chunk size");
    if (length === 0) break;
    const start = eol + 2;
    if (start + length > bytes.length) throw new Error("Truncated chunked body");
    chunks.push(bytes.subarray(start, start + length));
    size += length;
    at = start + length + 2;
  }
  return concat(chunks, size);
}

/**
 * The raw bytes of an HTTP/1.1 answer as a Response: header values trimmed,
 * chunked bodies joined, gzip bodies decompressed. Set-Cookie lines stay
 * separate, so `headers.getSetCookie()` returns each one whole.
 */
export async function parseHttpResponse(bytes: Bytes): Promise<Response> {
  let end = -1;
  for (let i = 0; i + 3 < bytes.length; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10 && bytes[i + 2] === 13 && bytes[i + 3] === 10) {
      end = i;
      break;
    }
  }
  if (end === -1) throw new Error("Incomplete HTTP answer: no end of headers");

  const [statusLine, ...headerLines] = new TextDecoder().decode(bytes.subarray(0, end)).split("\r\n");
  const status = /^HTTP\/1\.[01] (\d{3})(?: (.*))?$/.exec(statusLine);
  if (!status) throw new Error(`Invalid HTTP status line: ${statusLine}`);

  const headers = new Headers();
  let length: number | undefined;
  let chunked = false;
  let gzip = false;
  for (const line of headerLines) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (name === "content-length") length = Number.parseInt(value, 10);
    else if (name === "transfer-encoding") chunked = value.toLowerCase().includes("chunked");
    else if (name === "content-encoding" && value.toLowerCase() === "gzip") gzip = true;
    else headers.append(name, value);
  }

  let body = bytes.subarray(end + 4);
  if (chunked) body = dechunk(body);
  else if (length !== undefined && !Number.isNaN(length)) {
    if (body.byteLength < length) throw new Error(`Truncated body: ${body.byteLength} of ${length} bytes`);
    body = body.subarray(0, length);
  }
  if (gzip) {
    const stream = new Response(body).body!.pipeThrough(new DecompressionStream("gzip"));
    body = new Uint8Array(await new Response(stream).arrayBuffer());
  }

  return new Response(body, { status: Number(status[1]), statusText: status[2] ?? "", headers });
}
