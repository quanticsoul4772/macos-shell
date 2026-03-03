// Mock for voyageai module
export class VoyageAIClient {
  constructor(_options?: any) {}

  async embed(_params: any) {
    return {
      data: [{ embedding: new Array(512).fill(0) }],
      usage: { total_tokens: 10 },
    };
  }
}
