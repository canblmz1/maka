from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def patch_model_adapter() -> None:
    path = Path("packages/runtime/src/model-adapter.ts")
    text = path.read_text()

    text = replace_once(
        text,
        "import { rawFinishReasonString } from './model-protocol.js';\nimport type {",
        "import { rawFinishReasonString } from './model-protocol.js';\n"
        "import {\n"
        "  createToolCallSafetyTracker,\n"
        "  observeRawChunk,\n"
        "  resolveToolCallSafety,\n"
        "} from './tool-call-execution-guard.js';\n"
        "import type {",
        "model-adapter guard import",
    )

    text = replace_once(
        text,
        "  ToolCallPart,\n} from './model-protocol.js';",
        "  ToolCallPart,\n  ToolCallExecutionSafety,\n} from './model-protocol.js';",
        "model-adapter safety type import",
    )

    text = replace_once(
        text,
        "    const outcome = new Promise<ModelStepOutcome>((resolve) => {\n"
        "      settleOutcome = resolve;\n"
        "    });\n"
        "    const request = { messages: continuation.requestMessages };",
        "    const outcome = new Promise<ModelStepOutcome>((resolve) => {\n"
        "      settleOutcome = resolve;\n"
        "    });\n"
        "    let settleToolCallSafety!: (safety: ToolCallExecutionSafety) => void;\n"
        "    const toolCallSafety = new Promise<ToolCallExecutionSafety>((resolve) => {\n"
        "      settleToolCallSafety = resolve;\n"
        "    });\n"
        "    // One tracker per physical provider request, so concurrent requests\n"
        "    // can safely reuse provider-issued toolCallIds without sharing proof.\n"
        "    const toolCallGuard = createToolCallSafetyTracker();\n"
        "    const request = { messages: continuation.requestMessages };",
        "model-adapter safety promise",
    )

    text = replace_once(
        text,
        "          for await (const chunk of sdk.stream as AsyncIterable<AiSdkStreamChunk>) {\n"
        "            onStreamActivity();\n"
        "            if (",
        "          for await (const chunk of sdk.stream as AsyncIterable<AiSdkStreamChunk>) {\n"
        "            onStreamActivity();\n"
        "            // Observe the raw SDK chunk before semantic translation. The guard\n"
        "            // must prove tool argument completion from provider stream evidence,\n"
        "            // not from the SDK's already-parsed final tool-call projection.\n"
        "            observeRawChunk(toolCallGuard, chunk);\n"
        "            if (",
        "model-adapter raw observation",
    )

    text = replace_once(
        text,
        "          } finally {\n"
        "            settleOutcome(settled);\n"
        "          }",
        "          } finally {\n"
        "            settleToolCallSafety(\n"
        "              resolveToolCallSafety(toolCallGuard, { providerReason: finishReason }),\n"
        "            );\n"
        "            settleOutcome(settled);\n"
        "          }",
        "model-adapter safety settlement",
    )

    text = replace_once(
        text,
        "    return { events, outcome };",
        "    return { events, outcome, toolCallSafety };",
        "model-adapter result",
    )

    path.write_text(text)


def patch_ai_sdk_backend() -> None:
    path = Path("packages/runtime/src/ai-sdk-backend.ts")
    text = path.read_text()

    text = replace_once(
        text,
        "  ModelFailureKind,\n  ToolCallPart,\n  ToolResultOutput,",
        "  ModelFailureKind,\n  ToolCallPart,\n  ToolCallExecutionSafety,\n  ToolResultOutput,",
        "ai-sdk safety type import",
    )

    text = replace_once(
        text,
        "import { resolveSelectedModelContextWindow } from './context-budget-policy.js';\nexport {",
        "import { resolveSelectedModelContextWindow } from './context-budget-policy.js';\n"
        "import { isSafeToolExecutionStepOutcome } from './tool-call-execution-guard.js';\n"
        "export {",
        "ai-sdk guard import",
    )

    text = replace_once(
        text,
        "        let overflowRetryUsed = false;\n"
        "        let result: ModelStreamResult;\n"
        "        let providerOutcome: ModelStepOutcome;\n"
        "        let finishReason: ModelFinishReason = 'stop';",
        "        let overflowRetryUsed = false;\n"
        "        let result: ModelStreamResult;\n"
        "        let providerOutcome: ModelStepOutcome;\n"
        "        // Positive execution proof for the physical provider request that\n"
        "        // produced returnedToolCalls. It is replaced after every request\n"
        "        // and never carried across provider steps.\n"
        "        let toolCallSafety: ToolCallExecutionSafety = {\n"
        "          hadRawArgumentEvidence: false,\n"
        "          proofs: new Map(),\n"
        "          atomicProofs: new Map(),\n"
        "        };\n"
        "        let finishReason: ModelFinishReason = 'stop';",
        "ai-sdk safety state",
    )

    text = replace_once(
        text,
        "            providerOutcome = await result.outcome;\n"
        "            const incompleteStreamTerminal = providerOutcome.kind === 'truncated';",
        "            providerOutcome = await result.outcome;\n"
        "            toolCallSafety = await result.toolCallSafety;\n"
        "            const incompleteStreamTerminal = providerOutcome.kind === 'truncated';",
        "ai-sdk safety await",
    )

    old_settlement = """                const sandboxBoundaryAttempt = isProviderSandboxBoundaryAttempt(toolCall);
                const deniedBoundaryRequest =
                  toolRuntime.hasSandboxBoundaryDenial() &&
                  toolCall.toolName.toLowerCase() === REQUEST_SANDBOX_BOUNDARY_TOOL_NAME;
                if (deniedBoundaryRequest) {
                  toolRuntime.forceSandboxBoundaryFinalization();
                }
                const blockedToolCall = sandboxBoundaryFinalizationStep || deniedBoundaryRequest;
                const requestedTool = blockedToolCall
                  ? undefined
                  : toolsByName.get(toolCall.toolName);
                const tool = requestedTool ?? toolsByName.get(INVALID_TOOL_NAME);
                if (!tool) throw new Error('Runtime invalid-tool fallback is unavailable');
                const unavailableError = sandboxBoundaryFinalizationStep
                  ? 'Sandbox boundary finalization does not permit tool execution.'
                  : deniedBoundaryRequest
                    ? SANDBOX_BOUNDARY_DENIED_FOR_TURN
                    : 'returned tool is unavailable';
"""

    new_settlement = """                // Complete/valid projected JSON is not enough to authorize a side effect.
                // The guard owns the positive proof: raw streamed bytes and identity
                // when available, a per-id zero-delta atomic proof for the mixed
                // Google delivery shape, or the narrowly-scoped all-atomic fallback.
                const proof = toolCallSafety.proofs.get(toolCall.toolCallId);
                const atomicProof = toolCallSafety.hadRawArgumentEvidence
                  ? toolCallSafety.atomicProofs.get(toolCall.toolCallId)
                  : undefined;
                const provedNameMatches =
                  proof !== undefined &&
                  proof.name.toLowerCase() === toolCall.toolName.toLowerCase();
                const atomicNameMatches =
                  atomicProof !== undefined &&
                  atomicProof.name.toLowerCase() === toolCall.toolName.toLowerCase();
                const confirmedSafe =
                  proof !== undefined
                    ? toolCall.toolName === INVALID_TOOL_NAME || provedNameMatches
                    : atomicProof !== undefined
                      ? toolCall.toolName === INVALID_TOOL_NAME || atomicNameMatches
                      : !toolCallSafety.hadRawArgumentEvidence &&
                        isSafeToolExecutionStepOutcome(providerOutcome);

                // For an incrementally streamed call, the guard-proved value is the
                // sole payload authority. For a mixed-delivery zero-argument call,
                // its own proof establishes the canonical empty object. The SDK
                // projection is used only by the pre-existing whole-request atomic
                // fallback (or the deliberately non-side-effecting invalid-tool path).
                const provedValue = provedNameMatches ? proof.value : undefined;
                const atomicValue = atomicNameMatches ? {} : undefined;

                const sandboxBoundaryAttempt = isProviderSandboxBoundaryAttempt(toolCall);
                const deniedBoundaryRequest =
                  toolRuntime.hasSandboxBoundaryDenial() &&
                  toolCall.toolName.toLowerCase() === REQUEST_SANDBOX_BOUNDARY_TOOL_NAME;
                if (deniedBoundaryRequest) {
                  toolRuntime.forceSandboxBoundaryFinalization();
                }
                const blockedToolCall = sandboxBoundaryFinalizationStep || deniedBoundaryRequest;
                const requestedTool = blockedToolCall || !confirmedSafe
                  ? undefined
                  : toolsByName.get(toolCall.toolName);
                const tool = requestedTool ?? toolsByName.get(INVALID_TOOL_NAME);
                if (!tool) throw new Error('Runtime invalid-tool fallback is unavailable');
                const unavailableError = sandboxBoundaryFinalizationStep
                  ? 'Sandbox boundary finalization does not permit tool execution.'
                  : deniedBoundaryRequest
                    ? SANDBOX_BOUNDARY_DENIED_FOR_TURN
                    : !confirmedSafe
                      ? 'the stream that produced this call was not confirmed to complete safely'
                      : 'returned tool is unavailable';
"""
    text = replace_once(text, old_settlement, new_settlement, "ai-sdk settlement gate")

    text = replace_once(
        text,
        "                  input:\n"
        "                    requestedTool !== undefined\n"
        "                      ? toolCall.input\n"
        "                      : {",
        "                  input:\n"
        "                    requestedTool !== undefined\n"
        "                      ? provedValue !== undefined\n"
        "                        ? provedValue\n"
        "                        : atomicValue !== undefined\n"
        "                          ? atomicValue\n"
        "                          : toolCall.input\n"
        "                      : {",
        "ai-sdk proved payload",
    )

    path.write_text(text)


patch_model_adapter()
patch_ai_sdk_backend()
print("PR #3434 runtime conflicts resolved against pinned current main")
