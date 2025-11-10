/**
 * STREAMING CONFIGURATION
 * 
 * Ustawienia dla real-time streamingu.
 */

export const STREAMING_CONFIG = {
  ENABLE_BUFFERING: false,
  ENABLE_MESSAGE_GROUPING: false,
  ENABLE_ARGUMENT_CHUNKING: false,
  ARGUMENT_CHUNK_SIZE: 0,
  IMMEDIATE_PROCESSING: true,
  
  STREAMING_HEADERS: {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  },
} as const;

export function validateStreamingConfig(): void {
  if (STREAMING_CONFIG.ENABLE_BUFFERING) {
    throw new Error('BŁĄD: Buforowanie jest włączone!');
  }
  
  if (STREAMING_CONFIG.ENABLE_MESSAGE_GROUPING) {
    throw new Error('BŁĄD: Grupowanie wiadomości jest włączone!');
  }
  
  if (STREAMING_CONFIG.ENABLE_ARGUMENT_CHUNKING) {
    throw new Error('BŁĄD: Chunking argumentów jest włączony!');
  }
  
  if (!STREAMING_CONFIG.IMMEDIATE_PROCESSING) {
    throw new Error('BŁĄD: Natychmiastowe przetwarzanie jest wyłączone!');
  }
}

validateStreamingConfig();
