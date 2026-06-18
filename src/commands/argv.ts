import type { ToolCommand } from "./legacy-cli.js";

/** Convert a kebab-case flag name to the camelCase schema field it targets. */
function flagToField(flag: string): string {
  return flag.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function isBooleanFlag(flag: string, booleanFields: string[]): boolean {
  return booleanFields.includes(flagToField(flag));
}

/** Parse `--flag value` and `--flag=value` pairs out of an argv tail. */
export function parseFlags(
  args: string[],
  booleanFields: string[] = [],
): {
  positional: string[];
  flags: Record<string, string>;
} {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq >= 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const flag = a.slice(2);
        const next = args[i + 1];
        if (isBooleanFlag(flag, booleanFields)) {
          if (next !== undefined && !next.startsWith("--")) {
            flags[flag] = /^(true|false)$/iu.test(next) ? next : "false";
            i++;
          } else {
            flags[flag] = "";
          }
        } else {
          flags[flag] = next ?? "";
          i++;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function applyFilterFlag(args: Record<string, unknown>, field: string, value: string): void {
  const facet = field.slice("filter".length);
  const key = facet.charAt(0).toLowerCase() + facet.slice(1);
  const filter = (args.filter as Record<string, unknown> | undefined) ?? {};
  filter[key] = value;
  args.filter = filter;
}

export function mapArgvToToolInput(
  command: ToolCommand,
  positional: string[],
  flags: Record<string, string>,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};

  command.positional.forEach((field, i) => {
    const value = positional[i];
    if (value !== undefined) args[field] = value;
  });

  for (const [flag, raw] of Object.entries(flags)) {
    if (flag === "modules-dir") continue;
    const field = flagToField(flag);
    if (field.startsWith("filter") && field.length > "filter".length) {
      applyFilterFlag(args, field, raw);
    } else if (command.numeric.includes(field)) {
      args[field] = Number(raw);
    } else if (command.boolean.includes(field)) {
      args[field] = raw === "" ? true : raw.toLowerCase() === "true";
    } else if (command.array.includes(field)) {
      args[field] = raw.split(",").map((s) => s.trim());
    } else {
      args[field] = raw;
    }
  }

  return args;
}
