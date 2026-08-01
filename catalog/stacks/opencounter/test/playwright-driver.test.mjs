import assert from "node:assert/strict";
import { test } from "node:test";
import { waitForProviderRouteToSettle } from "../src/playwright-driver.mjs";

test("waits through a delayed client-side redirect to the summary route", async () => {
  const urls = [
    "/projects/2818705/apply/zoning",
    "/projects/2818705/apply/zoning",
    "/projects/2818705/apply/zoning",
    "/projects/2818705/apply/zoning",
    "/projects/2818705/apply/zoning",
    "/projects/2818705/apply/summary"
  ];
  let index = 0;
  const page = {
    async waitForTimeout() {
      index += 1;
    },
    url() {
      return `https://opencounter.cincinnati-oh.gov${urls[Math.min(index, urls.length - 1)]}`;
    }
  };

  assert.equal(
    await waitForProviderRouteToSettle(page),
    "https://opencounter.cincinnati-oh.gov/projects/2818705/apply/summary"
  );
});
