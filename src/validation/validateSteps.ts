import { StepsSchema, type ValidStep } from "./stepSchema";
import { sanitizePath } from "./sanitize";

export function validateStepsFromParsed(parsed: unknown): ValidStep[] {
  // normalize whitespace (optional but helpful)
  const normalized = Array.isArray(parsed)
    ? parsed.map((s: any) => ({
      ...s,
      type: typeof s?.type === "string" ? s.type.trim() : s?.type,
      path: typeof s?.path === "string" ? s.path.trim() : s?.path,
    }))
    : parsed;

  const result = StepsSchema.safeParse(normalized);
  if (!result.success) {
    const issues = result.error.issues.map(
      (i) => `${i.path.join(".")}: ${i.message}`
    );
    throw new Error("Invalid steps: " + issues.join(", "));
  }

  // sanitize + default title/description
  return result.data.map((s) => {
    if ("path" in s && s.path) {
      const safePath = sanitizePath(s.path);

      return {
        ...s,
        path: safePath,
        title: s.title ?? `${s.type} ${safePath}`,
        description: s.description ?? `Apply ${s.type} on ${safePath}`,
        code: s.code ?? "",
      };
    }

    return {
      ...s,
      title: s.title ?? "Run script",
      description: s.description ?? "Execute a command",
      code: s.code ?? "",
    };
  });
}