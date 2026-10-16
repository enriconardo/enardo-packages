// A decoder of RFC 2047 encoded words in UTF-8, as nodemailer writes a
// display name that a quoted string cannot hold (a line break, a non-ASCII
// character): `=?UTF-8?Q?Anna=0D=0ABcc=3A_…?=`, or `=?UTF-8?B?5pel5pys6Kqe?=`
// for mostly non-ASCII text, split into several words when it is long.

/** An encoded word in UTF-8: its encoding, then its encoded text. */
const ENCODED_WORD = /=\?UTF-8\?([BQ])\?([^?\s]*)\?=/gi;

const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** The bytes of a word's text in the Q encoding (RFC 2047, 4.2). */
function qBytes(text: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < text.length; index++) {
    const char = text.charAt(index);
    if (char === "_") {
      bytes.push(0x20);
    } else if (char === "=") {
      const hex = text.slice(index + 1, index + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(hex)) {
        throw new Error(`Malformed Q-encoded text: ${JSON.stringify(text)}`);
      }
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
    } else if (char.charCodeAt(0) > 0x20 && char.charCodeAt(0) < 0x7f) {
      bytes.push(char.charCodeAt(0));
    } else {
      throw new Error(`Malformed Q-encoded text: ${JSON.stringify(text)}`);
    }
  }
  return bytes;
}

/** The bytes of a word's text in the B encoding: base64. */
function bBytes(text: string): number[] {
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      text,
    )
  ) {
    throw new Error(`Malformed B-encoded text: ${JSON.stringify(text)}`);
  }
  return [...Buffer.from(text, "base64")];
}

/**
 * `text` with its encoded words in UTF-8 decoded, and everything else as it
 * is. Adjacent encoded words, with only whitespace between them, are joined:
 * that whitespace is not part of the text (RFC 2047, 6.2), and their bytes
 * are decoded together, so a character split across two words comes back
 * whole. Fails on a word that is not well formed, or on bytes that are not
 * UTF-8.
 */
export function decodeEncodedWords(text: string): string {
  let decoded = "";
  // The bytes of the run of adjacent encoded words under way.
  let pending: number[] = [];
  let inRun = false;
  let index = 0;

  const flush = (): void => {
    if (inRun) {
      decoded += UTF8.decode(new Uint8Array(pending));
      pending = [];
      inRun = false;
    }
  };

  for (const match of text.matchAll(ENCODED_WORD)) {
    const between = text.slice(index, match.index);
    if (!inRun || /\S/.test(between)) {
      flush();
      decoded += between;
    }
    const [, encoding = "", encoded = ""] = match;
    pending.push(
      ...(encoding.toUpperCase() === "B" ? bBytes(encoded) : qBytes(encoded)),
    );
    inRun = true;
    index = match.index + match[0].length;
  }
  flush();
  return decoded + text.slice(index);
}
