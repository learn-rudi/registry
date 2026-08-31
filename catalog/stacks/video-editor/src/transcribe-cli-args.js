function parseBooleanOption(flag, value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${flag} must be true or false`);
}

export function parseTranscribeArgs(rawArgs) {
  const positionals = [];
  const options = {};
  const optionNames = new Map([
    ['--engine', 'engine'],
    ['--language', 'language'],
    ['--initial-prompt', 'initialPrompt']
  ]);
  const booleanOptions = new Map([
    ['--word-timestamps', 'wordTimestamps'],
    ['--vad', 'vad']
  ]);

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }

    const next = rawArgs[index + 1];
    if (next === undefined) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (booleanOptions.has(arg)) {
      options[booleanOptions.get(arg)] = parseBooleanOption(arg, next);
    } else if (optionNames.has(arg)) {
      options[optionNames.get(arg)] = next;
    } else {
      throw new Error(`Unknown transcribe option: ${arg}`);
    }
    index += 1;
  }

  const [runArg, target = 'source', third, fourth] = positionals;
  if (!runArg || !['source', 'output'].includes(target)) {
    throw new Error('Usage: transcribe <run> source [model] [options], or transcribe <run> output <render> [model] [options]');
  }

  if (target === 'source' && positionals.length > 3) {
    throw new Error('Usage: transcribe <run> source [model] [options]');
  }
  if (target === 'output' && (!third || positionals.length > 4)) {
    throw new Error('Usage: transcribe <run> output <render> [model] [options]');
  }

  return {
    runArg,
    target,
    options: {
      ...options,
      renderName: target === 'output' ? third : null,
      model: target === 'output' ? fourth : third
    }
  };
}
