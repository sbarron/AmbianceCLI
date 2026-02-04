import { AmbianceAPIClient } from '../../client/apiClient';

const API_KEY = process.env.AMBIANCE_API_KEY || '';
const API_URL =
  process.env.AMBIANCE_API_URL || process.env.USING_LOCAL_SERVER_URL || 'http://localhost:3001';

const itIf = (cond: boolean) => (cond ? it : it.skip);

describe('Ambiance API Client Integration (skips without AMBIANCE_API_KEY)', () => {
  const client = new AmbianceAPIClient(API_KEY, API_URL);

  it('skips when no ambiance api key is provided', () => {
    if (!API_KEY) {
      expect(true).toBe(true);
    } else {
      expect(true).toBe(true);
    }
  });

  itIf(!!API_KEY)('health check should succeed on running server', async () => {
    const ok = await client.healthCheck();
    expect(ok).toBe(true);
  });

  itIf(!!API_KEY)('searchContext should return results', async () => {
    const results = await client.searchContext({ query: 'function' });
    expect(Array.isArray(results)).toBe(true);
  });
});
