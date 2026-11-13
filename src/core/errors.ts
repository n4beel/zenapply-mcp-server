export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export function formatToolError(err: unknown): { isError: true; content: [{ type: 'text'; text: string }] } {
  let message = 'An unexpected error occurred.';
  if (err instanceof ToolError) {
    message = err.message;
  } else if (err instanceof Error) {
    message = err.message;
  }
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: message,
      },
    ],
  };
}
