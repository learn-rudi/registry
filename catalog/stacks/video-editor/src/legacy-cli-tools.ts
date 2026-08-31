import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

type ToolArgs = Record<string, unknown>;
type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

type LegacyTool = ToolDefinition & {
  buildArgs: (args: ToolArgs) => string[];
};

const srcDir = dirname(fileURLToPath(import.meta.url));
const stackRoot = join(srcDir, "..");
const legacyCliPath = join(srcDir, "cli.js");
const maxOutputBytes = 20 * 1024 * 1024;

function stringArg(args: ToolArgs, key: string, label = key): string {
  const value = args[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required`);
  }
  return value;
}

function optionalStringArg(args: ToolArgs, key: string): string | null {
  const value = args[key];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  return value;
}

function stringArrayArg(args: ToolArgs, key: string, label = key): string[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string" && item.trim() !== "")) {
    throw new Error(`${label} must be a non-empty string array`);
  }
  return value;
}

function keywordArg(args: ToolArgs): string {
  const value = args.keywords;
  if (Array.isArray(value)) {
    const keywords = value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
    if (keywords.length === 0) {
      throw new Error("keywords must contain at least one item");
    }
    return keywords.join(",");
  }
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  throw new Error("keywords is required");
}

function addOptional(cliArgs: string[], flag: string, value: unknown): void {
  if (value === undefined || value === null || value === "") {
    return;
  }
  cliArgs.push(flag, String(value));
}

function addSilenceOptions(cliArgs: string[], args: ToolArgs): void {
  addOptional(cliArgs, "--preset", args.preset);
  addOptional(cliArgs, "--threshold", args.threshold);
  addOptional(cliArgs, "--duration", args.duration);
  addOptional(cliArgs, "--padding", args.padding);
  addOptional(cliArgs, "--min-keep-duration", args.min_keep_duration);
}

function runTool(command: string, ...args: string[]): string[] {
  return [command, ...args];
}

function runToolWithOptional(command: string, args: ToolArgs, required: string[], optional: string[] = []): string[] {
  const cliArgs = runTool(command, ...required.map((key) => stringArg(args, key)));
  for (const key of optional) {
    const value = optionalStringArg(args, key);
    if (value) cliArgs.push(value);
  }
  return cliArgs;
}

function applyOverlaysArg(args: ToolArgs): string {
  const requestPath = optionalStringArg(args, "request_path");
  if (requestPath) {
    return requestPath;
  }
  if (args.request && typeof args.request === "object") {
    return JSON.stringify(args.request);
  }
  return JSON.stringify(args);
}

const stringProp = (description: string) => ({ type: "string", description });
const numberProp = (description: string) => ({ type: "number", description });
const booleanProp = (description: string) => ({ type: "boolean", description });
const runProp = stringProp("Run slug or run directory path");

const silenceOptionProps = {
  preset: stringProp("Silence preset: aggressive, moderate, or conservative"),
  threshold: stringProp("Silence threshold in dB, for example -30"),
  duration: numberProp("Minimum silence duration in seconds"),
  padding: numberProp("Seconds of padding around cuts"),
  min_keep_duration: numberProp("Minimum kept segment duration in seconds")
};

const legacyTools: LegacyTool[] = [
  {
    name: "video_make_transcript_clips",
    description: "Create clips from timestamped transcript segments",
    inputSchema: {
      type: "object",
      properties: {
        input: stringProp("Path to the source video"),
        transcript: stringProp("Path to the timestamped transcript"),
        output_dir: stringProp("Directory to write clips into")
      },
      required: ["input", "transcript", "output_dir"]
    },
    buildArgs: (args) => runTool("clips", stringArg(args, "input"), stringArg(args, "transcript"), stringArg(args, "output_dir"))
  },
  {
    name: "video_make_topic_clips",
    description: "Create clips for transcript segments matching topic keywords",
    inputSchema: {
      type: "object",
      properties: {
        input: stringProp("Path to the source video"),
        transcript: stringProp("Path to the timestamped transcript"),
        keywords: {
          oneOf: [
            { type: "string" },
            { type: "array", items: { type: "string" } }
          ],
          description: "Comma-separated keyword string or keyword array"
        },
        output_dir: stringProp("Directory to write clips into")
      },
      required: ["input", "transcript", "keywords", "output_dir"]
    },
    buildArgs: (args) => runTool("topic-clips", stringArg(args, "input"), stringArg(args, "transcript"), keywordArg(args), stringArg(args, "output_dir"))
  },
  {
    name: "video_cut_silence",
    description: "Run the structured silence-cut workflow for one video",
    inputSchema: {
      type: "object",
      properties: {
        input: stringProp("Path to the source video"),
        output: stringProp("Optional final output video path"),
        run_slug: stringProp("Optional run slug"),
        ...silenceOptionProps
      },
      required: ["input"]
    },
    buildArgs: (args) => {
      const cliArgs = runTool("cut-silence", stringArg(args, "input"));
      const output = optionalStringArg(args, "output");
      const runSlug = optionalStringArg(args, "run_slug");
      if (output) cliArgs.push(output);
      if (runSlug) cliArgs.push(runSlug);
      addSilenceOptions(cliArgs, args);
      return cliArgs;
    }
  },
  {
    name: "video_cut_silence_batch",
    description: "Run the silence-cut workflow for multiple videos",
    inputSchema: {
      type: "object",
      properties: {
        inputs: { type: "array", items: { type: "string" }, description: "Source video paths" },
        output_dir: stringProp("Directory to write final outputs into"),
        ...silenceOptionProps
      },
      required: ["inputs", "output_dir"]
    },
    buildArgs: (args) => {
      const cliArgs = runTool("cut-silence-batch", stringArg(args, "output_dir"), ...stringArrayArg(args, "inputs"));
      addSilenceOptions(cliArgs, args);
      return cliArgs;
    }
  },
  {
    name: "video_silence_presets",
    description: "List available silence-cut presets",
    inputSchema: { type: "object", properties: {} },
    buildArgs: () => runTool("silence-presets")
  },
  {
    name: "video_init_run",
    description: "Initialize, refresh, or replace a structured video editing run",
    inputSchema: {
      type: "object",
      properties: {
        input: stringProp("Path to the source video, or existing run slug when refreshing"),
        run_slug: stringProp("Optional new run slug"),
        refresh: booleanProp("Refresh probe/about artifacts for an existing run"),
        force: booleanProp("Replace an existing run from the source video")
      },
      required: ["input"]
    },
    buildArgs: (args) => {
      const cliArgs = runTool("init", stringArg(args, "input"));
      const runSlug = optionalStringArg(args, "run_slug");
      if (runSlug) cliArgs.push(runSlug);
      if (args.refresh === true) cliArgs.push("--refresh");
      if (args.force === true) cliArgs.push("--force");
      return cliArgs;
    }
  },
  {
    name: "video_probe_run",
    description: "Probe a run and write ffprobe metadata",
    inputSchema: { type: "object", properties: { run: runProp }, required: ["run"] },
    buildArgs: (args) => runToolWithOptional("probe", args, ["run"])
  },
  {
    name: "video_normalize_run",
    description: "Normalize run source media into working media",
    inputSchema: { type: "object", properties: { run: runProp }, required: ["run"] },
    buildArgs: (args) => runToolWithOptional("normalize", args, ["run"])
  },
  {
    name: "video_transcribe_run",
    description: "Transcribe run source or rendered output with Whisper",
    inputSchema: {
      type: "object",
      properties: {
        run: runProp,
        target: stringProp("source or output"),
        render_name: stringProp("Rendered video name when target is output"),
        model: stringProp("Portable Whisper model ID such as large-v3-turbo; use environment variables for physical model paths"),
        engine: stringProp("Inference engine: auto, whisper.cpp, or python"),
        language: stringProp("Whisper language code, for example en"),
        word_timestamps: booleanProp("Preserve word timestamps; enable for editing and disable for faster meeting transcripts"),
        vad: booleanProp("Enable whisper.cpp voice activity detection"),
        initial_prompt: stringProp("Meeting glossary or initial transcription prompt")
      },
      required: ["run"]
    },
    buildArgs: (args) => {
      const target = optionalStringArg(args, "target") || "source";
      const cliArgs = runTool("transcribe", stringArg(args, "run"), target);
      if (target === "output") {
        cliArgs.push(stringArg(args, "render_name"));
        const model = optionalStringArg(args, "model");
        if (model) cliArgs.push(model);
      } else {
        const model = optionalStringArg(args, "model");
        if (model) cliArgs.push(model);
      }
      addOptional(cliArgs, "--engine", args.engine);
      addOptional(cliArgs, "--language", args.language);
      addOptional(cliArgs, "--word-timestamps", args.word_timestamps);
      addOptional(cliArgs, "--vad", args.vad);
      addOptional(cliArgs, "--initial-prompt", args.initial_prompt);
      return cliArgs;
    }
  },
  {
    name: "video_cluster_transcript",
    description: "Build phrase clusters from a run source transcript",
    inputSchema: { type: "object", properties: { run: runProp }, required: ["run"] },
    buildArgs: (args) => runToolWithOptional("cluster", args, ["run"])
  },
  {
    name: "video_detect_silence",
    description: "Detect silence in a run and write silence analysis",
    inputSchema: { type: "object", properties: { run: runProp }, required: ["run"] },
    buildArgs: (args) => runToolWithOptional("silence", args, ["run"])
  },
  {
    name: "video_audit_cuts",
    description: "Audit proposed cuts for pacing and transcript safety",
    inputSchema: { type: "object", properties: { run: runProp }, required: ["run"] },
    buildArgs: (args) => runToolWithOptional("cut-audit", args, ["run"])
  },
  {
    name: "video_plan_cut",
    description: "Create or refresh composition.json from run analysis artifacts",
    inputSchema: { type: "object", properties: { run: runProp }, required: ["run"] },
    buildArgs: (args) => runToolWithOptional("plan", args, ["run"])
  },
  {
    name: "video_render_rough",
    description: "Render a rough cut from a run composition with FFmpeg",
    inputSchema: {
      type: "object",
      properties: {
        run: runProp,
        output: stringProp("Optional render filename or output path")
      },
      required: ["run"]
    },
    buildArgs: (args) => runToolWithOptional("render-rough", args, ["run"], ["output"])
  },
  {
    name: "video_generate_captions",
    description: "Generate caption cues from a run transcript and composition",
    inputSchema: { type: "object", properties: { run: runProp }, required: ["run"] },
    buildArgs: (args) => runToolWithOptional("captions", args, ["run"])
  },
  {
    name: "video_render_captions",
    description: "Burn generated captions onto an existing render with FFmpeg/libass",
    inputSchema: {
      type: "object",
      properties: {
        run: runProp,
        input: stringProp("Input render filename or path"),
        output: stringProp("Optional output render filename or path")
      },
      required: ["run", "input"]
    },
    buildArgs: (args) => runToolWithOptional("render-captions", args, ["run", "input"], ["output"])
  },
  {
    name: "video_grade_source",
    description: "Grade run working media and point the Remotion composition at the graded source",
    inputSchema: {
      type: "object",
      properties: {
        run: runProp,
        preset: stringProp("Grade preset: natural, talking-head, or punchy"),
        output: stringProp("Optional run-local graded source filename")
      },
      required: ["run"]
    },
    buildArgs: (args) => runToolWithOptional("grade-source", args, ["run"], ["preset", "output"])
  },
  {
    name: "video_grade_render",
    description: "Grade an existing render in a run renders directory",
    inputSchema: {
      type: "object",
      properties: {
        run: runProp,
        input: stringProp("Input render filename"),
        output: stringProp("Optional output render filename"),
        preset: stringProp("Grade preset: natural, talking-head, or punchy")
      },
      required: ["run", "input"]
    },
    buildArgs: (args) => runToolWithOptional("grade-render", args, ["run", "input"], ["output", "preset"])
  },
  {
    name: "video_grade_presets",
    description: "List available color grade presets",
    inputSchema: { type: "object", properties: {} },
    buildArgs: () => runTool("grade-presets")
  },
  {
    name: "video_add_lower_third",
    description: "Add a lower-third overlay entry to a run composition",
    inputSchema: {
      type: "object",
      properties: {
        run: runProp,
        title: stringProp("Lower-third title"),
        subtitle: stringProp("Optional subtitle"),
        at: stringProp("Start time in seconds"),
        duration: stringProp("Duration in seconds"),
        style: stringProp("Lower-third style"),
        position: stringProp("Lower-third position")
      },
      required: ["run", "title"]
    },
    buildArgs: (args) => runToolWithOptional("lower-third", args, ["run", "title"], ["subtitle", "at", "duration", "style", "position"])
  },
  {
    name: "video_apply_overlays",
    description: "Apply full-screen image overlays to a video from an overlay request",
    inputSchema: {
      type: "object",
      properties: {
        request_path: stringProp("Path to an overlay request JSON file"),
        request: { type: "object", description: "Overlay request object" },
        video_path: stringProp("Source video path when passing the request directly"),
        format: stringProp("story, portrait, landscape, or square"),
        overlays: { type: "array", description: "Overlay entries" },
        output_path: stringProp("Output video path")
      }
    },
    buildArgs: (args) => runTool("apply-overlays", applyOverlaysArg(args))
  },
  {
    name: "video_qa",
    description: "Probe a render and sample QA frames for a run",
    inputSchema: {
      type: "object",
      properties: {
        run: runProp,
        render_name: stringProp("Optional render filename")
      },
      required: ["run"]
    },
    buildArgs: (args) => runToolWithOptional("qa", args, ["run"], ["render_name"])
  },
  {
    name: "video_review",
    description: "Write review.json and review.md from current run artifacts",
    inputSchema: {
      type: "object",
      properties: {
        run: runProp,
        render_name: stringProp("Optional render filename")
      },
      required: ["run"]
    },
    buildArgs: (args) => runToolWithOptional("review", args, ["run"], ["render_name"])
  }
];

const legacyToolByName = new Map(legacyTools.map((tool) => [tool.name, tool]));

export const legacyCliTools: ToolDefinition[] = legacyTools.map(({ buildArgs: _buildArgs, ...tool }) => tool);

export function isLegacyCliTool(name: string): boolean {
  return legacyToolByName.has(name);
}

export async function runLegacyCliTool(name: string, args: ToolArgs = {}): Promise<string> {
  const tool = legacyToolByName.get(name);
  if (!tool) {
    throw new Error(`Unknown legacy video tool: ${name}`);
  }

  const cliArgs = tool.buildArgs(args);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [legacyCliPath, ...cliArgs], {
      cwd: stackRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    let outputBytes = 0;

    function append(chunk: Buffer, stream: "stdout" | "stderr") {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill("SIGTERM");
        reject(new Error("video-editor CLI output exceeded 20MB"));
        return;
      }
      if (stream === "stdout") {
        stdout += chunk.toString("utf8");
      } else {
        stderr += chunk.toString("utf8");
      }
    }

    child.stdout.on("data", (chunk) => append(chunk, "stdout"));
    child.stderr.on("data", (chunk) => append(chunk, "stderr"));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim() || stderr.trim());
        return;
      }

      reject(new Error([
        `video-editor CLI ${cliArgs[0]} failed with exit code ${code}`,
        stderr.trim(),
        stdout.trim()
      ].filter(Boolean).join("\n")));
    });
  });
}
