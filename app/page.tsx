"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { AISDKLogo } from "@/components/icons";
import { PromptSuggestions } from "@/components/prompt-suggestions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/input";
import { getDesktopURL } from "@/lib/e2b/utils";
import { useScrollToBottom } from "@/lib/use-scroll-to-bottom";
import { LiveStreamController } from "@/lib/live-stream-controller";
import type { Message } from "@/components/message";
import { toast } from "sonner";

const STATUS_READY = "ready" as const;
const STATUS_STREAMING = "streaming" as const;
const STATUS_SUBMITTED = "submitted" as const;
const STATUS_ERROR = "error" as const;

type StreamStatus =
  | typeof STATUS_READY
  | typeof STATUS_STREAMING
  | typeof STATUS_SUBMITTED
  | typeof STATUS_ERROR;

type StreamEvent =
  | { type: "text-delta"; textDelta?: string; delta?: string }
  | { type: "tool-input-available"; toolCallId: string; toolName?: string; input?: any }
  | { type: "tool-output-available"; toolCallId: string; output?: any }
  | { type: "screenshot-update"; screenshot?: string }
  | { type: "finish"; content?: string }
  | { type: "error"; errorText?: string };

function cloneMessage(message: Message): Message {
  const parts = message.parts?.map((part) => {
    if (part.type !== "tool-invocation") {
      return part;
    }

    const { toolInvocation } = part;
    const clonedResult =
      typeof toolInvocation.result === "object" && toolInvocation.result !== null
        ? Array.isArray(toolInvocation.result)
          ? [...toolInvocation.result]
          : { ...toolInvocation.result }
        : toolInvocation.result;

    return {
      type: "tool-invocation" as const,
      toolInvocation: {
        ...toolInvocation,
        args:
          toolInvocation.args && typeof toolInvocation.args === "object"
            ? { ...toolInvocation.args }
            : toolInvocation.args,
        result: clonedResult,
      },
    };
  });

  return {
    ...message,
    parts,
  };
}

export default function Chat() {
  const [containerRef, endRef] = useScrollToBottom();
  const messagesHostRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<LiveStreamController | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const messageHistoryRef = useRef<Message[]>([]);
  const currentAssistantIdRef = useRef<string | null>(null);
  const toolMessageMapRef = useRef<Map<string, string>>(new Map());
  const lastToolMessageIdRef = useRef<string | null>(null);
  const [input, setInput] = useState("");
  const [isInitializing, setIsInitializing] = useState(true);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [sandboxId, setSandboxId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [status, setStatus] = useState<StreamStatus>(STATUS_READY);
  const [hasMessages, setHasMessages] = useState(false);

  const isLoading = isStreaming || isSubmitted;

  useEffect(() => {
    const host = messagesHostRef.current;
    if (!host || controllerRef.current) return;
    const controller = new LiveStreamController(host);
    controllerRef.current = controller;

    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!controllerRef.current) return;
    controllerRef.current.setStatus(status, isLoading);
  }, [status, isLoading]);

  const updateMessageHistory = (messageId: string, updatedMessage: Message) => {
    messageHistoryRef.current = messageHistoryRef.current.map((msg) =>
      msg.id === messageId ? updatedMessage : msg,
    );
  };

  const appendMessage = (message: Message) => {
    messageHistoryRef.current = [...messageHistoryRef.current, message];
    controllerRef.current?.appendMessage(message);
    if (!hasMessages) {
      setHasMessages(true);
    }
  };

  const handleTextDelta = (event: StreamEvent & { type: "text-delta" }) => {
    const delta = event.textDelta ?? event.delta ?? "";
    if (!delta) return;

    const controller = controllerRef.current;
    if (!controller) return;

    if (!currentAssistantIdRef.current) {
      const message: Message = {
        id: `assistant-${Date.now()}-${Math.random()}`,
        role: "assistant",
        content: delta,
      };
      currentAssistantIdRef.current = message.id;
      appendMessage(message);
      return;
    }

    const assistantId = currentAssistantIdRef.current;
    const existing = messageHistoryRef.current.find((msg) => msg.id === assistantId);
    if (!existing) return;

    const updated: Message = {
      ...existing,
      content: (existing.content || "") + delta,
    };

    updateMessageHistory(assistantId, updated);
    controller.updateMessage(assistantId, updated);
  };

  const handleToolInput = (event: Extract<StreamEvent, { type: "tool-input-available" }>) => {
    const toolMessageId = `tool-${event.toolCallId}-${Date.now()}`;
    const argsText = event.input ? JSON.stringify(event.input) : "";

    const message: Message = {
      id: toolMessageId,
      role: "assistant",
      content: "",
      parts: [
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            args: event.input,
            argsText,
            state: "call",
          },
        },
      ],
    };

    appendMessage(message);
    toolMessageMapRef.current.set(event.toolCallId, toolMessageId);
    lastToolMessageIdRef.current = toolMessageId;
  };

  const handleToolOutput = (event: Extract<StreamEvent, { type: "tool-output-available" }>) => {
    const messageId = toolMessageMapRef.current.get(event.toolCallId);
    if (!messageId) return;
    const existing = messageHistoryRef.current.find((msg) => msg.id === messageId);
    if (!existing) return;

    const existingPart = existing.parts?.[0];
    if (!existingPart || existingPart.type !== "tool-invocation") return;

    const updatedMessage: Message = cloneMessage(existing);
    const invocation = updatedMessage.parts![0].toolInvocation;
    invocation.state = "result";
    invocation.result = event.output;

    updateMessageHistory(messageId, updatedMessage);
    controllerRef.current?.updateMessage(messageId, updatedMessage);
  };

  const handleScreenshotUpdate = (event: Extract<StreamEvent, { type: "screenshot-update" }>) => {
    const messageId = lastToolMessageIdRef.current;
    if (!messageId || !event.screenshot) return;

    const existing = messageHistoryRef.current.find((msg) => msg.id === messageId);
    if (!existing?.parts?.length) return;

    const updatedMessage: Message = cloneMessage(existing);
    const invocation = updatedMessage.parts![0].toolInvocation;
    invocation.result = { type: "image", data: event.screenshot };
    invocation.state = "result";

    updateMessageHistory(messageId, updatedMessage);
    controllerRef.current?.updateMessage(messageId, updatedMessage);
  };

  const handleFinish = () => {
    setIsStreaming(false);
    setStatus(STATUS_READY);
    currentAssistantIdRef.current = null;
  };

  const handleError = (event: Extract<StreamEvent, { type: "error" }>) => {
    setIsStreaming(false);
    setStatus(STATUS_ERROR);
    toast.error("There was an error", {
      description: event.errorText || "Streaming error",
      richColors: true,
      position: "top-center",
    });
  };

  const processEvent = (event: StreamEvent) => {
    switch (event.type) {
      case "text-delta":
        handleTextDelta(event);
        break;
      case "tool-input-available":
        handleToolInput(event);
        break;
      case "tool-output-available":
        handleToolOutput(event);
        break;
      case "screenshot-update":
        handleScreenshotUpdate(event);
        break;
      case "finish":
        handleFinish();
        break;
      case "error":
        handleError(event);
        break;
      default:
        break;
    }
  };

  const readStream = async (response: Response) => {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) {
          try {
            processEvent(JSON.parse(buffer));
          } catch (error) {
            console.error("Failed to process trailing event", error);
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          processEvent(JSON.parse(line));
        } catch (error) {
          console.error("Failed to parse streaming line", error, line);
        }
      }
    }
  };

  const stop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsStreaming(false);
    setIsSubmitted(false);
    setStatus(STATUS_READY);
    currentAssistantIdRef.current = null;
    toolMessageMapRef.current = new Map();
    lastToolMessageIdRef.current = null;
  };

  const send = async (userMessage: string) => {
    const controller = controllerRef.current;
    if (!controller) return;

    const trimmed = userMessage.trim();
    if (!trimmed) return;

    const message: Message = {
      id: `user-${Date.now()}-${Math.random()}`,
      role: "user",
      content: trimmed,
    };

    appendMessage(message);
    setInput("");
    setIsStreaming(true);
    setStatus(STATUS_STREAMING);
    setIsSubmitted(false);
    currentAssistantIdRef.current = null;
    toolMessageMapRef.current = new Map();
    lastToolMessageIdRef.current = null;

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch(`/api/chat?_=${Date.now()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messageHistoryRef.current,
          sandboxId,
          timestamp: Date.now(),
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      await readStream(response);
      setIsStreaming(false);
      setStatus(STATUS_READY);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.warn("Streaming aborted");
      } else {
        console.error("Streaming error", error);
        setStatus(STATUS_ERROR);
        toast.error("There was an error", {
          description: error instanceof Error ? error.message : String(error),
          richColors: true,
          position: "top-center",
        });
      }
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement> | ChangeEvent<HTMLTextAreaElement>) => {
    setInput(event.target.value);
  };

  const handleFormSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!input.trim() || isStreaming || isInitializing) return;
    setIsSubmitted(true);
    setStatus(STATUS_SUBMITTED);
    void send(input);
  };

  const handlePromptSubmit = (prompt: string) => {
    if (isStreaming || isInitializing) return;
    setIsSubmitted(true);
    setStatus(STATUS_SUBMITTED);
    void send(prompt);
  };

  const refreshDesktop = async () => {
    try {
      setIsInitializing(true);
      const { streamUrl: url, id } = await getDesktopURL(sandboxId || undefined);
      setStreamUrl(url);
      setSandboxId(id);
    } catch (error) {
      console.error("Failed to refresh desktop", error);
    } finally {
      setIsInitializing(false);
    }
  };

  useEffect(() => {
    if (!sandboxId) return;

    const killDesktop = () => {
      if (!sandboxId) return;
      navigator.sendBeacon(`/api/kill-desktop?sandboxId=${encodeURIComponent(sandboxId)}`);
    };

    const isIOS =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

    if (isIOS || isSafari) {
      window.addEventListener("pagehide", killDesktop);
      return () => {
        window.removeEventListener("pagehide", killDesktop);
        killDesktop();
      };
    }

    window.addEventListener("beforeunload", killDesktop);
    return () => {
      window.removeEventListener("beforeunload", killDesktop);
      killDesktop();
    };
  }, [sandboxId]);

  useEffect(() => {
    const init = async () => {
      try {
        setIsInitializing(true);
        const { streamUrl: url, id } = await getDesktopURL(undefined);
        setStreamUrl(url);
        setSandboxId(id);
      } catch (error) {
        console.error("Failed to initialize desktop", error);
        toast.error("Failed to initialize desktop");
      } finally {
        setIsInitializing(false);
      }
    };

    void init();
  }, []);

  return (
    <div className="flex h-dvh">
      <div className="flex w-full flex-col xl:w-96 xl:border-r xl:border-border">
        <div className="flex items-center justify-between bg-background px-4 py-2">
          <AISDKLogo />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4" ref={containerRef}>
          <div ref={messagesHostRef} className="space-y-6" />
          <div ref={endRef} className="pb-2" />
        </div>

        {!hasMessages ? (
          <PromptSuggestions
            disabled={isInitializing || isStreaming}
            submitPrompt={handlePromptSubmit}
          />
        ) : null}

        <div className="bg-background">
          <form onSubmit={handleFormSubmit} className="p-4">
            <Input
              handleInputChange={handleInputChange}
              input={input}
              isInitializing={isInitializing}
              isLoading={isLoading}
              status={status}
              stop={stop}
            />
          </form>
        </div>
      </div>

      <div className="relative hidden flex-1 items-center justify-center bg-black xl:flex">
        {streamUrl ? (
          <>
            <iframe
              src={streamUrl}
              className="h-full w-full"
              style={{ transformOrigin: "center" }}
              allow="autoplay"
            />
            <Button
              onClick={refreshDesktop}
              className="absolute right-2 top-2 z-10 rounded bg-black/50 px-3 py-1 text-sm text-white hover:bg-black/70"
              disabled={isInitializing}
            >
              {isInitializing ? "Creating desktop..." : "New desktop"}
            </Button>
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-white">
            {isInitializing ? "Initializing desktop..." : "Loading stream..."}
          </div>
        )}
      </div>
    </div>
  );
}
