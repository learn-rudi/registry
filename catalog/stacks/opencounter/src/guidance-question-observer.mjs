export function observeGuidanceQuestions(checkpointFallback) {
  const normalizeStreet = (value) => value
    .split(",")[0]
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => ({
      ave: "avenue", blvd: "boulevard", cir: "circle", ct: "court",
      dr: "drive", e: "east", hwy: "highway", ln: "lane", n: "north",
      pk: "pike", pl: "place", plz: "plaza", rd: "road", s: "south",
      st: "street", ter: "terrace", w: "west"
    })[token] ?? token)
    .join(" ");
  const controls = Array.from(document.querySelectorAll(
    "input[type=radio], input[type=text], textarea, select"
  ));
  const groups = new Map();
  for (const control of controls) {
    const name = control.getAttribute("name") || control.getAttribute("id");
    if (!name || /address|search/i.test(name)) continue;
    const fieldset = control.closest("[data-field-name]")
      || control.closest("fieldset")
      || control.parentElement?.parentElement;
    const prompt = fieldset?.getAttribute?.("data-field-name")
      || fieldset?.querySelector("legend")?.textContent?.trim()
      || fieldset?.querySelector("label")?.textContent?.trim()
      || control.getAttribute("aria-label")
      || name;
    const current = groups.get(name) || {
      id: name,
      options: [],
      prompt,
      required: control.type === "radio" || control.required,
      type: control.type === "radio" ? "single_select" : "text"
    };
    current.required = current.required
      || control.type === "radio"
      || control.required;
    if (control.type === "radio") {
      const label = document.querySelector(`label[for="${control.id}"]`)
        ?.textContent?.trim() || control.value;
      current.options.push({ label, value: control.value });
    }
    groups.set(name, current);
  }
  const address = document.querySelector(
    'input[role="combobox"][aria-label="Address"]'
  );
  const street = address?.value ? normalizeStreet(address.value) : "";
  const addressOptions = street.length > 0
    ? Array.from(document.querySelectorAll("main *"))
      .filter((element) => element.children.length === 0)
      .map((element) => element.textContent?.trim())
      .filter((value) => value
        && normalizeStreet(value) === street
        && /,\s*Cincinnati,\s*Ohio\b/i.test(value))
      .filter((value, index, values) => values.indexOf(value) === index)
      .slice(0, 20)
    : [];
  const addressConfirmationPending = Array.from(
    document.querySelectorAll("button")
  ).some((button) => button.textContent?.trim() === "Select this address");
  const questions = Array.from(groups.values())
    .filter((question) => question.type === "text" || question.options.length >= 2);
  if (addressOptions.length > 0) {
    questions.unshift({
      id: "opencounter-address",
      options: addressOptions.map((value) => ({ label: value, value })),
      prompt: "Which OpenCounter address match is the intended location?",
      required: true,
      type: "single_select"
    });
  } else if (addressConfirmationPending && checkpointFallback !== null) {
    questions.unshift(checkpointFallback);
  }
  return {
    addressConfirmationPending,
    addressValue: address?.value?.trim() ?? "",
    questions: questions.slice(0, 50)
  };
}
