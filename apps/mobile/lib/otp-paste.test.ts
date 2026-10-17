import { describe, expect, it } from "vitest";
import { extractOtpCode } from "./otp-paste";

describe("extractOtpCode", () => {
  it("takes a plain or grouped six-digit code, trimmed", () => {
    expect(extractOtpCode(" 123456 \n")).toBe("123456");
    expect(extractOtpCode("123 456")).toBe("123456");
    expect(extractOtpCode("123-456")).toBe("123456");
  });

  it("finds the code inside the e-mail sentence", () => {
    expect(extractOtpCode("Your Multica code is 482913. It expires in 10 minutes.")).toBe("482913");
  });

  it("refuses ambiguous or wrong-length input", () => {
    expect(extractOtpCode("12345")).toBeNull();
    expect(extractOtpCode("1234567")).toBeNull();
    expect(extractOtpCode("111111 or 222222")).toBeNull();
    expect(extractOtpCode("abc")).toBeNull();
    expect(extractOtpCode("")).toBeNull();
    expect(extractOtpCode(null)).toBeNull();
  });

  it("accepts the same code twice (copied with the subject line)", () => {
    expect(extractOtpCode("Code 123456 – 123456")).toBe("123456");
  });

  it("respects another length", () => {
    expect(extractOtpCode("1234", 4)).toBe("1234");
  });
});

describe("extractOtpCode is strict about grouping", () => {
  it("does not read a date or time as a code", () => {
    expect(extractOtpCode("16 Oct 2026 10:30")).toBeNull();
    expect(extractOtpCode("12 34 56")).toBeNull();
  });
  it("still finds the code next to a date", () => {
    expect(extractOtpCode("Sent 16 Oct 2026 10:30 – code 482 913")).toBe("482913");
  });
});
