// [impl:auth/login#1]
export function login(token: string): boolean {
  return token.length > 0;
}
