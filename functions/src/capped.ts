/**
 * A body read up to a limit and no further. `arrayBuffer()` reads all of it
 * first: one picture of 600 MB with no length took the instance past its
 * memory before the size was ever compared.
 */
export async function readCapped(
  response: globalThis.Response,
  maxBytes: number,
): Promise<Buffer | null> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (response.body === null) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}
