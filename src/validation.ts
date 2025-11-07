// validation.ts
import { z } from "zod";

/** Validates a user-provided URL for safety. */
export function validateUrl(userUrl: string): string {
  try {
    const parsed = new URL(userUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Invalid scheme');
    }
    if (parsed.hash || parsed.username || parsed.password) {
      throw new Error('Forbidden URL components');
    }
    // Decode and check for dangerous chars (e.g., CRLF)
    const decoded = decodeURIComponent(userUrl);
    if (/[\r\n]/.test(decoded)) {
      throw new Error('Suspicious encoding');
    }
    // Basic length/sanity check
    if (parsed.href.length > 2048) {
      throw new Error('URL too long');
    }
    return parsed.href;
  } catch (err) {
    throw new Error('Invalid URL: ' + (err as Error).message);
  }
}

/** Validates that the output schema contains no arrays. */
export function validateNoArrays(schema: z.ZodObject<any>, path: string = ''): void {
  const shape = schema.shape;
  for (const [key, fieldSchema] of Object.entries(shape)) {
    const currentPath = path ? `${path}.${key}` : key;

    // Unwrap optional/nullable
    let currentSchema = fieldSchema as z.ZodType<any>;
    while (currentSchema._def.typeName === 'ZodOptional' || currentSchema._def.typeName === 'ZodNullable') {
      currentSchema = currentSchema.unwrap();
    }

    if (currentSchema._def.typeName === 'ZodArray') {
      throw new Error(`Arrays are not supported in output schema. Found array at path: ${currentPath}. Use individual fields like ${key}_1, ${key}_2 instead.`);
    }

    if (currentSchema._def.typeName === 'ZodObject') {
      validateNoArrays(currentSchema, currentPath);
    }
  }
}

/** Gets the type name of a Zod schema, unwrapping optional/nullable types. */
export function getSchemaTypeName(schema: z.ZodType<any>): string {
  if (schema._def.typeName === "ZodOptional" || schema._def.typeName === "ZodNullable") {
    return getSchemaTypeName(schema.unwrap());
  }
  return schema._def.typeName;
}

if (import.meta.env.NODE_ENV === "test") {
  const { test, expect, describe } = await import('bun:test');

  describe("Validation Utils", () => {
    test("validates a safe URL", () => {
      const safe = validateUrl("https://example.com");
      expect(safe).toBe("https://example.com/");
    });

    test("rejects invalid URL scheme", () => {
      expect(() => validateUrl("ftp://example.com")).toThrow("Invalid scheme");
    });

    test("rejects URL with hash", () => {
      expect(() => validateUrl("https://example.com#frag")).toThrow("Forbidden URL components");
    });

    test("validates no arrays in schema", () => {
      const schemaWithArray = z.object({ items: z.array(z.string()) });
      expect(() => validateNoArrays(schemaWithArray)).toThrow("Arrays are not supported");
    });

    test("gets schema type name unwrapping optional", () => {
      const optionalSchema = z.optional(z.string());
      expect(getSchemaTypeName(optionalSchema)).toBe("ZodString");
    });
  });
}
