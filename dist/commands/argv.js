/** Convert a kebab-case flag name to the camelCase schema field it targets. */
function flagToField(flag) {
    return flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
function isBooleanFlag(flag, booleanFields) {
    return booleanFields.includes(flagToField(flag));
}
/** Parse `--flag value` and `--flag=value` pairs out of an argv tail. */
export function parseFlags(args, booleanFields = []) {
    const positional = [];
    const flags = {};
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a.startsWith("--")) {
            const eq = a.indexOf("=");
            if (eq >= 0) {
                flags[a.slice(2, eq)] = a.slice(eq + 1);
            }
            else {
                const flag = a.slice(2);
                const next = args[i + 1];
                if (isBooleanFlag(flag, booleanFields)) {
                    if (next !== undefined && !next.startsWith("--")) {
                        flags[flag] = /^(true|false)$/iu.test(next) ? next : "false";
                        i++;
                    }
                    else {
                        flags[flag] = "";
                    }
                }
                else {
                    flags[flag] = next ?? "";
                    i++;
                }
            }
        }
        else {
            positional.push(a);
        }
    }
    return { positional, flags };
}
function applyFilterFlag(args, field, value) {
    const facet = field.slice("filter".length);
    const key = facet.charAt(0).toLowerCase() + facet.slice(1);
    const filter = args.filter ?? {};
    filter[key] = value;
    args.filter = filter;
}
export function mapArgvToToolInput(command, positional, flags) {
    const args = {};
    command.positional.forEach((field, i) => {
        const value = positional[i];
        if (value !== undefined)
            args[field] = value;
    });
    for (const [flag, raw] of Object.entries(flags)) {
        if (flag === "modules-dir")
            continue;
        const field = flagToField(flag);
        if (field.startsWith("filter") && field.length > "filter".length) {
            applyFilterFlag(args, field, raw);
        }
        else if (command.numeric.includes(field)) {
            args[field] = Number(raw);
        }
        else if (command.boolean.includes(field)) {
            args[field] = raw === "" ? true : raw.toLowerCase() === "true";
        }
        else if (command.array.includes(field)) {
            args[field] = raw.split(",").map((s) => s.trim());
        }
        else {
            args[field] = raw;
        }
    }
    return args;
}
//# sourceMappingURL=argv.js.map