import type { Message } from "@/app/hooks/useChat";

interface Props {
  message: Message;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-xs mr-2 mt-0.5 flex-shrink-0">
          ✈
        </div>
      )}
      <div
        className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? "bg-blue-600 text-white rounded-tr-sm"
            : message.error
            ? "bg-red-950 text-red-300 border border-red-800 rounded-tl-sm"
            : "bg-gray-800 text-gray-100 rounded-tl-sm"
        }`}
      >
        {message.content || (message.streaming ? null : <span className="text-gray-500 italic">Empty response</span>)}
        {message.streaming && !message.content && (
          <span className="inline-flex gap-0.5 ml-1">
            <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
            <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
            <span className="w-1 h-1 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
          </span>
        )}
        {message.streaming && message.content && (
          <span className="inline-block w-0.5 h-3.5 bg-gray-400 ml-0.5 animate-pulse align-middle" />
        )}
      </div>
    </div>
  );
}
