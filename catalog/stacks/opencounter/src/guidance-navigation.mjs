export async function assertGuidanceReadyToAdvance(page) {
  const pendingAddressConfirmation = page.getByRole("button", {
    name: "Select this address",
    exact: true
  });
  const pendingCount = await pendingAddressConfirmation.count();
  if (pendingCount > 1) {
    throw new Error("opencounter_ui_drift:confirm_address");
  }
  if (pendingCount === 1 && await pendingAddressConfirmation.isVisible()) {
    throw new Error("opencounter_address_confirmation_pending");
  }
  const next = page.locator("button[data-save-button=true]");
  if (await next.count() !== 1 || !(await next.isVisible())) {
    throw new Error("opencounter_ui_drift:Next");
  }
  try {
    await page.locator("button[data-save-button=true]:not([disabled])")
      .waitFor({ state: "visible", timeout: 15_000 });
  } catch {
    const remainingAddressCount = await pendingAddressConfirmation.count();
    if (remainingAddressCount === 1
      && await pendingAddressConfirmation.isVisible()) {
      throw new Error("opencounter_address_confirmation_pending");
    }
    throw new Error("opencounter_navigation_blocked");
  }
  if (!(await next.isEnabled())) throw new Error("opencounter_navigation_blocked");
}

export async function waitForProviderRouteToSettle(page) {
  let latestUrl = page.url();
  let stableSamples = 0;
  for (let sample = 0; sample < 20; sample += 1) {
    await page.waitForTimeout(100);
    const currentUrl = page.url();
    if (currentUrl.includes("/apply/summary")) return currentUrl;
    if (currentUrl === latestUrl) stableSamples += 1;
    else stableSamples = 0;
    latestUrl = currentUrl;
    if (sample >= 9 && stableSamples >= 3) return latestUrl;
  }
  return latestUrl;
}
