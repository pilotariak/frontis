import { describe, expect, test } from "bun:test";
import { parseHttpResponse, socketConnect } from "./socket-fetch";

const encoder = new TextEncoder();
const bytes = (...parts: (string | Uint8Array)[]): Uint8Array<ArrayBuffer> => {
  const chunks = parts.map((p) => (typeof p === "string" ? encoder.encode(p) : p));
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
};

describe("parseHttpResponse", () => {
  test("accepts a Content-Length padded with spaces, as competition.ffpb.net sends it", async () => {
    const res = await parseHttpResponse(
      bytes("HTTP/1.1 200 OK\r\nContent-Length: 5              \r\nContent-Type: text/html; charset=utf-8\r\n\r\nhello")
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await res.text()).toBe("hello");
  });

  test("joins a chunked body and decompresses gzip", async () => {
    const xml = '<?xml version="1.0" encoding="utf-8" ?><WAJAX><CHAMP ALIAS="I164" TYPE="3">Équipe</CHAMP></WAJAX>';
    const gzip = Bun.gzipSync(encoder.encode(xml));
    const half = Math.floor(gzip.byteLength / 2);
    const res = await parseHttpResponse(
      bytes(
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Encoding: gzip\r\n\r\n",
        `${half.toString(16)}\r\n`, gzip.subarray(0, half), "\r\n",
        `${(gzip.byteLength - half).toString(16)};ext=1\r\n`, gzip.subarray(half), "\r\n",
        "0\r\n\r\n"
      )
    );
    expect(await res.text()).toBe(xml);
    expect(res.headers.has("content-encoding")).toBe(false);
  });

  test("keeps each Set-Cookie whole, commas of the expiry date included", async () => {
    const res = await parseHttpResponse(
      bytes(
        "HTTP/1.1 200 OK\r\n",
        "Set-Cookie: A=1; expires=Sat, 19 Dec 2026 00:00:00 GMT; path=/; secure\r\n",
        "Set-Cookie: B=2; httponly; path=/\r\n",
        "Content-Length: 0\r\n\r\n"
      )
    );
    expect(res.headers.getSetCookie()).toEqual([
      "A=1; expires=Sat, 19 Dec 2026 00:00:00 GMT; path=/; secure",
      "B=2; httponly; path=/",
    ]);
  });

  test("keeps the status of an error answer", async () => {
    const res = await parseHttpResponse(bytes("HTTP/1.1 400 Bad Request\r\nContent-Length: 6\r\n\r\nCGI191"));
    expect(res.status).toBe(400);
    expect(res.statusText).toBe("Bad Request");
    expect(res.ok).toBe(false);
  });

  test("fails on a body shorter than its Content-Length", async () => {
    await expect(parseHttpResponse(bytes("HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nshort"))).rejects.toThrow(
      "Truncated body: 5 of 10 bytes"
    );
  });

  test("fails on a chunked body without its last chunk", async () => {
    await expect(
      parseHttpResponse(bytes("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n"))
    ).rejects.toThrow("Truncated chunked body");
  });

  test("fails without the end of the headers", async () => {
    await expect(parseHttpResponse(bytes("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n"))).rejects.toThrow(
      "no end of headers"
    );
  });
});

describe("socketConnect", () => {
  test("is null outside workerd, so the scrapers fall back to fetch()", async () => {
    expect(await socketConnect()).toBeNull();
  });
});
