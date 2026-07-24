import { describe, it, expect } from 'vitest';
import { SseFrameParser, buildSessionUrl } from './mcp-proxy.js';

/**
 * The MCP front door. Every JSON-RPC message the agent sends is framed by SseFrameParser, and a bug in
 * the chunk-boundary or line-ending handling would silently corrupt or drop it — yet the framing was
 * only ever exercised end-to-end. These pin the edge cases a socket makes hard to reproduce on demand.
 */
describe('SseFrameParser — MCP front-door framing', () => {
  const dataOf = (frames: { data: string }[]): string[] => frames.map((f) => f.data);

  it('parses a single event:/data: frame terminated by a blank line', () => {
    const p = new SseFrameParser();
    expect(p.push('event: endpoint\ndata: /session/abc\n\n')).toEqual([
      { event: 'endpoint', data: '/session/abc' },
    ]);
  });

  it('defaults the event name to "message" when only data: is present', () => {
    const p = new SseFrameParser();
    expect(p.push('data: {"jsonrpc":"2.0"}\n\n')).toEqual([
      { event: 'message', data: '{"jsonrpc":"2.0"}' },
    ]);
  });

  it('holds a frame split ACROSS chunks until the terminating blank line arrives', () => {
    const p = new SseFrameParser();
    // A field is split mid-line, and the frame is not complete until the blank line in a later chunk.
    expect(p.push('event: mess')).toEqual([]);
    expect(p.push('age\ndata: {"id":')).toEqual([]);
    expect(p.push('1}\n')).toEqual([]);
    expect(p.push('\n')).toEqual([{ event: 'message', data: '{"id":1}' }]);
  });

  it('normalises CRLF and bare CR line endings', () => {
    const p = new SseFrameParser();
    expect(p.push('event: x\r\ndata: a\r\n\r\n')).toEqual([{ event: 'x', data: 'a' }]);
    const q = new SseFrameParser();
    expect(q.push('data: b\r\r')).toEqual([{ event: 'message', data: 'b' }]);
  });

  it('accumulates multi-line data: fields newline-joined', () => {
    const p = new SseFrameParser();
    expect(p.push('data: line1\ndata: line2\n\n')).toEqual([
      { event: 'message', data: 'line1\nline2' },
    ]);
  });

  it('ignores id:/retry:/comment lines (not needed for the bridge)', () => {
    const p = new SseFrameParser();
    expect(p.push('id: 7\nretry: 3000\n:comment\ndata: real\n\n')).toEqual([
      { event: 'message', data: 'real' },
    ]);
  });

  it('emits multiple frames from one chunk and does not emit an empty frame', () => {
    const p = new SseFrameParser();
    // Two complete frames plus a leading blank line (no data → no frame).
    expect(dataOf(p.push('\ndata: one\n\ndata: two\n\n'))).toEqual(['one', 'two']);
  });

  it('resets event/data between frames (a bare data frame after a named one is "message")', () => {
    const p = new SseFrameParser();
    p.push('event: endpoint\ndata: /s\n\n');
    expect(p.push('data: next\n\n')).toEqual([{ event: 'message', data: 'next' }]);
  });
});

describe('buildSessionUrl', () => {
  it('turns a path into a loopback URL on the daemon port, leaves an absolute URL untouched', () => {
    expect(buildSessionUrl('/messages?sessionId=abc', 4460)).toBe(
      'http://127.0.0.1:4460/messages?sessionId=abc',
    );
    expect(buildSessionUrl('http://127.0.0.1:9/x', 4460)).toBe('http://127.0.0.1:9/x');
  });
});
