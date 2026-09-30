import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { recoverTypedDataAddress } from 'viem';

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const PAY_TO = '0x60264c480b67adb557efEd22Cf0e7ceA792DefB7';
const TEST_KEY = `0x${'33'.repeat(32)}`;

test('MCP tool signs a bounded Base USDC challenge', async () => {
  let proof;
  let recipient = PAY_TO;
  let requests = 0;
  const api = http.createServer((req, res) => {
    requests++;
    assert.equal(req.headers['x-x402-source'], 'glama');
    res.setHeader('Content-Type', 'application/json');
    if (!req.headers['x-payment']) {
      res.statusCode = 402;
      res.end(JSON.stringify({ accepts: [{ network: 'base', asset: USDC, payTo: recipient,
        maxAmountRequired: '1000', extra: { supportedProofs: ['eip3009_transferWithAuthorization'] } }] }));
    } else {
      proof = JSON.parse(Buffer.from(req.headers['x-payment'], 'base64').toString());
      res.end(JSON.stringify({ source: 'test', data: { core: [] } }));
    }
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const client = new Client({ name: 'x402-test', version: '1.0.0' }, { capabilities: {} });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js'],
    env: { ...process.env, X402_API_BASE_URL: `http://127.0.0.1:${api.address().port}`,
      X402_WALLET_PRIVATE_KEY: TEST_KEY, X402_REFERRAL_SOURCE: 'glama' },
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.equal(listed.tools[0].annotations.readOnlyHint, false);
    assert.equal(listed.tools[0].annotations.idempotentHint, false);
    const result = await client.callTool({ name: 'get_crypto_prices', arguments: {} });
    assert.equal(result.isError, false);
    assert.ok(proof);
    const auth = proof.payload.authorization;
    assert.equal(auth.value, '1000');
    const recovered = await recoverTypedDataAddress({
      domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: USDC },
      types: { TransferWithAuthorization: [
        { name: 'from', type: 'address' }, { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' },
      ] },
      primaryType: 'TransferWithAuthorization',
      message: { ...auth, value: BigInt(auth.value), validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore) },
      signature: proof.signature,
    });
    assert.equal(recovered.toLowerCase(), auth.from.toLowerCase());
    recipient = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const before = requests;
    await assert.rejects(client.callTool({ name: 'get_crypto_prices', arguments: {} }), /Unexpected payment recipient/);
    assert.equal(requests, before + 1, 'changed recipient gets no signed retry');
  } finally {
    await client.close();
    await new Promise(resolve => api.close(resolve));
  }
});
