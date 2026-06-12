import { describe, it, expect } from "vitest";
import {
  isCloudflareChallengeHtml,
  isCloudflareBotBlock,
  cfBlockMessage,
} from "../../services/cloudflare.js";
import {
  AUSTLII_CLOUDFLARE_CHALLENGE_HTML,
  AUSTLII_CLASSIC_JUDGMENT_HTML,
} from "../fixtures/index.js";

describe("isCloudflareChallengeHtml", () => {
  it("detects the real CF challenge fixture", () => {
    expect(isCloudflareChallengeHtml(AUSTLII_CLOUDFLARE_CHALLENGE_HTML)).toBe(true);
  });

  it("does not flag a real AustLII judgment HTML", () => {
    expect(isCloudflareChallengeHtml(AUSTLII_CLASSIC_JUDGMENT_HTML)).toBe(false);
  });

  it("detects HTML containing two CF markers", () => {
    const html = "<title>Just a moment...</title><script>window._cf_chl_opt = {};</script>";
    expect(isCloudflareChallengeHtml(html)).toBe(true);
  });

  it("does not flag HTML with only one CF marker", () => {
    const html = "<html><body>Just a moment...</body></html>";
    expect(isCloudflareChallengeHtml(html)).toBe(false);
  });

  it("does not flag empty string", () => {
    expect(isCloudflareChallengeHtml("")).toBe(false);
  });

  it("detects CF challenge platform script path as one marker", () => {
    const html =
      "/cdn-cgi/challenge-platform/ is loaded here. Enable JavaScript and cookies to continue";
    expect(isCloudflareChallengeHtml(html)).toBe(true);
  });
});

describe("isCloudflareBotBlock", () => {
  it("returns true for 403", () => {
    expect(isCloudflareBotBlock(403)).toBe(true);
  });

  it("returns true for 503", () => {
    expect(isCloudflareBotBlock(503)).toBe(true);
  });

  it("returns false for 200", () => {
    expect(isCloudflareBotBlock(200)).toBe(false);
  });

  it("returns false for 404", () => {
    expect(isCloudflareBotBlock(404)).toBe(false);
  });

  it("returns false for 500", () => {
    expect(isCloudflareBotBlock(500)).toBe(false);
  });
});

describe("cfBlockMessage", () => {
  it("includes the URL in the message", () => {
    const url = "https://www.austlii.edu.au/au/cases/cth/HCA/1992/23.html";
    const msg = cfBlockMessage(url);
    expect(msg).toContain(url);
  });

  it("mentions impit", () => {
    const msg = cfBlockMessage("https://example.com");
    expect(msg.toLowerCase()).toContain("impit");
  });
});
