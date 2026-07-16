// [impl:session/api#1.3]
import { persist } from './store';

export function openSession(id: string): void {
  persist(id, '{}');
}
