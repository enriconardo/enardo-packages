import type { DotenvPopulateInput } from "dotenv";
import type { EnvValueType } from "./env.types";

/**
 * Retrieves the raw string value of an environment variable from the specified source object.
 *
 * @param key - The name of the environment variable.
 * @param envSource - The source object containing environment variables.
 * @returns The raw string value, or `undefined` if not found.
 */
function getEnvValue(
  key: string,
  envSource: DotenvPopulateInput = process.env as DotenvPopulateInput,
): string | undefined {
  if (key in envSource) {
    return envSource[key];
  }

  return undefined;
}

/**
 * Retrieves an environment variable as a string.
 *
 * @param key - The name of the environment variable.
 * @param defaultValue - Value returned if the variable is not set or empty. Defaults to `null`.
 * @param envSource - The source object containing environment variables. Defaults to `process.env`.
 * @returns The variable's string value, or `defaultValue`.
 */
export function envString(key: string): string | null;
export function envString(
  key: string,
  defaultValue: string,
  envSource?: DotenvPopulateInput,
): string;
export function envString(
  key: string,
  defaultValue: string | null,
  envSource?: DotenvPopulateInput,
): string | null;
export function envString(
  key: string,
  defaultValue: string | null = null,
  envSource: DotenvPopulateInput = process.env as DotenvPopulateInput,
): string | null {
  const value = getEnvValue(key, envSource);
  return value === undefined || value === "" ? defaultValue : value;
}

/**
 * Retrieves an environment variable and parses it as a number.
 *
 * @param key - The name of the environment variable.
 * @param defaultValue - Value returned if the variable is not set, empty, or not a valid number. Defaults to `null`.
 * @param envSource - The source object containing environment variables. Defaults to `process.env`.
 * @returns The parsed number, or `defaultValue`.
 */
export function envNumber(key: string): number | null;
export function envNumber(
  key: string,
  defaultValue: number,
  envSource?: DotenvPopulateInput,
): number;
export function envNumber(
  key: string,
  defaultValue: number | null,
  envSource?: DotenvPopulateInput,
): number | null;
export function envNumber(
  key: string,
  defaultValue: number | null = null,
  envSource: DotenvPopulateInput = process.env as DotenvPopulateInput,
): number | null {
  const value = getEnvValue(key, envSource);

  if (value === undefined || value === "") {
    return defaultValue;
  }

  const num = Number(value);
  return isNaN(num) ? defaultValue : num;
}

const TRUTHY_VALUES = ["true", "1", "yes"];
const FALSY_VALUES = ["false", "0", "no"];

/**
 * Retrieves an environment variable and interprets it as a boolean.
 *
 * Truthy values: `"true"`, `"1"`, `"yes"` (case-insensitive).
 * Falsy values: `"false"`, `"0"`, `"no"` (case-insensitive).
 *
 * @param key - The name of the environment variable.
 * @param defaultValue - Value returned if the variable is not set, empty, or unrecognized. Defaults to `null`.
 * @param envSource - The source object containing environment variables. Defaults to `process.env`.
 * @returns The interpreted boolean, or `defaultValue`.
 */
export function envBool(key: string): boolean | null;
export function envBool(
  key: string,
  defaultValue: boolean,
  envSource?: DotenvPopulateInput,
): boolean;
export function envBool(
  key: string,
  defaultValue: boolean | null,
  envSource?: DotenvPopulateInput,
): boolean | null;
export function envBool(
  key: string,
  defaultValue: boolean | null = null,
  envSource: DotenvPopulateInput = process.env as DotenvPopulateInput,
): boolean | null {
  const value = getEnvValue(key, envSource);

  if (value === undefined || value === "") {
    return defaultValue;
  }

  const normalized = value.toLowerCase();

  if (TRUTHY_VALUES.includes(normalized)) {
    return true;
  }

  if (FALSY_VALUES.includes(normalized)) {
    return false;
  }

  return defaultValue;
}

/**
 * Retrieves an environment variable from `process.env` with type coercion.
 *
 * @param key - The name of the environment variable.
 * @param type - The target type: `"string"`, `"number"`, or `"boolean"`. Defaults to `"string"`.
 * @param defaultValue - Fallback value if the variable is not set or invalid.
 */
export function env(
  key: string,
  type?: "string",
  defaultValue?: string | null,
): string | null;
export function env(
  key: string,
  type: "number",
  defaultValue?: number | null,
): number | null;
export function env(
  key: string,
  type: "boolean",
  defaultValue?: boolean | null,
): boolean | null;
export function env(
  key: string,
  type: EnvValueType = "string",
  defaultValue: string | number | boolean | null = null,
): string | number | boolean | null {
  switch (type) {
    case "number":
      return envNumber(key, defaultValue as number | null);
    case "boolean":
      return envBool(key, defaultValue as boolean | null);
    case "string":
    default:
      return envString(key, defaultValue as string | null);
  }
}
