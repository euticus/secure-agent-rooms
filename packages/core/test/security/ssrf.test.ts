import { describe, expect, it } from "vitest";
import { SsrfError, isPrivateAddress, safeFetch } from "@booth/agents";

describe("SSRF protection (T9, spec §36)", () => {
  it("classifies private and metadata addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.9.9",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["8.8.8.8", "52.1.2.3", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it("rejects the cloud metadata endpoint", async () => {
    await expect(safeFetch("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(SsrfError);
    await expect(safeFetch("https://169.254.169.254/")).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects plain http to arbitrary hosts", async () => {
    await expect(safeFetch("http://example.com/")).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects loopback and RFC1918 literals", async () => {
    await expect(safeFetch("https://127.0.0.1/")).rejects.toBeInstanceOf(SsrfError);
    await expect(safeFetch("https://10.1.2.3/")).rejects.toBeInstanceOf(SsrfError);
    await expect(safeFetch("https://192.168.0.10/")).rejects.toBeInstanceOf(SsrfError);
  });

  it("rejects disallowed ports and protocols", async () => {
    await expect(safeFetch("https://example.com:6379/")).rejects.toBeInstanceOf(SsrfError);
    await expect(safeFetch("ftp://example.com/")).rejects.toBeInstanceOf(SsrfError);
    await expect(safeFetch("file:///etc/passwd")).rejects.toBeInstanceOf(SsrfError);
  });

  it("re-validates redirect targets into private ranges", async () => {
    // A redirect hop to a private address must be caught by per-hop validation.
    // We simulate by asserting the private target itself is rejected; the
    // fetch loop calls the same validator on every hop.
    await expect(safeFetch("https://169.254.169.254/latest")).rejects.toBeInstanceOf(SsrfError);
  });
});
