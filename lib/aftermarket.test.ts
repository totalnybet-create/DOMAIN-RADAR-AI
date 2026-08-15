import test from "node:test";
import assert from "node:assert/strict";
import { scoreAuctionDetailed, scoreExpiringDetailed } from "./aftermarket.ts";

test("Sztos Score v2 promotes a strong aged commercial expiring domain", () => {
  const now = Math.floor(Date.now() / 1000);
  const result = scoreExpiringDetailed({
    name: "finanse.pl",
    string: "finanse",
    createdTime: now - 20 * 31557600,
    deletedTime: now + 48 * 3600,
    archive: "2006-01-01",
    majesticQuality: 34,
    majesticDomains: 160,
    majesticLinks: 2500,
    pages: 250,
    future: true,
  });

  assert.equal(result.rejectedReason, undefined);
  assert.ok(result.score >= 90, `expected >= 90, got ${result.score}`);
  assert.ok(["PREMIUM", "ABSOLUTNY SZTOS"].includes(result.tier));
});

test("Sztos Score v2 hard-rejects unpronounceable garbage", () => {
  const result = scoreExpiringDetailed({ name: "qwrptz.pl", string: "qwrptz" });
  assert.equal(result.score, 0);
  assert.equal(result.tier, "ODRZUĆ");
  assert.ok(result.rejectedReason);
});

test("Sztos Score v2 hard-rejects obvious trademark risk", () => {
  const result = scoreExpiringDetailed({ name: "google.pl", string: "google" });
  assert.equal(result.score, 0);
  assert.equal(result.trademarkRisk, true);
  assert.match(result.rejectedReason || "", /znaku towarowego/);
});

test("Sztos Score v2 promotes a strong low-price auction", () => {
  const result = scoreAuctionDetailed({
    auctionId: 123,
    auctionKind: "caught",
    name: "hotel.pl",
    price: 10,
    currency: "PLN",
    offers: 6,
    featured: true,
  }, 50);

  assert.equal(result.rejectedReason, undefined);
  assert.ok(result.score >= 90, `expected >= 90, got ${result.score}`);
  assert.ok(["PREMIUM", "ABSOLUTNY SZTOS"].includes(result.tier));
});
