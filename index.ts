#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import express from "express";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Type definitions for tool arguments
interface ListChannelsArgs {
  limit?: number;
  cursor?: string;
}

interface PostMessageArgs {
  channel_id: string;
  text: string;
}

interface ReplyToThreadArgs {
  channel_id: string;
  thread_ts: string;
  text: string;
}

interface AddReactionArgs {
  channel_id: string;
  timestamp: string;
  reaction: string;
}

interface GetChannelHistoryArgs {
  channel_id: string;
  limit?: number;
}

interface GetThreadRepliesArgs {
  channel_id: string;
  thread_ts: string;
}

interface GetUsersArgs {
  cursor?: string;
  limit?: number;
}

interface GetUserProfileArgs {
  user_id: string;
}

export class SlackClient {
  private botHeaders: { Authorization: string; "Content-Type": string };

  constructor(botToken: string) {
    this.botHeaders = {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Format thread_ts to ensure it has the decimal point in the correct position
   * Slack expects format like "1234567890.123456" (timestamp with period before last 6 digits)
   */
  private formatThreadTs(thread_ts: string): string {
    if (!thread_ts.includes('.')) {
      // If no period, add it so that 6 digits come after it
      if (thread_ts.length >= 7) {
        const insertPosition = thread_ts.length - 6;
        return thread_ts.slice(0, insertPosition) + '.' + thread_ts.slice(insertPosition);
      }
    }
    return thread_ts;
  }

  async getChannels(limit: number = 100, cursor?: string): Promise<any> {
    const predefinedChannelIds = process.env.SLACK_CHANNEL_IDS;
    if (!predefinedChannelIds) {
      const params = new URLSearchParams({
        types: "public_channel,private_channel",
        exclude_archived: "true",
        limit: Math.min(limit, 200).toString(),
        team_id: process.env.SLACK_TEAM_ID!,
      });
  
      if (cursor) {
        params.append("cursor", cursor);
      }
  
      const response = await fetch(
        `https://slack.com/api/conversations.list?${params}`,
        { headers: this.botHeaders },
      );
  
      return response.json();
    }

    const predefinedChannelIdsArray = predefinedChannelIds.split(",").map((id: string) => id.trim());
    const channels = [];

    for (const channelId of predefinedChannelIdsArray) {
      const params = new URLSearchParams({
        channel: channelId,
      });

      const response = await fetch(
        `https://slack.com/api/conversations.info?${params}`,
        { headers: this.botHeaders }
      );
      const data = await response.json();

      if (data.ok && data.channel && !data.channel.is_archived) {
        channels.push(data.channel);
      }
    }

    return {
      ok: true,
      channels: channels,
      response_metadata: { next_cursor: "" },
    };
  }

  async postMessage(channel_id: string, text: string): Promise<any> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({
        channel: channel_id,
        text: text,
      }),
    });

    return response.json();
  }

  async postReply(
    channel_id: string,
    thread_ts: string,
    text: string,
  ): Promise<any> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({
        channel: channel_id,
        thread_ts: this.formatThreadTs(thread_ts),
        text: text,
      }),
    });

    return response.json();
  }

  async addReaction(
    channel_id: string,
    timestamp: string,
    reaction: string,
  ): Promise<any> {
    const response = await fetch("https://slack.com/api/reactions.add", {
      method: "POST",
      headers: this.botHeaders,
      body: JSON.stringify({
        channel: channel_id,
        timestamp: timestamp,
        name: reaction,
      }),
    });

    return response.json();
  }

  async getChannelHistory(
    channel_id: string,
    limit: number = 10,
  ): Promise<any> {
    const params = new URLSearchParams({
      channel: channel_id,
      limit: limit.toString(),
    });

    const response = await fetch(
      `https://slack.com/api/conversations.history?${params}`,
      { headers: this.botHeaders },
    );

    return response.json();
  }

  async getThreadReplies(channel_id: string, thread_ts: string): Promise<any> {
    const params = new URLSearchParams({
      channel: channel_id,
      ts: this.formatThreadTs(thread_ts),
    });

    const response = await fetch(
      `https://slack.com/api/conversations.replies?${params}`,
      { headers: this.botHeaders },
    );

    return response.json();
  }

  async getUsers(limit: number = 100, cursor?: string): Promise<any> {
    const params = new URLSearchParams({
      limit: Math.min(limit, 200).toString(),
      team_id: process.env.SLACK_TEAM_ID!,
    });

    if (cursor) {
      params.append("cursor", cursor);
    }

    const response = await fetch(`https://slack.com/api/users.list?${params}`, {
      headers: this.botHeaders,
    });

    return response.json();
  }

  async getUserProfile(user_id: string): Promise<any> {
    const params = new URLSearchParams({
      user: user_id,
      include_labels: "true",
    });

    const response = await fetch(
      `https://slack.com/api/users.profile.get?${params}`,
      { headers: this.botHeaders },
    );

    return response.json();
  }
}

export function createSlackServer(slackClient: SlackClient): McpServer {
  const server = new McpServer({
    name: "Slack MCP Server",
    version: "1.0.0",
  });

  // Register all Slack tools using the modern API
  server.registerTool(
    "slack_list_channels",
    {
      title: "List Slack Channels",
      description: "List public and private channels that the bot is a member of, or pre-defined channels in the workspace with pagination",
      inputSchema: {
        limit: z.number().optional().default(100).describe("Maximum number of channels to return (default 100, max 200)"),
        cursor: z.string().optional().describe("Pagination cursor for next page of results"),
      },
    },
    async ({ limit, cursor }) => {
      const response = await slackClient.getChannels(limit, cursor);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );

  server.registerTool(
    "slack_post_message",
    {
      title: "Post Slack Message",
      description: "Post a new message to a Slack channel or direct message to user",
      inputSchema: {
        channel_id: z.string().describe("The ID of the channel or user to post to"),
        text: z.string().describe("The message text to post"),
      },
    },
    async ({ channel_id, text }) => {
      const response = await slackClient.postMessage(channel_id, text);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );

  server.registerTool(
    "slack_reply_to_thread",
    {
      title: "Reply to Slack Thread",
      description: "Reply to a specific message thread in Slack",
      inputSchema: {
        channel_id: z.string().describe("The ID of the channel containing the thread"),
        thread_ts: z.string().describe("The timestamp of the parent message in the format '1234567890.123456'. Timestamps in the format without the period can be converted by adding the period such that 6 numbers come after it."),
        text: z.string().describe("The reply text"),
      },
    },
    async ({ channel_id, thread_ts, text }) => {
      const response = await slackClient.postReply(channel_id, thread_ts, text);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );

  server.registerTool(
    "slack_add_reaction",
    {
      title: "Add Slack Reaction",
      description: "Add a reaction emoji to a message",
      inputSchema: {
        channel_id: z.string().describe("The ID of the channel containing the message"),
        timestamp: z.string().describe("The timestamp of the message to react to"),
        reaction: z.string().describe("The name of the emoji reaction (without ::)"),
      },
    },
    async ({ channel_id, timestamp, reaction }) => {
      const response = await slackClient.addReaction(channel_id, timestamp, reaction);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );

  server.registerTool(
    "slack_get_channel_history",
    {
      title: "Get Slack Channel History",
      description: "Get recent messages from a channel",
      inputSchema: {
        channel_id: z.string().describe("The ID of the channel"),
        limit: z.number().optional().default(10).describe("Number of messages to retrieve (default 10)"),
      },
    },
    async ({ channel_id, limit }) => {
      const response = await slackClient.getChannelHistory(channel_id, limit);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );

  server.registerTool(
    "slack_get_thread_replies",
    {
      title: "Get Slack Thread Replies",
      description: "Get all replies in a message thread",
      inputSchema: {
        channel_id: z.string().describe("The ID of the channel containing the thread"),
        thread_ts: z.string().describe("The timestamp of the parent message in the format '1234567890.123456'. Timestamps in the format without the period can be converted by adding the period such that 6 numbers come after it."),
      },
    },
    async ({ channel_id, thread_ts }) => {
      const response = await slackClient.getThreadReplies(channel_id, thread_ts);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );

  server.registerTool(
    "slack_get_users",
    {
      title: "Get Slack Users",
      description: "Get a list of all users in the workspace with their basic profile information",
      inputSchema: {
        cursor: z.string().optional().describe("Pagination cursor for next page of results"),
        limit: z.number().optional().default(100).describe("Maximum number of users to return (default 100, max 200)"),
      },
    },
    async ({ cursor, limit }) => {
      const response = await slackClient.getUsers(limit, cursor);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );

  server.registerTool(
    "slack_get_user_profile",
    {
      title: "Get Slack User Profile",
      description: "Get detailed profile information for a specific user",
      inputSchema: {
        user_id: z.string().describe("The ID of the user"),
      },
    },
    async ({ user_id }) => {
      const response = await slackClient.getUserProfile(user_id);
      return {
        content: [{ type: "text", text: JSON.stringify(response) }],
      };
    }
  );

  return server;
}

async function runStdioServer(slackClient: SlackClient) {
  console.error("Starting Slack MCP Server with stdio transport...");
  const server = createSlackServer(slackClient);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Slack MCP Server running on stdio");
}

async function runHttpServer(slackClient: SlackClient, port: number = 3000, authToken?: string) {
  console.error(`Starting Slack MCP Server with Streamable HTTP transport on port ${port}...`);
  
  const app = express();
  app.use(express.json());

  // Authorization middleware
  const authMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!authToken) {
      // No auth token configured, skip authorization
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Unauthorized: Missing or invalid Authorization header',
        },
        id: null,
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    if (token !== authToken) {
      return res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Unauthorized: Invalid token',
        },
        id: null,
      });
    }

    next();
  };

  // Map to store transports by session ID
  const transports: { [sessionId: string]: StreamableHTTPServerTransport } = {};

  // Handle POST requests for client-to-server communication
  app.post('/mcp', authMiddleware, async (req, res) => {
    try {
      // Check for existing session ID
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      let transport: StreamableHTTPServerTransport;

      if (sessionId && transports[sessionId]) {
        // Reuse existing transport
        transport = transports[sessionId];
      } else if (!sessionId && req.body?.method === 'initialize') {
        // New initialization request
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId) => {
            // Store the transport by session ID
            transports[sessionId] = transport;
          },
        });

        // Clean up transport when closed
        transport.onclose = () => {
          if (transport.sessionId) {
            delete transports[transport.sessionId];
          }
        };

        const server = createSlackServer(slackClient);
        // Connect to the MCP server
        await server.connect(transport);
      } else {
        // Invalid request
        res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid session ID provided',
          },
          id: null,
        });
        return;
      }

      // Handle the request
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('Error handling MCP request:', error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: 'Internal server error',
          },
          id: null,
        });
      }
    }
  });

  // Reusable handler for GET and DELETE requests
  const handleSessionRequest = async (req: express.Request, res: express.Response) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (!sessionId || !transports[sessionId]) {
      res.status(400).send('Invalid or missing session ID');
      return;
    }
    
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  };

  // Handle GET requests for server-to-client notifications via Streamable HTTP
  app.get('/mcp', authMiddleware, handleSessionRequest);

  // Handle DELETE requests for session termination
  app.delete('/mcp', authMiddleware, handleSessionRequest);

  // Health endpoint - no authentication required
  app.get('/health', (req, res) => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'Slack MCP Server',
      version: '1.0.0'
    });
  });

  const server = app.listen(port, '0.0.0.0', () => {
    console.error(`Slack MCP Server running on http://0.0.0.0:${port}/mcp`);
  });

  return server;
}

export function parseArgs() {
  const args = process.argv.slice(2);
  let transport = 'stdio'; // default
  let port = 3000;
  let authToken: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--transport' && i + 1 < args.length) {
      transport = args[i + 1];
      i++; // skip next argument
    } else if (args[i] === '--port' && i + 1 < args.length) {
      port = parseInt(args[i + 1], 10);
      i++; // skip next argument
    } else if (args[i] === '--token' && i + 1 < args.length) {
      authToken = args[i + 1];
      i++; // skip next argument
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
Usage: node index.js [options]

Options:
  --transport <type>     Transport type: 'stdio' or 'http' (default: stdio)
  --port <number>        Port for HTTP server when using Streamable HTTP transport (default: 3000)
  --token <token>   Bearer token for HTTP authorization (optional, can also use AUTH_TOKEN env var)
  --help, -h             Show this help message

Environment Variables:
  AUTH_TOKEN             Bearer token for HTTP authorization (fallback if --token not provided)

Examples:
  node index.js                                    # Use stdio transport (default)
  node index.js --transport stdio                  # Use stdio transport explicitly
  node index.js --transport http                   # Use Streamable HTTP transport on port 3000
  node index.js --transport http --port 8080       # Use Streamable HTTP transport on port 8080
  node index.js --transport http --token mytoken   # Use Streamable HTTP transport with custom auth token
  AUTH_TOKEN=mytoken node index.js --transport http   # Use Streamable HTTP transport with auth token from env var
`);
      process.exit(0);
    }
  }

  if (transport !== 'stdio' && transport !== 'http') {
    console.error('Error: --transport must be either "stdio" or "http"');
    process.exit(1);
  }

  if (isNaN(port) || port < 1 || port > 65535) {
    console.error('Error: --port must be a valid port number (1-65535)');
    process.exit(1);
  }

  return { transport, port, authToken };
}

export async function main() {
  const { transport, port, authToken } = parseArgs();
  
  const botToken = process.env.SLACK_BOT_TOKEN;
  const teamId = process.env.SLACK_TEAM_ID;

  if (!botToken || !teamId) {
    console.error(
      "Please set SLACK_BOT_TOKEN and SLACK_TEAM_ID environment variables",
    );
    process.exit(1);
  }

  const slackClient = new SlackClient(botToken);
  let httpServer: any = null;

  // Setup graceful shutdown handlers
  const setupGracefulShutdown = () => {
    const shutdown = (signal: string) => {
      console.error(`\nReceived ${signal}. Shutting down gracefully...`);
      
      if (httpServer) {
        httpServer.close(() => {
          console.error('HTTP server closed.');
          process.exit(0);
        });
        
        // Force close after 5 seconds
        setTimeout(() => {
          console.error('Forcing shutdown...');
          process.exit(1);
        }, 5000);
      } else {
        process.exit(0);
      }
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGQUIT', () => shutdown('SIGQUIT'));
  };

  setupGracefulShutdown();

  if (transport === 'stdio') {
    await runStdioServer(slackClient);
  } else if (transport === 'http') {
    // Use auth token from command line, environment variable, or generate random
    let finalAuthToken = authToken || process.env.AUTH_TOKEN;
    if (!finalAuthToken) {
      finalAuthToken = randomUUID();
      console.error(`Generated auth token: ${finalAuthToken}`);
      console.error('Use this token in the Authorization header: Bearer ' + finalAuthToken);
    } else if (authToken) {
      console.error('Using provided auth token for authorization');
    } else {
      console.error('Using auth token from AUTH_TOKEN environment variable');
    }
    
    httpServer = await runHttpServer(slackClient, port, finalAuthToken);
  }
}

// Only run main() if this file is executed directly, not when imported by tests
// This handles both direct execution and global npm installation
if (import.meta.url.startsWith('file://')) {
  const currentFile = fileURLToPath(import.meta.url);
  const executedFile = process.argv[1] ? resolve(process.argv[1]) : '';
  
  // Check if this is the main module being executed
  // Don't run if we're in a test environment (jest)
  const isTestEnvironment = process.argv.some(arg => arg.includes('jest')) || 
                            process.env.NODE_ENV === 'test' ||
                            process.argv[1]?.includes('jest');
  
  const isMainModule = !isTestEnvironment && (
    currentFile === executedFile || 
    (process.argv[1] && process.argv[1].includes('slack-mcp')) ||
    (process.argv[0].includes('node') && process.argv[1] && !process.argv[1].includes('test'))
  );
  
  if (isMainModule) {
    main().catch((error) => {
      console.error("Fatal error in main():", error);
      process.exit(1);
    });
  }
}