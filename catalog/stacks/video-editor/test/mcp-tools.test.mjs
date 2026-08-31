import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const expectedTools = [
  'video_info',
  'video_trim',
  'video_speed',
  'video_extract_audio',
  'video_remove_silence',
  'video_resize',
  'video_compress',
  'video_concat',
  'video_frames',
  'video_extract_slides',
  'video_thumbnail',
  'video_make_transcript_clips',
  'video_make_topic_clips',
  'video_cut_silence',
  'video_cut_silence_batch',
  'video_silence_presets',
  'video_init_run',
  'video_probe_run',
  'video_normalize_run',
  'video_transcribe_run',
  'video_cluster_transcript',
  'video_detect_silence',
  'video_audit_cuts',
  'video_plan_cut',
  'video_render_rough',
  'video_generate_captions',
  'video_render_captions',
  'video_add_lower_third',
  'video_apply_overlays',
  'video_qa',
  'video_review',
  'video_list_templates',
  'video_render_template',
  'video_get_render_job',
  'video_transcribe_audio',
  'video_process_video_transcript'
];

test('MCP server exposes quick tools and comprehensive workflow tools', async () => {
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', 'src/index.ts', '--mcp'],
    cwd: process.cwd(),
    env: process.env
  });
  const client = new Client(
    { name: 'video-editor-mcp-test', version: '0.1.0' },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name).sort();

    for (const tool of expectedTools) {
      assert.ok(names.includes(tool), `missing MCP tool: ${tool}`);
    }

    const transcribeRun = tools.tools.find((tool) => tool.name === 'video_transcribe_run');
    assert.ok(transcribeRun, 'expected video_transcribe_run tool');
    const transcribeProperties = transcribeRun.inputSchema.properties;
    assert.equal(transcribeProperties.engine.type, 'string');
    assert.equal(transcribeProperties.word_timestamps.type, 'boolean');
    assert.equal(transcribeProperties.vad.type, 'boolean');
    assert.equal(transcribeProperties.initial_prompt.type, 'string');
    assert.equal(transcribeProperties.language.type, 'string');

    const presets = await client.callTool({
      name: 'video_silence_presets',
      arguments: {}
    });
    const parsed = JSON.parse(presets.content[0].text);
    const presetNames = parsed.map((preset) => preset.name);
    assert.ok(presetNames.includes('aggressive'), 'expected aggressive silence preset');
    assert.ok(presetNames.includes('moderate'), 'expected moderate silence preset');
    assert.ok(presetNames.includes('conservative'), 'expected conservative silence preset');

    const templates = await client.callTool({
      name: 'video_list_templates',
      arguments: {}
    });
    const templatePayload = JSON.parse(templates.content[0].text);
    assert.equal(templatePayload.ok, true);
    assert.ok(
      templatePayload.templates.some((template) => template.template_id === 'stat-card-short'),
      'expected stat-card-short template'
    );
  } finally {
    await client.close();
  }
});
