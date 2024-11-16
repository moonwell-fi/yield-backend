import { createMoonwellClient } from '@moonwell-fi/moonwell-sdk';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
  'Access-Control-Max-Age': '86400',
}

const respond = (response: Record<string, unknown>, code?: number) =>
  new Response(JSON.stringify(response), {
    headers: { 'content-type': 'application/json', ...corsHeaders },
    status: code,
  })

export default {
  async fetch(
    request: Request,
    env: Record<string, any>
  ) {
		const uri = 'market-vault-yields.json'
    const object = await env.MY_BUCKET.get(uri)

    if (
      (object === null) ||
      (object.uploaded.getTime() < (Date.now()) - (10000))
    ) { // Cached object is not found or older than 10 seconds
      console.log('Cache miss, fetching new data...')
      const moonwellClient = createMoonwellClient({
				networks: {
					base: {
						rpcUrls: ["https://base.llamarpc.com"],
					},
				},
			});

			const markets = await moonwellClient.getMarkets({chainId: 8453});
			const vaults = await moonwellClient.getMorphoVaults({includeRewards: true});

			const response = {
				markets: markets,
				vaults: vaults
			}

      const data: Record<string, unknown> = await response
      await env.MY_BUCKET.put(uri, JSON.stringify(data), {
        metadata: {
          'Content-Type': 'application/json',
        },
      });
      return respond(data)
    } else {
      console.log('Cache hit, returning cached data...')
      return new Response(object.body, {
        headers: { 'content-type': 'application/json', ...corsHeaders },
        status: 200,
      })
    }
  }
}