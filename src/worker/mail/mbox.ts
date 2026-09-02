/** Splits an mbox buffer on "From " separator lines. */
export function splitMbox(buffer: Uint8Array): Uint8Array[] {
  const text = new TextDecoder().decode(buffer);
  const parts = text.split(/^From [^\n]*\n/m).filter((p) => p.trim().length > 0);
  const encoder = new TextEncoder();
  return parts.map((p) => encoder.encode(p.replace(/^>(>*From )/gm, '$1')));
}
