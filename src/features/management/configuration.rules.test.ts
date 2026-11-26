import { describe, expect, it } from "vitest";
import { configurationTemplate, parseConfiguration } from "./configuration.rules";

describe("SMS and AI configuration import", () => {
  it("imports custom allowlisted JSON and env values without applying defaults", () => {
    const json = parseConfiguration(JSON.stringify({
      AI_CONNECTION_MODE: "direct", AI_MAX_OUTPUT_TOKENS: 4096, SMS_PROVIDER: "kavenegar",
      SMS_API_KEY: "new-sms-key", AI_SMS_MODEL: "custom-model",
    }));
    expect(json.values).toEqual({ AI_CONNECTION_MODE: "direct", AI_MAX_OUTPUT_TOKENS: "4096",
      SMS_PROVIDER: "kavenegar", SMS_API_KEY: "new-sms-key", AI_SMS_MODEL: "custom-model" });

    const env = parseConfiguration("export AI_CONNECTION_MODE=disabled\nAI_SMS_TIMEOUT_SECONDS=8\n");
    expect(env.values).toEqual({ AI_CONNECTION_MODE: "disabled", AI_SMS_TIMEOUT_SECONDS: "8" });
    expect(Object.values(JSON.parse(configurationTemplate()))).toContain("");
  });

  it("drops blank fields without changing existing settings and rejects unsafe or duplicate keys", () => {
    expect(parseConfiguration("{\"SMS_SENDER\":\"\",\"AI_SMS_MODEL\":\"custom\"}")).toEqual({
      values: { AI_SMS_MODEL: "custom" }, empty: ["SMS_SENDER"],
    });
    expect(() => parseConfiguration("{\"SMS_PROVIDER\":\"kavenegar\",\"SMS_PROVIDER\":\"kavenegar\"}"))
      .toThrow(/تکرار/);
    expect(() => parseConfiguration("DOCUMENT_ENCRYPTION_KEY=private"))
      .toThrow(/فهرست مجاز/);
    expect(() => parseConfiguration("AI_MAX_OUTPUT_TOKENS=12"))
      .toThrow(/بازه/);
    expect(() => parseConfiguration("AI_SMS_GATEWAY_URL=https://example.test/?private=value"))
      .toThrow(/HTTPS/);
    expect(() => parseConfiguration("SMS_API_KEY=$(whoami)"))
      .toThrow(/نویسه‌های مجاز/);
  });
});
