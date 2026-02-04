import OpenAI from 'openai';

const oa = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

const isReasoningModel = (model: string) => /^gpt-5/i.test(model);

export type GenOpts = {
  provider: 'openai' | 'anthropic' | 'azure-openai' | 'other';
  model: string;
  input: string;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_output_tokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  stream?: boolean;
};

const buildChatMessages = (input: string) => [{ role: 'user' as const, content: input }];

const buildResponseInput = (input: string) => [
  {
    role: 'user',
    content: [{ type: 'input_text', text: input }],
  },
];

export async function generate(opts: GenOpts) {
  const {
    provider,
    model,
    input,
    temperature,
    top_p,
    max_tokens,
    max_output_tokens,
    reasoningEffort,
    stream = false,
  } = opts;

  if (provider !== 'openai') {
    throw new Error(`Provider "${provider}" not wired yet`);
  }

  if (isReasoningModel(model)) {
    const resolvedMax =
      typeof max_output_tokens === 'number'
        ? max_output_tokens
        : typeof max_tokens === 'number'
          ? max_tokens
          : undefined;

    const payload: OpenAI.Responses.ResponseCreateParams = {
      model,
      input: buildResponseInput(input) as any,
      reasoning: { effort: reasoningEffort ?? 'medium' },
    };

    if (typeof resolvedMax === 'number') {
      payload.max_output_tokens = resolvedMax;
    }

    if (stream) {
      return oa.responses.stream({ ...payload, stream: true });
    }

    const res = await oa.responses.create(payload);
    const status = (res as any).status;
    const reason = (res as any).incomplete_details?.reason;
    const text = (res as any).output_text ?? '';

    return {
      text,
      truncated: status === 'incomplete' && reason === 'max_output_tokens',
      reason,
      raw: res,
    };
  }

  const chatPayload: OpenAI.Chat.Completions.ChatCompletionCreateParams = {
    model,
    messages: buildChatMessages(input),
  };

  if (typeof max_tokens === 'number') {
    chatPayload.max_tokens = max_tokens;
  }
  if (typeof temperature === 'number') {
    chatPayload.temperature = temperature;
  }
  if (typeof top_p === 'number') {
    chatPayload.top_p = top_p;
  }

  if (stream) {
    return oa.chat.completions.create({ ...chatPayload, stream: true });
  }

  const res = await oa.chat.completions.create(chatPayload);
  const choice = res.choices?.[0];

  return {
    text: choice?.message?.content ?? '',
    truncated: choice?.finish_reason === 'length',
    reason: choice?.finish_reason,
    raw: res,
  };
}
