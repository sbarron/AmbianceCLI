# Optional Qwen profile

The `qwen3` profile combines Qwen3-Embedding-0.6B with BM25 keyword ranking.
Try it on larger codebases for queries that describe behavior across modules.
Ambiance CLI uses its lightweight profile by default. A Qwen-compatible
Ambiance MCP release uses Qwen for semantic context by default.

## Prepare Python and the model cache

Use a single Python environment for installation, cache preparation and
Ambiance. Install a PyTorch build suitable for your CPU or CUDA platform.
Then install the requirements bundled with the Qwen-capable CLI.

For a global npm installation, PowerShell can locate the requirements with:

```powershell
$ambianceCli = Join-Path (npm root -g) '@jackjackstudios/ambiance-cli'
python -m pip install -r (Join-Path $ambianceCli 'dist/src/local/qwen-requirements.txt')
```

For a local npm installation, use `npm root` without `-g`. From a CLI source
checkout, use `python -m pip install -r src/local/qwen-requirements.txt`.
If your Python executable has a different path, set `AMBIANCE_PYTHON` to that
executable in the CLI shell or MCP server environment.

Download the pinned model and tokenizer assets during setup while online:

```powershell
python -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen3-Embedding-0.6B', revision='c54f2e6e80b2d7b7de06f51cec4959f6b3e03418', allow_patterns=['*.json', '*.safetensors', '*.txt', '*.model'])"
python -c "import tiktoken; tiktoken.get_encoding('o200k_base')"
```

Start Ambiance with access to those caches. If you use custom locations,
forward `HF_HOME`, `HF_HUB_CACHE` or `TIKTOKEN_CACHE_DIR` as needed.
The worker uses local assets and reports missing dependencies or caches as
errors. Device selection defaults to CUDA when available and CPU otherwise.
Set `AMBIANCE_QWEN_DEVICE` to `cpu` or `cuda` to override it.

## Use the profile

Run from the project directory, or provide `--project-path`:

```bash
ambiance context "How are duplicate uploads handled?" --local-profile qwen3
```

The first lookup can create the project's Qwen index. To build the index
before searching, run `ambiance embeddings create --local-profile qwen3`.
To use Qwen for subsequent CLI invocations in the same shell, set
`AMBIANCE_LOCAL_PROFILE=qwen3`. Use `--local-profile default` to select the
lightweight profile explicitly.

In a Qwen-default MCP release, use the server environment
`AMBIANCE_LOCAL_PROFILE=default` to select the lightweight profile. Use
`USE_LOCAL_EMBEDDINGS=false` for deterministic context without embeddings.
After changing server settings, reconnect your client.

## Resource and index behavior

- Each process loads its own encoder on the first Qwen request. MCP unloads
  it after five idle minutes by default. `AMBIANCE_QWEN_IDLE_MS` sets the
  timeout in milliseconds. A value of `0` keeps it resident until shutdown.
  The CLI disposes of the worker when it exits.
- The Qwen index lives under `profiles/qwen3-<identity>/` in the configured
  storage root. Existing lightweight indexes remain available when switching
  profiles. Four-bit vector storage reduces index size. Encoder weights and
  working memory are separate.
- For JSON context, `--max-tokens` applies to the full response, including
  metadata, source locations and numbered lines. Use a larger budget when
  several files are needed.
