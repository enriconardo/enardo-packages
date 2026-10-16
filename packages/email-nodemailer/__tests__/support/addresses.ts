import { domainToASCII } from "node:url";

// Seeded generators of addresses: the grammar that the sender accepts, and
// mutations of its addresses. The grammar, from the spec's Probes:
//
//   address = local "@" domain
//   local   = atext+ ("." atext+)*      atext: A–Z a–z 0–9 ! # $ % & ' * + - / = ? ^ _ ` { | } ~
//   domain  = (label ".")* last
//   label   = alnum (ldh* alnum)?        alnum: A–Z a–z 0–9    ldh: alnum and -
//   last    = alpha (ldh* alnum)?        alpha: A–Z a–z

/** A random number in [0, 1), from a seed: the same seed, the same series. */
export type Random = () => number;

/** mulberry32: small, fast, and good enough to spread test inputs. */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function integer(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function pick<T>(random: Random, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) {
    throw new Error("Cannot pick from an empty list");
  }
  return item;
}

function chars(text: string): readonly string[] {
  return Array.from(text);
}

const ALPHA = chars("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz");
const DIGIT = chars("0123456789");
const ALNUM = [...ALPHA, ...DIGIT];
const LDH = [...ALNUM, "-"];
const ATEXT = [...ALNUM, ...chars("!#$%&'*+-/=?^_`{|}~")];

/** Letters of other scripts, from which A-labels are made. */
const UNICODE = chars(
  "àáâãäåæçèéêëìíîïñòóôõöøùúûüýþÿœāăąćčďđēęěğīłńňőřśşšťūůűźżž" +
    "αβγδεζηθικλμνξοπρστυφχψωабвгдежзийклмнопрстуфхцчшщыэюя" +
    "日本語中文字한국어",
);

const LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const LAST_LABEL = /^[A-Za-z](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

function word(
  random: Random,
  alphabet: readonly string[],
  max: number,
): string {
  return Array.from({ length: integer(random, 1, max) }, () =>
    pick(random, alphabet),
  ).join("");
}

function randomCase(random: Random, text: string): string {
  switch (integer(random, 0, 2)) {
    case 0:
      return text.toLowerCase();
    case 1:
      return text.toUpperCase();
    default:
      return Array.from(text, (char) =>
        random() < 0.5 ? char.toLowerCase() : char.toUpperCase(),
      ).join("");
  }
}

/** first, then up to `max` LDH characters, then an alphanumeric one. */
function ldhLabel(
  random: Random,
  first: readonly string[],
  max: number,
): string {
  const head = pick(random, first);
  if (random() < 0.2) {
    return head;
  }
  const middle = integer(random, 0, max) > 0 ? word(random, LDH, max) : "";
  return `${head}${middle}${pick(random, ALNUM)}`;
}

/** A valid A-label, from a random string of other scripts, or undefined. */
function aLabel(random: Random): string | undefined {
  const text = Array.from({ length: integer(random, 1, 6) }, () =>
    random() < 0.8 ? pick(random, UNICODE) : pick(random, ALPHA),
  ).join("");
  const ascii = domainToASCII(text);
  return ascii.startsWith("xn--") && LABEL.test(ascii) ? ascii : undefined;
}

/** An `xn--` label that is most likely not valid punycode. */
function looseXnLabel(random: Random): string {
  return `${pick(random, ["xn--", "XN--", "Xn--"])}${word(random, ALNUM, 8)}`;
}

/** A label with `--` inside, starting with one of `first`. */
function doubleHyphenLabel(random: Random, first: readonly string[]): string {
  return `${pick(random, first)}${word(random, ALNUM, 4)}--${word(random, ALNUM, 4)}`;
}

function label(random: Random): string {
  switch (integer(random, 0, 6)) {
    case 0:
      return word(random, DIGIT, 4);
    case 1:
      return doubleHyphenLabel(random, ALNUM);
    case 2:
      return looseXnLabel(random);
    case 3:
      return randomCase(random, aLabel(random) ?? ldhLabel(random, ALNUM, 8));
    default:
      return ldhLabel(random, ALNUM, 10);
  }
}

function lastLabel(random: Random): string {
  switch (integer(random, 0, 5)) {
    case 0:
      return doubleHyphenLabel(random, ALPHA);
    case 1:
      return looseXnLabel(random);
    case 2:
      return randomCase(random, aLabel(random) ?? ldhLabel(random, ALPHA, 6));
    default:
      return ldhLabel(random, ALPHA, 6);
  }
}

/** An address of the grammar. */
export function generateAddress(random: Random): string {
  const local = Array.from({ length: integer(random, 1, 3) }, () =>
    word(random, ATEXT, 8),
  ).join(".");
  const labels = Array.from({ length: integer(random, 0, 3) }, () =>
    label(random),
  );
  const last = lastLabel(random);
  for (const part of labels) {
    if (!LABEL.test(part)) {
      throw new Error(`The generator made a label off the grammar: ${part}`);
    }
  }
  if (!LAST_LABEL.test(last)) {
    throw new Error(`The generator made a last label off the grammar: ${last}`);
  }
  return `${local}@${[...labels, last].join(".")}`;
}

/**
 * What a mutation inserts or puts in place of a character: every special of
 * the spec's Probes, whitespace, CR, LF, other controls and non-ASCII
 * characters, and characters of the grammar too, so that some mutations
 * stay in it.
 */
const MUTATION_ALPHABET: readonly string[] = [
  ...chars('",<>@()[];:\\.-_'),
  ...chars("!#$%&'*+/=?^`{|}~"),
  " ",
  "\t",
  "\r",
  "\n",
  "\u0000",
  "\u001f",
  "\u007f",
  " ",
  "​",
  ...chars("õéßｅ日"),
  ...chars("aqxZK0479"),
  ...chars("aqxZK0479"),
];

/** `address` with one character inserted, replaced or removed. */
export function mutateAddress(random: Random, address: string): string {
  const text = Array.from(address);
  switch (integer(random, 0, 2)) {
    case 0:
      text.splice(
        integer(random, 0, text.length),
        0,
        pick(random, MUTATION_ALPHABET),
      );
      break;
    case 1:
      text.splice(
        integer(random, 0, text.length - 1),
        1,
        pick(random, MUTATION_ALPHABET),
      );
      break;
    default:
      text.splice(integer(random, 0, text.length - 1), 1);
  }
  return text.join("");
}

/** `address` with what follows its last `@` in lowercase. */
export function withLowercaseDomain(address: string): string {
  const at = address.lastIndexOf("@");
  return at === -1
    ? address
    : `${address.slice(0, at + 1)}${address.slice(at + 1).toLowerCase()}`;
}
