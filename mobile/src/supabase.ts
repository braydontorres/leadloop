import * as SecureStore from "expo-secure-store";
import { AppState } from "react-native";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mobileSupabaseConfig } from "./config";
import { shouldRefreshSupabaseForAppState } from "./app-state-refresh";

const config = mobileSupabaseConfig(process.env);

const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase: SupabaseClient | null = config
  ? createClient(config.url, config.anonKey, {
      auth: {
        storage: secureStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;

// Supabase does not automatically refresh sessions while a React Native app is
// backgrounded. Keep the native session current when the app returns to the
// foreground so the voice request does not send an expired access token.
if (supabase) {
  const refreshForAppState = (state: string | null | undefined) => {
    if (shouldRefreshSupabaseForAppState(state))
      supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  };
  refreshForAppState(AppState.currentState);
  AppState.addEventListener("change", refreshForAppState);
}

export function configuredSupabase(): SupabaseClient {
  if (!supabase)
    throw new Error(
      "Cloud sign-in is not configured. Add EXPO_PUBLIC_SUPABASE_URL and a publishable key to mobile/.env.",
    );
  return supabase;
}
