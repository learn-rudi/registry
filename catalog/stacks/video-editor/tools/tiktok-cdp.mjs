import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import WebSocket from "ws";

const port = Number(process.env.CHROME_PORT || "9222");

function get(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve(body));
      })
      .on("error", reject);
  });
}

async function connectPage() {
  const tabs = JSON.parse(await get(`http://127.0.0.1:${port}/json/list`));
  const page = tabs.find((tab) => tab.type === "page" && tab.url.includes("tiktokstudio"));
  if (!page) throw new Error("No TikTok Studio page found on DevTools port.");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  let id = 0;
  function send(method, params = {}) {
    const message = { id: ++id, method, params };
    return new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.id !== message.id) return;
        ws.removeEventListener("message", onMessage);
        if (data.error) reject(new Error(JSON.stringify(data.error)));
        else resolve(data.result);
      };
      ws.addEventListener("message", onMessage);
      ws.send(JSON.stringify(message));
    });
  }

  function waitForEvent(method, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        ws.removeEventListener("message", onMessage);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
      const onMessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.method !== method) return;
        clearTimeout(timeout);
        ws.removeEventListener("message", onMessage);
        resolve(data.params || {});
      };
      ws.addEventListener("message", onMessage);
    });
  }

  return { ws, send, waitForEvent, page };
}

async function evalJson(send, expression) {
  const result = await send("Runtime.evaluate", {
    expression: `JSON.stringify((${expression})())`,
    returnByValue: true,
    awaitPromise: true,
  });
  return JSON.parse(result.result.value);
}

async function inspect() {
  const { ws, send, page } = await connectPage();
  try {
    const state = await evalJson(
      send,
      `() => ({
        href: location.href,
        title: document.title,
        text: document.body.innerText.slice(0, 5000),
        fileInputs: Array.from(document.querySelectorAll("input[type=file]")).map((input, i) => ({
          i,
          accept: input.accept,
          multiple: input.multiple,
          disabled: input.disabled,
          outerHTML: input.outerHTML.slice(0, 500)
        }))
      })`
    );
    console.log(JSON.stringify({ page: { id: page.id, url: page.url, title: page.title }, state }, null, 2));
  } finally {
    ws.close();
  }
}

async function screenshot(outputPath) {
  if (!outputPath) throw new Error("screenshot requires an output path");
  const { ws, send } = await connectPage();
  try {
    await send("Page.enable");
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await writeFile(outputPath, Buffer.from(shot.data, "base64"));
    console.log(JSON.stringify({ outputPath }, null, 2));
  } finally {
    ws.close();
  }
}

async function uploadFirst(filePath) {
  if (!filePath) throw new Error("upload-first requires a file path");
  const { ws, send } = await connectPage();
  try {
    await send("DOM.enable");
    const documentResult = await send("DOM.getDocument", { depth: -1, pierce: true });
    const inputResult = await send("DOM.querySelector", {
      nodeId: documentResult.root.nodeId,
      selector: "input[type=file]",
    });
    if (!inputResult.nodeId) throw new Error("No file input found");
    await send("DOM.setFileInputFiles", { nodeId: inputResult.nodeId, files: [filePath] });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const state = await evalJson(send, `() => ({ href: location.href, title: document.title, text: document.body.innerText.slice(0, 5000) })`);
    console.log(JSON.stringify({ uploaded: true, filePath, state }, null, 2));
  } finally {
    ws.close();
  }
}

async function clickXY(xValue, yValue) {
  const x = Number(xValue);
  const y = Number(yValue);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("click-xy requires numeric x and y");
  const { ws, send } = await connectPage();
  try {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log(JSON.stringify({ clicked: { x, y } }, null, 2));
  } finally {
    ws.close();
  }
}

async function dragXY(x1Value, y1Value, x2Value, y2Value) {
  const x1 = Number(x1Value);
  const y1 = Number(y1Value);
  const x2 = Number(x2Value);
  const y2 = Number(y2Value);
  if (![x1, y1, x2, y2].every(Number.isFinite)) throw new Error("drag-xy requires numeric coordinates");
  const { ws, send } = await connectPage();
  try {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: x1, y: y1, button: "none", buttons: 0 });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x1, y: y1, button: "left", buttons: 1, clickCount: 1 });
    const steps = 12;
    for (let i = 1; i <= steps; i += 1) {
      const x = x1 + ((x2 - x1) * i) / steps;
      const y = y1 + ((y2 - y1) * i) / steps;
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x2, y: y2, button: "left", buttons: 0, clickCount: 1 });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log(JSON.stringify({ dragged: { x1, y1, x2, y2 } }, null, 2));
  } finally {
    ws.close();
  }
}

async function clickText(text) {
  if (!text) throw new Error("click-text requires text");
  const { ws, send } = await connectPage();
  try {
    const result = await send("Runtime.evaluate", {
      expression: `(() => {
        const needle = ${JSON.stringify(text)};
        const candidates = Array.from(document.querySelectorAll("button,[role=button],a,div,span"))
          .map((node) => {
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            const text = (node.innerText || node.textContent || "").trim();
            return {
              node,
              rect,
              text,
              visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
              area: rect.width * rect.height,
              buttonLike: node.matches("button,[role=button],a")
            };
          })
          .filter((entry) => entry.visible && entry.text);
        const exact = candidates.filter((entry) => entry.text === needle);
        const partial = candidates.filter((entry) => entry.text.includes(needle));
        const ranked = (exact.length ? exact : partial).sort((a, b) => {
          if (a.buttonLike !== b.buttonLike) return a.buttonLike ? -1 : 1;
          return a.area - b.area;
        });
        const entry = ranked[0];
        if (!entry) return { clicked: false, reason: "not found", text: needle };
        entry.node.scrollIntoView({ block: "center" });
        entry.node.click();
        const rect = entry.node.getBoundingClientRect();
        return { clicked: true, text: entry.text.slice(0, 200), rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const state = await evalJson(send, `() => ({ href: location.href, text: document.body.innerText.slice(0, 4000) })`);
    console.log(JSON.stringify({ result: result.result.value, state }, null, 2));
  } finally {
    ws.close();
  }
}

async function clickTextBelow(minYValue, text) {
  const minY = Number(minYValue);
  if (!Number.isFinite(minY)) throw new Error("click-text-below requires a numeric minY");
  if (!text) throw new Error("click-text-below requires text");
  const { ws, send } = await connectPage();
  try {
    const result = await send("Runtime.evaluate", {
      expression: `(() => {
        const needle = ${JSON.stringify(text)};
        const minY = ${JSON.stringify(minY)};
        const candidates = Array.from(document.querySelectorAll("button,[role=button],a,div,span"))
          .map((node) => {
            const rect = node.getBoundingClientRect();
            const style = getComputedStyle(node);
            const text = (node.innerText || node.textContent || "").trim();
            return {
              node,
              rect,
              text,
              visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none",
              area: rect.width * rect.height,
              buttonLike: node.matches("button,[role=button],a")
            };
          })
          .filter((entry) => entry.visible && entry.text === needle && entry.rect.y >= minY)
          .sort((a, b) => {
            if (a.buttonLike !== b.buttonLike) return a.buttonLike ? -1 : 1;
            return a.area - b.area;
          });
        const entry = candidates[0];
        if (!entry) return { clicked: false, reason: "not found", text: needle, minY };
        entry.node.scrollIntoView({ block: "center" });
        entry.node.click();
        const rect = entry.node.getBoundingClientRect();
        return { clicked: true, text: entry.text, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const state = await evalJson(send, `() => ({ href: location.href, text: document.body.innerText.slice(0, 4000) })`);
    console.log(JSON.stringify({ result: result.result.value, state }, null, 2));
  } finally {
    ws.close();
  }
}

async function caption(captionPath) {
  if (!captionPath) throw new Error("caption requires a caption file path");
  const text = (await readFile(captionPath, "utf8")).trim();
  const { ws, send } = await connectPage();
  try {
    await send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector("[contenteditable=true]");
        if (!el) throw new Error("No contenteditable description field found");
        el.scrollIntoView({ block: "center" });
        el.focus();
      })()`,
      awaitPromise: true,
    });
    await send("Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 0,
      modifiers: 4,
      commands: ["selectAll"],
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      nativeVirtualKeyCode: 0,
      modifiers: 4,
    });
    await send("Input.insertText", { text });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const state = await evalJson(
      send,
      `() => ({ text: (document.querySelector("[contenteditable=true]")?.innerText || "").slice(0, 1200), counterText: document.body.innerText.match(/\\d+\\/4000/)?.[0] || null })`
    );
    console.log(JSON.stringify({ captionSet: true, state }, null, 2));
  } finally {
    ws.close();
  }
}

async function navigate(url) {
  if (!url) throw new Error("navigate requires a URL");
  const { ws, send } = await connectPage();
  try {
    await send("Page.enable");
    await send("Page.navigate", { url });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const state = await evalJson(send, `() => ({ href: location.href, title: document.title, text: document.body.innerText.slice(0, 3000) })`);
    console.log(JSON.stringify({ navigated: true, state }, null, 2));
  } finally {
    ws.close();
  }
}

async function waitText(text, timeoutValue = "120000") {
  if (!text) throw new Error("wait-text requires text");
  const timeoutMs = Number(timeoutValue);
  const { ws, send } = await connectPage();
  try {
    const start = Date.now();
    let state = null;
    while (Date.now() - start < timeoutMs) {
      state = await evalJson(send, `() => ({ href: location.href, text: document.body.innerText.slice(0, 5000) })`);
      if (state.text.includes(text)) {
        console.log(JSON.stringify({ found: true, text, elapsedMs: Date.now() - start, state }, null, 2));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    console.log(JSON.stringify({ found: false, text, elapsedMs: Date.now() - start, state }, null, 2));
    process.exitCode = 2;
  } finally {
    ws.close();
  }
}

async function chooseFile(filePath, xValue, yValue) {
  if (!filePath) throw new Error("choose-file requires a file path");
  const x = Number(xValue);
  const y = Number(yValue);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("choose-file requires numeric x and y");
  const { ws, send, waitForEvent } = await connectPage();
  try {
    await send("Page.enable");
    await send("DOM.enable");
    await send("Page.setInterceptFileChooserDialog", { enabled: true });
    const chooser = waitForEvent("Page.fileChooserOpened", 10000);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    const event = await chooser;
    await send("DOM.setFileInputFiles", { backendNodeId: event.backendNodeId, files: [filePath] });
    await send("Page.setInterceptFileChooserDialog", { enabled: false });
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const state = await evalJson(send, `() => ({ href: location.href, title: document.title, text: document.body.innerText.slice(0, 5000) })`);
    console.log(JSON.stringify({ chosen: true, filePath, event, state }, null, 2));
  } finally {
    ws.close();
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "inspect") return inspect();
  if (command === "screenshot") return screenshot(args[0]);
  if (command === "upload-first") return uploadFirst(args[0]);
  if (command === "click-xy") return clickXY(args[0], args[1]);
  if (command === "drag-xy") return dragXY(args[0], args[1], args[2], args[3]);
  if (command === "click-text") return clickText(args.join(" "));
  if (command === "click-text-below") return clickTextBelow(args[0], args.slice(1).join(" "));
  if (command === "caption") return caption(args[0]);
  if (command === "navigate") return navigate(args[0]);
  if (command === "wait-text") return waitText(args.slice(0, -1).join(" "), args.at(-1));
  if (command === "choose-file") return chooseFile(args[0], args[1], args[2]);
  throw new Error("Usage: inspect | screenshot <path> | click-xy <x> <y> | drag-xy <x1> <y1> <x2> <y2> | click-text <text> | click-text-below <minY> <text> | caption <path> | navigate <url> | wait-text <text> <timeoutMs> | choose-file <path> <x> <y>");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
