"use client";

import { useState, useRef, useCallback } from "react";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  done?: boolean;
  error?: boolean;
}

interface UseChatReturn {
  messages: Message[];
  isStreaming: boolean;
  toolInProgress: string | null;
  sendMessage: (text: string) => void;
}

let idCounter = 0;
const uid = () => `msg-${++idCounter}-${Date.now()}`;

export function useChat(apiUrl: string | undefined): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [toolInProgress, setToolInProgress] = useState<string | null>(null);
  const historyRef = useRef<{ role: string; content: string }[]>([]);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isStreaming || !apiUrl) return;

      const userMsg: Message = { id: uid(), role: "user", content: text, done: true };
      const assistantId = uid();
      const assistantMsg: Message = { id: assistantId, role: "assistant", content: "", streaming: true };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsStreaming(true);

      const history = historyRef.current.slice();
      history.push({ role: "user", content: text });

      try {
        const res = await fetch(`${apiUrl}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text, history: history.slice(0, -1) }),
        });

        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        readerRef.current = reader;
        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";

          for (const part of parts) {
            const lines = part.split("\n");
            let eventType = "message";
            let dataStr = "";

            for (const line of lines) {
              if (line.startsWith("event: ")) eventType = line.slice(7).trim();
              else if (line.startsWith("data: ")) dataStr = line.slice(6).trim();
            }

            if (!dataStr) continue;

            let payload: Record<string, unknown> = {};
            try { payload = JSON.parse(dataStr); } catch { continue; }

            if (eventType === "token") {
              const chunk = (payload.text as string) ?? "";
              fullText += chunk;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: fullText } : m))
              );
            } else if (eventType === "tool_start") {
              setToolInProgress((payload.name as string) ?? "tool");
            } else if (eventType === "tool_end") {
              setToolInProgress(null);
            } else if (eventType === "done") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, streaming: false, done: true } : m
                )
              );
              historyRef.current = [...history, { role: "assistant", content: fullText }];
            } else if (eventType === "error") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: (payload.message as string) || "An error occurred.", streaming: false, error: true, done: true }
                    : m
                )
              );
            }
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Connection failed.";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: errMsg, streaming: false, error: true, done: true }
              : m
          )
        );
      } finally {
        setIsStreaming(false);
        setToolInProgress(null);
        readerRef.current = null;
      }
    },
    [apiUrl, isStreaming]
  );

  return { messages, isStreaming, toolInProgress, sendMessage };
}
