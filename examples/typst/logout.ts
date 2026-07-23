// [impl:auth/logout#1]
const revokedTokens = new Set<string>();

export function logout(token: string): void {
  revokedTokens.add(token);
}

export function isRevoked(token: string): boolean {
  return revokedTokens.has(token);
}
