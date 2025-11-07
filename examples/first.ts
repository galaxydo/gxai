import { objToXml, xmlToObj } from 'gxai';

import { measureSync } from '@ments/utils';

if (import.meta.env.NODE_ENV === "test") {
  const { test, expect, describe } = await import('bun:test');

  describe("XML Utils", () => {
    test("realistic prompt object round-trip with descriptions and arrays, compares XML vs JSON token efficiency using tiktoken, and fetches OpenAI with weather request parsing XML response", async () => {
      const { get_encoding } = await import('tiktoken');
      const encoder = get_encoding("cl100k_base");
      const promptObj = {
        input: {
          user_query: "What is the weather in San Francisco today? Provide a detailed forecast including temperature, humidity, and wind speed.",
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

      // Now, fetch OpenAI with the XML prompt (as text content) for weather request
      const openaiApiKey = process.env.OPENAI_API_KEY; // Assume set in env for test
      if (!openaiApiKey) {
        console.warn('OPENAI_API_KEY not set, skipping OpenAI fetch');
        encoder.free();
        return;
      }
      const openaiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: xmlStr }], // Send XML as prompt content
          max_tokens: 300,
        }),
      });
      expect(openaiResponse.ok).toBe(true);
      const openaiData = await openaiResponse.json();
      const xmlResponseStr = openaiData.choices[0].message.content.trim();
      measureSync(xmlResponseStr);

      // Parse the expected XML response into object
      const parsedResponseObj = xmlToObj(xmlResponseStr, 'response'); // Assume root is <response>
      expect(parsedResponseObj).toHaveProperty('temperature');
      expect(typeof parsedResponseObj.temperature).toBe('string'); // Or number if parsed further
      expect(parsedResponseObj).toHaveProperty('humidity');
      expect(parsedResponseObj).toHaveProperty('wind_speed');
      expect(parsedResponseObj).toHaveProperty('forecast');
      measureSync(`Parsed OpenAI XML Response: ${JSON.stringify(parsedResponseObj)}`);

      encoder.free();
    });
  });
}
