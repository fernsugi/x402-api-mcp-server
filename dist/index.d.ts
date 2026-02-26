#!/usr/bin/env node
/**
 * @x402-api/mcp-server
 *
 * MCP (Model Context Protocol) server that wraps Sugi's x402 DeFi API.
 * Gives Claude, ChatGPT, and any MCP-compatible AI agent access to
 * pay-per-call crypto/DeFi data endpoints.
 *
 * ## x402 Payment Protocol
 *
 * Every endpoint costs a small USDC micropayment (0.001–0.008 USDC).
 * Two modes:
 *
 * 1. **Auto-pay mode** — Set X402_WALLET_PRIVATE_KEY env var.
 *    x402-fetch handles the payment automatically. The agent just calls
 *    the tool and gets data.
 *
 * 2. **Manual mode** — No private key set. The tool returns 402 payment
 *    instructions so you (or the agent) can see what's needed.
 *
 * ## Setup
 *
 *   export X402_WALLET_PRIVATE_KEY=0x...your_private_key...
 *   npx @x402-api/mcp-server
 *
 * Or in your Claude Desktop config:
 *   { "command": "npx", "args": ["@x402-api/mcp-server"] }
 */
export {};
//# sourceMappingURL=index.d.ts.map