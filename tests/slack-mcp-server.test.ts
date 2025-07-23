import { describe, expect, test, jest, beforeEach, afterEach } from '@jest/globals';

// Mock fetch globally
(global as any).fetch = jest.fn();

// Mock the MCP SDK modules
jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: jest.fn().mockImplementation(() => ({
    registerTool: jest.fn(),
    connect: jest.fn(),
  })),
}));

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(),
}));

jest.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: jest.fn().mockImplementation(() => ({
    sessionId: 'test-session-id',
    onclose: null,
    handleRequest: jest.fn(),
  })),
}));

jest.mock('express', () => {
  const mockApp = {
    use: jest.fn(),
    post: jest.fn(),
    get: jest.fn(),
    delete: jest.fn(),
    listen: jest.fn(),
  };
  const mockExpress = jest.fn(() => mockApp);
  (mockExpress as any).json = jest.fn();
  return mockExpress;
});

// Mock process.env
const originalEnv = process.env;
const originalArgv = process.argv;

beforeEach(() => {
  jest.resetModules();
  process.env = {
    ...originalEnv,
    SLACK_BOT_TOKEN: 'xoxb-test-token',
    SLACK_TEAM_ID: 'T123456',
  };
  process.argv = originalArgv;
});

afterEach(() => {
  process.env = originalEnv;
  process.argv = originalArgv;
  jest.clearAllMocks();
});

describe('SlackClient', () => {
  let SlackClient: any;
  let slackClient: any;
  const mockFetch = (global as any).fetch;

  beforeEach(async () => {
    const indexModule = await import('../index.js');
    SlackClient = indexModule.SlackClient;
    slackClient = new SlackClient('xoxb-test-token');
  });

  test('SlackClient constructor creates headers', () => {
    expect(slackClient).toHaveProperty('botHeaders');
    expect((slackClient as any).botHeaders).toEqual({
      Authorization: 'Bearer xoxb-test-token',
      'Content-Type': 'application/json',
    });
  });

  test('getChannels with predefined IDs', async () => {
    process.env.SLACK_CHANNEL_IDS = 'C123456,C789012';
    mockFetch
      .mockResolvedValueOnce({
        json: () => Promise.resolve({
          ok: true,
          channel: { id: 'C123456', name: 'general', is_archived: false },
        }),
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({
          ok: true,
          channel: { id: 'C789012', name: 'random', is_archived: false },
        }),
      });

    const result = await slackClient.getChannels();

    expect(result).toEqual({
      ok: true,
      channels: [
        { id: 'C123456', name: 'general', is_archived: false },
        { id: 'C789012', name: 'random', is_archived: false },
      ],
      response_metadata: { next_cursor: '' },
    });
  });

  test('getChannels with API call', async () => {
    delete process.env.SLACK_CHANNEL_IDS;
    const mockResponse = {
      ok: true,
      channels: [
        { id: 'C123456', name: 'general', is_archived: false },
        { id: 'C789012', name: 'random', is_archived: false },
      ],
      response_metadata: { next_cursor: '' },
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.getChannels();

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://slack.com/api/conversations.list'),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
      })
    );
  });

  test('postMessage successful response', async () => {
    const mockResponse = {
      ok: true,
      channel: 'C123456',
      ts: '1234567890.123456',
      message: {
        text: 'Hello, world!',
        user: 'U123456',
        ts: '1234567890.123456',
      },
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.postMessage('C123456', 'Hello, world!');

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: 'C123456',
          text: 'Hello, world!',
        }),
      }
    );
  });

  test('postReply successful response', async () => {
    const mockResponse = {
      ok: true,
      channel: 'C123456',
      ts: '1234567890.123457',
      message: {
        text: 'Reply text',
        user: 'U123456',
        ts: '1234567890.123457',
        thread_ts: '1234567890.123456',
      },
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.postReply('C123456', '1234567890.123456', 'Reply text');

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: 'C123456',
          thread_ts: '1234567890.123456',
          text: 'Reply text',
        }),
      }
    );
  });

  test('addReaction successful response', async () => {
    const mockResponse = {
      ok: true,
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.addReaction('C123456', '1234567890.123456', 'thumbsup');

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://slack.com/api/reactions.add',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel: 'C123456',
          timestamp: '1234567890.123456',
          name: 'thumbsup',
        }),
      }
    );
  });

  test('getChannelHistory successful response', async () => {
    const mockResponse = {
      ok: true,
      messages: [
        {
          type: 'message',
          user: 'U123456',
          text: 'Hello',
          ts: '1234567890.123456',
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.getChannelHistory('C123456', 10);

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://slack.com/api/conversations.history'),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
      })
    );
  });

  test('getChannelHistory with cursor parameter', async () => {
    const mockResponse = {
      ok: true,
      messages: [],
      response_metadata: { next_cursor: 'next_cursor_value' },
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.getChannelHistory('C123456', 10, 'test_cursor');

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('cursor=test_cursor'),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
      })
    );
  });

  test('getChannelHistory with include_all_metadata parameter', async () => {
    const mockResponse = {
      ok: true,
      messages: [
        {
          type: 'message',
          user: 'U123456',
          text: 'Hello',
          ts: '1234567890.123456',
          metadata: { event_type: 'app_mention' },
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.getChannelHistory('C123456', 10, undefined, true);

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('include_all_metadata=true'),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
      })
    );
  });

  test('getChannelHistory with inclusive parameter', async () => {
    const mockResponse = {
      ok: true,
      messages: [
        {
          type: 'message',
          user: 'U123456',
          text: 'Hello',
          ts: '1234567890.123456',
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.getChannelHistory('C123456', 10, undefined, undefined, false);

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('inclusive=false'),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
      })
    );
  });

  test('getChannelHistory with latest parameter', async () => {
    const mockResponse = {
      ok: true,
      messages: [
        {
          type: 'message',
          user: 'U123456',
          text: 'Hello',
          ts: '1234567890.123456',
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.getChannelHistory('C123456', 10, undefined, undefined, undefined, '1640995200.000000');

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('latest=1640995200.000000'),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
      })
    );
  });

  test('getChannelHistory with oldest parameter', async () => {
    const mockResponse = {
      ok: true,
      messages: [
        {
          type: 'message',
          user: 'U123456',
          text: 'Hello',
          ts: '1234567890.123456',
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.getChannelHistory('C123456', 10, undefined, undefined, undefined, undefined, '1640908800.000000');

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('oldest=1640908800.000000'),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
      })
    );
  });

  test('getChannelHistory with time range (oldest and latest)', async () => {
    const mockResponse = {
      ok: true,
      messages: [
        {
          type: 'message',
          user: 'U123456',
          text: 'Hello',
          ts: '1234567890.123456',
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.getChannelHistory(
      'C123456', 
      50, 
      undefined, 
      undefined, 
      true, 
      '1640995200.000000', 
      '1640908800.000000'
    );

    expect(result).toEqual(mockResponse);
    const fetchCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    const url = fetchCall[0];
    
    expect(url).toContain('oldest=1640908800.000000');
    expect(url).toContain('latest=1640995200.000000');
    expect(url).toContain('inclusive=true');
    expect(url).toContain('limit=50');
  });

  test('getChannelHistory with all parameters', async () => {
    const mockResponse = {
      ok: true,
      messages: [
        {
          type: 'message',
          user: 'U123456',
          text: 'Hello',
          ts: '1234567890.123456',
          metadata: { event_type: 'app_mention' },
        },
      ],
      response_metadata: { next_cursor: 'next_cursor_value' },
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.getChannelHistory(
      'C123456', 
      25, 
      'test_cursor', 
      true, 
      false, 
      '1640995200.000000', 
      '1640908800.000000'
    );

    expect(result).toEqual(mockResponse);
    const fetchCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    const url = fetchCall[0];
    
    expect(url).toContain('channel=C123456');
    expect(url).toContain('limit=25');
    expect(url).toContain('cursor=test_cursor');
    expect(url).toContain('include_all_metadata=true');
    expect(url).toContain('inclusive=false');
    expect(url).toContain('latest=1640995200.000000');
    expect(url).toContain('oldest=1640908800.000000');
  });

  test('getChannelHistory with undefined optional parameters', async () => {
    const mockResponse = {
      ok: true,
      messages: [],
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.getChannelHistory(
      'C123456', 
      10, 
      undefined, 
      undefined, 
      undefined, 
      undefined, 
      undefined
    );

    expect(result).toEqual(mockResponse);
    const fetchCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
    const url = fetchCall[0];
    
    // Should only contain required parameters
    expect(url).toContain('channel=C123456');
    expect(url).toContain('limit=10');
    expect(url).not.toContain('cursor=');
    expect(url).not.toContain('include_all_metadata=');
    expect(url).not.toContain('inclusive=');
    expect(url).not.toContain('latest=');
    expect(url).not.toContain('oldest=');
  });

  test('getThreadReplies successful response', async () => {
    const mockResponse = {
      ok: true,
      messages: [
        {
          type: 'message',
          user: 'U123456',
          text: 'Parent message',
          ts: '1234567890.123456',
        },
        {
          type: 'message',
          user: 'U789012',
          text: 'Reply message',
          ts: '1234567890.123457',
          thread_ts: '1234567890.123456',
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.getThreadReplies('C123456', '1234567890.123456');

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://slack.com/api/conversations.replies'),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
      })
    );
  });

  test('getUsers successful response', async () => {
    const mockResponse = {
      ok: true,
      members: [
        {
          id: 'U123456',
          name: 'testuser',
          real_name: 'Test User',
        },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.getUsers(100);

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://slack.com/api/users.list'),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
      })
    );
  });

  test('getUserProfile successful response', async () => {
    const mockResponse = {
      ok: true,
      profile: {
        real_name: 'Test User',
        email: 'test@example.com',
        phone: '+1234567890',
      },
    };

    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve(mockResponse),
    });

    const result = await slackClient.getUserProfile('U123456');

    expect(result).toEqual(mockResponse);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('https://slack.com/api/users.profile.get'),
      expect.objectContaining({
        headers: {
          Authorization: 'Bearer xoxb-test-token',
          'Content-Type': 'application/json',
        },
      })
    );
  });
});

describe('createSlackServer', () => {
  test('createSlackServer returns server instance', async () => {
    const { createSlackServer, SlackClient } = await import('../index.js');
    
    const mockSlackClient = new SlackClient('xoxb-test-token');
    const server = createSlackServer(mockSlackClient);

    // Just test that the server is created and defined
    expect(server).toBeDefined();
    expect(typeof server).toBe('object');
  });
});

describe('parseArgs', () => {
  test('parseArgs with default values', async () => {
    process.argv = ['node', 'index.js'];
    const { parseArgs } = await import('../index.js');

    const result = parseArgs();

    expect(result).toEqual({
      transport: 'stdio',
      port: 3000,
      authToken: undefined,
    });
  });

  test('parseArgs with custom transport', async () => {
    process.argv = ['node', 'index.js', '--transport', 'http'];
    const { parseArgs } = await import('../index.js');

    const result = parseArgs();

    expect(result).toEqual({
      transport: 'http',
      port: 3000,
      authToken: undefined,
    });
  });

  test('parseArgs with custom port', async () => {
    process.argv = ['node', 'index.js', '--port', '8080'];
    const { parseArgs } = await import('../index.js');

    const result = parseArgs();

    expect(result).toEqual({
      transport: 'stdio',
      port: 8080,
      authToken: undefined,
    });
  });

  test('parseArgs with invalid transport', async () => {
    process.argv = ['node', 'index.js', '--transport', 'invalid'];
    const { parseArgs } = await import('../index.js');

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => parseArgs()).toThrow('process.exit called');
    expect(mockConsoleError).toHaveBeenCalledWith('Error: --transport must be either "stdio" or "http"');
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });

  test('parseArgs with invalid port', async () => {
    process.argv = ['node', 'index.js', '--port', 'invalid'];
    const { parseArgs } = await import('../index.js');

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => parseArgs()).toThrow('process.exit called');
    expect(mockConsoleError).toHaveBeenCalledWith('Error: --port must be a valid port number (1-65535)');
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });
});

describe('main', () => {
  test('main with missing env vars', async () => {
    delete process.env.SLACK_BOT_TOKEN;
    delete process.env.SLACK_TEAM_ID;

    const { main } = await import('../index.js');

    const mockExit = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(main()).rejects.toThrow('process.exit called');
    expect(mockConsoleError).toHaveBeenCalledWith(
      'Please set SLACK_BOT_TOKEN and SLACK_TEAM_ID environment variables'
    );
    expect(mockExit).toHaveBeenCalledWith(1);

    mockExit.mockRestore();
    mockConsoleError.mockRestore();
  });
});

describe('HTTP Server', () => {
  test('express module can be imported', async () => {
    const express = await import('express');
    
    // Test that express module is available and mocked
    expect(express.default).toBeDefined();
    expect(typeof express.default).toBe('function');
  });

  test('SlackClient can be instantiated', async () => {
    const { SlackClient } = await import('../index.js');
    
    const mockSlackClient = new SlackClient('xoxb-test-token');
    
    // Test that SlackClient is created successfully
    expect(mockSlackClient).toBeDefined();
    expect(mockSlackClient).toHaveProperty('botHeaders');
  });

  test('index module exports expected functions', async () => {
    const indexModule = await import('../index.js');
    
    // Test that required exports are available
    expect(indexModule.SlackClient).toBeDefined();
    expect(indexModule.createSlackServer).toBeDefined();
    expect(indexModule.parseArgs).toBeDefined();
    expect(indexModule.main).toBeDefined();
  });
});