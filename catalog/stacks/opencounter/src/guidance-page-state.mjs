import { waitForProviderRouteToSettle } from "./guidance-navigation.mjs";
import { parseSummary } from "./summary-export.mjs";
import { addressesReferToSameCincinnatiStreet } from "./address-normalization.mjs";
import { observeGuidanceQuestions } from "./guidance-question-observer.mjs";

export async function readPageState(
  page,
  providerReference,
  guidanceState = null
) {
  await waitForProviderRouteToSettle(page);
  if (page.url().includes("/apply/summary")) return parseSummary(page, providerReference);
  const fallbackAddressQuestion = guidanceState?.activeCheckpoint?.questions
    ?.find((question) => question.id === "opencounter-address") ?? null;
  const observed = await page.evaluate(
    observeGuidanceQuestions,
    fallbackAddressQuestion
  );
  const {
    addressConfirmationPending,
    addressValue,
    questions: observedQuestions
  } = observed;
  const questions = [...observedQuestions];
  if (addressConfirmationPending
    && !questions.some((question) => question.id === "opencounter-address")) {
    if (typeof addressValue !== "string"
      || addressValue.trim().length === 0
      || typeof guidanceState?.requestedAddress !== "string"
      || !addressesReferToSameCincinnatiStreet(
        addressValue,
        guidanceState.requestedAddress
      )) {
      throw new Error("opencounter_address_checkpoint_missing");
    }
    questions.unshift({
      id: "opencounter-address",
      options: [{ label: addressValue, value: addressValue }],
      prompt: "Which OpenCounter address match is the intended location?",
      required: true,
      type: "single_select"
    });
  }
  if (questions.length > 0) {
    return { providerReference, questions, status: "needs_requester_input" };
  }
  return {
    providerReference,
    route: new URL(page.url()).pathname,
    status: "indeterminate"
  };
}
