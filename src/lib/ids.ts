/** ID личного чата: uid собеседников в алфавитном порядке. Так у двух людей всегда один чат. */
export function privateChatId(a: string, b: string): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export function savedChatId(uid: string): string {
  return `saved_${uid}`;
}

export function privateMembers(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function otherMember(members: string[], me: string): string {
  return members.find((m) => m !== me) ?? me;
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(length = 12): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
