/**
 * The `cause` of an error of `send`: the identifiers of the driver's failure
 * (`{ code: "ESOCKET", command: "CONN" }`), never the driver's error itself.
 *
 * A driver's error can echo the recipients' addresses, and `toJSON()` would
 * carry it into every log. The type refuses an `Error` and an `unknown`; the
 * implementation keeps addresses, names, subjects and bodies out of the
 * strings, and documents the fields.
 */
export type EmailErrorCause = Readonly<Record<string, string | number>>;
