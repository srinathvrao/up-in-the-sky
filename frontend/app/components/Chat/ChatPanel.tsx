"use client";

import { useEffect, useRef } from "react";
import { useChat } from "@/app/hooks/useChat";
import { MessageBubble } from "./MessageBubble";
import { ToolIndicator } from "./ToolIndicator";
import { ChatInput } from "./ChatInput";

const API_URL = process.env.NEXT_PUBLIC_API_HTTP_URL;

export function ChatPanel() {
  const { messages, isStreaming, toolInProgress, sendMessage } = useChat(API_URL);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, toolInProgress]);

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wider">AI Assistant</h2>
        {!API_URL && (
          <span className="text-xs text-orange-400 bg-orange-900/30 px-2 py-0.5 rounded">
            API URL not configured
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-3 p-6">
            <span className="text-3xl">💬</span>
            <p className="text-sm text-center text-gray-500">
              Ask me about any flight or area.
              <br />
              Try: <em className="text-gray-400">"Where is AAL123 right now?"</em>
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {toolInProgress && (
          <div className="ml-9 mb-2">
            <ToolIndicator toolName={toolInProgress} />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <ChatInput onSend={sendMessage} disabled={isStreaming} />
    </div>
  );
}
