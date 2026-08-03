#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as cheerio from 'cheerio';
import Database from 'better-sqlite3';
import { existsSync } from 'fs';

const server = new Server(
  {
    name: 'sports-stats',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

function asArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function optionalString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} must be a non-empty string`);
  }
  return value;
}

function boundedNumber(
  value: unknown,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined ? fallback : value;
  if (typeof parsed !== 'number' || !Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be a number between ${minimum} and ${maximum}`);
  }
  return parsed;
}

// Helper function to fetch and parse HTML
async function fetchHTML(url: string): Promise<cheerio.CheerioAPI> {
  const response = await fetch(url);
  const html = await response.text();
  return cheerio.load(html);
}

// Extract player season stats
async function extractPlayerStats(season: string = '2026'): Promise<any[]> {
  const url = `https://www.basketball-reference.com/leagues/NBA_${season}_per_game.html`;
  const $ = await fetchHTML(url);

  const players: any[] = [];
  $('#per_game_stats tbody tr').each((_, row) => {
    const $row = $(row);
    if ($row.hasClass('thead')) return;

    const player = {
      name: $row.find('[data-stat="player"]').text().trim(),
      team: $row.find('[data-stat="team_id"]').text().trim(),
      games: parseInt($row.find('[data-stat="g"]').text()) || 0,
      ppg: parseFloat($row.find('[data-stat="pts_per_g"]').text()) || 0,
      rpg: parseFloat($row.find('[data-stat="trb_per_g"]').text()) || 0,
      apg: parseFloat($row.find('[data-stat="ast_per_g"]').text()) || 0,
      player_url: $row.find('[data-stat="player"] a').attr('href') || ''
    };

    if (player.name && player.player_url) players.push(player);
  });

  return players;
}

// Save splits data to database
function saveSplitsToDatabase(splitsData: any[], dbPath: string, season: string): string {
  const db = new Database(dbPath);

  // Create table
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_splits (
      player_name TEXT PRIMARY KEY,
      team TEXT,
      season TEXT,
      season_ppg REAL,
      season_rpg REAL,
      season_apg REAL,
      home_games INTEGER,
      home_ppg REAL,
      home_rpg REAL,
      home_apg REAL,
      away_games INTEGER,
      away_ppg REAL,
      away_rpg REAL,
      away_apg REAL,
      ppg_home_diff REAL,
      rpg_home_diff REAL,
      apg_home_diff REAL,
      exceeds_all_at_home INTEGER,
      consistency_score REAL
    );
  `);

  const insert = db.prepare(`
    INSERT OR REPLACE INTO player_splits VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  for (const split of splitsData) {
    if (!split.player_name) continue;

    const ppg_diff = split.home_ppg - split.season_ppg;
    const rpg_diff = split.home_rpg - split.season_rpg;
    const apg_diff = split.home_apg - split.season_apg;
    const exceeds_all = (ppg_diff >= 0 && rpg_diff >= 0 && apg_diff >= 0) ? 1 : 0;
    const consistency_score = Math.max(0, ppg_diff) + Math.max(0, rpg_diff) + Math.max(0, apg_diff);

    insert.run(
      split.player_name,
      split.team || '',
      season,
      split.season_ppg || 0,
      split.season_rpg || 0,
      split.season_apg || 0,
      split.home_games || 0,
      split.home_ppg || 0,
      split.home_rpg || 0,
      split.home_apg || 0,
      split.away_games || 0,
      split.away_ppg || 0,
      split.away_rpg || 0,
      split.away_apg || 0,
      ppg_diff,
      rpg_diff,
      apg_diff,
      exceeds_all,
      consistency_score
    );
    inserted++;
  }

  db.close();
  return `Saved ${inserted} players to ${dbPath}`;
}

// Query database
function queryDatabase(dbPath: string, query: string): any[] {
  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }

  const db = new Database(dbPath, { readonly: true });
  const results = db.prepare(query).all();
  db.close();

  return results;
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'extract_nba_stats',
      description: 'Extract NBA player statistics and prepare for parallel splits extraction. Returns player list and instructions for Claude to spawn parallel subagents to fetch home/away splits.',
      inputSchema: {
        type: 'object',
        properties: {
          season: {
            type: 'string',
            description: 'NBA season year (e.g., "2026" for 2025-26 season)',
            default: '2026'
          },
          count: {
            type: 'number',
            description: 'Number of top players to extract (default: 30)',
            default: 30
          },
          min_ppg: {
            type: 'number',
            description: 'Minimum PPG threshold (default: 20)',
            default: 20
          }
        }
      }
    },
    {
      name: 'save_nba_splits',
      description: 'Save extracted player splits data to SQLite database. Call this after parallel agents have extracted all splits data.',
      inputSchema: {
        type: 'object',
        properties: {
          splits_data: {
            type: 'array',
            description: 'Array of player splits objects with fields: player_name, team, season_ppg, season_rpg, season_apg, home_games, home_ppg, home_rpg, home_apg, away_games, away_ppg, away_rpg, away_apg'
          },
          db_path: {
            type: 'string',
            description: 'Absolute path to save the SQLite database (for example, ~/.rudi/outputs/nba.db)'
          },
          season: {
            type: 'string',
            description: 'NBA season year',
            default: '2026'
          }
        },
        required: ['splits_data', 'db_path']
      }
    },
    {
      name: 'query_nba_db',
      description: 'Query the NBA stats SQLite database with SQL',
      inputSchema: {
        type: 'object',
        properties: {
          db_path: {
            type: 'string',
            description: 'Path to the SQLite database'
          },
          query: {
            type: 'string',
            description: 'SQL query to execute'
          }
        },
        required: ['db_path', 'query']
      }
    }
  ]
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name } = request.params;
    const args = asArgs(request.params.arguments);

    switch (name) {
      case 'extract_nba_stats': {
        const season = optionalString(args.season, '2026');
        const count = boundedNumber(args.count, 30, 'count', 1, 100);
        const min_ppg = boundedNumber(args.min_ppg, 20, 'min_ppg', 0, 100);

        // Extract player stats
        const players = await extractPlayerStats(season);
        const topPlayers = players
          .filter(p => p.ppg >= min_ppg)
          .sort((a, b) => b.ppg - a.ppg)
          .slice(0, count);

        // Return structured data for Claude to spawn parallel agents
        const response = {
          action: 'spawn_parallel_agents',
          player_count: topPlayers.length,
          season: season,
          players: topPlayers.map(p => ({
            name: p.name,
            team: p.team,
            ppg: p.ppg,
            rpg: p.rpg,
            apg: p.apg,
            url: p.player_url
          })),
          instructions: `
STEP 1: Launch ${topPlayers.length} parallel subagents (one per player) in a SINGLE message.

For each player, use Task tool with:
- subagent_type: "general-purpose"
- model: "haiku"
- description: "Extract {player_name} splits"
- prompt: "Go to https://www.basketball-reference.com{player_url}/splits/${season} (remove .html from URL) and extract HOME and AWAY splits. Return ONLY valid JSON with: player_name, team, season_ppg, season_rpg, season_apg, home_games, home_ppg, home_rpg, home_apg, away_games, away_ppg, away_rpg, away_apg"

STEP 2: After ALL agents complete, compile the JSON results into an array.

STEP 3: Call save_nba_splits tool with:
- splits_data: [array of all player JSON objects]
- db_path: "~/.rudi/outputs/nba.db" (or the user's specified absolute path)
- season: "${season}"

Player list to extract:
${topPlayers.map((p, i) => `${i + 1}. ${p.name} (${p.ppg} PPG) - ${p.player_url}`).join('\n')}
`
        };

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(response, null, 2)
          }]
        };
      }

      case 'save_nba_splits': {
        const dbPath = requireString(args.db_path, 'db_path');
        const season = optionalString(args.season, '2026');
        const splitsData = args.splits_data;

        if (!Array.isArray(splitsData)) {
          throw new Error('splits_data must be an array');
        }

        const result = saveSplitsToDatabase(splitsData, dbPath, season);

        return {
          content: [{
            type: 'text',
            text: `✅ ${result}\n\nYou can now query the database using:\n- Tool: query_nba_db\n- db_path: "${dbPath}"\n\nExample queries:\n1. Players who exceed averages at home:\n   SELECT player_name, home_ppg, season_ppg FROM player_splits WHERE exceeds_all_at_home = 1 ORDER BY consistency_score DESC;\n\n2. Top home performers:\n   SELECT player_name, home_ppg, ppg_home_diff FROM player_splits ORDER BY ppg_home_diff DESC LIMIT 10;`
          }]
        };
      }

      case 'query_nba_db': {
        const results = queryDatabase(
          requireString(args.db_path, 'db_path'),
          requireString(args.query, 'query'),
        );

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(results, null, 2)
          }]
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [{
        type: 'text',
        text: `Error: ${error.message}`
      }],
      isError: true
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Sports Stats MCP server running on stdio');
}

main().catch(console.error);
