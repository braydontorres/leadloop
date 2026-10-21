import type { Session, SupabaseClient, User } from "@supabase/supabase-js";

export type AuthState = { session: Session | null; user: User | null };

function fail(error: { message?: string } | null) {
  if (error) throw new Error(error.message || "Authentication request failed.");
}

export async function currentAuth(client: SupabaseClient): Promise<AuthState> {
  const { data, error } = await client.auth.getSession();
  fail(error);
  return { session: data.session, user: data.session?.user ?? null };
}

export async function signUpWithEmail(
  client: SupabaseClient,
  email: string,
  password: string,
  redirectTo: string,
) {
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: redirectTo },
  });
  fail(error);
  return data;
}

export async function signInWithEmail(
  client: SupabaseClient,
  email: string,
  password: string,
) {
  const { data, error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  fail(error);
  return data;
}

export async function sendPasswordRecovery(
  client: SupabaseClient,
  email: string,
  redirectTo: string,
) {
  const { error } = await client.auth.resetPasswordForEmail(email, {
    redirectTo,
  });
  fail(error);
}

export async function updatePassword(client: SupabaseClient, password: string) {
  const { error } = await client.auth.updateUser({ password });
  fail(error);
}

export async function signOut(client: SupabaseClient) {
  const { error } = await client.auth.signOut();
  fail(error);
}
