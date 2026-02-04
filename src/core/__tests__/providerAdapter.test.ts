import { generate } from '../providerAdapter';

let mockRegistry: {
  chatCreate: jest.Mock;
  responsesCreate: jest.Mock;
  responsesStream: jest.Mock;
};

jest.mock('openai', () => {
  mockRegistry = {
    chatCreate: jest.fn(),
    responsesCreate: jest.fn(),
    responsesStream: jest.fn(),
  };

  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockRegistry.chatCreate,
      },
    },
    responses: {
      create: mockRegistry.responsesCreate,
      stream: mockRegistry.responsesStream,
    },
  }));
});

const mockChatCreate = () => mockRegistry.chatCreate as jest.Mock;
const mockResponsesCreate = () => mockRegistry.responsesCreate as jest.Mock;
const mockResponsesStream = () => mockRegistry.responsesStream as jest.Mock;

describe('provider adapter generate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockChatCreate()?.mockReset();
    mockResponsesCreate()?.mockReset();
    mockResponsesStream()?.mockReset();
  });

  it('passes chat knobs through for GPT-4.1 and detects truncation', async () => {
    mockChatCreate().mockResolvedValue({
      choices: [
        {
          message: { role: 'assistant', content: 'Partial answer' },
          finish_reason: 'length',
        },
      ],
      usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
    });

    const result = await generate({
      provider: 'openai',
      model: 'gpt-4.1',
      input: 'Explain observability pipelines in depth',
      temperature: 0.4,
      top_p: 0.8,
      max_tokens: 1500,
    });

    expect(mockChatCreate()).toHaveBeenCalledTimes(1);
    expect(mockChatCreate()).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-4.1',
        temperature: 0.4,
        top_p: 0.8,
        max_tokens: 1500,
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        text: 'Partial answer',
        truncated: true,
        reason: 'length',
      })
    );
  });

  it('routes GPT-5 through responses API and maps max_tokens to max_output_tokens', async () => {
    mockResponsesCreate().mockResolvedValue({
      status: 'completed',
      output_text: 'Full reasoning response',
      usage: { input_tokens: 1200, output_tokens: 800, total_tokens: 2000 },
    });

    await generate({
      provider: 'openai',
      model: 'gpt-5',
      input: 'Describe migration strategy',
      max_tokens: 1800,
      temperature: 0.2,
      reasoningEffort: 'high',
    });

    expect(mockResponsesCreate()).toHaveBeenCalledTimes(1);
    const payload = mockResponsesCreate().mock.calls[0][0];
    expect(payload).toMatchObject({
      model: 'gpt-5',
      max_output_tokens: 1800,
      reasoning: { effort: 'high' },
    });
    expect(payload).not.toHaveProperty('temperature');
    expect(payload).not.toHaveProperty('top_p');
  });

  it('detects GPT-5 truncation via incomplete status', async () => {
    mockResponsesCreate().mockResolvedValue({
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output_text: 'Partial reasoning',
    });

    const result = await generate({
      provider: 'openai',
      model: 'gpt-5-preview',
      input: 'Give me a very long plan',
      max_output_tokens: 512,
    });

    expect(result).toEqual(
      expect.objectContaining({
        text: 'Partial reasoning',
        truncated: true,
        reason: 'max_output_tokens',
      })
    );
  });
});
