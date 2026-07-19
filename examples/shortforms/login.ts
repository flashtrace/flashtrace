// [impl:auth/login#1]
// [>>impl:auth/session]
import { openSession } from './session';

export function login(token: string): boolean {
  if (token.length === 0) return false;
  openSession(token);
  return true;
}
