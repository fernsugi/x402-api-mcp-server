# @x402-api/mcp-server

<a href="https://glama.ai/mcp/servers/@fernsugi/x402-api">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@fernsugi/x402-api/badge" alt="x402-api MCP server" />
</a>

> MCP server that gives Claude, ChatGPT, and any MCP-compatible AI agent access to pay-per-call crypto/DeFi data via the [x402 protocol](https://github.com/coinbase/x402).

**8 tools. No API keys. AI agents pay USDC micropayments on Base, per request.**

**Find this service:** [Official MCP Registry](https://registry.modelcontextprotocol.io/?q=io.github.fernsugi%2Fx402-api) · [Glama](https://glama.ai/mcp/servers/fernsugi/x402-api-mcp-server) · [Agent discovery manifest](https://x402-api.fly.dev/.well-known/x402) · [OpenAPI](https://x402-api.fly.dev/openapi.json). The API's new discovery URLs need a server deployment before those links work publicly.

```
  ██╗  ██╗██╗  ██╗ ██████╗ ██████╗
   ╚██╗██╔╝██║  ██║██╔═══██╗╚════██╗
    ╚███╔╝ ███████║██║   ██║ █████╔╝
    ██╔██╗ ╚════██║██║   ██║██╔═══╝
   ██╔╝ ██╗     ██║╚██████╔╝███████╗
   ╚═╝  ╚═╝     ╚═╝ ╚═════╝ ╚══════╝
```

## Tools

| Tool | API Endpoint | Cost | Description |
|------|-------------|------|-------------|
| `get_crypto_prices` | `GET /api/price-feed` | 0.001 USDC | BTC/ETH/SOL + top 24h movers |
| `get_gas_prices` | `GET /api/gas-tracker` | 0.001 USDC | Multi-chain gas (ETH, Base, Polygon, Arbitrum) |
| `get_dex_quotes` | `GET /api/dex-quotes` | 0.002 USDC | One ParaSwap aggregate route |
| `scan_token` | `GET /api/token-scanner` | 0.003 USDC | GoPlus security flags and heuristic |
| `track_whales` | `GET /api/whale-tracker` | 0.005 USDC | Top-holder sample and supply share |
| `scan_yields` | `GET /api/yield-scanner` | 0.005 USDC | DefiLlama pool APYs and TVL |
| `get_funding_rates` | `GET /api/funding-rates` | 0.008 USDC | Hyperliquid and dYdX hourly rates |
| `profile_wallet` | `GET /api/wallet-profiler` | 0.008 USDC | Observed Blockscout balances; partial coverage |

---

## Quick Start

### Option A: Inspect mode (no payment needed)

Just run it — any 402 responses will return human-readable payment instructions:

```bash
npx @x402-api/mcp-server
```

Claude will tell you what's needed when a tool requires payment.

### Option B: Auto-pay mode (fully autonomous)

Install optional payment deps and set your wallet key:

```bash
npm install -g @x402-api/mcp-server
npm install -g viem
export X402_WALLET_PRIVATE_KEY=0x<your_private_key>
x402-api-mcp
```

The MCP server signs Base USDC EIP-3009 authorizations only when the API advertises that settlement mode. The default payment cap is 0.01 USDC per call. Fund the wallet with USDC on Base; the API operator sponsors gas in direct settlement mode.

---

## Claude Desktop Integration

Add to your `claude_desktop_config.json`:

### Without auto-pay (inspect mode)

```json
{
  "mcpServers": {
    "x402-api": {
      "command": "npx",
      "args": ["@x402-api/mcp-server"]
    }
  }
}
```

### With auto-pay

```json
{
  "mcpServers": {
    "x402-api": {
      "command": "npx",
      "args": ["@x402-api/mcp-server"],
      "env": {
        "X402_WALLET_PRIVATE_KEY": "0x<your_private_key>"
      }
    }
  }
}
```

**Config file location:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `X402_WALLET_PRIVATE_KEY` | Optional | Base wallet private key for EIP-3009 automatic payment. Requires `viem`. |
| `X402_MAX_PER_CALL_USDC` | Optional | Per-call cap, default `0.01` USDC. |
| `X402_API_BASE_URL` | Optional | Override API URL (default: `https://x402-api.fly.dev`) |

---

## How x402 Payments Work

This API uses the [x402 protocol](https://github.com/coinbase/x402) — HTTP 402 Payment Required:

1. **Agent calls tool** → MCP server makes API request
2. **Server returns 402** with payment details (amount, USDC address, Base network)
3. **Auto-pay mode:** this client signs an EIP-3009 authorization and retries; the API settles it on Base
4. **Inspect mode:** MCP returns 402 details without signing or paying

**Payment details:**
- Token: USDC on Base mainnet
- Address: `0x60264c480b67adb557efEd22Cf0e7ceA792DefB7`
- Chain: Base (chain ID 8453)
- Amount: 0.001–0.008 USDC per call (< 1 cent USD)

---

## Tool Reference

### `get_crypto_prices`
No parameters. Returns current prices for BTC, ETH, SOL + top 24h movers.

```
Cost: 0.001 USDC
```

### `get_gas_prices`
No parameters. Returns gas prices for Ethereum, Base, Polygon, Arbitrum — slow/standard/fast tiers.

```
Cost: 0.001 USDC
```

### `get_dex_quotes`
Compare swap quotes across DEXes.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `from` | string | ✅ | Input token (e.g. `"ETH"`, `"0x..."`) |
| `to` | string | ✅ | Output token (e.g. `"USDC"`) |
| `amount` | string | ✅ | Amount to swap (e.g. `"1.5"`) |

```
Cost: 0.002 USDC
```

### `scan_token`
Token security scan — detects rug-pull flags, honeypot patterns, mint authority, etc.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `token` | string | ✅ | Contract address or symbol (e.g. `"PEPE"`) |

```
Cost: 0.003 USDC
```

### `track_whales`
Top-holder sample from GoPlus. Gini and recent transfer history unavailable.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `token` | string | ✅ | Contract address or symbol |

```
Cost: 0.005 USDC
```

### `scan_yields`
Top DeFi yield opportunities across Aave, Compound, Morpho, Lido, Pendle, etc.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `chain` | string | ❌ | Filter by chain: `"ethereum"`, `"base"`, `"arbitrum"`, `"polygon"` |
| `min_tvl` | number | ❌ | Minimum TVL in USD (e.g. `1000000`) |

```
Cost: 0.005 USDC
```

### `get_funding_rates`
Hourly perpetual funding from Hyperliquid and dYdX v4. Spreads are indicative.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `asset` | string | ❌ | Asset symbol (e.g. `"BTC"`, `"ETH"`). All assets if omitted. |

```
Cost: 0.008 USDC
```

### `profile_wallet`
Observed priced wallet balances and available transaction counts. DeFi positions, PnL and risk score unavailable.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `address` | string | ✅ | Ethereum/Base wallet address (`0x...`) |

```
Cost: 0.008 USDC
```

---

## Development

```bash
git clone https://github.com/fernsugi/x402-api-mcp-server
cd x402-api-mcp-server

npm install
npm run build
npm start
```

To test without a payment wallet, simply run and see the 402 responses:

```bash
node dist/index.js
```

---

## Links

- [x402 API Landing Page](https://x402-api.fly.dev)
- [x402 Protocol](https://github.com/coinbase/x402)
- [Base Chain](https://base.org)
- [ERC-8004 Agent Identity](https://eips.ethereum.org/EIPS/eip-8004)
- [Agent #18763 on BaseScan](https://basescan.org/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432)

---

## License

MIT
