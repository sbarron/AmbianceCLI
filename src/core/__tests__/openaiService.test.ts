import { OpenAIService, createOpenAIService } from '../openaiService';

// Create mock functions
const mockChatCreate = jest.fn();
const mockResponsesCreate = jest.fn();

// Mock OpenAI client
jest.mock('openai', () => {
  return jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockChatCreate,
      },
    },
    responses: {
      create: mockResponsesCreate,
    },
  }));
});

// Import after mock is set up
import OpenAI from 'openai';

describe('OpenAIService', () => {
  let service: OpenAIService;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Qwen Provider', () => {
    beforeEach(() => {
      // Mock environment variables
      process.env.OPENAI_BASE_MODEL = 'qwen-plus';
      process.env.OPENAI_MINI_MODEL = 'qwen-turbo';

      service = createOpenAIService({
        apiKey: 'test-key',
        provider: 'qwen',
      });
    });

    afterEach(() => {
      // Clean up environment variables
      delete process.env.OPENAI_BASE_MODEL;
      delete process.env.OPENAI_MINI_MODEL;
    });

    it('should initialize with Qwen configuration', () => {
      const info = service.getProviderInfo();
      expect(info.provider).toBe('Qwen');
      expect(info.model).toBe('qwen-plus');
      expect(info.miniModel).toBe('qwen-turbo');
      expect(info.supportsStreaming).toBe(true);
    });

    it('should force temperature to 1 for Qwen provider', async () => {
      mockChatCreate.mockResolvedValue({
        id: 'test',
        choices: [{ message: { content: 'test response', role: 'assistant' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      await service.createChatCompletion({
        model: 'qwen-plus',
        messages: [
          {
            role: 'user',
            content:
              'This is a comprehensive test message with sufficient content to pass validation. It contains multiple sentences and provides meaningful context for testing the OpenAI service temperature override functionality for the Qwen provider.',
          },
        ],
        temperature: 0.7, // This should be overridden
      });

      expect(mockChatCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 1, // Should be forced to 1
        })
      );
    });

    it('should respect max_tokens limit', async () => {
      mockChatCreate.mockResolvedValue({
        id: 'test',
        choices: [{ message: { content: 'test response', role: 'assistant' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      await service.createChatCompletion({
        model: 'qwen-plus',
        messages: [
          {
            role: 'user',
            content:
              'This is a comprehensive test message with sufficient content to pass validation. We are testing the max_tokens limit functionality to ensure that it respects the model constraints.',
          },
        ],
        max_tokens: 50000, // This exceeds Qwen's limit
      });

      expect(mockChatCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 32768, // Should be capped to model limit
        })
      );
    });

    it('should return appropriate models for tasks', () => {
      expect(service.getModelForTask('base')).toBe('qwen-plus');
      expect(service.getModelForTask('mini')).toBe('qwen-turbo');
    });
  });

  describe('OpenAI Provider', () => {
    beforeEach(() => {
      // Mock environment variables
      process.env.OPENAI_BASE_MODEL = 'gpt-4o';
      process.env.OPENAI_MINI_MODEL = 'gpt-4o-mini';

      service = createOpenAIService({
        apiKey: 'test-key',
        provider: 'openai',
      });
    });

    afterEach(() => {
      // Clean up environment variables
      delete process.env.OPENAI_BASE_MODEL;
      delete process.env.OPENAI_MINI_MODEL;
    });

    it('should initialize with OpenAI configuration', () => {
      const info = service.getProviderInfo();
      expect(info.provider).toBe('OpenAI');
      expect(info.model).toBe('gpt-4o');
      expect(info.miniModel).toBe('gpt-4o-mini');
      expect(info.supportsStreaming).toBe(true);
    });

    it('should preserve temperature for OpenAI provider', async () => {
      mockChatCreate.mockResolvedValue({
        id: 'test',
        choices: [{ message: { content: 'test response', role: 'assistant' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });

      await service.createChatCompletion({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content:
              'This is a comprehensive test message with sufficient content to pass validation. We are testing that the OpenAI provider preserves the temperature setting without modification.',
          },
        ],
        temperature: 0.7, // This should be preserved
      });

      expect(mockChatCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7, // Should be preserved
        })
      );
    });

    it('should return appropriate models for tasks', () => {
      expect(service.getModelForTask('base')).toBe('gpt-4o');
      expect(service.getModelForTask('mini')).toBe('gpt-4o-mini');
    });

    it('annotates metadata when chat completion truncates due to length', async () => {
      mockChatCreate.mockResolvedValue({
        id: 'chat_trunc',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Partial response that was cut off mid-thought.',
            },
            finish_reason: 'length',
            logprobs: null,
          },
        ],
        usage: { prompt_tokens: 800, completion_tokens: 200, total_tokens: 1000 },
      } as any);

      const result = await service.createChatCompletion({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content:
              'Please draft an exhaustive deep dive on the historical evolution of software observability practices, covering metrics, logs, tracing, RED/USE methodologies, distributed tracing internals, and future trends. Make it extremely detailed.',
          },
        ],
        max_tokens: 1200,
      } as any);

      expect(mockResponsesCreate).not.toHaveBeenCalled();
      expect(mockChatCreate).toHaveBeenCalledTimes(1);
      expect(result.choices[0].finish_reason).toBe('length');
      expect((result as any).response_metadata).toEqual(
        expect.objectContaining({
          truncated: true,
          incomplete_reason: 'max_tokens',
          need_more_budget: true,
          partial_response: 'Partial response that was cut off mid-thought.',
          used_max_tokens: 1200,
        })
      );
    });

    it('maps max_completion_tokens to max_tokens for chat models like gpt-4o', async () => {
      mockChatCreate.mockResolvedValue({
        id: 'chat_map_max_tokens',
        choices: [
          { index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      } as any);

      await service.createChatCompletion({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content:
              'Validate that providing max_completion_tokens is accepted by mapping to max_tokens.',
          },
        ],
        max_completion_tokens: 321,
      } as any);

      expect(mockChatCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 321,
        })
      );
      expect(mockChatCreate).toHaveBeenCalledTimes(1);
    });
  });

  describe('OpenAI GPT-4.1 Models', () => {
    beforeEach(() => {
      service = createOpenAIService({
        apiKey: 'test-key',
        provider: 'openai',
        model: 'gpt-4.1',
        miniModel: 'gpt-4.1-mini',
      });
    });

    it('keeps chat completions sampling controls for GPT-4.1', async () => {
      mockChatCreate.mockResolvedValue({
        id: 'test',
        choices: [{ message: { content: 'test response', role: 'assistant' } }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      });

      await service.createChatCompletion({
        model: 'gpt-4.1',
        messages: [
          {
            role: 'user',
            content:
              'This is an extensive prompt used solely for testing that GPT-4.1 continues to use chat completions with sampling controls intact.',
          },
        ],
        max_tokens: 2000,
        temperature: 0.5,
        top_p: 0.9,
      } as any);

      expect(mockResponsesCreate).not.toHaveBeenCalled();
      expect(mockChatCreate).toHaveBeenCalledTimes(1);
      expect(mockChatCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 2000,
          temperature: 0.5,
          top_p: 0.9,
        })
      );
    });
  });

  describe('Reasoning Models', () => {
    beforeEach(() => {
      process.env.OPENAI_BASE_MODEL = 'gpt-5';
      process.env.OPENAI_MINI_MODEL = 'gpt-5-mini';

      service = createOpenAIService({
        apiKey: 'test-key',
        provider: 'openai',
      });
    });

    afterEach(() => {
      delete process.env.OPENAI_BASE_MODEL;
      delete process.env.OPENAI_MINI_MODEL;
    });

    it('routes GPT-5 requests through the Responses API', async () => {
      mockResponsesCreate.mockResolvedValue({
        id: 'resp_test',
        object: 'response',
        created: 123,
        model: 'gpt-5',
        output_text: 'reasoned response',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'reasoned response' }],
            stop_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      } as any);

      const result = await service.createChatCompletion({
        model: 'gpt-5',
        messages: [
          {
            role: 'user',
            content:
              'This is a sufficiently detailed user prompt to exercise the GPT-5 routing path and satisfy validation requirements within the OpenAI service tests.',
          },
        ],
        max_output_tokens: 1200,
      } as any);

      expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
      expect(mockChatCreate).not.toHaveBeenCalled();
      expect(mockResponsesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-5',
          max_output_tokens: 1200,
          reasoning: { effort: 'medium' },
        })
      );
      expect(result.choices[0].message.content).toBe('reasoned response');
    });

    it('retries reasoning response with higher max_output_tokens when truncated', async () => {
      const truncated = {
        id: 'resp_retry',
        object: 'response',
        created: 111,
        model: 'gpt-5',
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'partial first attempt' }],
            stop_reason: 'max_output_tokens',
          },
        ],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
      } as any;

      const completed = {
        id: 'resp_retry_success',
        object: 'response',
        created: 222,
        model: 'gpt-5',
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'final response after retry' }],
            stop_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
      } as any;

      mockResponsesCreate.mockResolvedValueOnce(truncated).mockResolvedValueOnce(completed);

      const result = await service.createChatCompletion({
        model: 'gpt-5',
        messages: [
          {
            role: 'user',
            content:
              'Generate a thorough architectural review of a large-scale microservices deployment. Include detailed descriptions of service boundaries, communication protocols, resiliency strategies, database sharding, observability pipelines, and deployment automation. The explanation should be very verbose to ensure it easily exceeds the initial output token cap so that our adapter must retry.',
          },
        ],
        max_output_tokens: 1200,
      } as any);

      expect(mockResponsesCreate).toHaveBeenCalledTimes(2);
      const firstCall = mockResponsesCreate.mock.calls[0][0];
      const secondCall = mockResponsesCreate.mock.calls[1][0];

      expect(firstCall.max_output_tokens).toBe(1200);
      expect(secondCall.max_output_tokens).toBeGreaterThan(1200);
      expect(secondCall.reasoning.effort).toBe('medium');

      const metadata = (result as any).response_metadata;
      expect(metadata.need_more_budget).toBeUndefined();
      expect(metadata.adjustments).toEqual(
        expect.objectContaining({
          increased_max_output_tokens: true,
          lowered_reasoning_effort: false,
        })
      );
      expect(metadata.attempts).toBe(2);
    });

    it('derives max_output_tokens from legacy parameters for reasoning models', async () => {
      mockResponsesCreate.mockResolvedValue({
        id: 'resp_test_2',
        object: 'response',
        created: 456,
        model: 'gpt-5-mini',
        output_text: 'mini response',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'mini response' }],
            stop_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 },
      } as any);

      await service.createChatCompletion({
        model: 'gpt-5-mini',
        messages: [
          {
            role: 'user',
            content:
              'Another detailed prompt to ensure the legacy max token conversion logic is triggered for GPT-5 mini within the reasoning adapter tests.',
          },
        ],
        max_completion_tokens: 800,
      } as any);

      expect(mockResponsesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-5-mini',
          max_output_tokens: 800,
        })
      );
    });

    it('lowers reasoning effort when max_output_tokens cannot increase', async () => {
      const truncated = {
        id: 'resp_effort',
        object: 'response',
        created: 333,
        model: 'gpt-5',
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'partial with full cap' }],
            stop_reason: 'max_output_tokens',
          },
        ],
        usage: { prompt_tokens: 80, completion_tokens: 40, total_tokens: 120 },
      } as any;

      const completed = {
        id: 'resp_effort_success',
        object: 'response',
        created: 444,
        model: 'gpt-5',
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'final after lowering effort' }],
            stop_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 90, completion_tokens: 35, total_tokens: 125 },
      } as any;

      mockResponsesCreate.mockResolvedValueOnce(truncated).mockResolvedValueOnce(completed);

      await service.createChatCompletion({
        model: 'gpt-5',
        messages: [
          {
            role: 'user',
            content:
              'Provide an exhaustive breakdown of every optimization technique used in a cutting-edge generative AI stack, including model fine-tuning, inference serving, quantization, caching, streaming, GPU orchestration, autoscaling policies, and failure-handling patterns. The description should be expansive enough to pressure the maximum token window.',
          },
        ],
        max_output_tokens: 16384,
      } as any);

      expect(mockResponsesCreate).toHaveBeenCalledTimes(2);

      const firstCall = mockResponsesCreate.mock.calls[0][0];
      const secondCall = mockResponsesCreate.mock.calls[1][0];

      expect(firstCall.max_output_tokens).toBe(16384);
      expect(secondCall.max_output_tokens).toBe(16384);
      expect(secondCall.reasoning.effort).toBe('low');
      expect(secondCall.reasoning.effort).not.toBe(firstCall.reasoning.effort);
    });

    it('detects truncation metadata when response remains incomplete', async () => {
      const truncatedResponse = {
        id: 'resp_truncated',
        object: 'response',
        created: 789,
        model: 'gpt-5',
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'partial answer' }],
            stop_reason: 'max_output_tokens',
          },
        ],
        usage: { prompt_tokens: 60, completion_tokens: 40, total_tokens: 100 },
      } as any;

      mockResponsesCreate
        .mockResolvedValueOnce(truncatedResponse)
        .mockResolvedValueOnce(truncatedResponse)
        .mockResolvedValueOnce(truncatedResponse);

      const result = await service.createChatCompletion({
        model: 'gpt-5',
        messages: [
          {
            role: 'user',
            content:
              'Compose a step-by-step migration guide that covers every aspect of moving a monolithic enterprise application into a modular, event-driven architecture. Detail infrastructure changes, CI/CD adjustments, testing strategies, risk mitigation, stakeholder communication, and rollout sequencing. The write-up should go beyond executive summary depth so that we intentionally surpass the available completion budget and verify truncation handling.',
          },
        ],
        max_output_tokens: 100,
      } as any);

      expect(mockResponsesCreate).toHaveBeenCalledTimes(3);

      const firstCall = mockResponsesCreate.mock.calls[0][0];
      const secondCall = mockResponsesCreate.mock.calls[1][0];
      const thirdCall = mockResponsesCreate.mock.calls[2][0];

      expect(firstCall.max_output_tokens).toBe(100);
      expect(secondCall.max_output_tokens).toBeGreaterThan(100);
      expect(thirdCall.reasoning.effort).toBe('low');

      const metadata = (result as any).response_metadata;
      expect(metadata).toEqual(
        expect.objectContaining({
          status: 'incomplete',
          incomplete_reason: 'max_output_tokens',
          original_finish_reason: 'max_output_tokens',
          truncated: true,
          need_more_budget: true,
          attempts: 3,
        })
      );
      expect(metadata.adjustments).toEqual(
        expect.objectContaining({
          increased_max_output_tokens: true,
          lowered_reasoning_effort: true,
        })
      );
      expect(metadata.partial_response).toBe('partial answer');
    });
  });

  describe('Custom Provider with Custom Models', () => {
    beforeEach(() => {
      service = createOpenAIService({
        apiKey: 'test-key',
        provider: 'custom',
        model: 'custom-model-large',
        miniModel: 'custom-model-small',
        baseUrl: 'https://custom-api.example.com/v1',
      });
    });

    it('should initialize with custom configuration', () => {
      const info = service.getProviderInfo();
      expect(info.provider).toBe('Custom Provider');
      expect(info.model).toBe('custom-model-large');
      expect(info.miniModel).toBe('custom-model-small');
      expect(info.supportsStreaming).toBe(true);
    });

    it('should return custom models for tasks', () => {
      expect(service.getModelForTask('base')).toBe('custom-model-large');
      expect(service.getModelForTask('mini')).toBe('custom-model-small');
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      service = createOpenAIService({
        apiKey: 'test-key',
        provider: 'openai',
      });
    });

    it('should handle API errors gracefully', async () => {
      const errorMessage = 'API rate limit exceeded';
      mockChatCreate.mockRejectedValue(new Error(errorMessage));

      await expect(
        service.createChatCompletion({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'user',
              content:
                'This is a comprehensive test message with sufficient content to pass validation. We are testing API error handling to ensure that rate limit errors are properly propagated.',
            },
          ],
        })
      ).rejects.toThrow(errorMessage);
    });
  });
});
