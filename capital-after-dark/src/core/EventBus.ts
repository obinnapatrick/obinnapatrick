// Typed-ish pub/sub used to decouple systems (combat -> witnesses -> police -> missions -> memory).
export type GameEvent = { type: string; [k: string]: any };
type Handler = (e: GameEvent) => void;

export class EventBus {
  private handlers = new Map<string, Set<Handler>>();
  on(type: string, h: Handler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(h);
    return () => this.handlers.get(type)?.delete(h);
  }
  emit(e: GameEvent): void {
    this.handlers.get(e.type)?.forEach((h) => h(e));
    this.handlers.get('*')?.forEach((h) => h(e));
  }
}
