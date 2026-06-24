import { FormEvent, useState } from "react";
import { Loader2, SendHorizontal } from "lucide-react";

type PromptInputProps = {
  initialPrompt: string;
  repoUrl: string;
  depth: number;
  loading: boolean;
  onSubmit: (values: { prompt: string; repoUrl?: string | undefined; depth: number }) => void;
};

const suggestions = [
  "Explain authentication flow",
  "Show checkout architecture",
  "What services use Redis?",
  "How are payments processed?"
];

export const PromptInput = ({ initialPrompt, repoUrl, depth, loading, onSubmit }: PromptInputProps) => {
  const [prompt, setPrompt] = useState(initialPrompt);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit({
      prompt,
      repoUrl: repoUrl.trim() || undefined,
      depth
    });
  };

  return (
    <form className="query-console" onSubmit={submit}>
      <div className="query-input-row">
        <label className="sr-only" htmlFor="architecture-prompt">
          Ask Atlas
        </label>
        <input
          id="architecture-prompt"
          className="command-input"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Ask anything about this codebase..."
        />
        <button className="send-action" type="submit" disabled={loading || prompt.trim().length < 2}>
          {loading ? <Loader2 size={18} className="animate-spin" /> : <SendHorizontal size={18} />}
        </button>
      </div>

      <div className="suggestion-row">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="suggestion-chip"
            onClick={() => {
              setPrompt(suggestion);
              onSubmit({
                prompt: suggestion,
                repoUrl: repoUrl.trim() || undefined,
                depth
              });
            }}
            disabled={loading}
          >
            <span aria-hidden="true">›</span>
            {suggestion}
          </button>
        ))}
      </div>
    </form>
  );
};
