// The addresses the sender accepts: those nodemailer hands to the relay as
// they are, but for the case of the domain, which it lowercases. nodemailer
// normalizes every address, in object form too: it quotes a local part that
// is not a dot-atom, punycodes and maps a domain through a WHATWG host
// parser, and drops `<`, `>` and control characters. The grammar keeps what
// survives that unchanged, and refuses the rest, some valid addresses
// included (a quoted local part, an international address, an address
// literal).

// The atext of RFC 5322, ASCII only.
const ATEXT = "[A-Za-z0-9!#$%&'*+\\-/=?^_`{|}~]";
const LOCAL_PART = `${ATEXT}+(?:\\.${ATEXT}+)*`;
// Letters, digits and hyphens, with no hyphen at either end.
const LABEL = "[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?";
// The host parser reads a domain whose last label is a number (`123`,
// `0x7f`) as an IPv4 address: `user@123` would reach the relay as
// `user@0.0.0.123`. Every top-level domain starts with a letter.
const LAST_LABEL = "[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?";
const ADDRESS = new RegExp(`^${LOCAL_PART}@(?:${LABEL}\\.)*${LAST_LABEL}$`);

/**
 * Whether the sender accepts `address`: a dot-atom of ASCII characters, `@`,
 * and a domain of letters, digits and hyphens whose last label starts with a
 * letter.
 */
export function isAcceptedAddress(address: string): boolean {
  return ADDRESS.test(address);
}

/**
 * How nodemailer writes an accepted address into the envelope, and into the
 * `rejected` of a refusal: the local part as given, the domain lowercased.
 * The grammar above leaves it nothing else to change.
 */
export function envelopeFormOf(address: string): string {
  const at = address.lastIndexOf("@");
  return address.slice(0, at + 1) + address.slice(at + 1).toLowerCase();
}
