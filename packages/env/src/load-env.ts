import dotenv from "dotenv";
import type { DotenvConfigOptions, DotenvPopulateInput } from "dotenv";

export type LoadEnvOptions = DotenvConfigOptions & {
  source?: DotenvPopulateInput;
  target?: DotenvPopulateInput;
};

/**
 * Loads environment variables from a `.env` file into a target object.
 *
 * Accepts the same options as `dotenv.config()`.
 *
 * `source` and `target` default to `process.env`.
 *
 * @param options - Optional dotenv configuration options plus `source` and `target` objects.
 */
export function loadEnv(options?: LoadEnvOptions): void {
  const {
    source = process.env as DotenvPopulateInput,
    target = process.env as DotenvPopulateInput,
    ...dotenvOptions
  } = options ?? {};

  const configOptions =
    Object.keys(dotenvOptions).length > 0 ? dotenvOptions : undefined;

  if (configOptions) {
    dotenv.config(configOptions);
  }

  dotenv.populate(target, source, configOptions);
}
