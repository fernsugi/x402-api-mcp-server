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
 *    This client signs the server's Base USDC EIP-3009 challenge. The agent calls
 *    the tool and gets data.
 *
 * 2. **Inspect mode** — No private key set. The tool returns 402 requirements.
 *
 * ## Setup
 *
 *   export X402_WALLET_PRIVATE_KEY=0x...your_private_key...
 *   npx @x402-api/mcp-server
 *
 * Or in your Claude Desktop config:
 *   { "command": "npx", "args": ["@x402-api/mcp-server"] }
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { randomBytes } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ErrorCode, McpError, } from '@modelcontextprotocol/sdk/types.js';
// ─── Configuration ────────────────────────────────────────────────────────────
const API_BASE_URL = process.env.X402_API_BASE_URL || 'https://x402-api.fly.dev';
const WALLET_PRIVATE_KEY = process.env.X402_WALLET_PRIVATE_KEY;
const SERVER_VERSION = '1.0.5';
const REFERRAL_SOURCE = ['github', 'glama', 'nohumans', 'bazaar', 'mcp', 'eliza', 'demo', 'test'].includes(process.env.X402_REFERRAL_SOURCE || '') ? process.env.X402_REFERRAL_SOURCE : 'mcp';
const EXPECTED_PAY_TO = (process.env.X402_EXPECTED_PAY_TO || '0x60264c480b67adb557efEd22Cf0e7ceA792DefB7').toLowerCase();
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
let _fetchFn = null;
/**
 * Returns a fetch function that auto-handles x402 payments if a wallet
 * private key is configured. Falls back to standard fetch otherwise.
 */
async function getX402Fetch() {
    if (_fetchFn)
        return _fetchFn;
    if (WALLET_PRIVATE_KEY) {
        try {
            // Keep viem optional so inspect mode needs no wallet dependency.
            const dynImport = new Function('m', 'return import(m)');
            const viemAccounts = await dynImport('viem/accounts');
            const privateKeyToAccount = viemAccounts['privateKeyToAccount'];
            const account = privateKeyToAccount(WALLET_PRIVATE_KEY);
            const maxPerCall = Number(process.env.X402_MAX_PER_CALL_USDC || '0.01');
            if (!Number.isFinite(maxPerCall) || maxPerCall <= 0) {
                throw new Error('Invalid X402_MAX_PER_CALL_USDC');
            }
            _fetchFn = async (url, init) => {
                const response = await fetch(url, init);
                if (response.status !== 402)
                    return response;
                const challenge = await response.clone().json();
                const offer = challenge.accepts?.find(item => item.network === 'base' &&
                    item.asset?.toLowerCase() === BASE_USDC.toLowerCase());
                if (!offer)
                    return response;
                if (!offer.extra?.supportedProofs?.includes('eip3009_transferWithAuthorization'))
                    return response;
                if (!/^0x[0-9a-fA-F]{40}$/.test(offer.payTo) || offer.payTo.toLowerCase() !== EXPECTED_PAY_TO)
                    throw new Error('Unexpected payment recipient');
                const value = BigInt(offer.maxAmountRequired);
                if (value <= 0n || value > BigInt(Math.floor(maxPerCall * 1_000_000))) {
                    throw new Error(`Payment exceeds per-call cap of ${maxPerCall} USDC`);
                }
                const now = Math.floor(Date.now() / 1000);
                const auth = {
                    from: account.address,
                    to: offer.payTo,
                    value,
                    validAfter: 0n,
                    validBefore: BigInt(now + 60),
                    nonce: `0x${randomBytes(32).toString('hex')}`,
                };
                const signature = await account.signTypedData({
                    domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: BASE_USDC },
                    types: { TransferWithAuthorization: [
                            { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
                            { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
                            { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
                        ] },
                    primaryType: 'TransferWithAuthorization',
                    message: auth,
                });
                const payload = Buffer.from(JSON.stringify({ signature, payload: { authorization: {
                            ...auth,
                            value: value.toString(),
                            validAfter: auth.validAfter.toString(),
                            validBefore: auth.validBefore.toString(),
                        } } })).toString('base64');
                const headers = new Headers(init?.headers);
                headers.set('X-Payment', payload);
                return fetch(url, { ...init, headers });
            };
            process.stderr.write(`[x402-mcp] Base USDC auto-pay enabled. Wallet: ${account.address}; cap ${maxPerCall} USDC/call\n`);
            return _fetchFn;
        }
        catch (err) {
            process.stderr.write(`[x402-mcp] Auto-pay unavailable: ${err instanceof Error ? err.message : String(err)}. Falling back to inspect mode.\n` +
                `  Install viem and check the wallet key.\n`);
        }
    }
    // Standard fetch — 402s will surface as payment instruction responses
    _fetchFn = fetch;
    return _fetchFn;
}
async function callApi(endpoint, params = {}) {
    const url = new URL(`${API_BASE_URL}${endpoint}`);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== '') {
            url.searchParams.set(key, String(value));
        }
    }
    const fetchFn = await getX402Fetch();
    let response;
    const controller = new AbortController();
    const fetchTimeout = setTimeout(() => controller.abort(), 30_000);
    try {
        response = await fetchFn(url.toString(), {
            headers: {
                'Accept': 'application/json',
                'User-Agent': `x402-api-mcp/${SERVER_VERSION}`,
                'X-X402-Source': REFERRAL_SOURCE,
            },
            signal: controller.signal,
        });
    }
    catch (err) {
        const isTimeout = err instanceof Error && err.name === 'AbortError';
        throw new McpError(ErrorCode.InternalError, isTimeout
            ? `Request to ${endpoint} timed out after 30 seconds`
            : `Network error calling ${endpoint}: ${err instanceof Error ? err.message : String(err)}`);
    }
    finally {
        clearTimeout(fetchTimeout);
    }
    if (response.status === 402) {
        // Clone before reading so we can fall back to text() if JSON parsing fails.
        // Without the clone, calling response.json() consumes the body; a subsequent
        // response.text() call then throws "body already used".
        const cloned = response.clone();
        let paymentDetails;
        try {
            paymentDetails = await response.json();
        }
        catch {
            paymentDetails = await cloned.text();
        }
        return { status: 402, data: null, paymentRequired: true, paymentDetails };
    }
    if (!response.ok) {
        const errorText = await response.text();
        if (response.status === 400 || response.status === 422) {
            throw new McpError(ErrorCode.InvalidParams, `Invalid request to ${endpoint}: ${errorText}`);
        }
        throw new McpError(ErrorCode.InternalError, `API error ${response.status} from ${endpoint}: ${errorText}`);
    }
    const data = await response.json();
    return { status: response.status, data };
}
/**
 * Format a successful API response or payment instructions.
 */
function formatResult(result, toolName) {
    if (result.paymentRequired) {
        const details = result.paymentDetails;
        const accepts = details?.accepts;
        const first = accepts?.[0];
        let message = `## Payment Required — ${toolName}\n\n`;
        message += `This endpoint requires a USDC micropayment on Base network.\n\n`;
        if (first) {
            const amountRaw = Number(first.maxAmountRequired ?? 0);
            const amountUsdc = (amountRaw / 1_000_000).toFixed(6);
            message += `**Cost:** ${amountUsdc} USDC\n`;
            message += `**Pay to:** \`${first.payTo}\`\n`;
            message += `**Network:** Base mainnet (chain ID 8453)\n`;
            message += `**Asset:** USDC (\`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913\`)\n\n`;
        }
        const proofs = first?.extra?.supportedProofs || [];
        if (proofs.includes('eip3009_transferWithAuthorization')) {
            message += `To enable automatic payment, install viem, set X402_WALLET_PRIVATE_KEY, and restart this MCP server.\n`;
            message += `The default per-call cap is 0.01 USDC; configure X402_MAX_PER_CALL_USDC if needed.\n\n`;
        }
        else {
            message += `This deployment does not advertise EIP-3009 settlement. Ask the API operator to configure it before paying.\n\n`;
        }
        message += `---\n**Raw 402 response:**\n\`\`\`json\n`;
        message += JSON.stringify(result.paymentDetails, null, 2);
        message += `\n\`\`\``;
        return message;
    }
    return JSON.stringify(result.data, null, 2);
}
// ─── Tool Definitions ─────────────────────────────────────────────────────────
const TOOLS = [
    {
        name: 'get_crypto_prices',
        description: 'Get live cryptocurrency prices and top 24h movers. Returns BTC, ETH, SOL prices plus top gainers/losers. ' +
            'Costs 0.001 USDC per call (x402 micropayment on Base). ' +
            'Data sourced live from CoinGecko or CoinLore fallback.',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'get_gas_prices',
        description: 'Get current gas prices across multiple chains: Ethereum, Base, Polygon, and Arbitrum. ' +
            'Returns slow/standard/fast tiers in gwei and estimated USD cost. ' +
            'Costs 0.001 USDC per call (x402 micropayment on Base).',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'get_dex_quotes',
        description: 'Get one live ParaSwap aggregate route for a supported pair. ' +
            'Returns expected output and route components; no independent venue comparison. ' +
            'Costs 0.002 USDC per call (x402 micropayment on Base).',
        inputSchema: {
            type: 'object',
            properties: {
                from: {
                    type: 'string',
                    description: 'Input token symbol or address (e.g. "ETH", "USDC", "0x...")',
                },
                to: {
                    type: 'string',
                    description: 'Output token symbol or address (e.g. "USDC", "DAI", "0x...")',
                },
                amount: {
                    type: 'string',
                    description: 'Amount to swap (e.g. "1.5" for 1.5 ETH)',
                },
                chain: {
                    type: 'string',
                    description: 'Chain to query (e.g. "ethereum", "base", "arbitrum"). Defaults to "ethereum".',
                },
            },
            required: ['from', 'to', 'amount'],
        },
    },
    {
        name: 'scan_token',
        description: 'Read GoPlus ERC-20 security flags and a disclosed risk heuristic. ' +
            'Unavailable metrics are null; this is not an audit. ' +
            'Costs 0.003 USDC per call (x402 micropayment on Base).',
        inputSchema: {
            type: 'object',
            properties: {
                token: {
                    type: 'string',
                    description: 'Token contract address (0x...) or symbol (e.g. "PEPE", "UNI")',
                },
                chain: {
                    type: 'string',
                    description: 'Chain to scan on (e.g. "ethereum", "base", "arbitrum", "polygon"). Defaults to "ethereum".',
                },
            },
            required: ['token'],
        },
    },
    {
        name: 'track_whales',
        description: 'Read a GoPlus sample of top ERC-20 holders and reported supply share. ' +
            'Full distribution, Gini, and recent transfer history are unavailable. ' +
            'Costs 0.005 USDC per call (x402 micropayment on Base).',
        inputSchema: {
            type: 'object',
            properties: {
                token: {
                    type: 'string',
                    description: 'Token contract address (0x...) or symbol (e.g. "ETH", "PEPE")',
                },
                chain: {
                    type: 'string',
                    description: 'Chain to query (ethereum, base, arbitrum, polygon). Defaults to ethereum.',
                },
            },
            required: ['token'],
        },
    },
    {
        name: 'scan_yields',
        description: 'Scan top DeFi yield opportunities across protocols: Aave, Compound, Morpho, Lido, Pendle, and more. ' +
            'Filter by chain, asset, and minimum TVL. Returns provider reported APY and TVL without a safety rating. ' +
            'Costs 0.005 USDC per call (x402 micropayment on Base).',
        inputSchema: {
            type: 'object',
            properties: {
                chain: {
                    type: 'string',
                    description: 'Blockchain to filter by (e.g. "ethereum", "base", "arbitrum", "polygon"). ' +
                        'Omit for all chains.',
                },
                asset: {
                    type: 'string',
                    description: 'Filter by asset symbol (e.g. "ETH", "USDC", "stETH"). Omit for all assets.',
                },
                min_tvl: {
                    type: 'number',
                    description: 'Minimum TVL in USD (e.g. 1000000 for $1M). Omit for no minimum.',
                },
                limit: {
                    type: 'number',
                    description: 'Maximum number of results to return (1–50). Defaults to 20.',
                },
            },
            required: [],
        },
    },
    {
        name: 'get_funding_rates',
        description: 'Get hourly perpetual funding rates from Hyperliquid and dYdX v4. ' +
            'Current and predicted rates are compared as indicative spreads; fees and basis risk are excluded. ' +
            'Costs 0.008 USDC per call (x402 micropayment on Base).',
        inputSchema: {
            type: 'object',
            properties: {
                asset: {
                    type: 'string',
                    description: 'Asset symbol (e.g. "BTC", "ETH", "SOL"). Returns all assets if omitted.',
                },
                min_spread: {
                    type: 'number',
                    description: 'Filter for arbitrage spreads >= N basis points (e.g. 0.5). Omit for no filter.',
                },
            },
            required: [],
        },
    },
    {
        name: 'profile_wallet',
        description: 'Read priced public wallet balances and available transaction counts from Blockscout. ' +
            'Coverage may be partial; DeFi positions, PnL, and risk score are unavailable. ' +
            'Costs 0.008 USDC per call (x402 micropayment on Base).',
        inputSchema: {
            type: 'object',
            properties: {
                address: {
                    type: 'string',
                    description: 'Ethereum or Base wallet address (0x...)',
                },
                chain: {
                    type: 'string',
                    description: 'Filter by chain (e.g. "ethereum", "base", "arbitrum", "polygon"). Defaults to "all".',
                },
            },
            required: ['address'],
        },
    },
];
// ─── MCP Server ───────────────────────────────────────────────────────────────
const server = new Server({
    name: 'x402-api-mcp',
    version: SERVER_VERSION,
}, {
    capabilities: {
        tools: {},
    },
});
// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(tool => ({ ...tool, annotations: { readOnlyHint: !WALLET_PRIVATE_KEY, destructiveHint: false, idempotentHint: !WALLET_PRIVATE_KEY, openWorldHint: true } })),
}));
// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const params = (args ?? {});
    let result;
    switch (name) {
        case 'get_crypto_prices':
            result = await callApi('/api/price-feed');
            break;
        case 'get_gas_prices':
            result = await callApi('/api/gas-tracker');
            break;
        case 'get_dex_quotes':
            if (!params.from || !params.to || !params.amount) {
                throw new McpError(ErrorCode.InvalidParams, 'get_dex_quotes requires: from, to, amount');
            }
            result = await callApi('/api/dex-quotes', {
                from: params.from,
                to: params.to,
                amount: params.amount,
                chain: params.chain,
            });
            break;
        case 'scan_token':
            if (!params.token) {
                throw new McpError(ErrorCode.InvalidParams, 'scan_token requires: token');
            }
            result = await callApi('/api/token-scanner', {
                token: params.token,
                chain: params.chain,
            });
            break;
        case 'track_whales':
            if (!params.token) {
                throw new McpError(ErrorCode.InvalidParams, 'track_whales requires: token');
            }
            result = await callApi('/api/whale-tracker', {
                token: params.token,
                chain: params.chain,
            });
            break;
        case 'scan_yields':
            result = await callApi('/api/yield-scanner', {
                chain: params.chain,
                asset: params.asset,
                min_tvl: params.min_tvl,
                limit: params.limit,
            });
            break;
        case 'get_funding_rates':
            result = await callApi('/api/funding-rates', {
                asset: params.asset,
                min_spread: params.min_spread,
            });
            break;
        case 'profile_wallet':
            if (!params.address) {
                throw new McpError(ErrorCode.InvalidParams, 'profile_wallet requires: address');
            }
            result = await callApi('/api/wallet-profiler', {
                address: params.address,
                chain: params.chain,
            });
            break;
        default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    const text = formatResult(result, name);
    return {
        content: [
            {
                type: 'text',
                text,
            },
        ],
        isError: false,
    };
});
// ─── Start ────────────────────────────────────────────────────────────────────
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    const payMode = WALLET_PRIVATE_KEY
        ? 'AUTO-PAY CONFIGURED (Base USDC EIP-3009)'
        : 'INSPECT (returns 402 payment requirements)';
    process.stderr.write(`[x402-mcp] Server started\n` +
        `[x402-mcp] API: ${API_BASE_URL}\n` +
        `[x402-mcp] Payment mode: ${payMode}\n` +
        `[x402-mcp] Tools: ${TOOLS.map((t) => t.name).join(', ')}\n`);
}
main().catch((err) => {
    process.stderr.write(`[x402-mcp] Fatal error: ${err}\n`);
    process.exit(1);
});
//# sourceMappingURL=index.js.map