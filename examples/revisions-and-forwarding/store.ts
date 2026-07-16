// [impl:session/store#2.4.1]
const sessions = new Map<string, string>();

export function persist(id: string, data: string): void {
  sessions.set(id, data);
}
