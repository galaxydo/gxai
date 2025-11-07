// xml.ts
import { z } from "zod";

/** Converts an object to an XML string. */
export function objToXml(obj: any, parentKey?: string): string {
  const sanitizeTagName = (name: string): string => {
    return name.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^[^a-zA-Z]/, "tag_$&");
  };

  const wrapTag = (tag: string, content: string): string => {
    const safeTag = sanitizeTagName(tag);
    return `<${safeTag}>${content}</${safeTag}>`;
  };

  if (Array.isArray(obj)) {
    return wrapTag(
      parentKey || "array",
      obj.map((item) => wrapTag("item", typeof item === "object" ? objToXml(item) : String(item))).join("")
    );
  }

  if (obj && typeof obj === "object") {
    const entries = Object.entries(obj).filter(([, v]) => v !== undefined && v !== null);
    if (entries.length === 0) {
      return wrapTag(parentKey || "empty", "");
    }
    const content = entries
      .map(([key, value]) =>
        typeof value === "object" ? objToXml(value, key) : `<${key}>${String(value)}</${key}>`
      )
      .join("");
    return parentKey ? wrapTag(parentKey, content) : content;
  }

  return wrapTag(parentKey || "value", String(obj));
}

/** Parses an XML string into an object. */
export function xmlToObj(xmlContent: string): any {
  const parseElement = (content: string): any => {
    content = content.trim();
    if (!content.includes("<")) {
      return content || "";
    }
    const result: any = {};
    const tagRegex = /<([^>\s/]+)(?:[^>]*)>(.*?)<\/\1>/gs;
    let match;
    let hasMatches = false;
    while ((match = tagRegex.exec(content)) !== null) {
      hasMatches = true;
      const [, tagName, tagContent] = match;
      let child: any;
      if (tagContent.trim().includes("<")) {
        child = parseElement(tagContent);
      } else {
        const trimmedContent = tagContent.trim();
        if (trimmedContent === "true" || trimmedContent === "false") {
          child = trimmedContent === "true";
        } else if (/^\d+(\.\d+)?$/.test(trimmedContent)) {
          child = Number(trimmedContent);
        } else {
          child = trimmedContent;
        }
      }
      if (result[tagName] === undefined) {
        result[tagName] = child;
      } else if (Array.isArray(result[tagName])) {
        result[tagName].push(child);
      } else {
        result[tagName] = [result[tagName], child];
      }
    }
    if (!hasMatches) return content;

    // Unwrap 'item' arrays for better array representation
    if (Object.keys(result).length === 1) {
      const [key, val] = Object.entries(result)[0];
      if (key === "item") {
        return Array.isArray(val) ? val : [val];
      }
    }

    return result;
  };
  return parseElement(xmlContent);
}

if (import.meta.env.NODE_ENV === "test") {
  const { test, expect, describe } = await import('bun:test');
  const { measureSync } = await import('@ments/utils');

  describe("XML Utils", () => {
    test("realistic prompt object round-trip with descriptions and arrays, compares XML vs JSON token efficiency using tiktoken", async () => {
      const { get_encoding } = await import('tiktoken');
      const encoder = get_encoding("cl100k_base");
      const promptObj = {
        input: {
          user_query: "What is the weather?",
          location: "San Francisco"
        },
        output_format: {
          temperature: "number: current temperature in Celsius",
          humidity: "number: percentage",
          wind_speed: "string: wind speed description",
          forecast: "string: brief summary"
        },
        task: "Generate a structured response based on the input, filling the output format with relevant data. Use XML tags in your response for each field.",
        available_tools: [
          { name: "weather_api", description: "Fetches current weather data" },
          { name: "forecast_tool", description: "Provides 24-hour forecast" }
        ]
      };
      const jsonStr = JSON.stringify(promptObj);
      measureSync(jsonStr)
      const xmlStr = objToXml(promptObj);
      expect(xmlToObj(xmlStr)).toEqual(promptObj);
      measureSync(xmlStr)
      const jsonTokens = encoder.encode(jsonStr).length;
      const xmlTokens = encoder.encode(xmlStr).length;
      const jsonChars = jsonStr.length;
      const xmlChars = xmlStr.length;
      const tokenSavings = ((jsonTokens - xmlTokens) / jsonTokens) * 100;
      const charSavings = ((jsonChars - xmlChars) / jsonChars) * 100;
      measureSync(`JSON tokens: ${jsonTokens}, XML tokens: ${xmlTokens}, Token Savings: ${tokenSavings.toFixed(1)}%`);
      measureSync(`JSON chars: ${jsonChars}, XML chars: ${xmlChars}, Char Savings: ${charSavings.toFixed(1)}%`);
      encoder.free();
    });
  });
}
