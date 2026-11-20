"""Optional local-only JSONL worker. Stdout is reserved for protocol responses."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import socket
import tempfile

os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['TRANSFORMERS_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['TOKENIZERS_PARALLELISM'] = 'false'
os.environ['DO_NOT_TRACK'] = '1'
os.environ['OTEL_SDK_DISABLED'] = 'true'
os.environ.setdefault('OMP_NUM_THREADS', '4')


def deny_network(*args, **kwargs):
    raise RuntimeError('Network access is disabled in the local encoder.')


# Fail closed even if an optional dependency ignores its offline/telemetry flags.
socket.create_connection = deny_network
socket.socket.connect = deny_network
socket.socket.connect_ex = deny_network
socket.socket.sendto = deny_network
MODEL = 'Qwen/Qwen3-Embedding-0.6B'
REVISION = 'c54f2e6e80b2d7b7de06f51cec4959f6b3e03418'
INSTRUCTION = 'Given a coding question, retrieve relevant source code that helps answer it.'
model = tokenizer = encoding = None


def source_encoding():
    global encoding
    if encoding is not None:
        return encoding
    # tiktoken may otherwise download its vocabulary. Refuse a cache miss here.
    name = 'fb374d419588a4632f3f557e76b4b70aebbca790'
    checksum = '446a9538cb6c348e3516120d7c08b09f57c36495e2acfffe59a5bf8b0cfb1a2d'
    candidates = [Path(os.environ.get('TIKTOKEN_CACHE_DIR', '')),
                  Path(os.environ.get('LOCALAPPDATA', '')) / 'Temp/data-gym-cache',
                  Path(tempfile.gettempdir()) / 'data-gym-cache']
    try:
        candidates.append(Path.home() / 'AppData/Local/Temp/data-gym-cache')
    except RuntimeError:
        pass  # Isolated runtimes may supply explicit caches without a home directory.
    for directory in candidates:
        path = directory / name
        if path.is_file() and hashlib.sha256(path.read_bytes()).hexdigest() == checksum:
            os.environ['TIKTOKEN_CACHE_DIR'] = str(directory)
            break
    else:
        raise RuntimeError('The o200k tokenizer vocabulary is not cached. See docs/local-quality-profile.md for setup.')
    import tiktoken
    encoding = tiktoken.get_encoding('o200k_base')
    return encoding


def plan(request):
    enc = source_encoding()
    lines = request['content'].split('\n')
    path = request['path'].replace('\\', '/')
    signatures = [(i, line.strip()) for i, line in enumerate(lines)
                  if re.match(r'^\s*(?:(?:export|private|public|protected|static|async)\s+)*(?:function|def|class|interface|type)\s+\w+', line)
                  or re.match(r'^\s*(?:(?:private|public|protected|static|async)\s+)*[\w$]+\([^;]*\)\s*(?::[^=]+)?\s*\{', line)]
    imports = [line.strip()[:90] for line in lines if re.match(r'^\s*(?:import |from |export .*from )', line)][:2]
    costs = [len(enc.encode(line + '\n', disallowed_special=())) for line in lines]
    chunks = []
    start = 0
    while start < len(lines):
        end = start
        count = 0
        while end < len(lines):
            if count + costs[end] > 256 and end > start:
                break
            count += costs[end]
            end += 1
        owner = next((signature for i, signature in reversed(signatures) if i <= start), '(module)')[:150]
        body = '\n'.join(lines[start:end])
        header = f'Language: {Path(path).suffix}\nPath: {path}\nEnclosing signature: {owner}\nImports: ' + '; '.join(imports)
        if body.strip():
            chunks.append({'content': body, 'index': len(chunks), 'startLine': start + 1,
                           'endLine': end, 'type': 'code', 'input': header + '\n\n' + body})
        if end >= len(lines):
            break
        start = max(start + 1, end - 4)
    return chunks


def encode(request):
    global model, tokenizer
    import torch
    from transformers import AutoModel, AutoTokenizer
    torch.set_num_threads(4)
    if model is None:
        device = os.environ.get('AMBIANCE_QWEN_DEVICE', 'auto')
        if device not in ['auto', 'cpu', 'cuda']:
            raise RuntimeError('AMBIANCE_QWEN_DEVICE must be auto, cpu, or cuda.')
        if device == 'auto':
            device = 'cuda' if torch.cuda.is_available() else 'cpu'
        if device == 'cuda' and not torch.cuda.is_available():
            raise RuntimeError('CUDA was requested but is unavailable. Set AMBIANCE_QWEN_DEVICE=cpu or auto.')
        dtype = torch.float16 if device == 'cuda' else torch.float32
        tokenizer = AutoTokenizer.from_pretrained(MODEL, revision=REVISION, local_files_only=True, padding_side='left')
        model = AutoModel.from_pretrained(MODEL, revision=REVISION, local_files_only=True,
                                         torch_dtype=dtype, attn_implementation='sdpa').to(device).eval()
    texts = request['texts']
    if not isinstance(texts, list) or not texts or len(texts) > 16 or any(not isinstance(text, str) or not text.strip() for text in texts):
        raise ValueError('Encode requires 1-16 nonempty text inputs.')
    if request.get('query'):
        texts = [f'Instruct: {INSTRUCTION}\nQuery: ' + text for text in texts]
    inputs = tokenizer(texts, padding=True, truncation=True, max_length=512, return_tensors='pt').to(model.device)
    with torch.inference_mode():
        hidden = model(**inputs, use_cache=False).last_hidden_state[:, -1, :512].float()
        vectors = torch.nn.functional.normalize(hidden, p=2, dim=1)
    if not torch.isfinite(vectors).all() or (vectors.norm(dim=1) < 0.99).any():
        raise RuntimeError('Encoder returned invalid vectors.')
    return {'vectors': vectors.cpu().tolist(), 'device': str(model.device), 'dtype': str(model.dtype),
            'revision': REVISION}


def pack(request):
    enc = source_encoding()
    limit = request['maxTokens']
    envelope = request['envelope']
    envelope['content'] = 'Query: ' + request['query']
    envelope['jumpTargets'] = []
    envelope['metadata']['deferredLocations'] = len(request['chunks'])
    # Reserve a small margin for JS/Python numeric serialization and final counter fields.
    count = lambda value: len(enc.encode(json.dumps(value, ensure_ascii=False, indent=2), disallowed_special=()))
    if count(envelope) + 24 > limit:
        raise ValueError('The token budget is too small for the query and response metadata.')
    used = set()
    included = set()
    for chunk_index, chunk in enumerate(request['chunks']):
        runs = []
        run = []
        for offset, line in enumerate(chunk['content'].split('\n')):
            n = chunk['startLine'] + offset
            if (chunk['file'], n) in used:
                if run:
                    runs.append(run)
                    run = []
            else:
                run.append((n, line))
        if run:
            runs.append(run)
        for run in runs:
            body = f"FILE {chunk['file']}:{run[0][0]}-{run[-1][0]}\n" + '\n'.join(f'{n}: {line}' for n, line in run)
            pointer = {'file': chunk['file'], 'symbol': chunk['symbol'], 'startLine': run[0][0], 'endLine': run[-1][0]}
            candidate = {**envelope, 'content': envelope['content'] + '\n\n' + body,
                         'jumpTargets': envelope['jumpTargets'] + [pointer]}
            if count(candidate) + 24 <= limit:
                envelope = candidate
                included.add(chunk_index)
                used.update((chunk['file'], n) for n, _ in run)
    envelope['metadata']['deferredLocations'] = len(request['chunks']) - len(included)
    return envelope


def handle(request):
    operation = request.get('operation')
    if operation == 'plan':
        return plan(request)
    if operation == 'encode':
        return encode(request)
    if operation == 'count':
        return len(source_encoding().encode(request['text'], disallowed_special=()))
    if operation == 'pack':
        return pack(request)
    raise ValueError('Unsupported local encoder operation.')


for raw in sys.stdin:
    request = None
    try:
        if len(raw) > 16 * 1024 * 1024:
            raise ValueError('Local encoder request is too large.')
        request = json.loads(raw)
        result = {'id': request['id'], 'result': handle(request)}
    except Exception as error:
        result = {'id': request.get('id') if isinstance(request, dict) else None,
                  'error': f'{type(error).__name__}: {error}'}
    print(json.dumps(result, ensure_ascii=False, separators=(',', ':')), flush=True)
